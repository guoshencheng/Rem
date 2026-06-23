<!--
调研文档 #1
主题：TypeBox Schema 声明 + Provider 适配
调研者：subagent 1（general）
调研范围：bash-tools.schemas.ts、agent-tools-parameter-schema.ts、schema/typebox.ts、clean-for-gemini.ts、openai-tool-schema.ts
原合并文档位置：第 2 节
关联文档：README.md、00-overview.md、08-synthesis.md
-->

# 01. Schema 声明与 Provider 适配

> 调研者：subagent 1
> 主题：OpenClaw 如何用 TypeBox 描述 exec tool 参数并适配各 LLM provider 的 schema 怪癖
> 关联源码：`packages/agents/bash-tools.schemas.ts`、`packages/agents/agent-tools-parameter-schema.ts`

## 2. Schema 声明与 Provider 适配

### 2.1 execSchema 的字段语义

`execSchema` 定义在 `bash-tools.schemas.ts:13-59`，用 TypeBox 的 `Type.Object` 描述一个 flat 对象：

```ts
// bash-tools.schemas.ts:13-59
export const execSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  workdir: Type.Optional(Type.String({ description: "Working directory (defaults to cwd)" })),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  yieldMs: Type.Optional(
    Type.Number({ description: "Milliseconds to wait before backgrounding (default 10000)" }),
  ),
  background: Type.Optional(Type.Boolean({ description: "Run in background immediately" })),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds ..." })),
  pty: Type.Optional(Type.Boolean({ description: "Run in a pseudo-terminal (PTY) ..." })),
  elevated: Type.Optional(Type.Boolean({ description: "Run on the host with elevated permissions ..." })),
  host: optionalStringEnum(EXEC_TOOL_HOST_VALUES, { description: "Exec host/target (auto|sandbox|gateway|node)." }),
  security: Type.Optional(Type.String({ description: "Ignored for normal calls; ..." })),
  ask: Type.Optional(Type.String({ description: "Baseline ask comes from tools.exec.ask ..." })),
  node: Type.Optional(Type.String({ description: "Node id/name for host=node." })),
});
```

- **必填**只有 `command`；其余全部是 `Type.Optional`，默认值在运行时由 `createExecTool()` 在 `bash-tools.exec.ts:1324-1334` 处统一 clamp（例如 `yieldMs` 默认 10s、clamp 到 10-120000；`timeout` 默认 1800s）。
- `host` 用 `optionalStringEnum(["auto","sandbox","gateway","node"])`，不是 `Type.Union([Type.Literal(...),...])`（见 2.3）。
- `env` 是 `Record<string,string>`，字符串到字符串。
- `security` 与 `ask` 字段在 description 里明说"被 host approvals / tools.exec.* 覆盖"，作用是给模型一个稳定的占位，避免它绕开 policy 自行挑值。

### 2.2 为什么用 TypeBox 而不是 Zod/json-schema

`bash-tools.schemas.ts:7-8` 直接 `import { Type } from "typebox"`，schema 本身就是 JSON Schema 文档，不需要再过一次 Zod parse：

```ts
// bash-tools.schemas.ts:7-8
import { Type } from "typebox";
import { optionalStringEnum } from "./schema/typebox.js";
```

TypeBox 的好处：编译期类型（`Static<typeof execSchema>` 直接给 `ExecToolArgs`）、零运行时解析、可直接 `JSON.stringify` 发给 provider。Zod 会引入一层从 schema → JSON Schema 的二次翻译（容易丢 `description`），纯手写 JSON Schema 又丢失 TS 类型——TypeBox 是唯一同时拿到两者的方案。

### 2.3 optionalStringEnum vs Type.Union([Type.Literal(...)])

`string-enum.ts:15-16` 注释直接解释了这个差异：

```ts
// string-enum.ts:15-31
// Avoid Type.Union([Type.Literal(...)]) which compiles to anyOf.
// Some providers reject anyOf in tool schemas; a flat string enum is safer.
export function stringEnum<T extends readonly string[]>(values: T, options: StringEnumOptions<T> = {}) {
  const enumValues = Array.isArray(values) ? values : ... ;
  return Type.Unsafe<T[number]>({
    type: "string",
    ...(enumValues.length > 0 ? { enum: [...enumValues] } : {}),
    ...options,
  });
}
```

`Type.Union([Type.Literal("a"), Type.Literal("b")])` 编译成 `{ anyOf: [{const:"a"},{const:"b"}] }`，部分 provider（Gemini、xAI 的 strict 模式）会拒绝 `anyOf` 出现在 tool schema 里。`optionalStringEnum` 直接 emit `{ type:"string", enum:[...] }`，是所有 provider 都接受的扁平形态。注释里把这条规则钉死，整个 agent harness 的 policy 也是这条。

### 2.4 normalizeToolParameterSchema 的变换流水线

`agent-tools-parameter-schema.ts:891-908` 是公开入口，内部走 `normalizeToolParameterSchemaUncached`（`agent-tools-parameter-schema.ts:750-888`），整体顺序是：

```ts
// agent-tools-parameter-schema.ts:750-792
function normalizeToolParameterSchemaUncached(schema: unknown, options?): TSchema {
  const inlinedSchema = normalizeOpenApiSchemaKeywords(inlineLocalToolSchemaRefs(schema));
  ...
  function applyProviderCleaning(s: unknown): TSchema {
    const normalizedSchema = normalizeArraySchemasMissingItems(s);
    const arrayItemsCompatibleSchema = omitEmptyArrayItems
      ? stripEmptyArrayItemsFromArraySchemas(normalizedSchema)
      : normalizedSchema;
    if (isGeminiProvider && !isAnthropicProvider) return cleanSchemaForGemini(arrayItemsCompatibleSchema);
    if (unsupportedToolSchemaKeywords.size > 0)
      return stripUnsupportedSchemaKeywords(arrayItemsCompatibleSchema, unsupportedToolSchemaKeywords) as TSchema;
    return arrayItemsCompatibleSchema as TSchema;
  }
```

整体 5 步：

1. **`inlineLocalToolSchemaRefs`**（`agent-tools-parameter-schema.ts:490-612`）：递归把 `#/$defs/Foo` / `#/definitions/Foo` 内联展开，遇到循环引用（`refStack` 已包含该 ref）返回 `{}`。`copySchemaMeta` 把 `title/description/default` 拷贝到内联后的对象上。
2. **`normalizeOpenApiSchemaKeywords`**（`agent-tools-parameter-schema.ts:674-748`）：处理 OpenAPI 3.0 的 `nullable: true`。如果 schema 已经有 `allOf/anyOf/oneOf`，就在外层包 `{ anyOf: [schema, { type: "null" }] }`；如果只有 `type`，就用 `appendNullSchemaType` 把 `"null"` append 进 `type` 数组（`["string","null"]`）；如果只有 `enum`，就把 `null` 加进 enum。同时把 OpenAPI annotation 关键字（`discriminator, externalDocs, readOnly, writeOnly, xml, example`）剥掉。
3. **Shape 判定**（`agent-tools-parameter-schema.ts:795-887`）：
   - 已是 `{type:"object", properties:{}, 无 anyOf/oneOf/allOf}` → 走 provider cleaning；
   - 有 `properties` 但缺 `type` → 补 `type:"object"`；
   - `type:"object"` 但缺 `properties` → 补 `properties:{}`；
   - 真正空对象 `{}`（MCP 无参工具） → 输出 `{ type:"object", properties:{} }`；
   - **顶层 `anyOf`/`oneOf`**（TypeBox 的 `Type.Union` 编译形态） → 用 `mergePropertySchemas`（`agent-tools-parameter-schema.ts:86-119`）按 key 合并各分支的 `properties`，并把出现在所有 object 分支 `required` 里的 key 作为新 required（`agent-tools-parameter-schema.ts:847-868`）。这是为了给 OpenAI 一个顶层 `type:"object"`、同时保留 `host` 等 enum 字段。
   - 顶层 `allOf` 不安全拍平，显式保留（`agent-tools-parameter-schema.ts:819-822`）。
4. **数组容错**：`normalizeArraySchemasMissingItems`（`agent-tools-parameter-schema.ts:198-276`）递归给所有缺 `items` 的 `array` 补 `items:{}`，避免下游 `Object.*` 在严格 validator 里炸掉；可选地 `stripEmptyArrayItemsFromArraySchemas` 把 `items:{}` 这种真正空的剥掉（受 `omitEmptyArrayItems` 配置控制）。
5. **Provider quirks**（`agent-tools-parameter-schema.ts:778-793`）：根据 `modelProvider` 命中 Gemini 走 `cleanSchemaForGemini`；否则根据 `modelCompat.unsupportedToolSchemaKeywords` 走通用 `stripUnsupportedSchemaKeywords`（xAI 用这条路）。

整个流程配了一个 WeakMap 缓存（`agent-tools-parameter-schema.ts:24-58`），key = `[provider, modelId, unsupportedKeywords(sorted), omitEmptyArrayItems]`，每个 schema 最多 8 条。

### 2.5 Gemini 关键字剥离

`clean-for-gemini.ts:7-37` 是剥除清单：

```ts
// clean-for-gemini.ts:7-37
export const GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "patternProperties", "additionalProperties", "$schema", "$id", "$ref",
  "$defs", "definitions", "examples", "not",
  "minLength","maxLength","minimum","maximum","multipleOf","pattern","format",
  "minItems","maxItems","uniqueItems","minProperties","maxProperties",
]);
```

剥除原因注释在文件头：`Cloud Code Assist API rejects a subset of JSON Schema keywords`，实测比 draft 2020-12 更严：`minLength/maxLength/minimum/maximum/pattern/format` 这些约束词会触发 400。`examples` 是 OpenAPI 关键字，Claude 也拒，所以一并剥。

`clean-for-gemini.ts:248-409` 还做了几件事：

- `const: x` → `enum: [x]`（Gemini 不识 `const`）；
- `required: []` 直接删掉（line 333-335 注释：`Google's schema validator rejects "required": []`）；
- 在 `anyOf/oneOf` 旁边时把 `type` 字段删掉（line 337-339）；
- `["string","null"]` 数组里过滤掉 `"null"`（line 345-347）；
- `simplifyUnionVariants`（line 184-215）把 `Type.Literal("a")` 系列的 anyOf 拍平为 `{type:"string", enum:["a","b"]}`；
- `flattenUnionFallback`（line 416-446）是 last resort，从 variants 抽公共 `type`，避免给 Gemini 留下任何嵌套 `anyOf`；
- `sanitizeRequiredFields`（line 218-246）保证 `required` 里的每个 key 都在 `properties` 里——Gemini 也会因为孤儿 required 报错。

`agent-tools-parameter-schema.ts:783` 显式 `!isAnthropicProvider` 时才走 Gemini 路径，避免 Anthropic 误吃这套约束。

### 2.6 OpenAI 顶层 `type:"object"` 与 strict 模式

`agent-tools-parameter-schema.ts:765-766` 注释直接说：TypeBox 的 root `Type.Union([...])` 编译成 `{ anyOf: [...] }`，OpenAI 的 function tool 拒绝非 `type:"object"` 的顶层 schema。所以 2.4 的"顶层 union 拍平"步骤就是为 OpenAI 设计的。

strict 模式多一层：`openai-tool-schema.ts:112-156` 的 `normalizeStrictOpenAIJsonSchemaRecursive` 强制：

```ts
// openai-tool-schema.ts:138-152
if (normalized.type === "object") {
  ...
  if (properties && Object.keys(properties).length === 0 && !Array.isArray(normalized.required)) {
    normalized.required = [];
    changed = true;
  }
  if (depth === 0 && !("additionalProperties" in normalized)) {
    normalized.additionalProperties = false;
    changed = true;
  }
}
```

根节点必须有 `additionalProperties: false`、空 `properties` 必须显式 `required: []`——OpenAI strict schema 的硬性要求。`openai-tool-schema.ts:80-110` 把 `normalizeToolParameterSchema` 的结果再走一遍 strict 递归。

### 2.7 Anthropic draft 2020-12

`agent-tools-parameter-schema.ts:767-768` 注释：Anthropic 期望完整 draft 2020-12。代码上几乎不做特殊处理：`!isAnthropicProvider` 时跳过 Gemini 清理、generic keyword 集合也不会把 `minLength/maximum` 这些保留给 Anthropic——它就是要这些约束来做 schema 验证。`agent-tools-parameter-schema.ts:774` 只是用来防止 Gemini 路径误伤 Anthropic。

### 2.8 xAI 拒哪些约束

`schema/clean-for-xai.test.ts:6-13` 是真实集合：

```ts
// clean-for-xai.test.ts:6-13
const XAI_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "minLength","maxLength","minItems","maxItems","minContains","maxContains",
]);
```

xAI 只拒绝字符串/数组长度约束，其它关键字（`enum`、`anyOf`、`format`）都接受。处理走通用的 `stripUnsupportedSchemaKeywords`（`shared/schema-keyword-strip.ts:1-44`），靠 `modelCompat.unsupportedToolSchemaKeywords` 配置驱动（`plugins/provider-model-compat.ts:58-67`）。

### 2.9 调用栈：createExecTool() → wire JSON

```
createExecTool()                                       bash-tools.exec.ts:1321, 1988
  └─ returns { ..., parameters: execSchema }           bash-tools.exec.ts:1463
loadBashToolsModule() → createExecTool(defaults)      bash-tools.ts:187-188
agent-tools registry builds AnyAgentTool[]
normalizeToolParameters(tool, options)                agent-tools.schema.ts:68-90
  └─ normalizeToolParameterSchema(schema, options)     agent-tools.schema.ts:84 → agent-tools-parameter-schema.ts:891
       ├─ inlineLocalToolSchemaRefs                    agent-tools-parameter-schema.ts:598
       ├─ normalizeOpenApiSchemaKeywords               agent-tools-parameter-schema.ts:674
       ├─ shape detection (object / object-like / union-flatten)  lines 795-887
       ├─ normalizeArraySchemasMissingItems            lines 198-276
       ├─ (optional) stripEmptyArrayItemsFromArraySchemas  lines 304-358
       └─ applyProviderCleaning
            ├─ Gemini  → cleanSchemaForGemini          clean-for-gemini.ts:448
            ├─ xAI/... → stripUnsupportedSchemaKeywords  shared/schema-keyword-strip.ts:2
            └─ Anthropic / OpenAI (non-strict) → pass-through
For OpenAI strict: normalizeStrictOpenAIJsonSchema     openai-tool-schema.ts:80-110
  └─ adds additionalProperties:false, required:[]      openai-tool-schema.ts:138-152
最终 wire 出去的 JSON Schema 进入 provider request body
```

### 关键设计决策

- **TypeBox 单一来源**：schema、TS 类型、JSON Schema 一份代码搞定，避免 Zod 二次翻译丢 `description` 或手写 JSON Schema 漂移（`bash-tools.schemas.ts:7-8`）。
- **flat `enum` 优先于 `anyOf`**：comment 钉死在 `string-enum.ts:15-16`，是跨 provider 兼容的最低公分母；OpenAI / Gemini / xAI 任何一个拒 `anyOf` 都不会影响 host 字段（`bash-tools.schemas.ts:39-41`）。
- **归一化集中在 `normalizeToolParameterSchema`**：先 OpenAPI 兼容（`nullable`、refs 内联）再做 provider quirks，保证调用方对 schema 透明（`agent-tools-parameter-schema.ts:750-888`）。
- **Provider quirks 用 provider id + modelCompat 双驱动**：Gemini 是 provider-only 硬编码（`isGeminiProvider`），其余走 `modelCompat.unsupportedToolSchemaKeywords` 配置（`agent-tools-parameter-schema.ts:771-776`），既能精确描述 Gemini 又能让第三方模型通过配置扩展。
- **WeakMap + 8 条 LRU 缓存**：按 `[provider, modelId, unsupportedKeywords, omitEmptyArrayItems]` 复合 key 缓存，避免相同 schema 在循环里反复 normalize（`agent-tools-parameter-schema.ts:24-58`）。

---

