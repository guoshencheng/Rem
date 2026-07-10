# Rem Agent Workspace 外部路径访问控制设计

> 日期：2026-07-10  
> 主题：将 workspace-root-guard 从"直接拒绝越界"改为"interactive 模式询问、auto 模式按规则/读放行"  
> 范围：rem-agent-core

---

## 一、背景与目标

当前 `workspace-root-guard` 在文件工具（read/write/edit/ls）执行时，一旦路径解析到 `workspaceRoot` 外就抛出普通 `Error`，导致工具直接失败。实际使用中存在合理访问 workspace 外部路径的场景（如相邻项目、全局配置、临时目录），因此需要更灵活的控制策略。

本设计目标：

- **interactive 模式**：任何越界路径都询问用户，包括敏感路径。
- **auto 模式**：不询问；读操作越界直接放行（除非规则明确禁止）；写操作越界按规则判断。
- 引入 `Rule.outside` 字段，专门控制是否允许访问 workspace 外部路径。
- 通过 `RuleEngine.checkOutsideAllowed` 前置判断，如果已允许外部访问，则完全跳过 workspace guard。

---

## 二、核心概念

### 2.1 `WorkspaceOutsideError`

`workspace-root-guard.ts` 不再抛普通 `Error`，而是抛可识别的 `WorkspaceOutsideError`，携带越界路径和 workspace root。

### 2.2 `Rule.outside`

规则新增可选字段 `outside: boolean`：

- `outside: true`：该规则表示允许访问 workspace 外部路径。
- `outside: false` 或 `undefined`：规则只在 workspace 内部生效（保持现有行为）。

`outside` 字段只控制"是否允许外部访问"，不区分读/写。读写权限仍然由 `permission` + `pattern` 控制。

### 2.3 `RuleEngine.checkOutsideAllowed`

`RuleEngine` 增加专门方法，只评估 `outside: true` 的规则，默认行为为 `deny`。

---

## 三、架构设计

### 3.1 模块图

```
┌─────────────────────────────────────────┐
│  execute-tools.ts                        │
│  ─────────────────                       │
│  1. 用 RuleEngine.checkOutsideAllowed   │
│     判断当前调用是否允许外部访问          │
│  2. 把 outsideAllowed 写入 ToolContext  │
│  3. 调用 toolProvider.execute            │
│  4. 捕获 WorkspaceOutsideError，         │
│     按 mode 决定询问/放行/拒绝          │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  workspace-root-guard.ts                 │
│  ─────────────────────                   │
│  resolveWorkspacePath(filePath, ctx,      │
│                       outsideAllowed?)  │
│  ├─ outsideAllowed === true             │
│  │   → 跳过 guard，直接返回路径         │
│  └─ 否则执行 assertWithinWorkspaceRoot   │
│      → 越界抛 WorkspaceOutsideError     │
└─────────────────────────────────────────┘
```

### 3.2 文件改动

| 文件 | 改动 |
|---|---|
| `packages/core/src/security/workspace-root-guard.ts` | 新增 `WorkspaceOutsideError`；`resolveWorkspacePath` 支持 `outsideAllowed` 参数 |
| `packages/core/src/security/rules/rule.ts` | `RuleSchema` 增加 `outside: boolean` |
| `packages/core/src/security/rules/rule-engine.ts` | 新增 `checkOutsideAllowed` 方法 |
| `packages/core/src/sdk/tool-provider.ts` | `ToolContext` 增加 `outsideAllowed?: boolean` |
| `packages/core/src/execute/execute-tools.ts` | 前置调用 `checkOutsideAllowed`；捕获 `WorkspaceOutsideError` 并处理 |
| `packages/core/src/plugins/tool/file-system/*.ts` | 把 `outsideAllowed` 传给 `resolveWorkspacePath` |

---

## 四、组件设计

### 4.1 `WorkspaceOutsideError`

```typescript
// packages/core/src/security/workspace-root-guard.ts
export class WorkspaceOutsideError extends Error {
  constructor(
    public readonly absolutePath: string,
    public readonly workspaceRoot: string,
  ) {
    super(`Path "${absolutePath}" resolves outside workspace root "${workspaceRoot}"`);
    this.name = 'WorkspaceOutsideError';
  }
}

export function assertWithinWorkspaceRoot(
  absolutePath: string,
  workspaceRoot: string,
): void {
  const resolvedRoot = resolve(workspaceRoot);
  const realRoot = safeRealpath(resolvedRoot);
  const realPath = safeRealpath(absolutePath);
  const rel = relative(realRoot, realPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new WorkspaceOutsideError(absolutePath, workspaceRoot);
  }
}
```

### 4.2 `resolveWorkspacePath` 支持跳过 guard

```typescript
export function resolveWorkspacePath(
  filePath: string,
  ctx: { cwd: string; workspaceRoot: string },
  outsideAllowed: boolean = false,
): string {
  const cwd = safeRealpath(ctx.cwd);
  const root = safeRealpath(ctx.workspaceRoot);
  const resolved = resolveToCwd(filePath, cwd);

  if (outsideAllowed) {
    return resolved;
  }

  assertWithinWorkspaceRoot(resolved, root);
  return resolved;
}
```

### 4.3 `Rule` 类型扩展

```typescript
// packages/core/src/security/rules/rule.ts
export const RuleSchema = Type.Object({
  permission: Type.String({ minLength: 1 }),
  pattern: Type.String({ minLength: 1 }),
  action: RuleActionSchema,
  source: Type.Optional(RuleSourceSchema),
  outside: Type.Optional(Type.Boolean()),
});
```

### 4.4 `RuleEngine.checkOutsideAllowed`

```typescript
// packages/core/src/security/rules/rule-engine.ts
export class RuleEngine {
  constructor(private rules: Rule[]) {}

  evaluate(toolCall: ToolCallPattern): RuleAction {
    const set = buildRuleSet(this.rules);
    return evaluate(toolCall, set);
  }

  checkOutsideAllowed(toolName: string, derivedPatterns: string[]): boolean {
    const outsideRules = this.rules.filter((r) => r.outside === true);
    const set = buildRuleSet(outsideRules);
    const action = evaluate({ toolName, derivedPatterns }, set, 'deny');
    return action === 'allow';
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }
}
```

### 4.5 `ToolContext` 扩展

```typescript
// packages/core/src/sdk/tool-provider.ts
export interface ToolContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId?: string;
  outsideAllowed?: boolean;
}
```

### 4.6 文件工具执行器示例

```typescript
// packages/core/src/plugins/tool/file-system/read.ts
export function createReadToolExecutor(): ToolExecutor<typeof readSchema> {
  return async (input: ReadToolInput, ctx: ToolContext) => {
    const rawResolved = resolveReadPath(input.path, ctx.cwd);
    const absolutePath = resolveWorkspacePath(rawResolved, ctx, ctx.outsideAllowed);
    // ... 后续读取逻辑
  };
}
```

### 4.7 `execute-tools.ts` 处理逻辑

`execute-tools.ts` 在调用工具前，根据 `securityMode` 和工具类别决定 `outsideAllowed`。`ExecuteParams` 需要增加 `securityMode` 字段。

```typescript
// packages/core/src/execute/execute-tools.ts
for (const tc of params.toolCalls) {
  const def = toolProvider.getToolDefinition(tc.toolName);
  // ... 权限评估 ...

  const derivedPatterns = def?.derivePatterns
    ? def.derivePatterns(tc.input as never)
    : [`tool:${tc.toolName}`];

  const category = classifyTool(tc.toolName, def, derivedPatterns);
  const outsideAllowed = computeOutsideAllowed(
    params.securityMode,
    category,
    ruleEngine,
    tc.toolName,
    derivedPatterns,
  );

  const ctx: ToolContext = {
    cwd: params.workspaceRoot,
    workspaceRoot: params.workspaceRoot,
    signal,
    agentName: params.agentName,
    readOnly: params.readOnly,
    sessionId: params.sessionId,
    outsideAllowed,
  };

  let result: ToolResult;
  try {
    [result] = await toolProvider.execute([tc], ctx);
  } catch (err) {
    if (err instanceof WorkspaceOutsideError) {
      result = await handleOutsideWorkspaceError(tc, err, params, ctx, category);
    } else {
      result = {
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  results.push(result);
  emitToolResult(tc, result, emit, addMessage, appendContent);
}

function computeOutsideAllowed(
  mode: SecurityMode,
  category: ToolCategory,
  ruleEngine: RuleEngine,
  toolName: string,
  derivedPatterns: string[],
): boolean {
  // 已配置的 outside 规则最优先
  if (ruleEngine.checkOutsideAllowed(toolName, derivedPatterns)) {
    return true;
  }

  // auto 模式下读操作直接放行外部路径
  if (mode === 'auto' && category === 'read') {
    return true;
  }

  return false;
}
```

### 4.8 越界错误处理函数

```typescript
async function handleOutsideWorkspaceError(
  tc: ToolCall,
  err: WorkspaceOutsideError,
  params: ExecuteParams,
  ctx: ToolContext,
  category: ToolCategory,
): Promise<ToolResult> {
  if (params.securityMode === 'auto' && category === 'write') {
    // auto 模式下写操作越界：permissionEvaluator 已判定 allow，
    // 说明规则允许或无规则，直接放行重试。
    const allowedCtx = { ...ctx, outsideAllowed: true };
    const [result] = await params.toolProvider.execute([tc], allowedCtx);
    return result;
  }

  // auto 模式下读操作越界不会走到这里，因为 computeOutsideAllowed 已经返回 true。
  // 如果由于未知原因到达，按安全策略返回错误。
  if (params.securityMode === 'auto') {
    return {
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: '',
      error: `Path outside workspace denied in auto mode: ${err.absolutePath}`,
    };
  }

  // interactive 模式：创建审批请求
  const liveState = params.agentState.getOrCreate(params.sessionId);
  const request = liveState.approvalEngine.createRequest({
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    patterns: [err.absolutePath],
    title: `Access outside workspace: ${tc.toolName}`,
    description: `Path "${err.absolutePath}" resolves outside workspace root "${err.workspaceRoot}"`,
    severity: 'warning',
    alwaysOptions: [
      {
        label: err.absolutePath,
        rule: {
          permission: tc.toolName,
          pattern: err.absolutePath,
          action: 'allow',
          outside: true,
        },
      },
      {
        label: `allow all outside ${tc.toolName}`,
        rule: {
          permission: tc.toolName,
          pattern: '*',
          action: 'allow',
          outside: true,
        },
      },
    ],
  });

  liveState.pendingApprovals.push(request);
  params.emit({ type: 'approval-request', sessionId: params.sessionId, request });

  const resolution = await liveState.approvalEngine.wait(request.approvalId);
  liveState.pendingApprovals = liveState.pendingApprovals.filter(
    (r) => r.approvalId !== request.approvalId,
  );
  params.emit({
    type: 'approval-resolved',
    sessionId: params.sessionId,
    approvalId: request.approvalId,
    decision: resolution.decision,
  });

  if (resolution.decision === 'deny') {
    return {
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: '',
      error: 'denied',
    };
  }

  if (resolution.decision === 'allow-always' && resolution.rule) {
    await params.ruleStore.saveApproved(resolution.rule);
    params.ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
  }

  // 用户允许后，重新执行工具调用
  const allowedCtx = { ...ctx, outsideAllowed: true };
  const [result] = await params.toolProvider.execute([tc], allowedCtx);
  return result;
}
```

---

## 五、数据流

### 5.1 单次文件工具调用

```
LLM tool_call: read({ path: '/data/work/openclaw/.../grep.ts' })
  │
  ▼
executeTools
  │
  ▼
permissionEvaluator.evaluate → allow
  │
  ▼
computeOutsideAllowed(mode, category, ruleEngine, ...)
  │   ├─ 命中 outside: true allow 规则 → outsideAllowed = true
  │   ├─ auto 模式 + 读操作 → outsideAllowed = true
  │   └─ 其他情况 → outsideAllowed = false
  │
  ▼
toolProvider.execute([tc], { ..., outsideAllowed })
  │
  ▼
read 工具内部：resolveWorkspacePath(path, ctx, outsideAllowed)
  │
  ├─ outsideAllowed === true → 返回路径，继续读取
  └─ outsideAllowed === false → assertWithinWorkspaceRoot 抛 WorkspaceOutsideError
  │
  ▼
executeTools 捕获 WorkspaceOutsideError
  │
  ├─ auto 模式 + 写操作 → 已确认 allow，重试 outsideAllowed=true
  └─ interactive 模式 → 创建审批请求 → 等待用户 → 允许后重试
```

### 5.2 行为矩阵

| 模式 | outsideAllowed | 路径状态 | 结果 |
|---|---|---|---|
| interactive | true | 任意 | 直接执行 |
| interactive | false | 在 workspace 内 | 直接执行 |
| interactive | false | 在 workspace 外 | 询问用户 |
| auto | true | 任意 | 直接执行 |
| auto | false | 在 workspace 内 | 直接执行 |
| auto | false | 在 workspace 外 | 读：直接放行；写：按规则（permissionEvaluator 已判定 allow） |

其中 `outsideAllowed` 由 `computeOutsideAllowed` 决定：先检查 `outside: true` 规则，再检查是否为 auto 读。

---

## 六、错误处理

| 场景 | 行为 | 给 LLM 的反馈 |
|---|---|---|
| `outsideAllowed=true` 且路径越界 | 直接执行 | 正常工具结果 |
| `outsideAllowed=false` 且路径越界，interactive | 创建审批请求 | 等待用户 |
| `outsideAllowed=false` 且路径越界，auto + 读 | 已提前设置 outsideAllowed=true，不会触发 | — |
| `outsideAllowed=false` 且路径越界，auto + 写 | permissionEvaluator 已判定 allow，重试执行 | 正常工具结果 |
| 用户拒绝外部访问 | 返回错误 | `ToolResult.error = 'denied'` |
| 非越界异常 | 按现有逻辑处理 | 原错误信息 |

---

## 七、测试策略

| 模块 | 测试文件 | 覆盖点 |
|---|---|---|
| `WorkspaceOutsideError` | `packages/core/tests/security/workspace-root-guard.test.ts` | 越界抛错携带路径；非越界正常返回；`outsideAllowed=true` 跳过 guard |
| `Rule.outside` | `packages/core/tests/security/rules/rule.test.ts` | schema 接受 `outside: true/false`；验证非法值拒绝 |
| `RuleEngine.checkOutsideAllowed` | `packages/core/tests/security/rules/rule-engine.test.ts` | 命中 outside allow 返回 true；无规则返回 false；outside deny 规则生效 |
| `execute-tools.ts` 越界处理 | `packages/core/tests/execute/execute-tools-outside-workspace.test.ts` | interactive 询问；auto 读放行；auto 写按规则；允许后重试执行 |
| 文件工具 | `packages/core/tests/read-tool.test.ts` 等 | `outsideAllowed=true` 时访问外部路径成功 |

---

## 八、关键决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| 越界处理方案 | 工具执行器抛 `WorkspaceOutsideError`，execute-tools 捕获 | 路径解析不重复，审批逻辑集中 |
| 敏感路径越界 | interactive 也走询问 | 用户选择 A，保留用户控制权 |
| auto 模式读越界 | 直接放行 | 读操作风险低，auto 模式追求流畅 |
| auto 模式写越界 | 按规则判断 | 写操作风险高，必须有规则控制 |
| `outside` 字段语义 | 只控制是否允许外部访问，不区分读写 | 职责单一，不和 permission/pattern 语义混合 |
| 前置跳过 guard | `ruleEngine.checkOutsideAllowed` 返回 true 时完全跳过 guard | 避免重复检查，逻辑清晰 |
| 持久化规则 | `outside: true` 规则保存到 `RuleStore.approved` | 跨 session 生效 |

---

## 九、实施范围

### 第一阶段（本次设计）

1. 新增 `WorkspaceOutsideError` 并修改 `assertWithinWorkspaceRoot`。
2. 修改 `resolveWorkspacePath` 支持 `outsideAllowed` 参数。
3. `RuleSchema` 增加 `outside` 字段。
4. `RuleEngine` 增加 `checkOutsideAllowed` 方法。
5. `ToolContext` 增加 `outsideAllowed`。
6. 文件工具执行器把 `outsideAllowed` 传给 `resolveWorkspacePath`。
7. `execute-tools.ts` 前置调用 `checkOutsideAllowed` 并捕获 `WorkspaceOutsideError`。
8. 补充单元测试和集成测试。

### 第二阶段（未来）

1. 支持在配置文件中预定义 `outside: true` 规则。
2. 审批 UI 显示越界路径上下文，帮助用户判断风险。