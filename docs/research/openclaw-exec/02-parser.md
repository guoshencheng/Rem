<!--
调研文档 #2
主题：Shell 命令解析（Parser/Lexer）
调研者：subagent 2（general）
调研范围：infra/exec-approvals-analysis.ts（1279 行核心）
原合并文档位置：第 3 节
关联文档：README.md、00-overview.md、03-wrappers.md、04-safe-bin.md、08-synthesis.md
-->

# 02. Shell 命令解析（Parser/Lexer）

> 调研者：subagent 2
> 主题：OpenClaw 的字符级 shell 状态机如何把命令字符串拆为可 allowlist 校验的 argv 段
> 关联源码：`packages/infra/exec-approvals-analysis.ts`（1279 行核心）

## 3. Shell 命令解析（Parser/Lexer）

OpenClaw 的 exec 审批把"一条 shell 命令字符串"安全地分解为可独立 allowlist 校验的 argv 段，全部逻辑集中在 `src/infra/exec-approvals-analysis.ts`（1279 行）。它不是完整的 POSIX shell parser——而是一个"白名单优先 + fail-closed"的受限解析器：拒绝一切不安全的 shell 元字符，把允许的形态规整成 `ExecCommandSegment[]`，再交给 `resolveCommandResolutionFromArgv` 做可执行文件解析。

### 3.1 文件结构与公共 API

文件可按"公共 API / 内部辅助 / 状态机"切三段：

| 段 | 行号 | 角色 |
|---|---|---|
| 公共 API + 类型导出 | `src/infra/exec-approvals-analysis.ts:14`–`:54` | 透传 `resolveCommandResolutionFromArgv`、导出 `ExecCommandSegment`、`ExecCommandAnalysis`、`ShellChainOperator`、`ShellChainPart` |
| 常量表 + 小工具 | `:56`–`:93` | `DISALLOWED_PIPELINE_TOKENS`、`DOUBLE_QUOTE_ESCAPES`、`WINDOWS_UNSUPPORTED_TOKENS`、`isShellCommentStart` 等 |
| 解析核心 | `:95`–`:436` | `splitShellPipeline`（POSIX 流水线+heredoc 主状态机） |
| Windows 路径 | `:444`–`:674` | `findWindowsUnsupportedToken`、`tokenizeWindowsSegment`、`stripWindowsShellWrapper`、`analyzeWindowsShellCommand` |
| 链式分割 + 重建 | `:681`–`:820`、`:855`–`:1191` | `parseSegmentsFromParts`、`splitCommandChainWithOperators`、`buildEnforcedShellCommand` 等 |
| 顶层入口 | `:1205`–`:1279` | `analyzeShellCommand`、`analyzeArgvCommand` |

辅助 tokenizer 是 `src/utils/shell-argv.ts`（84 行）里的 `splitShellArgs`，它专门处理"一个流水线段"（不含 `|`、`&&`、`;`），把 `cmd a "b c"` 拆成 `["cmd","a","b c"]`，未闭合引号时返回 `null` 让上层 fail-closed。

### 3.2 从字符串到 `segments[]` 的处理链

`analyzeShellCommand`（`src/infra/exec-approvals-analysis.ts:1205`）做三件事：

1. Win 平台 → `analyzeWindowsShellCommand`（`:1212`）。
2. 否则先调 `splitCommandChain(params.command)` 拆 `&&`/`||`/`;`（`:1215`）。
3. 对每一段链路调 `splitShellPipeline(part)`（`:1221`）拿"流水线段"，再调 `parseSegmentsFromParts`（`:1225`）把每个段拆 argv + 解析可执行文件。

```ts
// src/infra/exec-approvals-analysis.ts:1205
export function analyzeShellCommand(params: {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
}): ExecCommandAnalysis {
  if (isWindowsPlatform(params.platform)) {
    return analyzeWindowsShellCommand(params);
  }
  const chainParts = splitCommandChain(params.command);
  if (chainParts) {
    const chains: ExecCommandSegment[][] = [];
    const allSegments: ExecCommandSegment[] = [];
    for (const part of chainParts) {
      const pipelineSplit = splitShellPipeline(part);
      if (!pipelineSplit.ok) {
        return { ok: false, reason: pipelineSplit.reason, segments: [] };
      }
      ...
```

调用方在 `src/infra/exec-approvals.ts:1215`、`src/infra/command-analysis/policy.ts:46`、`src/infra/exec-approvals-allowlist.ts:552` 等处都先看 `analysis.ok`，`ok === false` 时直接拒绝——这是 fail-closed 的核心。`src/infra/exec-approvals.ts:1221` 还示范了一种"分析失败就退化成文本扫描"的回退。

### 3.3 核心状态机：`splitShellPipeline`

`splitShellPipeline`（`src/infra/exec-approvals-analysis.ts:95`）是一个**字符级 DFA**，不是递归下降，也不是 token 树。状态由这些变量承载：

```ts
// src/infra/exec-approvals-analysis.ts:153-164
const segments: string[] = [];
let buf = "";
let inSingle = false;
let inDouble = false;
let escaped = false;
let emptySegment = false;
const pendingHeredocs: HeredocSpec[] = [];
let inHeredocBody = false;
let heredocLine = "";
let unquotedHeredocLogicalChunks: string[] = [];
let unquotedHeredocLogicalLength = 0;
```

状态转移大致是：

```
+----------------------------------------------------------+
| start --> inSingle --> ' --> start                       |
|   |          |          (buf+= 字符 / 控制符)             |
|   v          v                                           |
| inDouble -- " --> start  (允许 \ $ ` " \n \r 转义)        |
|   |                                                      |
|   v 遇到 << 或 <<-                                       |
| push HeredocSpec{delimiter, stripTabs, quoted}           |
|   | 遇到 \n 进入                                         |
|   v                                                      |
| inHeredocBody 逐行累积                                   |
|   |-- quoted=true: 行 == delimiter 即结束                |
|   +-- quoted=false: 拼接 \<newline> 续行，               |
|       整逻辑行经 hasUnquotedHeredocExpansionToken 检查   |
+----------------------------------------------------------+
```

主循环（`:216`-`:392`）顺序判断：`inHeredocBody` → `escaped` → `inSingle` → `inDouble` → `isShellCommentStart` → `pendingHeredoc \n` → 各种算子 → `DISALLOWED_PIPELINE_TOKENS` → `$()` → 普通字符。每一处不安全分支直接 `return { ok: false, reason: "unsupported shell token: X", segments: [] }`。

`inDouble` 分支（`:297`-`:323`）是反注入最严格的一段：

```ts
// src/infra/exec-approvals-analysis.ts:297
if (inDouble) {
  if (ch === "\\" && isEscapedLineContinuation(next)) {
    return { ok: false, reason: "unsupported shell token: newline", segments: [] };
  }
  if (ch === "\\" && isDoubleQuoteEscape(next)) {
    buf += ch; buf += next; i += 1; emptySegment = false; continue;
  }
  if (ch === "$" && next === "(") {
    return { ok: false, reason: "unsupported shell token: $()", segments: [] };
  }
  if (ch === "`") {
    return { ok: false, reason: "unsupported shell token: `", segments: [] };
  }
  if (ch === "\n" || ch === "\r") {
    return { ok: false, reason: "unsupported shell token: newline", segments: [] };
  }
  ...
```

也就是说——双引号里 `$VAR` 是合法的，但 `$( )`、`` ` ``、`\<newline>` 全部硬拒。

### 3.4 `DISALLOWED_PIPELINE_TOKENS` 与算子拒绝映射

`DISALLOWED_PIPELINE_TOKENS = new Set([">", "<", "`", "\n", "\r", "(", ")"])`（`:56`）。这些字符在**非引号**位置出现时触发统一拒绝（`:384`）：

```ts
// src/infra/exec-approvals-analysis.ts:384
if (DISALLOWED_PIPELINE_TOKENS.has(ch)) {
  return { ok: false, reason: `unsupported shell token: ${ch}`, segments: [] };
}
```

但每个 token 的"实际拒因"不一样，按测试 `src/infra/exec-approvals-analysis.test.ts:167`–`:194`：

| 字符 | 触发位置 | 错误信息 |
|---|---|---|
| `<` 单个（后面不是 `<`） | `analysis.ts:384` | `unsupported shell token: <` |
| `<<` / `<<-` | `analysis.ts:363` | 进入 heredoc 分支（合法） |
| `>` | `analysis.ts:384` | `unsupported shell token: >` |
| `` ` `` | `analysis.ts:384`（非引号） 或 `:311`（双引号内） | `unsupported shell token: \`` |
| `\n` / `\r` | `analysis.ts:384`；若有 pending heredoc 则 `:340` 切到 heredoc body | `unsupported shell token: newline` |
| `(` `)` | `analysis.ts:384` | `unsupported shell token: (` / `)` |
| `&&` / `&` | `analysis.ts:349`、`:352`、`:360` | `unsupported shell token: &&` / `&` |
| `\|\|` / `\|&` | `analysis.ts:349`、`:352` | `unsupported shell token: \|\|` / `\|&` |
| `$(` | `analysis.ts:387`（非引号） / `:308`（双引号内） | `unsupported shell token: $()` |

单 `|` 是唯一被允许的流水线分隔符，由 `pushPart()` 切段（`:355`-`:359`）。

### 3.5 Heredoc 解析与 `hasUnquotedHeredocExpansionToken`

heredoc 由 `parseHeredocDelimiter`（`:102`–`:151`）解析终结符。它接受三种形态：`'EOF'`、`"EOF"`、裸 `EOF`；前两种走引号分支，后者碰到空白 / `|` / `&` / `;` / `<` / `>` 即停。

最关键的安全检查是 `hasUnquotedHeredocExpansionToken`（`:181`–`:201`），它把 heredoc 体当成纯文本扫描：

```ts
// src/infra/exec-approvals-analysis.ts:181
const hasUnquotedHeredocExpansionToken = (line: string): boolean => {
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "`" && !isEscapedInHeredocLine(line, i)) {
      return true;
    }
    if (ch === "$" && !isEscapedInHeredocLine(line, i)) {
      const next = line[i + 1];
      if (
        next === "(" || next === "{" || next === "[" ||
        (next !== undefined &&
          (/^[A-Za-z_]$/.test(next) || /^[0-9]$/.test(next) || "@*?!$#-".includes(next)))
      ) {
        return true;
      }
    }
  }
  return false;
};
```

识别 `$VAR`/`${VAR}`/`$((arith))`/`$[arith]`/`$@`/`$*`/`$?`/`$$`/`$#`/`$-`/`$!` 全部 11 种形态。被单 `\` 奇数个转义的 `$` 不会被误报（`isEscapedInHeredocLine` 数前导 `\` 的奇偶）。反引号独立判断。

quoted heredoc（`'EOF'`、`"EOF"`）**永远不做**扩展性检查，因为按 POSIX 它们是字面量；这是测试 `src/infra/exec-approvals-analysis.test.ts:357`-`:359` 期望的（`<<'EOF'`/`<<"EOF"` 接受 `$(id)`）。

### 3.6 `splitCommandChainWithOperators` 与歧义

```ts
// src/infra/exec-approvals-analysis.ts:781-803
if (ch === "&" && next === "&") {
  if (!pushPart("&&")) { invalidChain = true; }
  i += 1; foundChain = true; continue;
}
if (ch === "|" && next === "|") {
  if (!pushPart("||")) { invalidChain = true; }
  i += 1; foundChain = true; continue;
}
if (ch === ";") {
  if (!pushPart(";")) { invalidChain = true; }
  foundChain = true; continue;
}
```

策略是"必须找到至少一个算子，否则返回 `null` 让上层走纯 pipeline 路径"。`||` 与 `|` 的歧义靠 lookahead 解决（`:789` 必须 `&& next === "|"` 才识别为 `||`）。`splitCommandChainWithOperators` 维护 `invalidChain` 标志，遇到"孤立算子"（如 `echo ok &&`）或"双引号内换行转义"（`:751`）时返回 `null`，等价于整个链语法错误。这跟 `analyzeShellCommand:1215` 配合使用——若返回 `null` 直接退到 `splitShellPipeline` 整段解析。

### 3.7 Windows 路径

`analyzeWindowsShellCommand`（`src/infra/exec-approvals-analysis.ts:640`）三步走：

1. `stripWindowsShellWrapper`（`:561`，最多 5 层递归）剥 `& exe args`、`powershell/pwsh ... -Command "..."`、`cmd /c "..."`。
2. `findWindowsUnsupportedToken`（`:446`）拒绝 `&|<>;^()%!\`` 和 `\n\r`；双引号内放宽；`$VAR`/`${VAR}`/`$(...)`/`$?`/`$$` 永远拒。
3. `tokenizeWindowsSegment`（`:491`）拆 argv，区分 PowerShell 单引号（`''` 转义为 `'`）与双引号。

`%` 出现即拒，因为 cmd.exe 即使在双引号内也展开 `%VAR%`（`:444` `WINDOWS_ALWAYS_UNSAFE_TOKENS`）。

### 3.8 失败模式与边界 case

`analysisOk: false` 的返回点（共 8 处）：

1. `analysis.ts:241` `heredoc continuation too long`（>1024 续行）
2. `:249` `heredoc logical line too large`（>64 KiB）
3. `:257` / `:409` `shell expansion in unquoted heredoc`
4. `:299` / `:315` 双引号内 `\<newline>` 或裸换行
5. `:309` / `:312` 双引号内 `$(` 或 `` ` ``
6. `:350`–`:361` `&&`/`||`/`|&`/`&`/`;`
7. `:385` `DISALLOWED_PIPELINE_TOKENS` 命中
8. `:388` 非引号 `$(`
9. `:420` `unterminated heredoc`；`:424` `unterminated shell quote/escape`；`:431` `empty command` / `empty pipeline segment`
10. `:657` Windows 解析失败

调用方统一处理（`src/infra/exec-approvals.ts:1221`、`src/infra/command-analysis/policy.ts:46`）：`if (!analysis.ok)` 即拒绝、要求人工审批或拒绝执行。

### 3.9 至少 10 个解析边界 case

| # | 输入 | 期望 | 来源 |
|---|---|---|---|
| 1 | `""` | `empty command` | `:431` |
| 2 | `"  "` | `empty command` | `pushPart` 在 `:165` trim 后丢弃 |
| 3 | `"echo # hi"` | 接受，`#` 在词中不是注释 | `shell-argv.ts:69` `buf.length === 0` 才识别注释 |
| 4 | `"echo ok > out"` | `unsupported shell token: >` | `:384` |
| 5 | `'echo "a $VAR"'` | 接受（`$VAR` 在双引号内合法） | `:297` 跳过 `$` 普通情形 |
| 6 | `'echo "$(id)"'` | `unsupported shell token: $()` | `:309` |
| 7 | `'cat <<EOF\n$KEY\nEOF'` | `shell expansion in unquoted heredoc` | `:256` |
| 8 | `"cat <<'EOF'\n$(id)\nEOF"` | 接受（引号 heredoc 不扩展） | `:225` quoted 分支跳过扩展检查 |
| 9 | `"cat <<EOF\nfoo\\\nEOF\nbar\nEOF"` | 接受（`fooEOF` 不是终结符，因续行挂起） | `:255`-`:261` |
| 10 | `"cat <<EOF\n$KEY\\\nKEY\nEOF"` | `shell expansion in unquoted heredoc` | `:404`-`:410` 续行合并后再判 |
| 11 | 64 KiB + 1 字符 heredoc 逻辑行 | `heredoc logical line too large` | `:248` |
| 12 | `"echo ok &&"` | `unable to parse shell segment`（链式 split 返回 null + pipeline 空段） | `:431` `empty pipeline segment` |
| 13 | `"net use \"\\\\host\\C$\""` (win32) | 接受（裸 `$` 不跟标识符合法） | `:470` 仅当 `next ∈ [A-Za-z_{(?$]` 才拒 |
| 14 | `'powershell -Command "node a.js ""hi"""'` (win32) | 接受，argv=`["node","a.js","hi"]` | `:611` `""` → `"` |
| 15 | 长度无显式限制（仅 heredoc 受 `MAX_UNQUOTED_HEREDOC_*` 约束） | 接受 | `:58`-`:59` |

### 3.10 总结

整套解析器的设计哲学：**白名单 → 引号剥离 → token 切分 → fail-closed**。它不试图"理解 shell 语义"，而是"枚举哪些是合法的、其余一律拒绝"。关键不变量有三条：

- 单引号内字节原样保留；双引号内只允许 `$VAR`/`${VAR}`/四个转义（`\` `"` `$` `` ` ``）。
- Heredoc 终结符、引号、续行拼接都按 POSIX 规则走，但 `unquoted heredoc + 含 $扩展` 整体拒。
- 一旦发现链式算子孤立、双引号内换行、unterminated 引号、`$()`/`&&`/`<` 等都立刻返回 `ok: false`，由上游审批层降级为"人工审批 / 拒绝执行"。

---

