<!--
整体流程总结文档（通俗版）
主题：从 LLM 工具调用到实际执行，OpenClaw exec 校验的整体流程
读者：想快速理解 OpenClaw exec 安全体系全貌的人
作者：综合调研者
关联：00-overview.md 是技术版（本篇是通俗版）；01-07 是技术细节；08-synthesis.md 是对比与移植
-->

# 00. OpenClaw Exec 校验整体流程总结

> 目的：让你用 10 分钟理解 OpenClaw 怎么保证"LLM 要执行一条 shell 命令"这件事是安全的。
> 风格：少代码、多类比、聚焦"为什么这样设计"。

---

## 1. 一句话总结

**OpenClaw 把"一条 shell 命令从 LLM 产出到实际执行"的全链路拆成 5 段独立的关卡，每段关卡都做"白名单 + 拒绝一切异常"两件事。任何一段关卡说"不行"，命令就不执行。**

这不是一句空话——这是 OpenClaw 用 5000+ 行代码、380+ 个测试用例堆出来的核心设计哲学：**纵深防御 + 早失败 + 可观测**。

---

## 2. 一图看完

```
LLM 想执行命令:  rm -rf /tmp/old_logs
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ 关卡 1: Schema 校验                                  │
  │ 问: 参数长得对吗？command 是字符串？env 是字典？      │
  │ 答: 是 → 放行；否 → 拒                               │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ 关卡 2: 命令解析                                     │
  │ 问: 这条命令到底在执行什么？                          │
  │ 把 "rm -rf /tmp/old_logs" → segments: [["rm","-rf","/tmp/old_logs"]]  │
  │ 顺便: 拆 heredoc / 拆 shell 包装 / 识别危险解释器     │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ 关卡 3: 安全匹配                                     │
  │ 问: 这个 segments 是不是允许执行的？                  │
  │ 答: 三道关:                                          │
  │   ① 路径信任: rm 是 /usr/bin/rm 吗？(不是 ./rm)        │
  │   ② Profile 校验: rm 的 -rf 是合法 flag 吗？          │
  │   ③ Allowlist 匹配: 这条命令用户明确批准过吗？         │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ 关卡 4: 环境变量消毒                                 │
  │ 问: 命令要带什么 env 进去？                           │
  │ 答: 把 100+ 黑名单 key 全剥掉, PATH 永远拒 override   │
  │ 例如: 即使模型塞了 LD_PRELOAD=/tmp/evil.so, 也会被剥掉 │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ 关卡 5: 决策                                         │
  │ 问: 这条命令现在该放、问、还是拒？                    │
  │ 答: 5 种 mode (deny/allowlist/ask/auto/full) +       │
  │     4 种额外必问信号 (inline-eval/heredoc/...) +       │
  │     durable allow-always 决策豁免                     │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
                   放行 / 问 / 拒
                          │
                          ▼ 放行
  ┌──────────────────────────────────────────────────────┐
  │ 重新包装命令: 把 segments 用单引号拼回 shell 字符串    │
  │ (防止二次注入)                                        │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
                   实际执行 + 异步通知 UI
```

---

## 3. 五段关卡是干什么的——用人话说

### 关卡 1: Schema 校验（"格式对吗？"）

每个工具有自己的"参数表"，比如 exec 工具的表是：

```ts
{
  command: 字符串 (必填),
  workdir: 字符串 (可选),
  env: 字典 (可选),
  timeout: 数字 (可选),
  ...
}
```

LLM 给的参数必须符合这张表。这一关**只查格式**，不查"这命令危不危险"。

为啥要做这一步？ 因为不同 LLM 厂商对参数表的支持不一样——有的不许 `anyOf`，有的不许 `minLength`。OpenClaw 写了一个"归一化器"，把所有 LLM 都喂同一种格式的参数表，错的当场拒。

---

### 关卡 2: 命令解析（"这条命令在干啥？"）

LLM 给的 `command` 字段是一行字符串，比如：

```bash
rm -rf /tmp/old_logs | tee /var/log/cleanup.log
```

关卡 2 把这行字符串**结构化**成：

```
segments: [
  ["rm", "-rf", "/tmp/old_logs"],
  ["tee", "/var/log/cleanup.log"]
]
chainOps: ["|"]    // 管道连接
```

为啥要结构化？因为只有结构化才能做后续检查。你正则匹配字符串，能挡 `rm -rf`，挡不了 `cat <<EOF\n$KEY\nEOF`（heredoc 注入），也挡不了 `sudo python -c "import os; os.system('rm -rf /')"`（包装层绕过）。

这一关里有几个有趣的子任务：

- **chain/pipeline 分割** — 拆 `|` `&&` `||` `;` ，每个子段独立判断
- **heredoc 拆解** — 拆 `<<EOF ... EOF`，并检查 heredoc 体内有没有 `$VAR` 展开
- **wrapper 拆解** — 看到 `sh -c "..."` / `bash -lc "..."` / `env -S "..."`，把内层命令揪出来当独立段处理
- **inline-eval 识别** — 看到 `python -c "..."` / `node -e "..."` / `awk 'script' file`，立刻打上"必问"标签

---

### 关卡 3: 安全匹配（"这条命令准不准跑？"）

拿到结构化 segments 之后，三道关要同时过：

#### ① 路径信任：binary 是不是真的"那个"binary

```bash
# 攻击者可能在 workspace 里放一个假的 cut
./cut  # 但 allowlist 是 "/usr/bin/cut" → 拒
```

OpenClaw 不会相信"你说你是谁"。它会 `realpath` 找到 binary 的真实位置，**只信任 `/bin`、`/usr/bin` 这种 OS 管理的目录**。

#### ② Profile 校验：binary 的"动作"合规吗？

不同 binary 的合法用法不一样。`cut` 只能切列，`jq` 只能跑 filter，`grep` 只能 stdin。

OpenClaw 给每个 safe-bin 写了一份"操作手册"（profile）：

```ts
jq = {
  maxPositional: 1,                     // 最多 1 个位置参数
  allowedFlags: ["--arg", "--argjson"], // 只许这几个 flag
  deniedFlags: ["--argfile", "-L"],     // 这几个 flag 拒
  // 接收的 literal 不能含 glob、shell 展开、路径
}
```

如果 `jq /etc/passwd` 来了，profile 一看"位置参数含路径字面量"，直接拒。

#### ③ Allowlist 匹配：用户明确批准过吗？

Allowlist 是用户写的"批准名单"：

```json
{
  "pattern": "/usr/bin/rm",
  "argPattern": "-rf /tmp/old_*"   // 可选, 进一步限定参数
}
```

匹配就走精确路径或 basename glob。**path-style 和 bare name 严格区分**——`./rm` 不会命中 bare `/usr/bin/rm`。

---

### 关卡 4: 环境变量消毒（"命令的"工作环境"安全吗？"）

LLM 在 `env` 参数里塞了一堆环境变量。这一关把它们洗干净：

- **100+ 全局黑名单**：`NODE_OPTIONS`、`PYTHONPATH`、`BASH_ENV`、`IFS`、`LD_*`、`DYLD_*`、`SSLKEYLOGFILE`...
- **150+ 覆盖阶段黑名单**：`HOME`、`PATH`、`EDITOR`、`HTTP_PROXY`、`AWS_*`...
- **3 个 prefix 黑名单**：`DYLD_`、`LD_`、`BASH_FUNC_*`
- **`PATH` 永远拒 override** —— 哪怕用户说"我想改 PATH"，也直接拒
- **GIT_* 专项**：`GIT_ALLOW_PROTOCOL` 只保留 `git/http/https/ssh`；`GIT_PROTOCOL_FROM_USER` 强制置 0

为啥要这么严？ 因为 `env` 是 LLM 最容易搞事的地方——塞个 `LD_PRELOAD=/tmp/evil.so` 就能劫持进程，OpenClaw 直接从源头切断。

---

### 关卡 5: 决策（"现在该放、问、还是拒？"）

5 种 mode + 4 种额外必问信号：

| Mode | 含义 |
|---|---|
| `deny` | 一律拒（sandbox 默认） |
| `allowlist` | 命中 allowlist 就放，没命中就拒 |
| `ask` | 命中 allowlist 放，没命中**问用户** |
| `auto` | 没命中先问**小模型**评审员，评审员说不行再问人 |
| `full` | 一律放（YOLO，用户自负全责） |

**4 种额外必问信号**（即使 allowlist 命中也要问）：

1. **inline-eval**：`python -c` / `node -e` / `awk 'script'` 这类解释器内嵌代码
2. **heredoc**：命令里出现 `<<EOF`（哪怕 allowlist 命中，因为 heredoc 体里可能藏东西）
3. **allowlist 重建失败**：allowlist 命中但重新安全 quote 命令失败（防意外二次注入）
4. **audit suppression**：命令涉及修改 `security.audit.suppressions` 配置（要审计）

**durable allow-always 豁免**：如果用户在之前已经选过 "always allow"，这条命令记了 `=command:<sha256>` 哈希，下次同一条命令直接放行。

---

## 4. 三个关键设计原则

### 原则 1: 早失败 (Fail-closed)

每一段关卡都说"不知道=拒"，不冒险"猜"。比如：

- Wrapper 拆解开到第 4 层还没解开？拒
- 解析器看到 unterminated quote？拒
- binary 路径不信任？拒
- env 里有黑名单 key？拒

> "不知道是什么" = "危险" = "拒"

### 原则 2: 深度有界 (Bounded depth)

任何递归都有上限：

| 递归 | 上限 |
|---|---|
| Dispatch wrapper 嵌套（`time nice sudo ...`）| 4 层 |
| `env -S` 嵌套 | 32 层 |
| Shell wrapper inline 嵌套（`sh -c "sh -c '...'"`）| 3 层 |

为啥要限？ 防止恶意输入把解析器栈搞爆。

### 原则 3: 数据驱动 (Data-driven policy)

所有白名单、黑名单、profile 都是 JSON / 常量描述，**代码只负责判断**，不负责记忆。

`~/.openclaw/exec-approvals.json`：

```json
{
  "version": 1,
  "agents": {
    "default": {
      "security": "allowlist",
      "ask": "on-miss",
      "allowlist": [
        { "pattern": "/usr/bin/rm", "argPattern": "-rf /tmp/.*" },
        { "pattern": "/usr/bin/git" }
      ]
    }
  }
}
```

改配置文件就改策略，**不用改代码**。

---

## 5. 五个关键概念（记住这五个就够了）

| 概念 | 一句话 |
|---|---|
| **Schema** | "这个工具的参数表长啥样" |
| **Segments** | "这条命令被结构化后长啥样" |
| **Profile** | "这个 safe-bin 允许怎么用" |
| **Mode** | "现在该问还是该放" |
| **Durable approval** | "我之前批准过这条命令的证据" |

---

## 6. 跟 Rem 现状的对比（一句话版）

| 维度 | OpenClaw | Rem |
|---|---|---|
| 命令解析 | 完整 shell 状态机 | 字符级正则 |
| Wrapper 拆解 | 自动拆 `sh -c` / `sudo` / `env -S` | 不拆 |
| Env 黑名单 | 100+ 键 + PATH 永远拒 override | 不清理 |
| Allowlist | glob + path-style 严格区分 | 不支持 |
| allow-always 持久化 | atomic write + SHA-256 哈希 | 内存 Map，进程重启即丢 |
| 审批事件 | 4 种事件全 emit | 4 种事件声明但 0 emit |

**结论**：Rem 是"单层字符正则"（约 200 行），OpenClaw 是"13 层结构化管道"（约 5000 行）。差距大约 1-2 年工程量。

最该优先抄的三块（按价值/成本比）：

1. **env 黑名单** — 200 行代码挡掉最常见的 `LD_PRELOAD` / `NODE_OPTIONS` 注入
2. **inline-eval 检测** — 149 行 spec 表挡掉 `python -c` / `node -e` 危险模式
3. **持久化 allow-always** — 100 行代码让 "allow-always" 真正可用

完整对比与移植路线见 `08-synthesis.md`。

---

## 7. 如果只能记住一句话

> **OpenClaw 假设 LLM 给的任何东西都可能是恶意的，然后用 5 段独立关卡 + 早失败 + 数据驱动配置，一层一层剥掉不安全因素。** 不是靠"模型应该不会这样做"，而是靠"就算模型这样做了，系统也拦得住"。

---

## 关联文档

- 通俗版（本篇）— 理解全貌
- [`00-overview.md`](./00-overview.md) — 技术版整体架构
- [`01-07` 子文档](README.md) — 各维度技术细节
- [`08-synthesis.md`](./08-synthesis.md) — Rem vs OpenClaw 对比 + 移植路线
