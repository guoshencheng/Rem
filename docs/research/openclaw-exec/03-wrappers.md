<!--
调研文档 #3
主题：Wrapper、Carrier、Inline-Eval 拆解
调研者：subagent 3（general）
调研范围：shell-wrapper-resolution.ts、command-carriers.ts、exec-wrapper-trust-plan.ts、command-analysis/inline-eval.ts、command-analysis/risks.ts
原合并文档位置：第 4 节
关联文档：README.md、00-overview.md、02-parser.md、04-safe-bin.md、08-synthesis.md
-->

# 03. Wrapper、Carrier 与 Inline-Eval 拆解

> 调研者：subagent 3
> 主题：OpenClaw 如何把 `sh -c "..."` / `sudo` / `env -S "..."` / `python -c` 这类"披着外套"的命令拆解校验
> 关联源码：`shell-wrapper-resolution.ts`、`command-carriers.ts`、`exec-wrapper-trust-plan.ts`、`command-analysis/inline-eval.ts`

## 4. Wrapper、Carrier 与 Inline-Eval 拆解

OpenClaw 把"披着外套执行的命令"按层级解耦成三条独立管道，分别由 `shell-wrapper-resolution.ts`、`command-carriers.ts`、`command-analysis/inline-eval.ts` 承担，再通过 `exec-wrapper-trust-plan.ts` 与 `dispatch-wrapper-resolution.ts` 把多跳 dispatch 串起来。它们之间是**串联而非替代**：每次解包后都需要重新识别下一层是否仍属于 carrier / shell / inline-eval，直到深度耗尽或不再匹配为止。

### 4.1 职责边界与调用顺序

调用顺序固定如下，深度逐层递减：

```
argv ──► exec-wrapper-trust-plan
            ├─ dispatch-wrapper-resolution  (nice/time/caffeinate/script/...)
            ├─ shell-wrapper-resolution     (busybox sh)
            └─ shell-inline-command         (-c / -lc / -Command / -EncodedCommand)

argv ──► command-carriers                  (env / sudo / doas / command / builtin / exec)
            └─ env -S 内递归 resolveEnvCarriedArgv (depth ≤ 32)

argv ──► shell-wrapper-resolution          (sh / bash / zsh / fish / dash / ksh / ash / cmd / powershell)
            └─ shell-inline-command          (-c / -lc / -Command / -File / -EncodedCommand)

argv ──► command-analysis/risks
            ├─ inline-eval (python -c / node -e / awk -e / find -exec / ...)
            ├─ shell-positional-trampoline   (sh -c '$@ "$0"' -- rm -rf /)
            └─ carrier-then-inline-eval       (sudo env -S "node -e ...")
```

关键约束来自 `dispatch-wrapper-resolution.ts:14` 的 `MAX_DISPATCH_WRAPPER_DEPTH = 4` —— 即整个解包回路最多穿透 4 层 dispatch，超过会被 `blockedDispatchWrapperPlan` fail-closed。

### 4.2 `extractShellWrapperInlineCommand` 与嵌套 shell

入口在 `shell-wrapper-resolution.ts:382`：

```ts
export function extractShellWrapperInlineCommand(argv: string[]): string | null {
  return resolveShellWrapperSpecAndArgvInternal(argv, 0)?.payload ?? null;
}
```

`resolveShellWrapperSpecAndArgvInternal` 内部调用 `resolveShellWrapperCandidate`（`shell-wrapper-resolution.ts:73-114`），候选阶段会**先 unwrap dispatch、再 unwrap shell multiplexer**，把 `argv` 缩短后再判断 token0 是不是 shell wrapper。所以 `time -p busybox sh -c "sh -c 'rm -rf /'"` 会被剥到 `["sh", "-c", "sh -c 'rm -rf /'"]`，payload 即第二层字符串。**深度限制不在 shell 层而在 dispatch 层**（`isWithinDispatchClassificationDepth` 使用 `MAX_DISPATCH_WRAPPER_DEPTH`），而 `unwrapKnownShellMultiplexerInvocation` 会显式 fail-closed：碰到 `busybox sed` 这种 applet 不是已知 shell 直接返回 `{ kind: "blocked" }`（`shell-wrapper-resolution.ts:194-200`）。

POSIX 形式由 `resolveInlineCommandMatch` 扫描 `-lc`/`-c`/`--command`（`shell-inline-command.ts:6`），并支持 `bash -OO -c "..."` 这种 combined short-option —— `parseCombinedCommandFlag` 在 `shell-inline-command.ts:83-102` 处理 `-cfoo` 形态。

### 4.3 `env -S` 递归与 `MAX_ENV_SPLIT_PAYLOAD_DEPTH`

`command-carriers.ts:12` 常量：

```ts
const MAX_ENV_SPLIT_PAYLOAD_DEPTH = 32;
```

递归入口在 `resolveEnvSplitPayload`（`command-carriers.ts:201-214`）：

```ts
function resolveEnvSplitPayload(
  payload: string,
  trailingArgv: string[],
  depth: number,
): string[] | null {
  const innerArgv = splitShellArgs(payload);
  if (!innerArgv || innerArgv.length === 0) {
    return null;
  }
  const carriedArgv = [...innerArgv, ...trailingArgv];
  // env -S can recursively introduce another env wrapper; keep a bounded depth
  // so malicious argv cannot create unbounded parser work.
  return resolveEnvCarriedArgv(["env", ...carriedArgv], depth + 1) ?? carriedArgv;
}
```

外层 `parseEnvInvocationPrelude` 在 `command-carriers.ts:228` 守住入口 `depth > MAX_ENV_SPLIT_PAYLOAD_DEPTH` 即返回 `null`。即 `env -S 'env -S "env -S ..."'` 至多递归 32 层，第 33 层直接 fail-closed 成 null，让 carrier 整体不被信任。

### 4.4 `COMMAND_CARRIER_EXECUTABLES` 与 carrier 检测

`command-carriers.ts:8` 一行确定名单：

```ts
export const COMMAND_CARRIER_EXECUTABLES = new Set(["sudo", "doas", "env", "command", "builtin"]);
```

注意 `exec` 默认**不在**该集合里，仅在调用方显式 `resolveCarrierCommandArgv(argv, 0, { includeExec: true })` 时启用（见 `command-carriers.ts:416` 和 `risks.ts:57-58`）。每个 carrier 在 `command-carriers.ts:224-398` 里有独立的选项表：

- `env`：`ENV_OPTIONS_WITH_VALUE` (`-S` / `-s` / `--split-string` / `-C` / `-P` / `-u` / `--chdir` / `--argv0` / `--block-signal` 等，`command-carriers.ts:16-29`)
- `sudo`：`SUDO_OPTIONS_WITH_VALUE` 17 项 + `SUDO_STANDALONE_OPTIONS` 25 项 + `SUDO_NON_EXEC_OPTIONS` 12 项 (`-K` / `-l` / `-v` / `--edit` / `--validate`)，非 exec 形式直接 fail-closed（`command-carriers.ts:81-93`）
- `doas`：精简到 3 个 with-value、3 个 standalone
- `command` / `builtin`：只看 `-p` / `-v` / `-V`，其它拒识（`command-carriers.ts:14-15`）

选项解析器 `parseCarrierOptionToken`（`command-carriers.ts:113-161`）支持 combined short-flag，例如 `-iS` 中的 `S` 自动识别为 split-string；unknown flag 直接返回 `null`，让 carrier 拒绝解包。

### 4.5 `resolveCarrierCommandArgv` 的提取算法

`command-carriers.ts:400-420` 是统一分发：

```ts
export function resolveCarrierCommandArgv(
  argv: string[],
  depth = 0,
  options?: { includeExec?: boolean },
): string[] | null {
  const executable = normalizeExecutableToken(argv[0] ?? "");
  switch (executable) {
    case "env":       return resolveEnvCarriedArgv(argv, depth);
    case "command":
    case "builtin":   return resolveCommandBuiltinCarriedArgv(argv);
    case "sudo":
    case "doas":      return resolveSudoLikeCarriedArgv(argv);
    case "exec":      return options?.includeExec ? resolveExecCarriedArgv(argv) : null;
    default:          return null;
  }
}
```

对 `sudo node script.js`：`sudo` 跳到 `resolveSudoLikeCarriedArgv`（`command-carriers.ts:327-374`），跳过 known options，遇到 `node` 这种非 `-` 开头 token 直接返回 `argv.slice(index)`，即 `["node", "script.js"]`。同时 `stripSudoEnvAssignmentsFromCommandArgv`（`command-carriers.ts:180-192`）会剥掉 `sudo` 之前的 `FOO=bar` 风格赋值。

### 4.6 `inline-eval.ts` 的 spec 表

`command-analysis/inline-eval.ts:37-76` 是 flag 形式解释器：

| 解释器 | 名称集合 | inline flag |
|---|---|---|
| python | `python python2 python3 pypy pypy3` | `-c` |
| node 系 | `node nodejs bun deno` | `-e --eval -p --print` |
| awk 系 | `awk gawk mawk nawk` | `-e --source`（含 `--source=` 前缀） |
| ruby | `ruby` | `-e` |
| perl | `perl` | `-e -E` |
| php | `php` | `-r` |
| lua | `lua` | `-e` |
| osascript | `osascript` | `-e` |
| find | `find` | `-exec -execdir -ok -okdir`（`scanPastDoubleDash: true`） |
| make 系 | `make gmake` | `-f --file --makefile --eval` + raw `-E` |
| sed 系 | `sed gsed` | raw `-e`（prefix `-e`） |

`command-analysis/inline-eval.ts:78-149` 是 positional spec：

| 解释器 | positional flag | 备注 |
|---|---|---|
| awk 系 | `<program>` | 跳过 `-f/--file`、`-F/-W/-v/-i/-l` 等 value flag |
| xargs | `<command>` | 跳过 `-a/-d/-E/-I/-L/-n/-P/-s` 与 `--eof`/`--replace` |
| sed 系 | `<program>` | 跳过 `-f/--file`、`-l`、可选 `-i` |

### 4.7 `awk 'script' file` 与 `find -exec` 的识别

`awk 'script' file` 走的是 positional spec。`inline-eval.ts:236-282` 会从 argv[1] 往后扫描：碰到 `-f`/`--file` 返回 null（用脚本文件不是 inline）；碰到 `-F`/`-v`/`-W` 这种带值 flag 跳过；最后命中第一个非 `-` token 即视为 `<program>`。

`find -exec rm -rf {} \;` 走 flag spec：`exactFlags: new Set(["-exec", "-execdir", "-ok", "-okdir"])` 加 `scanPastDoubleDash: true`，意味着扫描时遇到 `--` 仍继续。`risks.ts:290-295` 单独用 `detectCommandCarrierArgv` 把 `-exec/-ok` 标记为 carrier，让 approval UI 展示"find 隐藏子命令"。

### 4.8 多跳 dispatch 与 `MAX_DISPATCH_WRAPPER_DEPTH`

`dispatch-wrapper-resolution.ts:14` 定义 `MAX_DISPATCH_WRAPPER_DEPTH = 4`。15 个 dispatch wrapper 注册在 `DISPATCH_WRAPPER_SPECS`（`dispatch-wrapper-resolution.ts:386-422`），分两类：

- **有 unwrap 且 transparent**：nice / caffeinate / nohup / sandbox-exec / stdbuf / timeout
- **有 unwrap 但 conditional**：time（`-o` 写文件时阻断）、script（始终阻断，darwin/freebsd）、env（带 modifier 时阻断）、arch/xcrun（仅 darwin）
- **无 unwrap 直接阻断**：chrt / doas / ionice / setsid / sudo / taskset

`resolveDispatchWrapperTrustPlan`（`dispatch-wrapper-resolution.ts:513-553`）循环 `for depth < maxDepth`，任何一次返回 blocked 都 fail-closed。`hasDispatchEnvManipulation`（`dispatch-wrapper-resolution.ts:555-560`）专门识别"dispatch env 之后再带 shell wrapper"—— 用于 `hasEnvManipulationBeforeShellWrapper`。

### 4.9 `exec-wrapper-trust-plan.ts` 输出结构

输出结构定义在 `exec-wrapper-trust-plan.ts:13-21`：

```ts
type ExecWrapperTrustPlan = {
  argv: string[];                  // 解包后的最终 argv
  policyArgv: string[];            // 信任策略要校验的 argv（首次 multiplexer 时保持原貌）
  wrapperChain: string[];          // 跳过的 dispatch wrapper 名字链
  policyBlocked: boolean;          // 是否 fail-closed
  blockedWrapper?: string;         // 被阻断的具体 wrapper
  shellWrapperExecutable: boolean; // 是否最终落到 shell wrapper
  shellInlineCommand: string | null; // 提取的 inline payload
};
```

调用方在 `exec-wrapper-trust-plan.ts:1078-1106` 的 `renderInlineChainSegmentArgv` 里就是用 `extractShellWrapperInlineCommand(segment.argv)` → `analyzeShellCommand` → `buildEnforcedShellCommand` 三步把 inline 字符串重新解析成 argv 段再 enforce。另外 `command-explainer/extract.ts:949-964` 把它当作风险条目 `kind: "shell-wrapper"` 写到 explain payload。

### 4.10 Windows PowerShell 与 `stripWindowsShellWrapperOnce`

PowerShell 在两处独立处理：

1. **argv 视角**（`shell-inline-command.ts:24-57`）：通过 `expandPowerShellSwitchPrefixForms` 展开 `-c`/`-command`/`--command`/`/c`/`/command` 全集共 24 种写法的 inline flag；同时识别 `-EncodedCommand`/`-ec`/`/ec` 把 base64 payload 当作 inline。
2. **字符串视角**（`exec-approvals-analysis.ts:561-638`）：`stripWindowsShellWrapperOnce` 用三层正则剥 `& exe args`（call-operator）、`powershell.exe -NoProfile -Command "inner"`（双引号，`""` → `"`）、`powershell -c 'inner'`（单引号，`''` → `'`）、无引号裸 payload。`stripWindowsShellWrapper` 固定上限 `MAX_DEPTH = 5`（`exec-approvals-analysis.ts:562`）。注释明确写 `cmd /c` 故意**不**剥——`cmd /c` 的 inner 在 Windows 仍由 PowerShell 解释，强制让调用方走显式 allowlist。

### 4.11 拆解结果如何回流到上游

整条数据流是**自顶向下、然后自底向上反馈**：

1. `resolveExecWrapperTrustPlan` 把 dispatch / multiplexer 串起来，输出 `argv + wrapperChain + shellInlineCommand`；
2. `command-analysis/risks.ts:47-76` 的 `buildCommandPayloadCandidates` 用 `seenArgv` Set 防环，递归调用 `resolveCarrierCommandArgv` 和 `extractShellWrapperInlineCommand`；
3. 命中 inline-eval 时调用 `detectInlineEvalArgv`（`risks.ts:248-268`），先看 `detectInterpreterInlineEvalArgv`（flag 形式）、再看 `detectShellPositionalCarrierInlineEvalArgvInternal`（`sh -c '$@ "$0"' -- cmd`）、最后看 `detectCarrierInlineEvalArgvInternal`（dispatch → carrier → 解释器）；
4. explain 模块在 `command-explainer/extract.ts:944-968` 把 inline-eval 与 shell-wrapper 写到 `risks[]`；approvals 在 `exec-approvals-analysis.ts:1073-1106` 用 `extractShellWrapperInlineCommand` + `analyzeShellCommand` 重建执行 argv 后再 allowlist 校验。

### 4.12 完整示例：`sudo env -S "node -e 'rm -rf /'"`

四层嵌套的完整拆解路径：

```
原始 argv
  ["sudo", "env", "-S", "node -e 'rm -rf /'"]
   |
   v step 1 - dispatch wrapper（risks → carrier）        ← depth 1
   sudo 不在 DISPATCH_WRAPPER_SPECS unwrap 表，fail-closed 透传
   |
   v step 2 - command carrier（command-carriers.ts:400）  ← depth 1
   resolveCarrierCommandArgv → env 分支
   parseEnvInvocationPrelude 命中 -S → resolveEnvSplitPayload
   splitShellArgs → ["node", "-e", "rm -rf /"]
   depth = 1，未超过 32，递归结束
   carriedArgv = ["node", "-e", "rm -rf /"]
   |
   v step 3 - inline-eval（risks.ts:258 → inline-eval.ts:200）
   node 在 FLAG_INTERPRETER_INLINE_EVAL_SPECS
   exactFlags = {-e, --eval, -p, --print}
   命中 "-e" → createInlineEvalHit("node", [...], "-e")
   |
   v step 4 - 反向反馈
   shellInlineCommand = "rm -rf /"
   explain.risks.push({ kind: "inline-eval", command: "node", flag: "-e" })
   approvals.renderInlineChainSegmentArgv → analyzeShellCommand("rm -rf /")
   → segmentSatisfiedBy = ["allowlist"? null] → 触发 approval gate
```

ASCII 流程图：

```
+------------------------------------------------------------------+
| argv: sudo env -S "node -e 'rm -rf /'"                           |
+--------------------------------+---------------------------------+
                                 |
        +------------------------v------------------------+
        | resolveExecWrapperTrustPlan (depth <= 4)        |
        |   dispatch -> env (modifier? no -S => blocked)  |
        |   wrapperChain = ["env"], policyBlocked=true    |
        +------------------------+------------------------+
                                 |
        +------------------------v------------------------+
        | command-carriers: env -S -> splitShellArgs      |
        |   depth=1/32 -> carriedArgv=[node,-e,rm -rf /]  |
        +------------------------+------------------------+
                                 |
        +------------------------v------------------------+
        | inline-eval: detectInterpreterInlineEvalArgv   |
        |   exactFlags {-e} hit → InterpreterInlineEvalHit|
        +------------------------+------------------------+
                                 |
        +------------------------v------------------------+
        | risks.buildCommandPayloadCandidates            |
        |   seenArgv 去环 → 输出 ["node -e rm -rf /"]    |
        +------------------------+------------------------+
                                 |
        +------------------------v------------------------+
        | explain.risks / approvals policy gate           |
        |   { kind:"inline-eval", command:"node",        |
        |     flag:"-e", payload:"rm -rf /" }            |
        +-------------------------------------------------+
```

整套设计是 **fail-closed + bounded depth + cycle-safe**：`MAX_DISPATCH_WRAPPER_DEPTH=4` 防过度跳，`MAX_ENV_SPLIT_PAYLOAD_DEPTH=32` 防 `env -S` 自递归，`seenArgv` 防 carrier↔shell 互递归，任何一层返回 null 立即阻断而不是静默透传。

---

