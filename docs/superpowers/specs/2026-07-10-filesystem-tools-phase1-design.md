# 文件系统工具第一期设计

> 设计日期：2026-07-10
> 范围：glob / find / grep / apply_patch
> 状态：待实现

## 背景

对比 OpenCode / OpenClaw 的工具体系，当前 Rem 在文件系统操作方面缺少 `glob`、`find`、`grep` 和 `apply_patch` 四个工具。它们分别覆盖批量文件查找、递归文件搜索、文件内容搜索和多文件 patch 应用，是 coding agent 日常工作的核心能力。

本期为两期计划中的第一期，聚焦本地文件系统工具；第二期再扩展到网络 / Web 工具。

## 目标

1. 在 `rem-agent-core` 中新增 4 个内置文件系统工具：
   - `glob`：按 glob 模式查找文件
   - `find`：按 glob 模式递归查找文件（与 OpenClaw 语义一致）
   - `grep`：按正则或纯文本搜索文件内容
   - `apply_patch`：应用 OpenAI envelope 格式的多文件 patch
2. 与现有工具（`read`/`write`/`edit`/`ls`/`exec`）保持一致的接口、安全和测试风格。
3. 遵循 `module-separation-convention`，文件精简、职责单一。

## 非目标

- 本期不涉及网络 / Web 工具（`web_fetch`/`web_search`/`browser`）。
- `grep` 不引入 `ripgrep` 外部二进制；使用纯 Node.js 实现。
- `apply_patch` 仅支持 OpenAI envelope 格式，暂不支持标准 unified diff 或 git patch。

## 选型

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 与 OpenClaw 对齐 | 底层调用 `rg`/`fd` | 拒绝，需要外部二进制，部署复杂 |
| B. 纯 Node.js | 用 `glob` npm 包 + 逐行读取 | **采纳**，与现有工具风格一致，测试简单 |
| C. 混合 | 优先 `rg`/`fd`，回退到 JS | 拒绝，维护两套实现，收益不大 |

## 工具 API

### 1. `glob`

按 glob 模式查找文件，返回相对 `workspaceRoot` 的 POSIX **文件**路径列表（默认不包含目录）。

```typescript
{
  pattern: string;                  // 必填，glob 模式，如 "**/*.ts"
  path?: string;                      // 可选，默认 cwd；可以是文件或目录
  exclude?: string | string[];        // 可选，排除模式
  limit?: number;                    // 可选，默认 1000
}
```

- `readOnly: true`
- 分类：filesystem
- 默认排除 `node_modules/**` 和 `.git/**`，用户可通过 `exclude` 追加

### 2. `find`

递归查找文件，语义与 OpenClaw 的 `find` 一致，底层与 `glob` 共享实现。

```typescript
{
  pattern: string;                  // 必填，glob 模式
  path?: string;                     // 可选，默认 cwd；可以是文件或目录
  exclude?: string | string[];       // 可选
  limit?: number;                    // 可选，默认 1000
}
```

- `readOnly: true`
- 分类：filesystem
- 默认排除 `node_modules/**` 和 `.git/**`

### 3. `grep`

按正则或纯文本搜索文件内容。

```typescript
{
  pattern: string;                  // 必填，默认正则
  path?: string;                     // 可选，默认 cwd；可以是文件或目录
  glob?: string;                     // 可选，只搜索匹配该 glob 的文件
  literal?: boolean;                // 默认 false，true 时按纯文本匹配
  ignoreCase?: boolean;              // 默认 false
  context?: number;                  // 默认 0，匹配行前后各 N 行
  limit?: number;                     // 可选，默认 100
}
```

- `readOnly: true`
- 分类：search

返回格式参考 OpenClaw：

```text
src/foo.ts:42: matched text
src/foo.ts-40: context line
src/foo.ts-41: context line
src/foo.ts:43: context line
```

- 匹配行：`relpath:line: text`
- 上下文行：`relpath-line- text`

### 4. `apply_patch`

应用 OpenAI envelope 格式的多文件 patch。

```typescript
{
  patchText: string;                  // 必填
}
```

- `dangerous: true`
- 分类：filesystem

支持操作：

- `*** Add File: <path>`
- `*** Update File: <path>`
- `*** Delete File: <path>`
- `*** Move to: <new>`（与 Update File 配合使用）
- `@@ <context>` 上下文定位
- 行首 ` `（保留）、`+`（新增）、`-`（删除）

Parser 错误处理：遇到无法识别的行或结构时立即抛出，包含行号和附近文本，不静默跳过。

## 模块拆分

```text
packages/core/src/plugins/tool/file-system/
├── glob.ts                      # glob 工具定义 + 执行器入口
├── find.ts                      # find 工具定义，委托 glob 实现
├── grep.ts                      # grep 工具定义 + 执行器
├── apply-patch.ts               # apply_patch 工具定义 + 入口执行器
├── apply-patch-parser.ts        # OpenAI envelope 解析器
├── apply-patch-executor.ts      # patch 应用逻辑
├── shared/
│   ├── glob-executor.ts         # glob/find 共享的目录遍历实现
│   └── index.ts                 # 共享模块导出（按需）
└── index.ts                     # 注册所有文件系统工具
```

### 文件职责

| 文件 | 职责 | 预估行数 |
|------|------|---------|
| `glob.ts` | 定义 schema、执行器入口、derivePatterns/deriveAlwaysOptions | ≤ 100 |
| `find.ts` | 定义 schema、复用 glob 执行器 | ≤ 80 |
| `grep.ts` | 定义 schema、逐行读取、正则匹配、输出格式化 | ≤ 150 |
| `apply-patch.ts` | 定义 schema、调用 parser + executor | ≤ 100 |
| `apply-patch-parser.ts` | 解析 OpenAI envelope，产出 Hunk 列表 | ≤ 150 |
| `apply-patch-executor.ts` | 按 Hunk 执行文件写入、删除、移动 | ≤ 150 |
| `shared/glob-executor.ts` | 基于 `glob` 包实现目录遍历和过滤 | ≤ 150 |

## 依赖关系

```text
glob.ts
  └── shared/glob-executor.ts

find.ts
  └── shared/glob-executor.ts

grep.ts
  ├── shared/glob-executor.ts（用于 glob 文件过滤）
  ├── shared/truncate.ts
  └── resolveWorkspacePath

apply-patch.ts
  ├── apply-patch-parser.ts
  ├── apply-patch-executor.ts
  └── shared/file-mutation-queue.ts

apply-patch-executor.ts
  ├── resolveWorkspacePath
  └── shared/file-mutation-queue.ts
```

## 新增依赖

- `glob`：用于 `glob` / `find` 的目录遍历和模式匹配。
- 无需 `minimatch`（`glob` 已内置）。
- `apply_patch` 自研解析，无额外依赖。

## 修改文件

### 1. `packages/core/src/plugins/tool/file-system/index.ts`

注册 4 个新工具，并配置 `derivePatterns` / `deriveAlwaysOptions`：

- `glob` / `find` / `grep`：从 `path` 派生 `file:<path>`。
- `apply_patch`：从 patch 解析出的每个目标文件路径派生 `file:<path>`；always 选项提供文件级、目录级、扩展名级、全局级 allow 规则。

### 2. `packages/core/src/security/rules/profiles.ts`

为 `coding` profile 增加默认 allow 规则：

```typescript
rule('glob', '*', 'allow'),
rule('find', '*', 'allow'),
rule('grep', '*', 'allow'),
// apply_patch 保持默认 ask（危险工具）
```

### 3. `packages/core/package.json`

新增运行时依赖：

```json
"dependencies": {
  "glob": "^11.0.0"
}
```

## 安全与审批

### 工具分类

| 工具 | 分类 | 审批策略 |
|------|------|----------|
| `glob` | read-only | 默认免审批 |
| `find` | read-only | 默认免审批 |
| `grep` | read-only | 默认免审批 |
| `apply_patch` | dangerous | 必须审批 |

### 工作区隔离

- `glob` / `find` / `grep`：搜索范围限制在 `workspaceRoot` 内；`path` 超出时拒绝。
- `apply_patch`：解析 patch 后先提取所有目标文件路径，每个路径都通过 `resolveWorkspacePath` 校验；使用 `FileMutationQueue` 串行化写入。

### 规则匹配

- `glob` / `find` / `grep` 的 `derivePatterns` 主要服务于 deny 规则匹配；默认 allow 通过 read-only 机制实现。
- `apply_patch` 的 `derivePatterns` 从 patch 目标路径派生，用于规则评估和审批 UI 的 always 选项。

## 输出格式

### `glob` / `find`

```text
src/foo.ts
src/bar.ts
src/nested/baz.ts

[1000 entries limit reached]
```

空结果：`(no matches)`

### `grep`

```text
src/foo.ts:10: import { glob } from './glob';
src/foo.ts-12-: // helper
src/foo.ts-12-: // helper
src/foo.ts:13: export function createGlobTool() {
```

- 匹配行：`relpath:line: text`
- 上下文行：`relpath-line- text`

空结果：`(no matches)`

命中 limit 时追加：

```text
[100 matches limit reached]
```

### `apply_patch`

```text
Applied patch:
- Added: src/foo.ts
- Updated: src/bar.ts
- Deleted: src/baz.ts
- Moved: src/old.ts -> src/new.ts
```

失败示例：

- `Patch targets path outside workspace: /etc/foo`
- `Could not locate context in src/foo.ts at line 10`
- `File already exists: src/foo.ts (Add conflict)`

### 通用截断

所有输出统一走 `truncateHead`，默认 `DEFAULT_MAX_BYTES = 50KB`；截断时追加 `[truncated to ...]`。

## 测试策略

### 测试文件

- `packages/core/tests/glob-tool.test.ts`
- `packages/core/tests/find-tool.test.ts`
- `packages/core/tests/grep-tool.test.ts`
- `packages/core/tests/apply-patch-tool.test.ts`
- `packages/core/tests/apply-patch-parser.test.ts`

### 覆盖要点

**glob / find：**
- 基本模式匹配、`**` 递归、`{}` brace expansion
- `exclude` 排除
- 工作区外路径拒绝
- `limit` 截断
- 空结果

**grep：**
- 正则匹配、literal 模式、ignoreCase
- `glob` 文件过滤
- `context` 上下文行
- `limit` 截断
- 工作区外路径拒绝

**apply_patch：**
- Add / Update / Delete / Move 操作
- 多文件 patch
- 上下文定位失败回退
- 工作区外路径拒绝
- read-only 模式拒绝
- parser 错误处理

## 验收标准

1. `pnpm install` 后 `glob` 依赖可用。
2. `pnpm typecheck && pnpm test` 全部通过。
3. 4 个新工具在 `coding` profile 下默认可用（`apply_patch` 除外，走审批）。
4. 新文件均不超过 200 行。
5. 所有工具都通过 `resolveWorkspacePath` 限制在工作区内。

## 风险与回退

- `glob` 包体积较大，但属于社区标准；若未来需要更小依赖，可替换为 `minimatch` + 自研遍历。
- `apply_patch` 的 OpenAI envelope 格式不是通用标准，但 OpenCode / OpenClaw 均采用此格式，LLM 生成稳定性较好。

## 下一期

第二期：网络 / Web 工具（`web_fetch` / `web_search` / `browser`），需单独设计域名白名单、重定向检测、外部内容标记等安全机制。
