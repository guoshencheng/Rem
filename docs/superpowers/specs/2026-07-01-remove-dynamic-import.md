# 消除 provider-loader 动态 import

## 目标

消除 `provider-loader.ts` 中 `import(expression)` 导致的 webpack "Critical dependency" 警告，只涉及 session provider 链路，其他 provider 不变。

## 改动范围

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/core/src/sdk/provider-loader.ts` | MODIFY | `ProviderReference` 类型保持不变；删除 `resolveModulePath` + `importModule` 方法 |
| `packages/core/src/registry/provider-loader.ts` | MODIFY | `DefaultProviderLoader.load()` 中，非 immediate instance 且非 builtin 的分支改为抛错 |
| `packages/core/src/registry/provider-registry.ts` | MODIFY | `resolve()` 中 session provider 如果是实例（非 string/descriptor），直接放入 `providers` map，不走 loader |
| `packages/core/src/provider-manager.ts` | MODIFY | `ProviderManagerConfig.sessionProvider` 类型改为 `SessionProvider` |
| `packages/core/src/agent-factory.ts` | MODIFY | `CreateAgentOptions.sessionProvider` 类型改为 `SessionProvider` |
| `packages/web/src/lib/container.ts` | MODIFY | 构造 `FileSessionProvider` 实例传入 `createAgentFromEnv` |

## 不改的

- tool、memory、compressor、error、skill、budget、title 等 provider 保持现状（字符串名称 + static map）
- `resolveBuiltin` 机制不变（字面量 `import('./session/file/index.js')` 无 webpack 警告）

## 数据流

```
container.ts
  ↓ new FileSessionProvider(dir)
  ↓ createAgentFromEnv({ sessionProvider: instance })
  ↓ createProviderManager({ sessionProvider: instance })
  ↓ ProviderManager.init()
  ↓ AgentProviderRegistry.resolve('session')
    → ref 是 SessionProvider 实例 → 直接存入 providers map（不走 loader）
```

## 删除的代码

`DefaultProviderLoader` 中：
- `resolveModulePath()` 方法（整个删掉）
- `importModule()` 方法（整个删掉）
- `load()` 中调用这两个方法的分支（抛错替代）

这会导致非 builtin 的字符串/descriptor 路径 provider 不再工作。当前项目只用 builtin provider，没有外部路径加载场景。
