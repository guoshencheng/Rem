<!--
调研文档 #7
主题：持久化 allow-always、Effective Policy 合并、测试覆盖
调研者：subagent 7（general）
调研范围：infra/exec-approvals.ts（持久化部分）、infra/exec-approvals-effective.ts、11 个测试文件（exec-approvals-*.test.ts、bash-tools.exec*.test.ts）
原合并文档位置：第 8 节
关联文档：README.md、00-overview.md、06-decision-flow.md、08-synthesis.md
-->

# 07. 持久化 allow-always、Effective Policy 合并、测试覆盖

> 调研者：subagent 7
> 主题：OpenClaw 如何原子写 `~/.openclaw/exec-approvals.json`、用 `=command:<sha256>` 模式匹配 allow-always、合并三层 policy、覆盖 11 个测试文件 380+ 用例
> 关联源码：`infra/exec-approvals.ts`（持久化部分）、`infra/exec-approvals-effective.ts`、11 个测试文件

## 8. 持久化 allow-always 与测试覆盖

### A. Durable allow-always 持久化机制

#### A.1 持久化后端与默认路径

OpenClaw 的"持久化 allow-always"只有**单一后端**：本地 JSON 文件。仓库内不存在 `exec-approvals-store-sqlite.ts` 之类多后端实现；`grep` 整个 `infra/` 也找不到任何 `sqlite / drizzle / kysely` 痕迹（参见 `src/infra/exec-approvals.ts` 全文只导入 `node:fs` 与 `node:crypto`）。

默认路径常量定义于 `src/infra/exec-approvals.ts:287-288`：

```ts
const DEFAULT_SOCKET = "~/.openclaw/exec-approvals.sock";
const DEFAULT_FILE = "~/.openclaw/exec-approvals.json";
```

并由 `src/infra/exec-approvals.ts:297-303` 通过 `expandHomePrefix` 展开为真实绝对路径：

```ts
export function resolveExecApprovalsPath(): string {
  return expandHomePrefix(DEFAULT_FILE);
}

export function resolveExecApprovalsSocketPath(): string {
  return expandHomePrefix(DEFAULT_SOCKET);
}
```

#### A.2 Atomic Write 保证

写盘路径在 `src/infra/exec-approvals.ts:784-808` 实现了一套完整的"temp file → rename → 失败 fallback copy"三段式原子写：

```ts
function writeExecApprovalsRaw(filePath: string, raw: string) {
  const dir = ensureDir(filePath);
  assertSafeExecApprovalsDestination(filePath);
  const tempPath = path.join(dir, `.exec-approvals.${process.pid}.${crypto.randomUUID()}.tmp`);
  ...
  fs.writeFileSync(tempPath, raw, { mode: 0o600, flag: "wx" });
  ...
  renameExecApprovalsWithFallback(tempPath, filePath);
}
```

关键防御措施：

- **symlink 拒绝**：`assertSafeExecApprovalsDestination` (L371-382) 用 `lstatSync` 拒绝符号链接目标；`ensureDir` 用 `assertNoSymlinkParentsSync` 拒绝中间目录包含 symlink（`exec-approvals.ts:344-360`）。
- **目录权限归零**：`ensureDir` 强制 `chmodSync(dir, 0o700)`，文件强制 `chmodSync(filePath, 0o600)`，temp file 同样 `0o600`。
- **Windows EPERM/EEXIST 回退**：当 `fs.renameSync` 抛出 `EPERM` 或 `EEXIST` 时（Windows 上其它进程持有文件句柄），回退到 `copyExecApprovalsFallback` (L539-560) 用 `O_NOFOLLOW` 打开现有 fd，先 snapshot 原内容，再 truncate 写入新内容，最后用 fstat 比对 dev/ino 防止 TOCTOU swap。
- **hard-link 拒绝**：`assertSafeExecApprovalsOverwriteFallback` (L384-396) 检测 `nlink > 1` 时直接 throw `Refusing copy fallback for hard-linked exec approvals file`，避免覆盖被多处共享的 inode。

#### A.3 `buildDurableCommandApprovalPattern` 详解

定义于 `src/infra/exec-approvals.ts:1262-1265`：

```ts
function buildDurableCommandApprovalPattern(commandText: string): string {
  const digest = crypto.createHash("sha256").update(commandText).digest("hex").slice(0, 16);
  return `=command:${digest}`;
}
```

要点：

- **SHA-256 取前 16 个 hex 字符**（64 位熵）。`exec-approvals-store.test.ts:621` 用 `^=command:[0-9a-f]{16}$` 显式断言此格式。
- **不带明文命令**：`exec-approvals-store.test.ts:622` 断言 entry 上 `not.toHaveProperty("commandText")`，即"durable approval 不存明文"。
- **配套 `=node-command:`**：`buildNodeCommandApprovalPattern`（L1267-1270）生成 `=node-command:<sha256-prefix>`，专用于 `persistAllowAlwaysPatterns` 在 `coverage.complete` 时写入的"全命令级"标记，仅记录哈希、不存明文。
- **strip 早**：调用前先用 `commandText.trim()`（`addDurableCommandApproval` L1433、`persistAllowAlwaysPatterns` L1516），哈希输入是 trim 后的字符串。

#### A.4 `hasExactCommandDurableExecApproval` 匹配与空白处理

定义于 `src/infra/exec-approvals.ts:1286-1301`：

```ts
function hasExactCommandDurableExecApproval(params: {...}): boolean {
  const normalizedCommand = params.commandText?.trim();
  if (!normalizedCommand) {
    return false;
  }
  const commandPattern = buildDurableCommandApprovalPattern(normalizedCommand);
  return (params.allowlist ?? []).some(
    (entry) =>
      entry.source === "allow-always" &&
      (entry.pattern === commandPattern ||
        (typeof entry.commandText === "string" && entry.commandText.trim() === normalizedCommand)),
  );
}
```

匹配策略：

1. 入口处 `params.commandText?.trim()` —— 输入和存盘都先 trim，**头尾空白不区分**。
2. 比较 `entry.pattern === "=command:<sha256-prefix>"`，或兼容旧条目用 `entry.commandText.trim() === normalizedCommand`（仅当历史数据已经包含明文时才走这条分支，新写入路径已剥离明文，见 `stripAllowlistCommandText` 在 L626-642）。
3. 要求 `entry.source === "allow-always"`` —— 普通 allowlist 条目即使 pattern 长得像也不会被识别为 durable。
4. **`hasDurableExecApproval`**（L1244-1260）是 OR 组合：精确命令命中 OR 所有 segment 都来自 allow-always，任一成立即返回 true。

#### A.5 `hasSegmentDurableExecApproval` 判定

定义于 `src/infra/exec-approvals.ts:1303-1312`：

```ts
function hasSegmentDurableExecApproval(params: {...}): boolean {
  return (
    params.analysisOk &&
    params.segmentAllowlistEntries.length > 0 &&
    params.segmentAllowlistEntries.every((entry) => entry?.source === "allow-always")
  );
}
```

三连条件：

1. `analysisOk === true`：管道解析必须成功（不允许 broken shell）。
2. `segmentAllowlistEntries.length > 0`：至少有一个 segment；空命令直接 false。
3. **每个 segment 的 entry 都标 `source === "allow-always"`**：`policyBlocked` 的 segment 会得到 `null`（`exec-approvals-allowlist.ts:622-627`），`null?.source` 不等于 `"allow-always"`，整个链立刻短路 false —— `exec-approvals-policy.test.ts:317-366` "marks policy-blocked segments as non-durable allowlist entries" 测试用例显式断言这一点。

#### A.6 过期机制与 Revoke

**没有 TTL**。代码搜索无 `expiresAtMs` / `TTL` / `expire` 字段出现在 `ExecAllowlistEntry` 类型中（`src/infra/exec-approvals.types.ts:3-12` 只有 `id / pattern / source / commandText / argPattern / lastUsedAt / lastUsedCommand / lastResolvedPath`）。

**Revoke 路径**：

- 直接删除 JSON 文件中对应 entry（用户手动编辑或 `openclaw doctor --fix` 迁移）。
- `restoreExecApprovalsSnapshot` (`exec-approvals.ts:810-820`) 可整体回滚到上一份 snapshot。
- `mergeExecApprovalsSocketDefaults` 仅合并 socket 字段，不删 allowlist。

#### A.7 跨 session / per-workspace / per-agent

**跨 session 共享**（同一台机器所有 session 共享一份 `~/.openclaw/exec-approvals.json`）；**per-agent** 由 `agents.<agentId>.allowlist` 隔离，`addAllowlistEntry` (`exec-approvals.ts:1377-1426`) 在 L1386 用 `const target = agentId ?? DEFAULT_AGENT_ID;` 选择目标 agent。`recordAllowlistMatchesUse` 与 `recordAllowlistUse` 沿用同一套目标定位。**无 per-workspace 隔离** —— 工作区信息不出现在路径或 key 中。

### B. Effective Policy 合并

定义于 `src/infra/exec-approvals-effective.ts:344-442` 的 `resolveExecPolicyScopeSnapshot`，共三层：

1. **Requested**：来自 `OpenClawConfig.tools.exec`（global）+ `agents.list.<id>.tools.exec`（agent override）。解析顺序在 `resolveRequestedPolicy` (L149-262)：scope.mode > global.mode > scope.legacy (security/ask) > global.legacy > OpenClaw default (`DEFAULT_REQUESTED_SECURITY="full"` / `DEFAULT_REQUESTED_ASK="off"`)。
2. **Host**：从 `~/.openclaw/exec-approvals.json` 解析出的 `resolved.agent.{security, ask, askFallback}`，遵循"rawAgent > rawWildcard > defaults > OpenClaw default"链（`exec-approvals.ts:918-988` 中的 `resolveAgentSecurityField` / `resolveAgentAskField`）。
3. **Effective**：核心合并在 `exec-approvals-effective.ts:371-374`：

```ts
const effectiveSecurity    = minSecurity(requestedPolicy.security, resolved.agent.security);
const effectiveAsk         = maxAsk(requestedPolicy.ask, resolved.agent.ask);
const effectiveAskFallback = minSecurity(effectiveSecurity, resolved.agent.askFallback);
```

- `minSecurity`（`exec-approvals.ts:1530-1533`）: `deny(0) < allowlist(1) < full(2)`，**取更严格者**。
- `maxAsk`（`exec-approvals.ts:1535-1538`）: `off(0) < on-miss(1) < always(2)`，**取更激进者**。
- `askFallback` 进一步 clamp 到 effectiveSecurity（不允许 fallback 比 effective 还宽松）。
- **mode**：当 (effectiveSecurity, effectiveAsk) 与 requested 不一致时，按新组合重派生 `resolveExecModeFromPolicy`；一致则保留 requested.mode。

### C. 测试覆盖

#### C.1 测试文件职责

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/infra/exec-approvals-analysis.test.ts` | 1260 | shell/argv parser、safe-bin shell 重建、Windows 转义、heredoc 行续接、`buildSafeBinsShellCommand` 行为 |
| `src/infra/exec-approvals-allow-always.test.ts` | 1151 | `resolveAllowAlwaysPatterns`、wrapper unwrap (busybox/toybox/caffeinate/nice/time/sudo/sandbox-exec/arch/xcrun)、shell-script 路径持久化、allow-always bypass 防护矩阵 |
| `src/infra/exec-approvals-store.test.ts` | 931 | store helpers：路径展开、atomic write、symlink/hard-link 拒绝、EPERM fallback copy、TOCTOU swap 防护、`addDurableCommandApproval`、socket wire protocol |
| `src/infra/exec-approvals-policy.test.ts` | 812 | `hasDurableExecApproval`、policy merging (`minSecurity`/`maxAsk`)、effective policy snapshot、agent field source attribution、wildcard `*`、默认 agent 迁移 |
| `src/infra/exec-approvals-config.test.ts` | 458 | wildcard agent 合并、`legacy default` 迁移、非法 enum 剥离（`#59006`）、`#9790` spread-string artifacts |
| `src/infra/exec-approvals-safe-bins.test.ts` | 600 | sort/grep/jq/wc/head/tr denied flags、`POSIX ${IFS}` 注入拦截、trusted-dir 信任链、Windows 平台强制禁用 |
| `src/infra/exec-approvals-parity.test.ts` | 34 | shell-parser 与 wrapper-resolution **fixture 驱动**的回归测试（data-driven） |
| `src/agents/bash-tools.exec-approval-request.test.ts` | 497 | 两阶段 gateway 注册、决策等待、timeout fallback、命令高亮 lazy load |
| `src/agents/bash-tools.exec-host-gateway.test.ts` | 1162 | gateway host 路径：allowlist miss、auto-review、strict inline-eval、diagnostics follow-up、result routing |
| `src/agents/bash-tools.exec-host-node.test.ts` | 2778 | node host 路径：脚本注入、symlink 交换、shell-bleed、approval session-binding |
| `src/agents/bash-tools.exec.script-preflight.test.ts` | 634 | Python/Node 脚本预检：shell-bleed、symlink/path race、`fs-safe` hooks 注入 |

总测试文件 11 份，按 "describe + it" 拆分约 380+ 测试用例（含 `it.each` 数据驱动行）。

#### C.2 Fixture / Snapshot 机制

`src/infra/exec-approvals-test-helpers.ts:94-117` 暴露两个 JSON fixture loader：

```ts
export function loadShellParserParityFixtureCases(): ShellParserParityFixtureCase[] {
  const fixturePath = path.join(process.cwd(),
    "test", "fixtures", "exec-allowlist-shell-parser-parity.json");
  ...
}

export function loadWrapperResolutionParityFixtureCases(): ... {
  const fixturePath = path.join(process.cwd(),
    "test", "fixtures", "exec-wrapper-resolution-parity.json");
  ...
}
```

`exec-approvals-parity.test.ts:13-24` 直接 `it.each(fixtures)` 跑表驱动回归。fixture 本身在 `test/fixtures/` 目录，**没有内联 snapshot 工具**（无 `toMatchSnapshot` 调用）。

#### C.3 关键边界用例（≥15 条具体描述）

1. **`hasDurableExecApproval` 接受精确命令哈希**：`exec-approvals-policy.test.ts:288-302` 用 `=command:613b5a60181648fd` + `commandText` 验证精确哈希命中。
2. **`hasDurableExecApproval` 接受多 segment 全 allow-always**：`exec-approvals-policy.test.ts:304-315` 验证 `/usr/bin/echo` + `/usr/bin/printf` 双 segment。
3. **policy-blocked segment 阻断整链**：`exec-approvals-policy.test.ts:317-366` 显式断言 `policyBlocked=true` 的 segment 让 durable 判定为 false。
4. **不持久化 interpreter-like 可执行**：`exec-approvals-allow-always.test.ts:208-226` 验证 `awk '{print $1}' data.csv` 不会被持久化（除非开 strictInlineEval）。
5. **trust realpath 持久化**：`:228-247` 验证 `rg` 的 `resolvedRealPath`（Cellar 路径）被持久化，不是 `resolvedPath`。
6. **Windows strict inline-eval 强制 argv-bound**：`exec-approvals-allow-always.test.ts:278-318` 验证 `argPattern` 必须匹配，否则 `matchAllowlist` 返回 null。
7. **PowerShell `-File/-fi//file` argv 边界**：`exec-approvals-allow-always.test.ts:320-381` 用 `it.each` 表驱动测空参数、别名、`env` dispatch unwrap 三种场景。
8. **shell wrapper unwrap**：`exec-approvals-allow-always.test.ts:402-456` 验证 `/bin/zsh -c 'whoami'` 持久化 `whoami` 而非 `zsh`；`:430-456` 验证 `&&` 链会去重。
9. **shell script 路径持久化 + 反例**：`exec-approvals-allow-always.test.ts:458-509` 验证 `bash scripts/save_crystal.sh` 存脚本路径，而 `--rcfile / --init-file / --startup-file` 直接拒绝。
10. **shell 启动标志拒绝**：`exec-approvals-allow-always.test.ts:524-559` 6 种 `--login/-i/-lc/$0/$1` 组合全部不持久化。
11. **busybox sh applet 持久化 + fail-closed**：`exec-approvals-allow-always.test.ts:762-791` 持久 `whoami`；`:793-818` 失败 `busybox sed`。
12. **allow-always bypass 防御矩阵**：`exec-approvals-allow-always.test.ts:840-925` 显式测 caffeinate / nice / sandbox-exec / time 各种 wrapper-chain 形态，确保二次用 `id > marker` 命令仍触发审批。
13. **macOS dispatch wrapper (arch/xcrun)**：`:927-949` 在 darwin 平台下专项测 `/usr/bin/arch -arm64` 与 `/usr/bin/xcrun`。
14. **awk 解释器 carry bypass**：`exec-approvals-allow-always.test.ts:987-1013` 验证 `sh -c '$0 "$@"' awk 'BEGIN{system("id")}'` 不会持久化 awk，从而二次 system() 调用仍被拦。
15. **comment-tailed payload 不持久化**：`:1051-1066` 验证 `benign warmup # && payload` 只持久化 `benign`，后续 `payload` 单跑仍需审批。
16. **位置参数载体 (positional carrier) 严格规则**：`:561-600` 验证 `$0 "$1"` / `exec --` 形态接受，但 `$0` 加单引号或 exec 跨换行立即拒绝。
17. **JSON store atomic write + EPERM fallback**：`exec-approvals-store.test.ts:397-451` 用 `vi.spyOn(fs, "renameSync")` 注入 EPERM，验证 fallback copy + 清理 temp file；`:453-487` 验证 copy 中途 ENOSPC 会回滚到 previousRaw。
18. **hard-link + symlink 双重拒绝**：`:523-558` 同时测 hard-link 与 symlink target 都不被覆盖。
19. **OPENCLAW_HOME 自身 symlink 允许但子目录 symlink 拒绝**：`:560-588` 验证 home 软链接允许，`.openclaw/` 子目录软链接拒绝（防"路径被偷换"）。
20. **durable approval 不存明文**：`exec-approvals-store.test.ts:608-623` 显式断言 `addDurableCommandApproval` 写入条目没有 `commandText` 属性；`:625-645` 验证 normalization 会剥离历史遗留明文。
21. **`=node-command:` 标记仅在 coverage.complete 时写**：`exec-approvals-store.test.ts:805-885` 对完整覆盖写，对 `sh -c '/bin/echo ok && missingcmd'` 部分覆盖跳过；并断言不写 `lastUsedCommand` 字段。
22. **safe-bin denied flags 全面表驱动**：`exec-approvals-safe-bins.test.ts:70-176` 用 `buildDeniedFlagVariantCases` 生成 sort/grep/jq/wc 的多种 `--flag=val` / `--flag val` / `-fval` / `-f val` 变体，统一期望 `false`。
23. **`${IFS}` 参数扩展拦截**：`:228-251` 验证 safe-bin 模式下 `head -c${IFS}16` 与 `tr ${IFS}` 都被拒。
24. **空 string allowlist 修复**：`exec-approvals-config.test.ts:267-353` 验证 `["ls", "cat"]` 旧字符串数组被 coerce 为对象数组而不退化为 `{0:"l",1:"s"...}` spread artifacts；空字符串、非法对象、非数组各自有 case。
25. **非法 enum 静默剥离**：`exec-approvals-config.test.ts:356-457` 测 `security:"none"` / `ask:"never"` / 数字 / 布尔 / 数组都被剥离。
26. **mode 解析覆盖**：`exec-approvals-policy.test.ts:158-200` 表驱动 6 组 mode→{security, ask, autoReview} 映射。
27. **`minSecurity`/`maxAsk` 对称性**：`exec-approvals-policy.test.ts:216-238` 三组两两对比，验证对换参数顺序结果不变。
28. **三层 policy 合并优先级**：`exec-approvals-policy.test.ts:368-403` 验证 requested security="full" / host="allowlist" → effective="allowlist"（host 更严则取 host），且 `note: "stricter host security wins"`。
29. **ask 单边"更激进者胜"**：`exec-approvals-policy.test.ts:553-574` 验证 requested "always" 不会因 host "off" 而降级。
30. **shell 解析 fixture 驱动**：`exec-approvals-parity.test.ts:13-24` 用 `test/fixtures/exec-allowlist-shell-parser-parity.json` 跑 `it.each(fixtures)`。

#### C.4 测试组织

- **Unit**：默认 `*.test.ts` 共置于源文件旁（colocated），全部走 vitest。`exec-approvals-policy.test.ts:11-12` 用 `vi.unmock` 配合 `vi.importActual`（L31-54）确保走真实实现而非 mock 版本。
- **Integration**：所有 store 测试用 `OPENCLAW_HOME` 指向 `makeTempDir()`（`exec-approvals-store.test.ts:70-75`）模拟真实 home，验证整条 fs → JSON → chmod → rename 链路。
- **E2E**：`src/agents/bash-tools.exec-gateway-approval.e2e.test.ts` 是唯一的 `*.e2e.test.ts`（未在用户列表中），跑真实 gateway 协议往返；其余 exec 文件均为单元/集成粒度。
- **Fixture-driven**：`exec-approvals-parity.test.ts` 是唯一 `it.each(fixtures)` 数据驱动测试。

#### C.5 关于跨文件契约

- `exec-approvals-store.test.ts:7-11` 用 `vi.mock("./jsonl-socket.js")` 替换 socket 实现，验证 wire protocol shape（`{type:"request", token, id, request}`），与 `requestExecApprovalViaSocket` (exec-approvals.ts:1577-1607) 一致。
- `bash-tools.exec-host-gateway.test.ts:14-29` 注入 `vi.hoisted` mock，覆盖 `evaluateShellAllowlist` / `analyzeShellCommand` 等敏感函数，使"approval flow 不依赖真实解析器"。
- `bash-tools.exec.script-preflight.test.ts:9` 通过 `__setFsSafeTestHooksForTest` 注入 fs-safe hook，模拟 TOCTOU symlink swap，验证预检能拒绝。

---

