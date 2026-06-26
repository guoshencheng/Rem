# OpenTUI 迁移设计

> 将 `rem-agent-tui` 底层依赖从 `@earendil-works/pi-tui` 替换为 OpenTUI，采用 Solid JSX 实现数据驱动的终端 UI。

## 1. 目标

用 OpenTUI + Solid JSX 完整重写 `packages/tui`，实现：

- **数据驱动渲染**：状态变更自动驱动 UI 更新，不再手动调 `requestRender()`
- **细粒度响应**：Solid signal 追踪，仅受影响组件重渲染（如流式消息追加文本时只更新 Markdown 节点，不重绘整棵树）
- **声明式组件**：JSX 模板 + `createSignal`/`createStore` 替代命令式 `addChild`/`setText`

## 2. 架构

```
rem-agent-demo (main.ts)
  └── <TUIApp /> (Solid 根组件)
        ├── 状态层 (createStore)
        │     ├── sessionStore    — sessionId, currentTurn, maxTurns, status
        │     └── messageStore    — Message[]（含流式 parts）
        │     └── uiStore        — pickerVisible, reasoningCollapsed, toolsCollapsed
        │
        ├── 键盘层 (useKeyboard)
        │     ├── Ctrl+C → 退出
        │     ├── Ctrl+O → 全局折叠切换
        │     └── Escape → 中断请求
        │
        └── 视图层 (JSX)
              <box flexDirection="column" height="100%">
                <ScrollBox flexGrow={1}>
                  <For each={messages()}>
                    {msg => <Switch>...</Switch>}
                  </For>
                </ScrollBox>
                <StatusBar ... />
                <InputBox ... />
                <Show when={ui.pickerVisible}>
                  <SessionPicker ... />
                </Show>
              </box>
```

## 3. 组件规格

### 3.1 TUIApp（根组件）

- **Props**: `{ serverUrl, sessionId?, maxTurns? }`
- **职责**: 创建 renderer、初始化 store、挂载组件树
- **实现**: `createCliRenderer()` → `render(() => <TUIApp />)`

### 3.2 ChatLog（消息列表）

- 用 `<ScrollBox stickyStart="bottom">` 包裹 `<For each={messages()}>`
- 每条消息根据 role 分发：用户消息 / 静态助手消息 / 流式助手消息
- 无需 EventLog 展示（事件写入日志文件）

### 3.3 UserMessage / AssistantMessage

- `<UserMessage content={string} />`
- `<AssistantMessage content={string} />`
- 内部：`<box borderStyle="single" padding={1}>` + `<markdown>`（OpenTUI 原生）

### 3.4 StreamMessage（流式消息）

- `<StreamMessage parts={Record<string, Part>} />`
- Part 类型：
  - `TextPart { type: "text", content: string }`
  - `ReasoningPart { type: "reasoning", content: string, duration?: number }`
  - `ToolPart { type: "tool", toolName: string, input?, status, result? }`
- 每个 part 用 `<Switch>` 分发到 ReasoningBlock / FunctionToolBlock / markdown(streaming)

### 3.5 ReasoningBlock / FunctionToolBlock

- 可折叠组件，响应全局折叠 signal + 本地点击折叠
- 折叠时仅显示标题行（`▶ Thinking 12s` / `▶ Tool: read`）
- 展开时显示完整 markdown 内容
- 全局折叠：`createMemo(() => globalCollapsed || localCollapsed)`

### 3.6 StatusBar

- `<StatusBar turn={number} maxTurns={number} status={string} sessionId={string} />`
- 纯派生组件：`createMemo(() => "Turn 3/60 [running]  abc12345")`
- 渲染为 `<text>`

### 3.7 InputBox

- `<InputBox onSubmit={fn} disabled={boolean} />`
- 使用 OpenTUI `<input>` 组件
- built-in 命令处理：`/new`、`/resume`、`/help`
- disabled 由 `session.status === "running"` 派生

### 3.8 SessionPicker（Overlay）

- `<SessionPicker sessions={SessionSummary[]} onSelect={fn} onCancel={fn} />`
- `position: "absolute"`, full-screen 半透明遮罩
- 居中 Box 含 `<Select>` 列表（OpenTUI SelectRenderable）
- Esc 或点击遮罩关闭

## 4. 状态管理

```typescript
const [session, setSession] = createStore({
  sessionId: string;
  currentTurn: number;
  maxTurns: number;
  status: "idle" | "running" | "error";
});

const [messages, setMessages] = createStore<Message[]>([]);
// Message = UserMessage | AssistantMessage | StreamMessage

const [ui, setUi] = createStore({
  reasoningCollapsed: boolean;
  toolsCollapsed: boolean;
  pickerVisible: boolean;
  pickerSessions: SessionSummary[];
});
```

### 关键数据流（一次问答）

```
用户输入 → InputBox.onSubmit("hello")
  → setSession("status", "running")
  → setMessages(m => [...m, userMsg, streamMsg])
  → client.run(sessionId, "hello")
  → for await (chunk of stream):
      → 直接 mutate messageStore 中 StreamMsg 的 parts 属性
      → Solid 自动追踪变更 → 仅受影响组件重渲染
  → chunk.type === "finish":
      → StreamMsg 转为 AssistantMsg (streaming: false)
      → setSession("status", "idle")
```

### 派生状态

- StatusBar 文本：`createMemo(() => ...)` 从 3 个 signal 派生
- InputBox disabled：`createMemo(() => status === "running")`
- 全局折叠：所有 ReasoningBlock/FunctionToolBlock 读取 `ui.reasoningCollapsed`

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| Agent 调用失败 | try/catch → 错误信息插入消息，status → "error" |
| 网络断开 | 超时 → catch → "Request timed out" |
| 已达最大轮次 | InputBox disabled + 提示 "/new" |
| 重复提交 | `status === "running"` 时 InputBox disabled |
| Session 加载失败 | picker 显示 "No sessions" 或 "Failed to load" |
| Renderer 初始化失败 | 降级 console 模式 |
| FFI 不可用 | `OTUI_NO_NATIVE_RENDER` 环境变量纯 JS 降级 |
| 空消息 | trim 后空串不提交 |
| 流式无内容 | finish 时 content 为空 → "(empty response)" |
| 终端 resize | `useTerminalDimensions()` signal → Flexbox 自动重排 |
| 组件清理 | Solid `onCleanup` → 取消流、释放 renderer |

应用级 `<ErrorBoundary>` 包裹，捕获未处理异常显示错误文本。

### Solid JSX 约定

OpenTUI Solid 绑定使用 **snake_case** JSX 元素名：`<box>`, `<text>`, `<scrollbox>`, `<markdown>`, `<input>`, `<select>`, `<tab_select>` 等。所有组件规格中的 JSX 代码均遵循此约定。

## 6. 依赖变更

```diff
- "@earendil-works/pi-tui": "^0.79.3"
+ "@opentui/core": "^latest"
+ "@opentui/solid": "^latest"
+ "solid-js": "^1.x"
```

需添加 JSX 编译配置（`tsconfig.json` 中 `jsxImportSource: "solid-js"`）。

## 7. 文件结构

```
packages/tui/src/
  index.ts           → 公开导出
  app.tsx            → <TUIApp /> 根组件
  store.ts           → createStore 状态定义
  chat-log.tsx       → <ChatLog /> + 消息列表
  message/
    user-message.tsx
    assistant-message.tsx
    stream-message.tsx
    reasoning-block.tsx
    function-tool-block.tsx
  status-bar.tsx
  input-box.tsx
  session-picker.tsx

packages/tui/tests/
  app.test.tsx
  chat-log.test.ts
  stream-message.test.ts
  reasoning-block.test.ts
  function-tool-block.test.ts
  session-picker.test.ts
```

每个组件一个文件，遵循 module-separation-convention。

## 8. EventLog 处理

EventLog 不渲染到 TUI 界面，改为在关键节点（`handleSubmit`、`handleChunk` 等）调用 `appendLog(type, data)`，内部用 `fs.appendFile` 追加到日志文件（路径由环境变量 `TUI_LOG_FILE` 指定，默认 `~/.rem-agent/tui.log`）。
