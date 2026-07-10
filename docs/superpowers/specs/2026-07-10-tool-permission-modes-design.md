# Rem Agent 工具权限双模式设计

> 日期：2026-07-10  
> 主题：将工具权限校验从单一“默认 ask”拆分为 `auto` 与 `interactive` 两种模式  
> 范围：rem-agent-core

---

## 一、背景与目标

当前 `rem-agent-core` 的工具权限模型是统一的“默认 ask”：只要没有显式 `allow` 规则，任何非只读工具都会触发审批。这在人机协作场景下安全，但在自动化场景下会产生过多交互。

本设计引入两种运行模式：

- **`interactive`（人机互动模式）**：保持现有行为。写入操作和敏感读取默认 ask，普通读取默认 allow。
- **`auto`（自动模式）**：写入操作默认 allow，敏感读取默认 deny，普通读取默认 allow。

无论哪种模式，显式 `deny` 规则和 `allow` 规则始终优先。

---

## 二、核心概念

### 2.1 `securityMode`

`AgentContextBuildOptions` 新增配置：

```typescript
export type SecurityMode = 'auto' | 'interactive';

export interface AgentContextBuildOptions {
  // ... existing fields
  securityMode?: SecurityMode;
}
```

默认值为 `interactive`，保证现有行为不变。

### 2.2 工具类别

运行时根据 `toolName`、`ToolDefinition` 和派生 pattern 把一次调用分为三类：

| 类别 | 判定方式 |
|---|---|
| `write` | `toolName` 为 `write`/`edit`；或 `exec` 工具被 `CommandClassifier` 判定为写操作 |
| `sensitive-read` | `readOnly === true` 且至少一个 `derivedPattern` 命中内置敏感 pattern |
| `read` | 其他只读操作 |

### 2.3 内置敏感读取 pattern

敏感读取 pattern 以内置常量形式存在，暂不向用户暴露配置。

```typescript
// packages/core/src/security/permissions/sensitive-patterns.ts
export const BUILT_IN_SENSITIVE_READ_PATTERNS = [
  '**/.env*',
  '**/*.pem',
  '**/*.key',
  '**/secrets/**/*',
  '**/.ssh/**/*',
];
```

---

## 三、架构设计

### 3.1 模块图

```
┌─────────────────────────────────────┐
│  execute-tools.ts                    │
│  ─────────────────                   │
│  只调用 evaluator.evaluate()         │
│  不再直接依赖 RuleEngine / Approval  │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  ToolPermissionEvaluator (interface)  │
│  ├── InteractivePermissionEvaluator   │
│  └── AutoPermissionEvaluator          │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  BaseRuleEvaluator                   │
│  共享 RuleEngine 规则求值            │
└─────────────────────────────────────┘
```

### 3.2 文件建议

| 文件 | 职责 |
|---|---|
| `packages/core/src/security/permissions/types.ts` | `ToolPermissionEvaluator` 接口与 `PermissionDecision` 类型 |
| `packages/core/src/security/permissions/tool-classifier.ts` | `classifyTool` 工具分类函数 |
| `packages/core/src/security/permissions/sensitive-patterns.ts` | 内置敏感读取 pattern |
| `packages/core/src/security/permissions/base-evaluator.ts` | `BaseRuleEvaluator` 共享规则求值 |
| `packages/core/src/security/permissions/interactive-evaluator.ts` | `InteractivePermissionEvaluator` |
| `packages/core/src/security/permissions/auto-evaluator.ts` | `AutoPermissionEvaluator` |
| `packages/core/src/execute/execute-tools.ts` | 重构为薄编排层 |
| `packages/core/src/agent-context-builder.ts` | 根据 `securityMode` 创建对应 evaluator |

---

## 四、组件设计

### 4.1 `ToolPermissionEvaluator` 接口

```typescript
export interface ApprovalRequestInput {
  toolCallId: string;
  toolName: string;
  patterns: string[];
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  alwaysOptions: Array<{ label: string; rule: Omit<Rule, 'source'> }>;
}

export type PermissionDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; request: ApprovalRequestInput };

export interface ToolPermissionEvaluator {
  evaluate(toolCall: ToolCall, toolDef: ToolDefinition): Promise<PermissionDecision>;
}
```

### 4.2 工具分类器

```typescript
export type ToolCategory = 'write' | 'sensitive-read' | 'read';

export function classifyTool(
  toolName: string,
  toolDef: ToolDefinition,
  derivedPatterns: string[],
): ToolCategory {
  // 实现细节：
  // 1. 如果 toolName 是 write/edit，返回 'write'。
  // 2. 如果 toolName 是 exec，使用 CommandClassifier 判断是否为写操作；
  //    若是返回 'write'。
  // 3. 如果 readOnly === true 且 derivedPatterns 命中内置敏感 pattern，
  //    返回 'sensitive-read'。
  // 4. 否则返回 'read'。
}
```

### 4.3 `BaseRuleEvaluator`

```typescript
export class BaseRuleEvaluator {
  constructor(private ruleEngine: RuleEngine) {}

  evaluateRules(toolName: string, derivedPatterns: string[]): RuleAction {
    return this.ruleEngine.evaluate({ toolName, derivedPatterns });
  }
}
```

### 4.4 `InteractivePermissionEvaluator`

```typescript
export class InteractivePermissionEvaluator implements ToolPermissionEvaluator {
  constructor(
    private base: BaseRuleEvaluator,
    private approvalFactory: ApprovalRequestFactory,
  ) {}

  async evaluate(tc: ToolCall, toolDef: ToolDefinition): Promise<PermissionDecision> {
    const derivedPatterns = derivePatterns(tc, toolDef);
    const category = classifyTool(tc.toolName, toolDef, derivedPatterns);
    const ruleAction = this.base.evaluateRules(tc.toolName, derivedPatterns);

    if (ruleAction === 'deny') {
      return { action: 'deny', reason: 'denied by rule' };
    }
    if (ruleAction === 'allow') {
      return { action: 'allow' };
    }

    // 无规则命中时
    if (category === 'read') {
      return { action: 'allow' };
    }

    return {
      action: 'ask',
      request: this.approvalFactory.create({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        patterns: derivedPatterns,
        title: `Run ${tc.toolName}`,
        description: formatDescription(tc),
        severity: 'warning',
        alwaysOptions: deriveAlwaysOptions(tc, toolDef),
      }),
    };
  }
}
```

### 4.5 `AutoPermissionEvaluator`

```typescript
export class AutoPermissionEvaluator implements ToolPermissionEvaluator {
  constructor(private base: BaseRuleEvaluator) {}

  async evaluate(tc: ToolCall, toolDef: ToolDefinition): Promise<PermissionDecision> {
    const derivedPatterns = derivePatterns(tc, toolDef);
    const category = classifyTool(tc.toolName, toolDef, derivedPatterns);
    const ruleAction = this.base.evaluateRules(tc.toolName, derivedPatterns);

    if (ruleAction === 'deny') {
      return { action: 'deny', reason: 'denied by rule' };
    }
    if (ruleAction === 'allow') {
      return { action: 'allow' };
    }

    if (category === 'sensitive-read') {
      return { action: 'deny', reason: 'sensitive read blocked in auto mode' };
    }

    return { action: 'allow' };
  }
}
```

### 4.6 `execute-tools.ts` 重构

`execute-tools.ts` 不再直接依赖 `RuleEngine`、`RuleStore`、`ApprovalEngine`。它只依赖注入的 `ToolPermissionEvaluator`：

```typescript
export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
  permissionEvaluator: ToolPermissionEvaluator;
  agentState: AgentState;
  addMessage: (role: 'tool') => ModelMessage;
  appendContent: (msg: ModelMessage, part: { type: string; [key: string]: unknown }) => void;
  workspaceRoot: string;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
  signal?: AbortSignal;
  emit: (chunk: ProviderChunk) => void;
}

export async function executeTools(params: ExecuteParams): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const { toolProvider, permissionEvaluator, agentState, addMessage, appendContent, emit, signal } = params;

  for (const tc of params.toolCalls) {
    const def = toolProvider.getToolDefinition(tc.toolName);
    const decision = await permissionEvaluator.evaluate(tc, def);

    if (decision.action === 'deny') {
      const denied: ToolResult = {
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: '',
        error: decision.reason,
      };
      emitToolResult(tc, denied, emit, addMessage, appendContent);
      results.push(denied);
      continue;
    }

    if (decision.action === 'ask') {
      const liveState = agentState.getOrCreate(params.sessionId);
      const request = liveState.approvalEngine.createRequest(decision.request);
      liveState.pendingApprovals.push(request);
      emit({ type: 'approval-request', sessionId: params.sessionId, request });

      const resolution = await liveState.approvalEngine.wait(request.approvalId);
      liveState.pendingApprovals = liveState.pendingApprovals.filter(
        (r) => r.approvalId !== request.approvalId,
      );
      emit({
        type: 'approval-resolved',
        sessionId: params.sessionId,
        approvalId: request.approvalId,
        decision: resolution.decision,
      });

      if (resolution.decision === 'deny') {
        const denied: ToolResult = {
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: '',
          error: 'denied by user',
        };
        emitToolResult(tc, denied, emit, addMessage, appendContent);
        results.push(denied);
        continue;
      }

      // allow-once / allow-always 的持久化规则仍由当前 execute-tools 处理
      if (resolution.decision === 'allow-always' && resolution.rule) {
        await params.ruleStore.saveApproved(resolution.rule);
        params.ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
      }
    }

    const [result] = await toolProvider.execute([tc], {
      cwd: params.workspaceRoot,
      workspaceRoot: params.workspaceRoot,
      signal,
      agentName: params.agentName,
      readOnly: params.readOnly,
      sessionId: params.sessionId,
    });
    results.push(result);
    emitToolResult(tc, result, emit, addMessage, appendContent);
  }

  return results;
}
```

**说明**：`execute-tools.ts` 仍需持有 `ruleEngine` 和 `ruleStore`，因为 `allow-always` 的持久化发生在审批流之后。后续可进一步将审批持久化抽象进 `ApprovalRequestFactory`，但本次设计保持最小改动。

### 4.7 工厂函数

在 `agent-context-builder.ts` 中：

```typescript
function createPermissionEvaluator(
  mode: SecurityMode,
  ruleEngine: RuleEngine,
  approvalFactory: ApprovalRequestFactory,
): ToolPermissionEvaluator {
  const base = new BaseRuleEvaluator(ruleEngine);
  return mode === 'auto'
    ? new AutoPermissionEvaluator(base)
    : new InteractivePermissionEvaluator(base, approvalFactory);
}
```

`ApprovalRequestFactory` 可由 `agentState` 与 `toolProvider` 组合提供，负责把 `ApprovalRequestInput` 转成带 `alwaysOptions` 的完整 `ApprovalRequest`。

---

## 五、数据流

### 5.1 Agent 启动

```
createAgentFromEnv(options)
  │
  ▼
securityMode = options.securityMode ?? 'interactive'
  │
  ▼
buildRuleSecurity(ruleEngine, ruleStore)
  │
  ▼
createPermissionEvaluator(mode, ruleEngine, approvalFactory)
  │
  ▼
注入 AgentContext.permissionEvaluator
```

### 5.2 单次工具调用

```
LLM tool_call
  │
  ▼
executeTools
  │
  ▼
permissionEvaluator.evaluate(tc, toolDef)
  │   ├─ derivePatterns(tc, toolDef)
  │   ├─ classifyTool(toolName, toolDef, derivedPatterns)
  │   ├─ base.evaluateRules(toolName, derivedPatterns)
  │   └─ 按 mode + 类别决定 PermissionDecision
  │
  ▼
分支：
  ├─ allow → toolProvider.execute
  ├─ deny  → ToolResult.error
  └─ ask   → ApprovalEngine.createRequest → emit → wait → resolve
```

### 5.3 决策矩阵

| 规则命中 | 模式 | 类别 | 结果 |
|---|---|---|---|
| `allow` | 任意 | 任意 | `allow` |
| `deny` | 任意 | 任意 | `deny` |
| 无规则 | interactive | `read` | `allow` |
| 无规则 | interactive | `write` | `ask` |
| 无规则 | interactive | `sensitive-read` | `ask` |
| 无规则 | auto | `read` | `allow` |
| 无规则 | auto | `write` | `allow` |
| 无规则 | auto | `sensitive-read` | `deny` |

---

## 六、错误处理

| 场景 | 行为 | 给 LLM 的反馈 |
|---|---|---|
| 显式 `deny` 规则命中 | 直接拒绝，不进入审批 | `ToolResult.error = 'denied by rule'` |
| auto 模式下敏感读取无规则 | 直接拒绝 | `ToolResult.error = 'sensitive read blocked in auto mode'` |
| interactive 模式下用户点击 deny | 拒绝并级联拒绝同 session pending | `ToolResult.error = 'denied by user'` |
| 规则引擎 evaluate 异常 | 降级为 `deny`，记录日志 | `ToolResult.error = 'permission evaluation failed'` |
| 工具分类异常 | 降级为 `ask`（interactive）或 `deny`（auto），记录日志 | 按模式对应处理 |

---

## 七、测试策略

### 7.1 单元测试

| 模块 | 测试文件 | 覆盖点 |
|---|---|---|
| `classifyTool` | `packages/core/tests/security/permissions/tool-classifier.test.ts` | write/edit 分类；exec 写操作分类；敏感 pattern 命中；普通 read 分类 |
| `AutoPermissionEvaluator` | `packages/core/tests/security/permissions/auto-evaluator.test.ts` | 写操作默认 allow；敏感读默认 deny；deny 规则优先；allow 规则优先 |
| `InteractivePermissionEvaluator` | `packages/core/tests/security/permissions/interactive-evaluator.test.ts` | 写操作默认 ask；敏感读默认 ask；read 默认 allow；deny/allow 规则优先 |
| `execute-tools.ts` | `packages/core/tests/execute/execute-tools-permission-modes.test.ts` | 切换 evaluator 后行为变化；deny 直接返回；ask 走审批；allow 直接执行 |

### 7.2 集成测试

| 流程 | 测试文件 | 覆盖点 |
|---|---|---|
| `agent-context-builder` | `packages/core/tests/agent-context-builder-security-mode.test.ts` | 不同 `securityMode` 创建不同 evaluator；默认 interactive |
| 端到端 auto 模式 | 现有 run-agent 测试补充 | auto 模式下写操作无阻塞执行；敏感读被拒绝 |

---

## 八、关键决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| 默认模式 | `interactive` | 保持现有行为不变，避免破坏性变更 |
| 敏感读取 pattern | 内置，不暴露配置 | 先完成功能，后续再考虑用户配置 |
| 显式规则优先级 | `deny`/`allow` 优先于默认模式 | 两种模式都需保留用户明确控制能力 |
| 审批持久化 | 仍由 `execute-tools.ts` 处理 | 最小化改动，避免一次性重构过大 |
| 抽象粒度 | `ToolPermissionEvaluator` 接口 | 隔离模式差异，未来新增模式（如 `headless`）只需新增实现 |

---

## 九、实施范围

### 第一阶段（本次设计）

1. 新增 `security/permissions` 目录与 `ToolPermissionEvaluator` 接口。
2. 实现 `classifyTool`、`BaseRuleEvaluator`、`AutoPermissionEvaluator`、`InteractivePermissionEvaluator`。
3. 定义内置敏感读取 pattern。
4. 重构 `execute-tools.ts` 为薄编排层，依赖注入的 `permissionEvaluator`。
5. 在 `agent-context-builder.ts` 中根据 `securityMode` 创建对应 evaluator。
6. 补充单元测试与集成测试。

### 第二阶段（未来）

1. 将 `allow-always` 持久化逻辑完全抽象进 `ApprovalRequestFactory`，让 `execute-tools.ts` 不感知 `RuleStore`。
2. 将敏感读取 pattern 暴露为可配置项。
3. 支持运行中切换模式（如通过 API 事件），需处理 pending 审批状态。
