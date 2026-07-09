# Composer 统一区块设计

**日期：** 2026-07-09  
**状态：** 已确认，待实现  
**相关文件：**
- `packages/web/src/components/chat/chat-panel.tsx`
- `packages/web/src/components/chat/input-box.tsx`
- `packages/web/src/components/chat/activity-bar.tsx`
- `packages/web/src/components/chat/token-stats.tsx`
- `packages/web/src/components/chat/approval-bar.tsx`
- `packages/web/src/styles/globals.css`

## 背景与目标

当前 `ChatPanel` 底部的三块信息——Token 统计 (`TokenStatsBadge`)、Agent 状态 (`ActivityBar`)、输入框 (`InputBox`)——是分离排列的，视觉上显得零散。本次设计的目标是把它们整合为一个**视觉上统一的输入区块**，让用户能一眼感知当前会话状态、Token 消耗和输入区域之间的关联。

## 当前状态

```
ChatPanel
├── MessageList
└── 底部区域
    ├── TokenStatsBadge   (token 统计，在输入框上方)
    ├── ActivityBar       (agent 状态，在输入框上方)
    └── InputBox          (输入框 + approvals)
```

问题：
- Token 统计和 Agent 状态与输入框之间没有明确的归属关系。
- 当 Agent 状态变化时，下方输入框会上下跳动，视觉不稳定。
- 信息层级分散，用户难以快速定位“我现在能不能输入、Agent 在干嘛”。

## 设计决策

采用**方案 A：全部收进一张卡片**。

### 布局

```
┌─────────────────────────────────────────┐
│ Agent 状态栏 (thinking/calling/idle)    │  ← 卡片顶部
├─────────────────────────────────────────┤
│ [Approval 请求列表，当有请求时显示]       │
│                                         │
│ 多行 textarea 输入区                    │  ← 卡片主体
│                                         │
├─────────────────────────────────────────┤
│ Token 统计 ...              [+][↑/Stop] │  ← 卡片底部
└─────────────────────────────────────────┘
```

### 关键原则

1. **单一容器**：Token 统计、Agent 状态、输入框共享同一个 `bg-card` 圆角卡片容器。
2. **Agent 状态置顶**：始终显示在卡片最顶部，Agent 活动时用户第一眼就能看到。
3. **Token 统计置底**：与操作按钮（附件、发送/Stop）同处底部工具栏，保持输入区干净。
4. **状态稳定**：Agent 状态从“有/无”变为卡片内固定区域的内容切换，避免整体布局跳动。
5. **Approval 属于输入区块**：Approval 请求卡片放在 Agent 状态栏下方、输入区上方，因为它们是“当前输入/交互需要处理的事项”。

## 组件结构

### 推荐的新组件：`ChatComposer`

将当前 `ChatPanel` 底部的三块逻辑封装为一个独立组件，职责单一：渲染整个输入区块。

```tsx
interface ChatComposerProps {
  streaming: boolean;
  initialized: boolean;
  activity?: SessionActivity;
  tokenUsage?: LanguageModelUsage;
  maxTokens?: number;
  pendingApprovals?: ApprovalRequest[];
  onSend(content: string): void;
  onInterrupt(): void;
  onResolveApproval(approvalId: string, decision: ApprovalDecision): void;
}
```

内部继续复用：
- `ActivityBar` → 渲染顶部 Agent 状态
- `ApprovalBar` → 渲染 Approval 请求
- `TokenStatsBadge` → 渲染底部 Token 统计
- 内部 textarea + 按钮 → 输入框主体

`ChatPanel` 的职责简化为：
- 头部标题
- `MessageList`
- 底部 `<ChatComposer ... />`

### 现有组件调整

| 组件 | 调整内容 |
|------|----------|
| `ChatPanel` | 移除对 `TokenStatsBadge`、`ActivityBar`、`InputBox` 的直接引用，改为引用 `ChatComposer` |
| `InputBox` | 建议改名为 `ComposerInput`，并将其视觉容器逻辑并入 `ChatComposer`。或保留 `InputBox` 作为内部子组件，但移除外层 `bg-card` 容器 |
| `ActivityBar` | 基本不变，但需要在 `idle` 时也渲染占位（显示 “Idle”），避免卡片顶部高度跳动 |
| `TokenStatsBadge` | 基本不变，保持底部工具栏左侧显示 |
| `ApprovalBar` | 基本不变，但不再自带 `mb-3` 外边距，由 `ChatComposer` 统一控制内部间距 |

## 数据流

数据流保持不变：
1. `useAgents` hook 提供 `activity`、`tokenUsage`、`pendingApprovals`、`status`、`initialized`。
2. `ChatPanel` 将这些数据传递给 `ChatComposer`。
3. `ChatComposer` 内部将数据分发给 `ActivityBar`、`ApprovalBar`、`TokenStatsBadge` 和内部输入区。

不需要新增后端接口或状态字段。

## 视觉规范

所有颜色、圆角、字体均复用项目现有 CSS 变量。

| 元素 | 规范 |
|------|------|
| 整体容器 | `bg-card` (#1a2129)、`border-bd` (#232b35)、`radius-card` (14px)、1px 边框 |
| Agent 状态栏 | 卡片顶部，下边框 1px `border-bd`，padding `10px 14px`，min-height 38px，12px 字体 |
| 状态颜色 | `idle` → `text-tx3`；`thinking` → `text-ac`；`calling-function` → `text-warn`；`outputting` → `text-ok` |
| 状态图标 | 复用 `lucide-react`：`Loader2`（spin）、`Wrench`、`PenLine`、`Hourglass` |
| Approval 卡片 | 保持现有 `approval-bar.tsx` 的 severity 样式，位于 Agent 状态栏下方 |
| 输入区 | `textarea`，透明背景，`text-tx`，placeholder `text-tx3`，自动增高，max-height 160px |
| 底部工具栏 | 上边框 1px `border-bd`，padding `10px 14px`，flex 两端对齐 |
| Token 统计 | 12px `text-tx3`，总量文本 + cache 比例 chip + context 比例 chip |
| chip 样式 | `bg-bd2` (#2a333e)、`radius-chip` (18px)、padding `3px 8px`、11px 字体 |
| 发送按钮 | 无内容：`bg-tx3/20` + `text-tx3`；有内容：`bg-ac` + `text-ac-ink`；`radius-btn` (9px) |
| Stop 按钮 | streaming/loading 时替换发送按钮：`bg-err` + 白色文字，高度 28px，带 Square 图标 |
| 附件按钮 | 透明背景，`text-tx3`，hover 时 `bg-bd` + `text-tx` |

## 状态清单

需要覆盖的状态：

1. **默认/Idle**：Agent 状态栏显示 “Idle”（tx3 色），发送按钮禁用。
2. **用户输入中**：textarea 有内容，发送按钮变为 ac 色可用状态。
3. **Agent thinking**：顶部显示 spinning 的 “Thinking...”（ac 色），底部 Stop 按钮。
4. **Agent calling-function**：顶部显示 “Calling function...”（warn 色），底部 Stop 按钮。
5. **Agent outputting**：顶部显示 “Outputting...”（ok 色），底部 Stop 按钮。
6. **有 Approval 请求**：顶部 Agent 状态下方出现 Approval 卡片，用户需处理后继续。
7. **未初始化**：textarea placeholder 为 “Connecting...”，所有按钮禁用。

## 边界与依赖

- `ChatComposer` 只依赖 `rem-agent-core` 和 `rem-agent-bridge` 的类型，不依赖具体实现。
- 保持 `onSend`、`onInterrupt`、`onResolveApproval` 回调由父组件注入，便于测试。
- `TokenStatsBadge` 在 `tokenUsage` 缺失时不渲染；`ActivityBar` 在 `idle` 时显示占位 “Idle”，避免高度变化。
- Approval 请求为空时，`ApprovalBar` 不渲染，内部间距由 `ChatComposer` 控制。

## 测试考虑

- 渲染测试：验证 `ChatComposer` 在不同 `activity` 值下正确显示对应状态文字和颜色。
- 交互测试：验证输入内容后发送按钮样式变化、点击发送调用 `onSend`、streaming 时显示 Stop 按钮并调用 `onInterrupt`。
- Approval 测试：验证有 pending approvals 时 Approval 卡片正确渲染，点击 allow/deny 调用 `onResolveApproval`。
- Token 统计测试：验证 `tokenUsage` 为 undefined 时不渲染 Token 区域。
- 视觉回归：建议在实现后通过浏览器截图确认整体区块视觉效果。

## 决策记录

- **不选择方案 B（卡片 + 上下信息条）**：虽然信息层级清晰，但 Token 统计在卡片外部，整体感弱于方案 A。
- **不选择方案 C（紧凑卡片式）**：底部一行同时放状态、Token、按钮，空间拥挤，长 Token 文本会与按钮重叠。
- **Agent 状态在 idle 时显示占位**：为了避免 Agent 状态栏在 “出现/消失” 之间切换导致卡片高度变化，统一显示 “Idle”。
- **Approval 放在卡片内部**：Approval 是当前交互的组成部分，放在输入区块内比放在外部更符合语义。

## 下一步

实现计划将通过 `writing-plans` skill 产出。
