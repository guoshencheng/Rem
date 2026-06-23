<!--
调研文档 #5
主题：Host 环境变量安全、脚本预检、控制命令拦截、Sandbox 路径
调研者：subagent 5（general）
调研范围：host-env-security.ts、host-env-security-policy.json、bash-tools.exec.ts（preflight + control command）、sandbox-paths.ts
原合并文档位置：第 6 节
关联文档：README.md、00-overview.md、06-decision-flow.md、08-synthesis.md
-->

# 05. Host 环境变量安全、脚本预检与控制命令拦截

> 调研者：subagent 5
> 主题：OpenClaw 如何防御 env 注入（LD_PRELOAD / NODE_OPTIONS / PATH）、检测脚本里的 shell 语法泄漏、拦截 `/approve` 等控制命令、保护 sandbox 路径
> 关联源码：`host-env-security.ts`、`host-env-security-policy.json`、`bash-tools.exec.ts`（preflight + control command）、`sandbox-paths.ts`

## 6. Host 环境变量安全、脚本预检与控制命令拦截

OpenClaw 把"agent 触达 host / sandbox 进程边界"的所有可控面统一收口到三个文件：`src/infra/host-env-security.ts` + `src/infra/host-env-security-policy.json` 定义黑名单与传播策略，`src/agents/bash-tools.exec.ts` 在 exec 工具入口把它们串联起来，`src/agents/sandbox-paths.ts` 守住 workspace 边界。下面分四块深入。

### 6.1 Host Env Security：五桶黑名单 + 三种传播模式

`host-env-security.ts:9-26` 从 JSON 策略文件组装出 5 个冻结常量，再喂给两个判定函数。**关键判定见 `host-env-security.ts:101-135` 的 `isDangerousHostEnvVarName` / `isDangerousHostInheritedEnvVarName` / `isDangerousHostEnvOverrideVarName`**——三者用同一套大写归一化逻辑，分别对应"无处不在"、"继承阶段"、"覆盖阶段"。`blockedEverywhereKeys` 同时被 `isDangerousHostEnvVarName`（继承）与 `isDangerousHostEnvOverrideVarName`（覆盖）引用，所以同一行既不会从宿主继承下来，也不允许被工具调用者覆写。

| 黑名单桶 | 条目数 | 典型例子 | 来源 |
|---|---|---|---|
| `blockedEverywhereKeys` | **100** | `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `PERL5LIB`, `RUBYLIB`, `BASHOPTS`, `BASH_ENV`, `ENV`, `KSH_ENV`, `BROWSER`, `GIT_*`（18 条：editor/external_diff/dir/work_tree/common_dir/exec_path/index_file/object_directory/alternate_object_directories/namespace/protocol_from_user/sequence_editor/template_dir/ssl_no_verify/ssl_cainfo/ssl_capath/allow_protocol），`CC`/`CXX`/`CMAKE_C_COMPILER`/`CMAKE_CXX_COMPILER`, `CARGO_BUILD_RUSTC*`, `RUSTC_WRAPPER`, `SHELL`, `SHELLOPTS`, `PS4`, `GCONV_PATH`, `IFS`, `SSLKEYLOGFILE`, `JAVA_OPTS`/`JAVA_TOOL_OPTIONS`/`_JAVA_OPTIONS`/`JDK_JAVA_OPTIONS`, `PYTHONBREAKPOINT`, `DOTNET_STARTUP_HOOKS`/`DOTNET_ADDITIONAL_DEPS`, `FPATH`, `GLIBC_TUNABLES`, `MAVEN_OPTS`, `MAKEFLAGS`/`MFLAGS`, `SBT_OPTS`/`GRADLE_OPTS`/`ANT_OPTS`, `HGRCPATH`, `EXINIT`/`VIMINIT`/`MYVIMRC`/`GVIMINIT`, `LUA_INIT*`(5), `EMACSLOADPATH`, `RUBYSHELL`, `GIT_HOOK_PATH`, `SVN_EDITOR`/`SVN_SSH`, `BZR_*`, `SUDO_ASKPASS`, `JULIA_EDITOR`, `CONFIG_SITE`/`CONFIG_SHELL`, `CMAKE_TOOLCHAIN_FILE`, `CATALINA_OPTS`, `CORECLR_PROFILER`, `HELM_PLUGINS`, `PACKER_PLUGIN_PATH`, `VAGRANT_VAGRANTFILE`, `ERL_AFLAGS`/`ERL_FLAGS`/`ERL_ZFLAGS`/`ELIXIR_ERL_OPTIONS`, `R_ENVIRON`/`R_PROFILE`/`R_ENVIRON_USER`/`R_PROFILE_USER`, `TCLLIBPATH`, `HOSTALIASES` | `host-env-security-policy.json:2-103` |
| `blockedOverrideOnlyKeys` | **154** | `HOME`, `GRADLE_USER_HOME`, `ZDOTDIR`, `GIT_DIR`/`GIT_WORK_TREE`/`GIT_COMMON_DIR`/`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES`/`GIT_NAMESPACE`, `GIT_SSH_COMMAND`/`GIT_SSH`/`GIT_PROXY_COMMAND`/`GIT_ASKPASS`, `GIT_SSL_NO_VERIFY`/`GIT_SSL_CAINFO`/`GIT_SSL_CAPATH`, `SSH_ASKPASS`, `LESSOPEN`/`LESSCLOSE`, `PAGER`/`MANPAGER`/`GIT_PAGER`, `EDITOR`/`VISUAL`/`FCEDIT`/`SUDO_EDITOR`, `PROMPT_COMMAND`, `HISTFILE`, `PERL5DB`/`PERL5DB_CMD`, `OPENSSL_CONF`/`OPENSSL_ENGINES`, `PYTHONSTARTUP`, `WGETRC`, `CURL_HOME`, `CLASSPATH`, `CFLAGS`/`CGO_CFLAGS`/`CGO_LDFLAGS`, `GOFLAGS`, `MAKEFLAGS`/`MFLAGS`, `CORECLR_PROFILER_PATH`, `PHPRC`/`PHP_INI_SCAN_DIR`, `DENO_DIR`, `BUN_CONFIG_REGISTRY`, `YARN_RC_FILENAME`, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, `NODE_TLS_REJECT_UNAUTHORIZED`/`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`/`SSL_CERT_DIR`, `REQUESTS_CA_BUNDLE`/`CURL_CA_BUNDLE`, `DOCKER_HOST`/`DOCKER_TLS_VERIFY`/`DOCKER_CERT_PATH`, `PIP_INDEX_URL`/`PIP_PYPI_URL`/`PIP_EXTRA_INDEX_URL`/`PIP_CONFIG_FILE`/`PIP_FIND_LINKS`/`PIP_TRUSTED_HOST`, `UV_INDEX`/`UV_INDEX_URL`/`UV_PYTHON`/`UV_EXTRA_INDEX_URL`/`UV_DEFAULT_INDEX`, `DOCKER_CONTEXT`, `LIBRARY_PATH`/`LDFLAGS`/`CPATH`/`C_INCLUDE_PATH`/`CPLUS_INCLUDE_PATH`/`OBJC_INCLUDE_PATH`, `GOPROXY`/`GONOSUMCHECK`/`GONOSUMDB`/`GONOPROXY`/`GOPRIVATE`/`GOENV`/`GOPATH`, `HGRCPATH`, `PYTHONUSERBASE`, `RUSTC_WRAPPER`/`RUSTFLAGS`/`RUSTUP_DIST_ROOT`/`RUSTUP_DIST_SERVER`/`RUSTUP_HOME`/`RUSTUP_TOOLCHAIN`/`RUSTUP_UPDATE_ROOT`/`CARGO_HOME`, `VIRTUAL_ENV`, `LUA_PATH`/`LUA_CPATH`, `GEM_HOME`/`GEM_PATH`/`BUNDLE_GEMFILE`, `COMPOSER_HOME`, `CARGO_BUILD_RUSTC_WRAPPER`, `XDG_CACHE_HOME`/`XDG_CONFIG_DIRS`/`XDG_CONFIG_HOME`/`XDG_DATA_DIRS`/`XDG_DATA_HOME`/`XDG_RUNTIME_DIR`/`XDG_STATE_HOME`, `AWS_CONFIG_FILE`/`KUBECONFIG`/`GOOGLE_APPLICATION_CREDENTIALS`/`AWS_SHARED_CREDENTIALS_FILE`/`AWS_WEB_IDENTITY_TOKEN_FILE`/`AZURE_AUTH_LOCATION`, `HELM_HOME`, `ANSIBLE_CONFIG`/`ANSIBLE_LIBRARY`/`ANSIBLE_CALLBACK_PLUGINS`/`ANSIBLE_COLLECTIONS_PATH`/`ANSIBLE_CONNECTION_PLUGINS`/`ANSIBLE_FILTER_PLUGINS`/`ANSIBLE_INVENTORY_PLUGINS`/`ANSIBLE_LOOKUP_PLUGINS`/`ANSIBLE_MODULE_UTILS`/`ANSIBLE_REMOTE_TEMP`/`ANSIBLE_ROLES_PATH`/`ANSIBLE_STRATEGY_PLUGINS`, `R_LIBS_USER`, `TF_CLI_CONFIG_FILE`/`TF_PLUGIN_CACHE_DIR`, `AMQP_URL`, `AWS_ACCESS_KEY_ID`/`AWS_CONTAINER_CREDENTIALS_FULL_URI`/`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`/`AWS_SECRET_ACCESS_KEY`/`AWS_SECURITY_TOKEN`/`AWS_SESSION_TOKEN`, `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`, `DATABASE_URL`, `GH_TOKEN`/`GITHUB_TOKEN`/`GITLAB_TOKEN`, `MONGODB_URI`, `NODE_AUTH_TOKEN`, `NPM_TOKEN`, `REDIS_URL`, `SSH_AUTH_SOCK`, `SYSTEMROOT`/`WINDIR` | `host-env-security-policy.json:104-259` |
| `allowedInheritedOverrideOnlyKeys` | **42** | `HOME`, `GRADLE_USER_HOME`, `ZDOTDIR`, `HISTFILE`, `MANPAGER`, `PAGER`, `GIT_PAGER`, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, `NODE_TLS_REJECT_UNAUTHORIZED`/`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`/`SSL_CERT_DIR`, `REQUESTS_CA_BUNDLE`/`CURL_CA_BUNDLE`, `DOCKER_HOST`/`DOCKER_TLS_VERIFY`/`DOCKER_CERT_PATH`/`DOCKER_CONTEXT`, `KUBECONFIG`/`AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE`/`AWS_WEB_IDENTITY_TOKEN_FILE`/`AZURE_AUTH_LOCATION`/`GOOGLE_APPLICATION_CREDENTIALS`, `SSH_AUTH_SOCK`, `SYSTEMROOT`/`WINDIR`, `RUSTUP_*`(5), `XDG_*`(7) | `host-env-security-policy.json:260-303` |
| `blockedOverridePrefixes` | **4** | `GIT_CONFIG_`, `NPM_CONFIG_`, `CARGO_REGISTRIES_`, `TF_VAR_` | `host-env-security-policy.json:304` |
| `blockedPrefixes` | **3** | `DYLD_`, `LD_`, `BASH_FUNC_`（继承 + 覆盖皆拦） | `host-env-security-policy.json:305` |

**为什么 `PATH` 永远拒绝 override（`bash-tools.exec.ts:1681-1722`）**：`sanitizeHostEnvOverridesWithDiagnostics` 默认 `blockPathOverrides=true`（`host-env-security.ts:221`），命中 `upper === "PATH"` 时直接进 `rejectedBlocked` 列表。注释（`host-env-security.ts:237-238`）明确说"PATH 是安全边界（命令解析 + safe-bin 检查）的一部分，禁止 request-scoped 覆盖"。特殊豁口：`sanitizeHostExecEnv({ blockPathOverrides: false })` 才会接受 PATH 覆盖（测试 `host-env-security.test.ts:924-937`）。`isDangerousHostEnvOverrideVarName` 本身**不**包含 PATH 字符串——它由额外一档 `blockPathOverrides` 开关控制，与黑名单正交。

**`BASH_FUNC_*` / `IFS` 单独处理（`host-env-security.ts:107-111, 198-201`）**：Bash 导出函数通过 `BASH_FUNC_echo%%=() { ... }` 这种"带 `%%` 后缀"的特殊名传入子进程，且前缀 `BASH_FUNC_` 在 `blockedPrefixes` 里被命中。`IFS` 在 `blockedEverywhereKeys` 里以完整 key 形式列出。两者都走 `isDangerousHostEnvVarName`，继承阶段 `sanitizeHostInheritedEnvEntry` 直接返回 `null` 丢弃。

**`GIT_ALLOW_PROTOCOL` 安全协议过滤（`host-env-security.ts:166-175`）**：`sanitizeInheritedGitAllowProtocolValue` 用 `:` 拆分值，只保留 `GIT_DEFAULT_ALWAYS_ALLOWED_PROTOCOLS = {"git","http","https","ssh"}` 里的协议，再拼回去；空值、纯非安全协议、含分隔符错乱的值（`"https::ssh"` → `"https:ssh"`，重复分隔符合并）。这样既"保留用户的合法白名单"，又"不会因为含一个 `ext`/`file`/`hg` 而放行"。**`GIT_PROTOCOL_FROM_USER` 强制置 0（`host-env-security.ts:192-197`）**：通过 `isPermissiveGitProtocolFromUserValue` 检测 `"true"`/`"yes"`/`"on"` 与非零整数（`"1"`/`"01"`/`"+1"`/`"-1"`/`"2"` 等），因为 Git 在 unset 状态下默认对 `user` policy 仍允许协议，必须显式覆盖为 `"0"` 才能关闭。注释（`host-env-security.ts:190-191`）解释"Git unset 默认仍会放行"，所以仅保留非许可性值（`""`/`"0"`/`"false"`/`"no"`/`"off"`/`"maybe"`）是不够的。

**三种传播模式**：

1. **inherit（`sanitizeHostExecEnvWithDiagnostics`）**（`host-env-security.ts:257-289`）：以 `baseEnv`（默认 `process.env`）为输入，对每条调用 `sanitizeHostInheritedEnvEntry`。`blockedEverywhere` + `blockedInherited` 全拦；`GIT_*` 走专项剥壳；`allowedInheritedOverrideOnly`（42 条，比如 `HOME`、`KUBECONFIG`、`SSH_AUTH_SOCK`）可以保留；其余普通变量原样透传。
2. **override（`sanitizeHostEnvOverridesWithDiagnostics`）**（`host-env-security.ts:204-255`）：以工具调用者传入的 `params.env`（`requestedEnv`）为输入，先用 `normalizeHostOverrideEnvVarKey`（仅匹配 `^[A-Za-z_][A-Za-z0-9_()]*$` 的 Windows 兼容 key）过滤非法字符；`PATH` 单独拦；`blockedEverywhere` + `blockedOverride` + `blockedOverridePrefixes` 全部丢弃；其余通过 `acceptedOverrides` 合并到 `merged`。返回值结构：`{ acceptedOverrides?, rejectedOverrideBlockedKeys: string[] (sortedUnique), rejectedOverrideInvalidKeys: string[] }`。
3. **sanitize (shell-wrapper)**（`host-env-security.ts:310-328`）：`sanitizeSystemRunEnvOverrides({ shellWrapper: true })` 用于系统级 subprocess（如 `systemd`/`launchd` 安装器），只放行 `TERM`/`LANG`/`LC_ALL`/`LC_CTYPE`/`LC_MESSAGES`/`COLORTERM`/`NO_COLOR`/`FORCE_COLOR` 与 `LC_` 前缀，其余 key 全部丢弃。`shellWrapper: false` 时透传。

**`enforceEnvOverrides` / `sanitizeHostEnvOverrides`** 的命名澄清：`bash-tools.exec-runtime.ts:96-128` 提供 `sanitizeHostBaseEnv`（继承阶段清理）与 `validateHostEnv`（覆盖阶段拒绝），两者都封装自 `host-env-security.ts`；**没有名为 `enforceEnvOverrides` 的导出函数**——exec 工具的真实入口是 `bash-tools.exec.ts:1681-1722` 的内联块：调用 `sanitizeHostExecEnvWithDiagnostics`，命中任何 `rejectedOverrideBlockedKeys` 或 `rejectedOverrideInvalidKeys` 时按"只拦 PATH""只拦一个普通 key""多 key"三档构造不同的 `Security Violation:` 错误（`bash-tools.exec.ts:1698-1721`）。`PATH` 单独被抬到最高优先级错误消息以便用户理解原因。

### 6.2 Script Preflight：在 spawn 前 catch "$VAR 注入"

**触发时机与后缀（`bash-tools.exec.ts:1846-1850`）**：exec 工具在 `shouldSkipExecScriptPreflight`（`bash-tools.exec.ts:1187-1193`）放行的情况下（即 `host !== "gateway" || security !== "full" || ask !== "off"`），**晚于** `rejectUnsafeControlShellCommand`（1674）与 host-env-sanitize（1681-1722），**早于** `runExecProcess`（1852），调用 `validateScriptFileForShellBleed({ command, workdir })`。**YOLO 模式（gateway + full + ask=off）整段跳过**——这是有意为之的"全权自负"模式。

**文件读取与 512KB cap（`bash-tools.exec.ts:209-285`）**：`SCRIPT_PREFLIGHT_MAX_BYTES = 512 * 1024`；走 `fs-safe` 模块的 `workspaceRoot.read(relativePath, { nonBlockingRead: true, symlinks: "follow-within-root", maxBytes: 512KB })`。`nonBlockingRead: true` 用 `O_RDONLY | O_NONBLOCK`（`bash-tools.exec.ts:213-214`）防 FIFO 死锁；`symlinks: "follow-within-root"` + `resolveOpenedFileRealPathForHandle` 防 symlink swap 投毒；`shouldSkipScriptPreflightPathError` 在 `EACCES/EISDIR/ELOOP/EINVAL/ENAMETOOLONG/ENOENT/ENOTDIR/EPERM` 这些不可恢复错误上**best-effort 跳过**，不让路径抖动炸掉执行（测试 `bash-tools.exec.script-preflight.test.ts:446-498`）。`hasLeadingTildePathSegment` 处理 `"~/bad.js"` 这种字面 `~`，走 `readLiteralTildePreflightScript`，先 stat + 校验 isFile + 校验大小 + 校验 realPath 落在 workspaceRoot 内。

**检测模式（`bash-tools.exec.ts:1075-1185`）**：

1. **环境变量 token 检测**（`bash-tools.exec.ts:1151`）：正则 `/\$[A-Z_][A-Z0-9_]{1,}/g`。**特意限定大写 + 下划线**——避免把 JS 里 `$.ajax` 这种合法用法误判。命中后构造错误信息 `$FILE:$LINE`，并按 `kind` 提示改写：`python` 提示 `os.environ.get('FOO')`；`node` 提示 `process.env['FOO']`。
2. **JS 误写 shell 检查**（`bash-tools.exec.ts:1172-1182`）：若 `target.kind === "node"`，检查文件首行非空内容是否以 `NODE` 开头——常见 model 错误是输出 `NODE "$TMPDIR/hot.json"` 而不是真正的 JS。
3. **复杂解释器调用 fail-closed**（`bash-tools.exec.ts:1079-1104`）：当 `extractScriptTargetFromCommand` 找不到清晰的 script operand，但 `shouldFailClosedInterpreterPreflight` 判定为"shell 包装的、复杂语法的、含解释器调用"时（典型如 `cat bad.py | python`、`if true; then python bad.py; fi`、`bash -c "python bad.py"`、`python <(cat bad.py)`），直接拒绝并提示"Use a direct `python <file>.py` or `node <file>.js` command"。

**哪些后缀触发**：`extractInterpreterScriptTargetFromArgv`（`bash-tools.exec.ts:444-474`）只识别两种解释器——`python(?:3(?:\.\d+)?)?` 配 `.py` 后缀（`findFirstPythonScriptArg`，`bash-tools.exec.ts:344-371`），以及 `node` 配 `.js` 后缀（`findNodeScriptArgs`，`bash-tools.exec.ts:373-442`，会同时检查 `-r/--require/--import` 的 preload 脚本以及 entry script，含 inline `-e`/`-p` 时排除 entry 匹配）。`stripPreflightEnvPrefix`（`bash-tools.exec.ts:306-342`）处理 `VAR=val env python bad.py` 前缀。其他脚本（bash、ruby、sh 等）**不**走这条预检——shell 自身的解析器负责边界检查。

**错误信息怎么定位 token**：`bash-tools.exec.ts:1153-1168` 通过 `first.index` 取匹配位置，按 `\n` 切前面得到所在行号；`first[0]` 是完整 `$VAR` token；`path.basename(absPath)` 是文件名。三段拼成 `exec preflight: detected likely shell variable injection ($DM_JSON) in python script: bad.py:3.`。

**误报处理**：**没有白名单**——只要模型把 shell 语法写到 `.py`/`.js` 文件就拒。YOLO 模式（`host=gateway security=full ask=off`）整体跳过预检，是模型/操作员"我自负全责"的逃生口（测试 `bash-tools.exec.script-preflight.test.ts:408-428`）。

### 6.3 Control Command Rejection：把 `/approve` 和 `openclaw channels login` 拦在 shell 外

`rejectUnsafeControlShellCommand`（`bash-tools.exec.ts:1279-1306`）只拒**两类**命令：

1. **`/approve <id> <allow-once|allow-always|always|deny>`**（`bash-tools.exec.ts:1200-1215` 的 `parseExecApprovalShellCommand`）：正则 `^\/approve(?:@[^\s]+)?\s+([A-Za-z0-9][A-Za-z0-9._:-]*)\s+(allow-once|allow-always|always|deny)\b`。`always` 被归一为 `allow-always`。抛出："exec cannot run /approve commands. Show the /approve command to the user as chat text, or route it through the approval command handler instead of shell execution."
2. **`openclaw channels login`**（`bash-tools.exec.ts:1266-1277` 的 `parseOpenClawChannelsLoginShellCommand`）：先通过 `stripOpenClawPackageRunner`（`bash-tools.exec.ts:1225-1264`）剥掉 `pnpm/npm/yarn/npx/bunx` 包装层；要求 `argv[0]=openclaw && argv[1] in {channels, channel} && argv[2]=login`。抛出："exec cannot run interactive OpenClaw channel login commands. Run `openclaw channels login` in a terminal on the gateway host, or use the channel-specific login agent tool when available (for WhatsApp: `whatsapp_login`)."

**怎么区分模型想调用"工具"还是想调用"系统命令"**：模型调 `/approve` 必须走 `approval command handler`（聊天消息 + 回调），不能 spawn 一个 shell 进程执行 `/approve` 字符串。同理 `openclaw channels login` 是交互式 CLI（QR 扫码等），exec 是非交互式 spawn，强行执行会卡死或失败。判定流程用 `analyzeShellCommand` 解析 → 提取 `segment.argv` → 通过 `buildCommandPayloadCandidates`（`bash-tools.exec.ts:1282-1287`）容忍 `sudo -EH bash -lc '...'`、`env env env env openclaw channels login`、`env -S 'openclaw channels' login` 这类包装层（测试 `bash-tools.exec.script-preflight.test.ts:88-116`）。

**完整 block list**就是这两个：`/approve ...` + `openclaw channels login`（或 `openclaw channel login`，大小写无关，包装层忽略）。其他像 `cd`、`sudo`、`env` 都允许；危险 token 走 env sanitize 与 script preflight。

### 6.4 Sandbox 路径：`assertSandboxPath` 三段防御

**`assertSandboxPath` 工作流（`sandbox-paths.ts:88-107`）**：

1. `resolveSandboxPath`（`sandbox-paths.ts:66-86`）→ `resolveSandboxInputPath` → `resolveToCwd` 处理 `~/`/`@` 前缀、Unicode 空白（`U+00A0`/`U+2000-U+200A`/`U+202F`/`U+205F`/`U+3000` 全部归一为 `U+0020`，`sandbox-paths.ts:21-28`）、Windows drive letter。然后 `path.relative(rootResolved, resolved)` 计算相对路径；若 `relative === ".."`、`startsWith("../")`、`startsWith("..\\")`、是绝对路径、是 Windows drive path，**抛** `Path escapes sandbox root (<root>): <filePath>`。
2. **`assertNoPathAliasEscape`**（`sandbox-paths.ts:100-105` 调用，对应 `path-alias-guards.ts`）：对最终 `resolved` 路径做 symlink/hardlink 检查，防止 link swap 投毒。
3. **resolveAllowedManagedMediaPath**（`sandbox-paths.ts:135-149`）+ **resolveAllowedTmpMediaPath**（`sandbox-paths.ts:277-292`）则把 OpenClaw 自身 `media/outbound` 与 `tmp` 目录作为"白名单白名"，但仍走相同的 alias escape 防护。

**哪些工具走 sandbox**：`agent-tools.read.ts:572,580,625,631,697`、`apply-patch.ts:16`、`agent-bundle-lsp-runtime.ts:5`、`mcp-config-shared.ts:11`、`image-tool.ts:857`、`image-generate-tool.ts:873`、`video-generate-tool.ts:954`、`music-generate-tool.ts:602`、`pdf-tool.ts:389`、`message-tool.ts:1414`、`outbound/message-action-params.ts:7`、`stage-sandbox-media.ts:8`、`skills/loading/workspace.ts:10` 都导入 `assertSandboxPath` / `resolveSandboxPath`。**sandbox root 来源**：`agents.defaults.sandbox.mode = "non-main" | "all"`（`bash-tools.exec.ts:1642` 错误信息明文）配置 sandbox 模式；image-tool 等工具测试（`tools/image-tool.test.ts:786-794`）展示典型 sandbox root：`path.join(stateDir, "sandbox")`。`resolveSandboxedMediaSource`（`sandbox-paths.ts:151-205`）还做容器 `/workspace` → 宿主 sandbox root 的映射（`mapContainerWorkspacePath`，`sandbox-paths.ts:258-275`），让容器内 media 引用文件落到宿主正确位置。

**错误消息格式**（`sandbox-paths.ts:83`）：`Path escapes sandbox root (<短路径化 root>): <原始输入>`。`shortPath`（`sandbox-paths.ts:305-310`）把 `$HOME` 替换成 `~`，方便用户识别。

### 6.5 串联起来的整体执行流

`bash-tools.exec.ts:1646-1874` 一次 exec 工具调用的边界守卫顺序：

1. **1674** `rejectUnsafeControlShellCommand(params.command)`——挡 `/approve` 与 `openclaw channels login`。
2. **1681-1722** `sanitizeHostExecEnvWithDiagnostics`——过滤请求 overrides；PATH / 黑名单 / 非法 key 任一命中即抛 `Security Violation:`。
3. **1724-1732** 合并 sandbox env 或 sanitize 后的 host env。
4. **1734-1750** gateway 模式下回填 shell PATH；`pathPrepend` 注入。
5. **1846-1850** 非 YOLO 模式下 `validateScriptFileForShellBleed`——读 `.py`/`.js` 文件首段查 `$VAR` 注入。
6. **1852** `runExecProcess` spawn 进程，沙箱用 docker exec、本地用 `bash -lc` 包装 PATH prepend（`bash-tools.exec-runtime.ts:629-657`）防止 `~/.zshenv` 反扑。

这套分层的设计意图：纵深防御——黑名单挡"已知恶意"、"PATH 永远拒 override"挡"动态二进制劫持"、script preflight 挡"模型把 shell 语法写到 .py/.js 的低质错误"、control command rejection 挡"模型把工具调用当成 shell 调用"、sandbox 路径挡"模型试图逃出 workspace"。每一层各自独立，任何一层失守，下一层仍能兜住。

---

