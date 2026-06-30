# 消除 provider-loader 动态 import 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `provider-loader.ts` 中 `import(expression)` 动态导入路径，消除 webpack "Critical dependency" 警告；session provider 改为直接传实例，其他 provider 不变。

**Architecture:** 类型链路 `CreateAgentOptions.sessionProvider` → `ProviderManagerConfig.sessionProvider` → `ProviderRegistryConfig.sessionProvider` 从 `ProviderReference<SessionProvider>` 改为 `SessionProvider`；实例通过已有 loader 的 immediate-return 路径（非 string/descriptor 直接返回）；删除 `resolveModulePath` 和 `importModule` 两个方法，消除动态 `import()` 来源。

**Tech Stack:** TypeScript, rem-agent-core

**Spec:** `docs/superpowers/specs/2026-07-01-remove-dynamic-import.md`

---

## File Structure

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/core/src/sdk/provider-loader.ts` | MODIFY | `ProviderReference` 不变 |
| `packages/core/src/registry/provider-loader.ts` | MODIFY | 删除 `resolveModulePath` + `importModule`；`load()` 中非 builtin 分支抛错 |
| `packages/core/src/provider-manager.ts` | MODIFY | `sessionProvider` 类型改为 `SessionProvider` |
| `packages/core/src/agent-factory.ts` | MODIFY | `sessionProvider` 类型改为 `SessionProvider` |
| `packages/web/src/lib/container.ts` | MODIFY | 构造 `FileSessionProvider` 实例传入 |

---

### Task 1: ProviderLoader 删除动态 import 方法

**Files:**
- Modify: `packages/core/src/registry/provider-loader.ts:1-88`

- [ ] **Step 1: 重写 provider-loader.ts**

删除 `resolveModulePath` 和 `importModule` 两个方法，修改 `load()` 中 fallback 分支为抛错。移除不再需要的 `node:path` 和 `node:url` import。

```typescript
import type {
  ProviderLoader,
  ProviderLoaderContext,
  ProviderReference,
  ProviderDescriptor,
  ProviderModule,
  ProviderModuleRef,
} from '../sdk/provider-loader.js';

function isDescriptor<T>(ref: ProviderReference<T>): ref is ProviderDescriptor<T> {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    'module' in ref &&
    typeof (ref as ProviderDescriptor<T>).module === 'string'
  );
}

export class DefaultProviderLoader implements ProviderLoader {
  constructor(private resolveBuiltin?: (kind: string, name: string) => ProviderModuleRef | string | undefined) {}

  async load<T>(ref: ProviderReference<T>, ctx: ProviderLoaderContext): Promise<T> {
    if (typeof ref !== 'string' && !isDescriptor(ref)) {
      return ref as T;
    }

    const descriptor = typeof ref === 'string' ? { module: ref } : ref;
    const name = descriptor.module;
    const kind = ctx.kind;

    const builtinResult = this.resolveBuiltin?.(kind as any, name);
    if (typeof builtinResult === 'function') {
      const mod = await builtinResult();
      const options = descriptor.options ?? (mod as any).getDefaultOptions?.(ctx);
      return mod.createProvider(options);
    }

    throw new Error(
      `Provider "${name}" for kind "${kind}" is not a recognized builtin. ` +
        `Use a ProviderReference instance or register it as a builtin.`,
    );
  }
}
```

- [ ] **Step 2: Typecheck core**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/registry/provider-loader.ts
git commit -m "refactor: remove dynamic import from provider-loader, throw for non-builtin paths"
```

---

### Task 2: 类型链路改为 SessionProvider 实例

**Files:**
- Modify: `packages/core/src/provider-manager.ts:29`
- Modify: `packages/core/src/agent-factory.ts:17,61`

- [ ] **Step 1: 修改 ProviderManagerConfig 类型**

`packages/core/src/provider-manager.ts` 第 29 行，将 `sessionProvider` 类型从 `ProviderReference<SessionProvider>` 改为 `SessionProvider`：

```typescript
// 第 29 行改为
  sessionProvider?: SessionProvider;
```

去掉 `ProviderReference` 的 import（如果不再其他地方使用则删除，但 `toolProvider` 等还在用，保留）。

- [ ] **Step 2: 修改 CreateAgentOptions 类型**

`packages/core/src/agent-factory.ts` 第 17 行：

```typescript
// 第 17 行改为
  sessionProvider?: SessionProvider;
```

去掉 `ProviderReference` 的 import。如果 `skillProvider` 还在用 `ProviderReference`，保留该 import。

- [ ] **Step 3: Typecheck core**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: FAIL — `container.ts` 仍传 `{ sessionProvider: 'file' }`（string 而非实例）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/provider-manager.ts packages/core/src/agent-factory.ts
git commit -m "refactor: change sessionProvider type to SessionProvider instance"
```

---

### Task 3: container.ts 构造 FileSessionProvider 实例

**Files:**
- Modify: `packages/web/src/lib/container.ts:1-35`

- [ ] **Step 1: 修改 container.ts**

```typescript
import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentService, SessionService } from 'rem-agent-bridge';
import { createAgentFromEnv, FileSessionProvider } from 'rem-agent-core';
import { getDefaultSessionsDir } from 'rem-agent-core';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  const sessionsDir = process.env.REM_AGENT_SESSIONS_DIR ?? getDefaultSessionsDir();
  const sessionProvider = new FileSessionProvider(sessionsDir);
  const { pm } = await createAgentFromEnv({ sessionProvider });

  container.register({
    agentService: asFunction(() => new AgentService(pm), {
      lifetime: Lifetime.SINGLETON,
    }),
    sessionService: asFunction(({ agentService }) => new SessionService(agentService), {
      lifetime: Lifetime.SINGLETON,
    }),
  });

  return container;
}

let _container: AwilixContainer | null = null;
let _initPromise: Promise<AwilixContainer> | null = null;

export async function getContainer(): Promise<AwilixContainer> {
  if (_container) return _container;
  if (!_initPromise) {
    _initPromise = configureContainer().then((c) => {
      _container = c;
      _initPromise = null;
      return c;
    });
  }
  return _initPromise;
}
```

`getDefaultSessionsDir` 需要确认是否已从 `rem-agent-core` 导出。

- [ ] **Step 2: Typecheck web**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/container.ts
git commit -m "refactor: construct FileSessionProvider instance in container"
```

---

### Task 4: 最终验证

- [ ] **Step 1: 全仓 typecheck + build**

```bash
pnpm build:all && pnpm --filter rem-agent-web typecheck
```
Expected: PASS

- [ ] **Step 2: 运行测试**

```bash
pnpm test
```
Expected: 全部通过

- [ ] **Step 3: 启动 web 验证**

```bash
pnpm --filter rem-agent-web dev
```
检查：
- 页面正常加载
- 无 webpack "Critical dependency" 警告
- session 创建/切换/消息发送正常
- 重启后 session 持久化正常

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: final verification for dynamic import removal" --allow-empty
```

---

## 自查

1. **Spec coverage**: 
   - 删除 `resolveModulePath` + `importModule` → Task 1
   - `sessionProvider` 类型改为实例 → Task 2
   - container 构造实例 → Task 3
   - 最终验证 → Task 4

2. **Placeholder scan**: 无 TBD/TODO

3. **Type consistency**: `ProviderManagerConfig.sessionProvider` 和 `CreateAgentOptions.sessionProvider` 类型同步改为 `SessionProvider`；`container.ts` 使用 `FileSessionProvider` 实例。
