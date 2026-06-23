<!--
调研文档 #6
主题：决策模式、审批流、Auto-Reviewer、Channel 路由
调研者：subagent 6（general）
调研范围：infra/exec-approvals.ts、agents/exec-defaults.ts、bash-tools.exec-host-gateway.ts、bash-tools.exec-host-shared.ts、bash-tools.exec-approval-request.ts、exec-auto-reviewer.ts、exec-approval-channel-runtime.ts
原合并文档位置：第 7 节
关联文档：README.md、00-overview.md、07-persistence.md、08-synthesis.md
-->

# 06. 决策模式、审批流与 Auto-Reviewer

> 调研者：subagent 6
> 主题：OpenClaw 的 5 mode 决策、min/max 安全 floor/ceiling、4 种额外必问信号、两阶段审批注册、LLM 评审员、per-channel native card
> 关联源码：`infra/exec-approvals.ts`、`bash-tools.exec-host-gateway.ts`、`bash-tools.exec-approval-request.ts`、`exec-auto-reviewer.ts`

## 7. 决策模式、审批流与 Auto-Reviewer

### 7.1 五种 mode 与 (security, ask) 映射

`src/infra/exec-approvals.ts:24-28` 定义五种 `ExecMode`：

```ts
export type ExecSecurity = "deny" | "allowlist" | "full";
export type ExecAsk = "off" | "on-miss" | "always";
export type ExecMode = "deny" | "allowlist" | "ask" | "auto" | "full";
```

`mode` 是 `(security, ask, autoReview)` 三元组的别名。`src/infra/exec-approvals.ts:121-140` 的 `resolveExecPolicyForMode` 给出了映射：

| mode | security | ask | autoReview | 含义 |
|---|---|---|---|---|
| `deny` | `deny` | `off` | `false` | 全部拒执行，host=sandbox 默认值 |
| `allowlist` | `allowlist` | `off` | `false` | 命中 allowlist 才放行，不问 |
| `ask` | `allowlist` | `on-miss` | `false` | allowlist miss 时弹审批 |
| `auto` | `allowlist` | `on-miss` | `true` | 允许先用 LLM 评审员裁决，miss 才走人审 |
| `full` | `full` | `off` | `false` | 全部放行（yolo） |

反向 `security/ask → mode` 用 `resolveExecModeFromPolicy` (`src/infra/exec-approvals.ts:105-119`)：仅在 `(allowlist, off)` 或 `(full, off/always)` 上对应唯一 mode，否则回退 `ask`。

### 7.2 `minSecurity` / `maxAsk` 的 floor/ceiling 语义

`src/infra/exec-approvals.ts:1530-1538` 用一个简单的整数序做单调 flooor/ceiling：

```ts
export function minSecurity(a: ExecSecurity, b: ExecSecurity): ExecSecurity {
  const order: Record<ExecSecurity, number> = { deny: 0, allowlist: 1, full: 2 };
  return order[a] <= order[b] ? a : b;
}
export function maxAsk(a: ExecAsk, b: ExecAsk): ExecAsk {
  const order: Record<ExecAsk, number> = { off: 0, "on-miss": 1, always: 2 };
  return order[a] >= order[b] ? a : b;
}
```

`agents/exec-defaults.ts:226-240` 用它们把 caller 配置"收紧"：caller 可以松（security=full），但 `~/.openclaw/exec-approvals.json` 只能让它更严（security=floor at min，ask=ceiling at max）——"Approval files are safety bounds: they can only reduce security/ask from config-derived policy, never grant a less restrictive effective mode." (src/agents/exec-defaults.ts:227-228)。`bash-tools.exec-host-shared.ts:227-246` 的 `resolveExecHostApprovalContext` 同样在 host 层重做一遍 min/max。

### 7.3 `requiresExecApproval` 决策树

`src/infra/exec-approvals.ts:1119-1137`：

```ts
export function requiresExecApproval(params: {
  ask: ExecAsk; security: ExecSecurity; analysisOk: boolean;
  allowlistSatisfied: boolean; durableApprovalSatisfied?: boolean;
}): boolean {
  if (params.ask === "always") return true;                   // 强制问
  if (params.durableApprovalSatisfied === true) return false;  // durable allow-always 救场
  return params.ask === "on-miss"
      && params.security === "allowlist"
      && (!params.analysisOk || !params.allowlistSatisfied);   // allowlist 失败
}
```

### 7.4 五种额外审批触发器

`src/agents/bash-tools.exec-host-gateway.ts:408-426` 在基础策略之上又叠加四种"必问"信号：

| 变量 | 触发 | 来源 |
|---|---|---|
| `requiresInlineEvalApproval` | `strictInlineEval` + `detectPolicyInlineEval` 命中 | `src/infra/command-analysis/policy.ts:70` |
| `requiresHeredocApproval` | allowlist 命中 + 任一 segment 含 `<<` | `src/agents/bash-tools.exec-host-gateway.ts:408-412` |
| `requiresAllowlistPlanApproval` | allowlist 命中但 `buildEnforcedShellCommand` 失败（无 safe re-render） | `src/agents/bash-tools.exec-host-gateway.ts:414-419` |
| `requiresSecurityAuditSuppressionApproval` | 命令提到 `security.audit.suppressions` 且非只读 `config get/schema/validate` | `src/infra/exec-approvals.ts:1197-1242`（除 yolo 即 security=full & ask=off 跳过） |

任一为真就 `requiresAsk = true`（同文件 427-438 行）。

### 7.5 完整审批流水线（gateway host）

`src/agents/bash-tools.exec-host-gateway.ts:348-826` 的 `processGatewayAllowlist` 是 host=gateway 的中枢。`src/agents/bash-tools.exec.ts:1790-1839` 调用它。完整步骤：

```
[1] resolveExecHostApprovalContext                              351 → floors caller config
[2] evaluateShellAllowlist (chain/pipe/builtin + safeBins)      357
[3] allowlistSatisfied / analysisOk / matches                   369
[4] hasDurableExecApproval (=command:<sha16> / segment allow-always)  371
[5] detectPolicyInlineEval (strictInlineEval)                    377
[6] buildEnforcedShellCommand  (rebuild cmd by quoting argv)     388-399
[7] derive requiresHeredoc/InlineEval/AllowlistPlan/AuditSuppr   408-426
[8] requiresAsk = requiresExecApproval || any extra trigger     427-438
[9] autoReview path (mode=auto only):
      - canAutoReviewApprovalMiss = autoReview && hostAsk!=always  463-467
         && autoReviewHasBoundCommand && !auditSuppr
      - reviewer({reason: strict-inline-eval|heredoc|...})       473-499
      - decision.decision=="allow-once" → return override       500-514
[10] createAndRegisterDefaultExecApprovalRequest                 521-561
      ↳ registerExecApprovalRequestForHostOrThrow (two-phase)  528-548
      ↳ unavailableReason / preResolvedDecision                558-561
[11] shouldResolveExecApprovalUnavailableInline (cron headless) 562-602
      ↳ enforceStrictInlineEvalApprovalBoundary
[12] resolveApprovalForExecution → wait for gateway decision    608-682
      ↳ allow-once  → approvedByAsk=true
      ↳ allow-always → approvedByAsk + persistAllowAlwaysPatterns
      ↳ decision="deny" or timeout → deniedReason
[13] shouldAwaitGatewayApprovalInline (internal channel)         684-702
[14] async follow-up branch (fire-and-forget void async)        719-791
      ↳ runExecProcess + sendExecApprovalFollowupResult
[15] else: return buildExecApprovalPendingToolResult              793-807
[16] catch-all allowlist-miss → throw "exec denied: allowlist miss"  810-819
```

四种结果对象（`ProcessGatewayAllowlistResult`，`src/agents/bash-tools.exec-host-gateway.ts:107-112`）：

- `execCommandOverride`：以"安全 re-render"串替换原命令（`src/infra/exec-approvals-analysis.ts:1166-1191` 的 `buildEnforcedShellCommand` 用 `shellEscapeSingleArg` 把 argv 逐项单引号包起，再用原 pipeline 符号拼回，**防止重解析时二次注入**）
- `allowWithoutEnforcedCommand`：allowlist 命中但 re-render 失败，只能放行原命令（需要审批链路同意）
- `pendingResult`：UI/通道收到 `approval-pending` 状态，等用户回复
- `deniedResult`：deny/timeout/audit-suppression 等直接终态

### 7.6 两阶段注册（two-phase registration）

`src/agents/bash-tools.exec-approval-request.ts:135-154` 注释直接点出原因：

> "Two-phase registration is critical: the ID must be registered server-side before exec returns `approval-pending`, otherwise `/approve` can race and orphan."

时序：

```
client  ──register──▶  gateway  (exec.approval.request, twoPhase=true)
   ◀──{expiresAtMs, [finalDecision]}──    (no decision yet → id persisted)
   ──return approval-pending──           (UI 渲染 approvalSlug)
   ──waitDecision──▶  gateway            (long-poll)
   ◀──{decision}──
```

注册走 `callGatewayTool("exec.approval.request", { timeoutMs: DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS }, ...)`（同文件 140-145）。解析响应时区分 `decision` 字段是否**显式存在**（`parseDecision` 104-117）：注册响应故意省略 `decision`，而 `waitDecision` 才会带 `decision`——这个差异让客户端在 `requestExecApprovalDecision`（186-195）能决定是直接返回还是 long-poll。

`preResolvedDecision` 来自另一条路：channel runtime 在注册时就同步收到了 `/approve` 命令，把 decision 写进 `registration.finalDecision` 透出（`src/agents/bash-tools.exec-approval-request.runtime.ts` + `src/agents/bash-tools.exec-host-shared.ts:317-318`）。`resolveRegisteredExecApprovalDecision`（175-184）优先用 preResolved，再走 `waitForExecApprovalDecision`（156-173），这避免了"先 long-poll 再超时"的死循环。

`createAndRegisterDefaultExecApprovalRequest`（`src/agents/bash-tools.exec-host-shared.ts:298-339`）把"创建 id、注册、获取 preResolved"三步打包成一次 round-trip；`shouldResolveExecApprovalUnavailableInline`（416-426）只在 `trigger==='cron'` 且 `no-approval-route` 且 `preResolvedDecision===null` 时才把审批判定 inline 终结（cron 不能挂住等审批）。

### 7.7 Auto-Reviewer

`createModelExecAutoReviewer`（`src/agents/exec-auto-reviewer.ts:236-334`）是 mode=auto 的"先问 LLM 评审员"组件：

- **输入** `ExecAutoReviewInput`（`src/infra/exec-auto-review.ts:21-46`）：command、argv、cwd、envKeys、host、reason、analysis 摘要、agent id/sessionKey
- **输出** `ExecAutoReviewDecision`（5-15）：`{decision: "allow-once" | "ask", risk, rationale}`
- **风险分数**：`{low|medium|high|unknown}` 来自模型，**`parseExecAutoReviewResponse`**（116-170）做严格 sanitize：risk ≠ "low" 时即使 decision="allow" 也降级为 "ask"
- **prompt**：`DEFAULT_EXEC_REVIEWER_SYSTEM_PROMPT`（`src/agents/exec-auto-reviewer.prompt.ts:1-15`），明确"untrusted data only"边界，要求 JSON `{decision, risk, rationale}` 单对象
- **超时**：`DEFAULT_EXEC_REVIEWER_TIMEOUT_MS = 30_000`、最低 1s（200-202）；超时分支返回 `ask` 决策（204-210），并 `AbortController` 中断 provider 请求（305-311）
- **prompt-injection 防御**：`hasReviewerDirective`（82-99）扫描 `command/argv/cwd/envKeys` 是否含 `(ignore|disregard|override) ... (instruction|system|...)` 这类越狱文本，命中则 `ask` 提前短路
- **未配置 cfg 退化**为 `defaultExecAutoReviewer`（`src/infra/exec-auto-review.ts:58-64`），无脑 `ask`，绝不会"auto 模式变静态白名单"
- **仅 mode=auto 触发**：`bash-tools.exec.ts:1635` `const autoReview = modePolicy.autoReview && ask === modePolicy.ask && !bypassApprovals;`，即只有 `modePolicy.autoReview===true`（即 mode=auto 推出来的）才进入评审。node host 还会被 `nodePolicyBlocksAutoReview`（`src/agents/bash-tools.exec-host-node.ts:76-89`）阻止——远端节点 policy 更严时不跨权限 auto-approve

### 7.8 Channel 路由与 per-channel native card

`src/infra/exec-approval-channel-runtime.ts:80-434` 是 gateway-backed approval runtime：建立 `createOperatorApprovalsGatewayClient`，订阅 `exec.approval.requested` / `plugin.approval.requested` / `exec.approval.resolved` 事件（`handleGatewayEvent` 226-248）；重连后 `replayPendingApprovals` 用 `exec.approval.list` / `plugin.approval.list` 拉回未决请求（250-273）。

`adapter.deliverRequested(request)` 由具体 channel 注入——native card 的渲染发生在各 `extensions/<channel>/src/` 内（OpenClaw 把 core 与 channel 解耦：channel 只渲染 portable 表达，core 负责命令树）。审批的 followup 走 `sendExecApprovalFollowup`（`src/agents/bash-tools.exec-approval-followup.ts`），再由 `bash-tools.exec-host-shared.ts:450-490` 的 `sendExecApprovalFollowupResult` 包装（含 `internalRuntimeHandoff` 幂等键 + 失败日志去重上限 256）。

未启动时（如 cron no-approval-route），runtime 的 `unavailableReason` 会被 `buildExecApprovalPendingToolResult`（`src/agents/bash-tools.exec-host-shared.ts:493-562`）渲染为 `status: "approval-unavailable"` 而不是 `approval-pending`，并附 `channel/channelLabel/accountId` 上下文。

### 7.9 端到端决策流（ASCII）

```
exec tool call
   |
   v
resolveExecDefaults ──► mode/security/ask (floor by approval file)
   |
   v
host target  ──► sandbox | gateway | node
   |
   ├─ node ──► executeNodeHostCommand ─► (node policy floors) ─► autoReview? ─► human
   |
   └─ gateway ──► processGatewayAllowlist
                       |
                       ├─ allowlist miss + autoReview → model reviewer → allow-once | ask-human
                       |
                       ├─ allowlist ok + enforced cmd  → execCommandOverride
                       |
                       └─ requiresAsk
                              ├─ inline-eval / heredoc / plan-miss / audit-suppr
                              ├─ createAndRegisterDefaultExecApprovalRequest (two-phase)
                              │     └─ preResolved?  → inline 终结
                              │     └─ unavailable?   → approval-unavailable tool result
                              │     └─ awaiting       → approval-pending tool result
                              │                         + async followup (run + notify)
                              v
                       runExecProcess (execCommandOverride 替换原命令)
                              |
                              v
                       followup → channel native card
```

简言之：5 mode 是 (security, ask, autoReview) 的命名糖；`minSecurity`/`maxAsk` 在 caller 与 approval file 两侧保证"更严的赢"；`requiresExecApproval` 是基础 OR，叠加 inline-eval/heredoc/plan-miss/audit-suppression 四种必问信号；two-phase 注册用 `decision` 字段是否出现区分"已决/待决"，cron 走 inline 终结通道；auto-reviewer 在 allowlist miss 时用小模型给低风险放行，但 prompt-injection 文本/超时/risk≠low/未配 model 全部回退到人审。

---

