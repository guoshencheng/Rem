# TUI Thinking 块折叠设计

## 背景

当前 `rem-agent-tui` 在渲染 Agent 的 reasoning/thinking 内容时，会把完整 thinking 文本直接展开显示在 [`ReasoningBlock`](packages/tui/src/message/reasoning-block.ts:5) 中。对于长 reasoning，这会占据大量终端空间，干扰用户阅读最终回复。

本设计为 TUI 增加 thinking 块折叠能力，使用户可以一键收起/展开所有 thinking 内容。

## 目标

1. 支持全局快捷键 `ctrl+o` 切换所有 thinking 块的展开/折叠状态。
2. thinking 块默认折叠，只显示一行标签。
3. 折叠标签显示为 `thinking >`（未完成）或 `think for 1.2s >`（已完成）。
4. 折叠不影响底层 reasoning 数据收集；展开后应显示完整内容。
5. 新创建的流式消息自动继承当前折叠偏好。

## 非目标

- 单个 thinking 块独立折叠。
- 持久化折叠偏好到配置文件或环境变量。
- 鼠标点击折叠（终端环境优先键盘交互）。
- 折叠动画或过渡效果。

## 关键设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 状态持有者 | `ChatLog` | 消息容器拥有 thinking 显示状态，便于向新消息传播；`TUIApp` 无需了解子组件结构。 |
| 快捷键 | `ctrl+o` | 用户指定；不是常见终端快捷键，冲突风险低。 |
| 默认状态 | 折叠 | 用户指定；减少终端空间占用。 |
| 折叠时渲染 | 仅一行标签 | 用户指定；简洁，与当前 `ReasoningBlock` 标签风格一致。 |
| 作用范围 | 全局所有 thinking 块 | 用户指定；操作可预期，实现简单。 |

## 组件变更

### `ReasoningBlock`

文件：[packages/tui/src/message/reasoning-block.ts](packages/tui/src/message/reasoning-block.ts:5)

- 新增私有状态 `collapsed: boolean`，默认 `true`。
- 新增 `setCollapsed(collapsed: boolean): void` 方法，更新内部状态；pi-tui 由父级 `TUIApp.requestRender(true)` 统一触发重绘。
- `appendText` 继续追加到内部 buffer，不受折叠状态影响。
- `render` 行为根据 `collapsed` 返回不同行数：
  - 折叠：仅返回标签行（`thinking >` 或 `think for 1.2s >`）。
  - 展开：返回标签行 + 空行 + thinking 内容。
- `finish()` 仍负责把标签从 `thinking` 更新为 `think for Xs`。

### `StreamAssistantMessage`

文件：[packages/tui/src/message/stream-message.ts](packages/tui/src/message/stream-message.ts:14)

- 构造函数接收 `thinkingCollapsed?: boolean`，创建 `ReasoningBlock` 时传入。
- 新增 `setThinkingCollapsed(collapsed: boolean): void`，遍历 `parts` 中所有 `reasoning` 类型 part，调用其 `setCollapsed`。
- 静态文本模式（`setText`）不涉及 thinking，无需处理。

### `ChatLog`

文件：[packages/tui/src/chat-log.ts](packages/tui/src/chat-log.ts:7)

- 新增私有状态 `thinkingCollapsed = true`。
- 新增 `toggleThinkingCollapsed(): void`：
  1. 切换 `thinkingCollapsed` 状态；
  2. 遍历 `children`，对所有 `StreamAssistantMessage` 调用 `setThinkingCollapsed`。
- `startAssistant()` 创建 `StreamAssistantMessage` 时传入当前 `thinkingCollapsed`。

### `TUIApp`

文件：[packages/tui/src/app.ts](packages/tui/src/app.ts:24)

- 在 `addInputListener` 中捕获 `ctrl+o`：

  ```ts
  if (matchesKey(data, Key.ctrl("o"))) {
    this.chatLog.toggleThinkingCollapsed();
    this.tui.requestRender(true);
    return { consume: true };
  }
  ```

- `TUIApp` 不直接操作 `ReasoningBlock`，只调用 `ChatLog` 的公共方法。

## 数据流

```text
用户按 ctrl+o
  │
  ▼
TUIApp.addInputListener 捕获
  │
  ▼
chatLog.toggleThinkingCollapsed()
  │
  ├── 切换 ChatLog.thinkingCollapsed
  │
  └── 遍历 children 中的 StreamAssistantMessage
        │
        ▼
      streamMessage.setThinkingCollapsed(collapsed)
        │
        └── 遍历 parts 中的 ReasoningBlock
              │
              ▼
            reasoningBlock.setCollapsed(collapsed)
              │
              ▼
            下次 render 输出标签或完整内容
  │
  ▼
TUIApp.requestRender(true) 触发重绘
```

## 边界情况

| 场景 | 行为 |
|------|------|
| 流式中切换折叠 | 内容隐藏但继续收集；再次展开时显示全部已收集内容。 |
| 多个 thinking 块 | 全局开关同步影响所有已有和新建的 thinking 块。 |
| 没有流式消息时按 `ctrl+o` | no-op， harmless。 |
| thinking 块尚未完成 | 折叠标签显示 `thinking >`；完成后更新为 `think for Xs >`。 |
| 新流式消息 | 自动继承当前 `ChatLog.thinkingCollapsed` 状态。 |

## 测试策略

### 单元测试

- **`ReasoningBlock`**
  - 默认折叠，只渲染标签行。
  - `setCollapsed(false)` 后渲染完整内容。
  - 折叠状态下 `appendText` 仍增加内部 buffer，展开后可见。
  - `finish()` 后标签从 `thinking` 变为 `think for Xs`。

- **`StreamAssistantMessage`**
  - 构造时传入 `thinkingCollapsed: true`，创建的 `ReasoningBlock` 默认折叠。
  - `setThinkingCollapsed(false)` 展开所有 reasoning part。
  - 同时存在 text 和 reasoning part 时，只影响 reasoning。

- **`ChatLog`**
  - `toggleThinkingCollapsed()` 影响所有子 `StreamAssistantMessage`。
  - 切换后新调用 `startAssistant()` 创建的流式消息继承当前状态。

- **`TUIApp`**（可选，视测试复杂度）
  - 通过 input listener 验证 `ctrl+o` 触发 `chatLog.toggleThinkingCollapsed()` 和 `requestRender(true)`。

## 依赖与影响范围

- 仅修改 `packages/tui` 包内的组件和 `TUIApp`。
- 不修改 `rem-agent-core` 的流协议或 UI 协议。
- 不引入新依赖。
