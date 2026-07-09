# 消息列表底部间距设计

**日期：** 2026-07-09  
**状态：** 已确认，待实现  
**相关文件：** `packages/web/src/components/chat/message-list.tsx`

## 背景与目标

当前消息列表滚动到底部时，最后一条消息会与下方的输入框卡片顶部贴在一起，视觉上过于紧凑。目标是在消息列表内容区底部增加固定内边距，让最后一条消息和输入框之间留出呼吸空间。

## 设计决策

采用 **方案 A：在 MessageList 内容区底部添加 `pb-6`（24px）**。

### 理由

- 改动范围最小，只涉及 `MessageList` 一个文件。
- 不影响 `ChatPanel` 的 flex 布局和输入框容器已有的 `pb-4`。
- 24px 与现有间距尺度一致（`pb-4` 为 16px，`px-4` 为 16px），视觉上自然。

## 实现细节

修改 `packages/web/src/components/chat/message-list.tsx` 第 44 行：

```tsx
// 旧
<div className="max-w-3xl mx-auto px-4">

// 新
<div className="max-w-3xl mx-auto px-4 pb-6">
```

## 验证

- 启动 web 开发服务器，发送或加载足够多的消息，滚动到底部，确认最后一条消息与输入框卡片之间有明显间距。
- 空消息列表状态（显示 "Hello, how can I help?"）不受此改动影响。

## 下一步

实现计划将通过 `writing-plans` skill 产出。
