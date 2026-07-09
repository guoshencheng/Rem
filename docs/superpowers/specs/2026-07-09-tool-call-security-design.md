# Rem Agent 工具调用安全优化设计

> 日期：2026-07-09  
> 主题：工具调用安全层重构  
> 参考：OpenCode Rule-based + Ask 模型（主），OpenClaw 多层防御（辅）

---

## 一、设计目标

1. 将工具调用安全从当前的 "dangerous 标记 + 硬编码审批" 升级为 **统一的规则驱动模型**。
2. 默认策略为 **默认 ask**：任何工具未被显式 `allow` 时都需要用户审批。
3. 支持 **pattern 级规则**，允许对命令、路径、域名等参数做通配符控制。pattern 采用类 glob 语法：`*` 匹配单段路径或字符串，`?` 匹配单个字符，`**` 匹配任意深度路径。例如 `exec:rm *`、`edit:src/**/*.ts`、`webfetch:github.com`。
4. 用户选择 **always allow** 后，规则持久化到 **用户本地存储**（`~/.config/rem/permissions.json`）。
5. 覆盖范围：**rem-agent-core** + **rem-agent-bridge** + **rem-agent-web** 的审批 UI。
6. 吸收 OpenClaw 的关键补充：**workspace root guard**、**safe-bins 白名单**、**命令 AST 第一层风险评估**、**审计日志**。
7. **审批无超时**：用户未响应时，调用持续 pending，直到用户明确批准或拒绝。

---

## 二、架构设计

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Web / TUI / Bridge Client                         │
│  - 显示待审批列表                                            │
│  - 用户选择 once / always / deny                            │
│  - 展示规则命中上下文与 always 口径选项                       │
└─────────────────────────────────────────────────────────────┘
                              ↑↓ SSE / HTTP
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Bridge (rem-agent-bridge)                         │
│  - AgentService 转发 approval request / resolve             │
│  - /api/approvals 路由复用并增强                             │
└─────────────────────────────────────────────────────────────┘
                              ↑↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Execution & Approval (rem-agent-core)             │
│  - execute-tools.ts 重构：先 evaluate rules，再 ask         │
│  - waitApproval / resolveApproval（无超时）                  │
│  - 级联批准/拒绝同 session pending                          │
└─────────────────────────────────────────────────────────────┘
                              ↑↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Rule Engine (rem-agent-core/security)             │
│  - RuleSet: 合并多来源规则                                   │
│  - Evaluator: wildcard 匹配，默认 ask                        │
│  - RuleStore: 本地文件读写 approved rules                    │
│  - ProfileRegistry: coding/minimal 等预设                    │
│  - CommandClassifier: exec AST 第一层风险评估                │
└─────────────────────────────────────────────────────────────┘
```

### Core 内部关键模块

| 模块 | 文件建议 | 职责 |
|---|---|---|
| `Rule` | `packages/core/src/security/rules/rule.ts` | 规则类型：`permission`、`pattern`、`action` |
| `RuleSet` | `packages/core/src/security/rules/ruleset.ts` | 合并、排序多来源规则 |
| `Evaluator` | `packages/core/src/security/rules/evaluator.ts` | 对一次工具调用求值，返回 `allow/deny/ask` |
| `RuleStore` | `packages/core/src/security/rules/rule-store.ts` | 读写 `~/.config/rem/permissions.json` |
| `ProfileRegistry` | `packages/core/src/security/rules/profiles.ts` | `coding` / `minimal` / `messaging` 预设 |
| `CommandClassifier` | `packages/core/src/security/exec-classifier.ts` | 用 AST 解析 exec 命令，评估第一层风险 |
| `ApprovalEngine` | `packages/core/src/execute/approval-engine.ts` | 创建 approval request、级联、无超时等待 |
| `ToolExecutor` | `packages/core/src/execute/execute-tools.ts`（重构） | 规则求值 → 审批 → 执行 → 反馈 |

### 与现有代码的关系

- **`tool-policy-pipeline.ts`**：逐步废弃，功能合并到 `Evaluator` + `RuleSet`。
- **`dangerous-tool-hook.ts`**：废弃或改为 `dangerous` 提示生成器。
- **`workspace-root-guard.ts`**：保留并强化，作为文件工具的最后一道防线。
- **`execute-tools.ts`**：重构入口，把硬编码的 dangerous 检查替换为规则求值。
- 移除审批超时逻辑，包括 `waitApproval` 的 timeout 参数和相关错误处理。

---

## 三、组件设计

### 3.1 `Rule` 类型

```typescript
// packages/core/src/security/rules/rule.ts
export type RuleAction = 'allow' | 'deny' | 'ask';

export interface Rule {
  permission: string; // 工具名或通配符，如 "exec", "edit", "mcp:*"
  pattern: string;    // 调用参数模式，如 "rm *", "src/**/*.ts", "github.com"
  action: RuleAction;
  source?: string;    // 来源标识：'default' | 'profile:coding' | 'user-config' | 'approved' | 'session'
}
```

### 3.2 `RuleSet` 合并策略

来源优先级从高到低：

1. `session` — 创建 agent 时传入
2. `user-config` — `~/.config/rem/permissions.json`
3. `approved` — 用户 always 后持久化
4. `profile` — 当前 profile 预设
5. `default` — 代码内置

代码默认规则：
- 内部安全工具（`read`、`ls`、`session_status` 等纯读工具）→ `allow`
- 其他工具 → `ask`
- `exec`、`write`、`edit` 等高风险工具 → `ask`，并附加危险提示

合并时用 `findLast`（后定义优先），与 OpenCode 一致。

### 3.3 `Evaluator` 接口

```typescript
// packages/core/src/security/rules/evaluator.ts
export interface ToolCallPattern {
  toolName: string;
  input: unknown;              // 原始参数
  derivedPatterns: string[];   // 工具自己提取的 pattern
}

export function evaluate(
  toolCall: ToolCallPattern,
  rules: Rule[],
  defaultAction: RuleAction = 'ask'
): RuleAction;
```

每个工具在执行前注册自己的 pattern 提取器：
- `exec` → `["bash:" + command]`
- `edit/write` → `["file:" + resolvedPath]`
- `webfetch` → `["host:" + hostname]`
- 其他工具 → `["tool:" + toolName]`

### 3.4 `RuleStore` 文件格式

```jsonc
// ~/.config/rem/permissions.json
{
  "version": 1,
  "approved": [
    { "permission": "exec", "pattern": "ls *", "action": "allow" },
    { "permission": "edit", "pattern": "src/**/*.ts", "action": "allow" }
  ],
  "user": [
    { "permission": "exec", "pattern": "rm -rf *", "action": "deny" },
    { "permission": "webfetch", "pattern": "*", "action": "ask" }
  ],
  "profiles": {
    "coding": [
      { "permission": "exec", "pattern": "git *", "action": "allow" },
      { "permission": "read", "pattern": "*", "action": "allow" }
    ]
  }
}
```

`approved` 由系统自动写入；`user` 由用户手写；`profiles` 是预设模板。

### 3.5 `ApprovalEngine` 状态

```typescript
// packages/core/src/execute/approval-engine.ts
export interface ApprovalRequest {
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  patterns: string[];       // 哪些 pattern 触发了 ask
  title: string;
  description?: string;     // 命令原文、文件路径等
  alwaysOptions: Array<{   // 用户可选的 always 口径
    label: string;
    rule: Rule;
  }>;
  createdAt: number;
}

export interface ApprovalState {
  pending: Map<string, ApprovalRequest>;
  resolve(approvalId: string, decision: 'once' | 'always' | 'deny', rule?: Rule): void;
}
```

**审批无超时**：`waitApproval()` 不设置超时，一直等待用户响应。

### 3.6 `ToolExecutor` 执行流程

```typescript
async function executeToolCall(tc: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
  // 1. 提取 pattern
  const patterns = derivePatterns(tc);

  // 2. 规则求值
  const action = evaluator.evaluate({ toolName: tc.toolName, input: tc.input, patterns }, rules);

  // 3. deny → 直接失败
  if (action === 'deny') return deniedResult(tc, 'denied by rule');

  // 4. allow → 直接执行
  if (action === 'allow') return toolProvider.execute([tc], ctx);

  // 5. ask → 创建 approval request 并等待（无超时）
  const request = approvalEngine.createRequest({ ...tc, patterns });
  emitApprovalRequest(request);
  const decision = await waitApproval(request.approvalId);

  if (decision === 'deny') return deniedResult(tc, 'denied by user');
  if (decision === 'always') {
    ruleStore.saveApproved(request.toolName, patterns);
  }
  return toolProvider.execute([tc], ctx);
}
```

### 3.7 `CommandClassifier`（exec 命令风险评估）

使用 shell AST 解析器解析 exec 命令，但只评估**第一层**结构。推荐解析库：

- **首选**：`bash-parser`（轻量、输出命令 AST）
- **备选**：`tree-sitter-bash`（更准确但更重）
- **降级**：如果解析器不可用，回退到正则/字符串检测，但标记为 `complex` 处理

解析策略：

- **单个简单命令**：解析出顶层命令（如 `git`、`ls`），检查是否在 safe-bins 白名单。
  - 在白名单 → 默认 `allow`
  - 不在白名单 → `ask`
- **复杂结构**（管道、命令替换、`&&`/`||` 链、`bash -c` 等）：识别为不可安全降级，直接 `ask`，且不提供宽泛 always 选项。

```typescript
// packages/core/src/security/exec-classifier.ts
export type CommandRisk = 'safe' | 'normal' | 'dangerous' | 'complex';

export interface CommandClassification {
  risk: CommandRisk;
  baseCommand: string;
  subCommand?: string;
  patterns: string[]; // 生成的 alwaysOptions 候选
}

export function classifyCommand(command: string): CommandClassification;
```

#### Safe-bins 白名单示例

```typescript
const SAFE_BINS = [
  'ls', 'cat', 'grep', 'find', 'pwd', 'echo', 'head', 'tail',
  'git status', 'git log', 'git diff', 'git branch', 'git show'
];
```

#### 复杂结构判定

包含以下任一特征即判定为 `complex`：
- 管道 `|`
- 命令链 `;` / `&&` / `||`
- 命令替换 `$(...)` / `` `...` ``
- 重定向 `>` / `<` / `>>`
- `bash -c` / `sh -c` / `eval`
- 反斜杠换行
- AST 解析失败

复杂命令的审批文案：
> ⚠️ 复杂命令：包含管道/命令替换，无法自动评估风险。只允许本次执行，不会保存为 always 规则。

---

## 四、数据流

### 4.1 Agent 启动时规则加载

```
createAgentFromEnv(options)
  │
  ▼
loadProfile(options.profile ?? 'coding')
  │   └─ 读取 packages/core/src/security/rules/profiles.ts 中的预设
  ▼
RuleStore.loadUserRules()
  │   └─ 读取 ~/.config/rem/permissions.json
  │      ├─ user[]      用户手写规则
  │   └─ approved[]     历史 always 规则
  ▼
合并规则（按优先级）：
  session > user > approved > profile > default
  ▼
生成最终 RuleSet，注入到 Agent 运行上下文
```

### 4.2 单次工具调用评估流

```
LLM 发起 tool_call: { toolName: "exec", input: { command: "git status" } }
  │
  ▼
derivePatterns(toolCall)
  │   └─ exec 工具调用 shell-parser 解析 command
  │      └─ 返回 ["bash:git status", "bash:git *"]
  ▼
Evaluator.evaluate(toolCall, rules)
  │   ├─ 按优先级 findLast 匹配规则
  │   └─ 无匹配 → 默认 ask
  ▼
结果分支：
  ├─ allow → 直接执行
  ├─ deny  → 返回错误结果给 LLM
  └─ ask   → 进入审批流
```

### 4.3 审批流

```
ask 结果
  │
  ▼
ApprovalEngine.createRequest(toolCall, patterns)
  │   ├─ 生成 approvalId
  │   ├─ 计算 alwaysOptions（exec 按风险分级）
  │   └─ 写入 liveState.pendingApprovals
  ▼
emit('approval-request', request)  ────────────┐
  │                                             │
  ▼                                             │
ToolExecutor 调用 waitApproval() 阻塞等待       │
  │                                             │
  ▼                                             │
Bridge/Web 收到 approval-request               │
  │                                             │
  ▼                                             │
Web UI 显示审批卡片                             │
  │                                             │
  ▼                                             │
用户选择 once / always / deny                   │
  │                                             │
  ▼                                             │
POST /api/approvals/:id/resolve                │
  │                                             │
  ▼                                             │
agentState.resolveApproval(decision) ───────────┘
  │
  ▼
决策处理：
  ├─ deny   → 返回错误结果，级联拒绝同 session 其他 pending
  ├─ once   → 执行本次调用
  └─ always → RuleStore.saveApproved(rule) + 执行 + 级联批准其他可匹配的 pending
```

### 4.4 级联批准/拒绝

当用户对一个请求回复 `always` 或 `deny` 时：

```typescript
// 级联批准
for (const pending of sameSessionPending) {
  if (pending.patterns.every(p => evaluate(p, approvedRules) === 'allow')) {
    resolve(pending, 'always');
  }
}

// 级联拒绝
if (decision === 'deny') {
  for (const pending of sameSessionPending) {
    resolve(pending, 'deny');
  }
}
```

### 4.5 规则持久化流

```
用户选择 always + 选定口径（如 write:*.ts）
  │
  ▼
RuleStore.saveApproved({ permission: "write", pattern: "*.ts", action: "allow" })
  │
  ▼
追加到 ~/.config/rem/permissions.json 的 approved 数组
  │
  ▼
同时刷新当前 Agent 的 RuleSet，使同 session 后续调用生效
```

---

## 五、审批 UX 设计

### 5.1 审批卡片内容

```
┌─────────────────────────────────────┐
│  🔒 工具调用请求                      │
│                                      │
│  工具：exec                           │
│  命令：rm -rf node_modules            │
│  风险：高风险 ⚠️                       │
│                                      │
│  [允许一次]  [拒绝]                   │
│                                      │
│  ▼ 总是允许以下范围：                  │
│    ○ rm -rf node_modules  （精确）    │
│    ○ rm -rf *             （命令级）  │
│    ● rm *                 （工具级）  │
└─────────────────────────────────────┘
```

### 5.2 always 口径生成策略

| 工具 | 调用示例 | alwaysOptions |
|---|---|---|
| `exec` safe | `git status` | `git status` / `git *` / `bash:safe-bins:*` |
| `exec` normal | `git push` | `git push` / `git *` |
| `exec` dangerous | `rm -rf node_modules` | `rm -rf node_modules` / `rm *`（不提供 all bash） |
| `exec` complex | `cat file \| grep x` | 仅 `once` / `deny`，不提供 always |
| `write` | `src/foo.ts` | `src/foo.ts` / `src/*.ts` / `*.ts` / `*` |
| `webfetch` | `github.com` | `github.com` / `*` |

---

## 六、错误处理

| 场景 | 行为 | 给 LLM 的反馈 |
|---|---|---|
| **规则文件损坏** | 启动时检测到 `permissions.json` 格式错误 | 用默认规则继续运行，同时向 stderr 输出警告，并在日志中提示用户检查 `~/.config/rem/permissions.json` |
| **规则求值异常** | 某条规则 pattern 无效 | 跳过该规则，记录日志，不影响其他规则 |
| **用户拒绝** | 用户点 deny | 返回 `ToolResult.error = 'denied by user'`，级联拒绝同 session pending |
| **AST 解析失败** | 命令太复杂或语法错误 | 降级为 `ask`，审批文案显示"无法解析命令结构" |
| **路径穿越尝试** | 文件工具路径解析到 workspace 外 | 直接 `deny`，不进入审批 |
| **级联处理失败** | 某个 pending 解析错误 | 只影响该 pending，其他继续正常处理 |

### 关键错误类型

```typescript
// packages/core/src/security/rules/errors.ts
export class ToolDeniedError extends Error {
  constructor(
    public toolName: string,
    public reason: 'rule' | 'user' | 'workspace' | 'parse'
  ) {
    super(`Tool ${toolName} denied: ${reason}`);
  }
}
```

---

## 七、测试策略

### 7.1 单元测试

| 模块 | 测试文件 | 覆盖点 |
|---|---|---|
| `Evaluator` | `packages/core/tests/security/rules/evaluator.test.ts` | 通配符匹配、优先级、默认 ask、allow/deny/ask 分支 |
| `RuleSet` | `packages/core/tests/security/rules/ruleset.test.ts` | 多来源合并、findLast 语义、source 优先级 |
| `RuleStore` | `packages/core/tests/security/rules/rule-store.test.ts` | 读写 `permissions.json`、损坏文件回退、approved 追加 |
| `CommandClassifier` | `packages/core/tests/security/exec-classifier.test.ts` | safe-bins 识别、复杂结构检测、AST 解析失败降级 |
| `ApprovalEngine` | `packages/core/tests/execute/approval-engine.test.ts` | 创建请求、级联批准、级联拒绝、无超时等待 |

### 7.2 集成测试

| 流程 | 测试文件 | 覆盖点 |
|---|---|---|
| 完整工具执行 | `packages/core/tests/execute/execute-tools-rules.test.ts` | 规则命中 allow/deny/ask、审批后执行、always 持久化 |
| ReactLoop 集成 | `packages/core/tests/plugins/loop/react/react-loop-rules.test.ts` | 多步工具调用中规则持续生效 |
| Profile 加载 | `packages/core/tests/security/rules/profiles.test.ts` | coding/minimal profile 规则正确性 |

### 7.3 Bridge/Web 测试

| 模块 | 测试文件 | 覆盖点 |
|---|---|---|
| Approval API | `packages/bridge/tests/agent-service/approval-rules.test.ts` | 列出 pending、resolve、SSE 推送、无超时 |
| Web approval bar | `packages/web/tests/approval-bar.test.tsx` | 渲染审批卡片、选择 always 口径、提交 resolve |

### 7.4 安全测试

| 场景 | 测试文件 | 覆盖点 |
|---|---|---|
| 路径安全 | `packages/core/tests/security/workspace-guard.test.ts` | 路径穿越、symlink、workspace 外访问 |
| 命令注入 | `packages/core/tests/security/exec-injection.test.ts` | `bash -c`、反引号、`$()`、管道等复杂命令正确降级为 ask |
| 危险命令 | `packages/core/tests/security/exec-dangerous.test.ts` | `rm -rf /`、`sudo *` 等被 deny 或 ask-only |

---

## 八、实施范围与阶段

### 第一阶段（本次设计）

1. Core 规则引擎：`Rule`、`RuleSet`、`Evaluator`、`RuleStore`。
2. `CommandClassifier`：AST 第一层风险评估。
3. `ApprovalEngine`：无超时审批、级联处理、always 口径选项。
4. `execute-tools.ts` 重构：接入规则引擎。
5. Profile 预设：`coding` / `minimal` / `messaging`。
6. Bridge/Web 审批 UI：展示 always 口径选项。
7. 移除审批超时逻辑。

### 第二阶段（未来）

1. 审计日志系统。
2. Docker 沙箱执行（OpenClaw 风格）。
3. Gateway HTTP 工具限制。
4. Plugin/MCP 动态工具的权限隔离。
5. 更复杂的 AST 多层分析。

---

## 九、关键决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| 默认策略 | 默认 ask | 用户明确选择，安全优先 |
| 规则粒度 | pattern 级 | 支持命令、路径、域名等细粒度控制 |
| 规则持久化 | 用户本地存储 `~/.config/rem/permissions.json` | 不污染项目仓库，跨 session 生效 |
| 审批超时 | 移除 | 用户认为超时逻辑不合理 |
| exec 解析 | AST 第一层 | 避免字符串误判，同时控制复杂度 |
| 参考模型 | OpenCode 为主，OpenClaw 为辅 | OpenCode 的规则+Ask 模型更适合 Rem 当前架构 |
