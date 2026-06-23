<!--
整体架构总览（综合调研者视角）
主题：3 独立管道 + 5 顺序关卡 + 数据流图
作者：综合调研者
原合并文档位置：第 1 节
关联文档：README.md、00-background.md、01-07 各子文档、08-synthesis.md
-->

# 00. 整体架构总览

> 作者：综合调研者
> 主题：从全局视角概括 OpenClaw exec 校验的 3 独立管道 + 5 顺序关卡 + 数据流图
> 关联：本文是 01-07 的总览，详细实现见各子文档

## 1. 整体架构总览

### 1.1 三条独立管道 + 五道关卡

OpenClaw 把"一条 exec 命令从工具调用到实际 spawn"划分为三层独立管道和五道顺序关卡：

**三条独立管道（按职责正交）**：

1. **Schema 管道**：`bash-tools.schemas.ts` → `agent-tools-parameter-schema.ts` 的 `normalizeToolParameterSchema`，把 TypeBox 编译为各 provider 兼容的 JSON Schema
2. **解析管道**：`analyzeShellCommand`（POSIX 状态机） / `analyzeWindowsShellCommand`（Windows 状态机） + wrapper/carrier/inline-eval 拆解
3. **决策管道**：`exec-approvals.ts`（5 mode） + `bash-tools.exec-host-gateway.ts`（host 编排） + `bash-tools.exec-approval-request.ts`（两阶段注册）

**五道顺序关卡（每个工具调用必经）**：

1. **Schema 校验**（provider 入口，参数形状）
2. **命令解析**（argv 化，识别 chain / pipeline / heredoc / shell wrapper / carrier / inline-eval）
3. **环境变量 sanitize**（inherit + override 双向，100+ 黑名单 key + 3 prefix + PATH 永远拒 override）
4. **Safe-bin & Allowlist 评估**（per-segment：trust path / profile / glob 匹配）
5. **审批决策**（5 mode + 4 种额外必问信号 + Auto-Reviewer LLM 评估 + 持久化 allow-always）

### 1.2 关键不变量

整个系统的设计哲学是 **fail-closed + bounded depth + cycle-safe**：

- 任何解析失败、未知 flag、深度超限 → 立即 `return null` 阻断上游
- 所有递归都有深度上限（`MAX_DISPATCH_WRAPPER_DEPTH=4`、`MAX_ENV_SPLIT_PAYLOAD_DEPTH=32`、`MAX_SHELL_WRAPPER_INLINE_EVAL_DEPTH=3`）
- 互递归用 `seenArgv` Set 防环
- 写盘走 `temp + rename + chmod 0o600`，EPERM 回退到 `O_NOFOLLOW` snapshot 防止 TOCTOU

### 1.3 数据流概览

```
exec tool call (LLM 产出)
   |
   v
[1] Schema 校验 (bash-tools.schemas.ts:13-59)
   | execSchema: Type.Object({ command, workdir, env, yieldMs, background, timeout, pty, elevated, host, security, ask, node })
   | normalizeToolParameterSchema 适配 Gemini/OpenAI/Anthropic/xAI 怪癖
   v
[2] 命令解析 (exec-approvals-analysis.ts:1205 analyzeShellCommand)
   | splitCommandChain -> splitShellPipeline -> parseSegmentsFromParts
   | 检测 heredoc / unquoted heredoc expansion / chain ops / DISALLOWED tokens
   | -> segments: ExecCommandSegment[]
   v
[3] Wrapper / Carrier / Inline-Eval 拆解
   | dispatch-wrapper-resolution (depth <= 4) -> shell-wrapper -> command-carriers -> inline-eval
   | 检测 sh -c / sudo / env -S / python -c / node -e
   | -> wrapperChain, shellInlineCommand, inlineEvalHits
   v
[4] Host Env Sanitize (host-env-security.ts:204-289)
   | inherit 阶段：blockedEverywhere(100) + blockedPrefixes(3) + GIT_* 专项
   | override 阶段：blockedEverywhere + blockedOverride(154) + blockedOverridePrefixes(4) + PATH 永远拒
   | -> { acceptedOverrides, rejectedBlockedKeys, rejectedInvalidKeys }
   v
[5] Script Preflight (bash-tools.exec.ts:1846-1850, 非 YOLO)
   | 读 .py / .js 文件 <= 512KB
   | 检测 $VAR 注入（正则 /\$[A-Z_][A-Z0-9_]{1,}/g）
   | 复杂 shell 包装解释器调用直接 fail-closed
   v
[6] Safe-Bin & Allowlist 评估 (exec-approvals-allowlist.ts:606-662 evaluateSegments)
   | 每个 segment 走：allowlist -> safeBins -> safeBuiltins -> skills fallback
   | safe-bin 必须从 /bin 或 /usr/bin 加载（防 workspace 假名 binary）
   | safe-bin profile 检查 flag/positional/literal（拒 glob/expansion/path-like）
   | -> { allowlistSatisfied, segmentSatisfiedBy[] }
   v
[7] 决策 (exec-approvals.ts:1119 requiresExecApproval)
   | 基础：requiresExecApproval(ask, security, allowlistSatisfied, durableApprovalSatisfied)
   | 叠加：requiresInlineEvalApproval / requiresHeredocApproval / requiresAllowlistPlanApproval / requiresSecurityAuditSuppressionApproval
   | -> requiresAsk: boolean
   v
[8] Auto-Reviewer (mode=auto only, exec-auto-reviewer.ts)
   | 调独立 LLM 评审员打分 {decision, risk, rationale}
   | risk != low 即降级到 ask
   | prompt-injection 检测短路
   v
[9] 审批注册 (bash-tools.exec-approval-request.ts:135, 两阶段)
   | 第一阶段：registerExecApprovalRequest，server 端先存 ID
   | 第二阶段：waitForDecision，preResolved 短路
   | cron 触发无 channel 走 inline 终结
   v
[10] 命令执行 (bash-tools.exec.ts:1852 runExecProcess)
   | buildEnforcedShellCommand 重新 quote argv 防二次注入
   | spawn 进程
   v
[11] 持久化 allow-always (exec-approvals.ts:1516 persistAllowAlwaysPatterns)
   | 用户选 allow-always -> 写 ~/.openclaw/exec-approvals.json
   | =command:<sha256-prefix> 或 segment-level allow-always
   | atomic write + chmod 0o600
```

---

