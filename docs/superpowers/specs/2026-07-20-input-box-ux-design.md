# 输入框体验优化设计

日期：2026-07-20
状态：已批准（方案 A：分层推进）

## 背景

`packages/web` 聊天输入框（`input-box.tsx`）当前存在三类体验问题：

1. **中文 IME 误发送**：拼音组词时按 Enter/空格确认候选词，会触发发送（`handleKeyDown` 未判断 composition 状态）
2. **视觉**：输入框初始高度仅一行，不像"输入区域"；输入时的边框观感不佳
3. **附件能力缺失**：`+` 按钮是空实现，无法发送图片或文件

同时确认约束：当前发送链路为纯文本 —— `InputBox.onSend(string)` → `use-agents.send` → `agent-bus.send` → `IAgentService.run(workspace, sessionId, input: string)`（`packages/bridge/src/agent-service.interface.ts:13`），core 侧 `UserInput.content` 也是 `string`（`packages/core/src/types.ts:33`），但 `run-agent.ts:96` 直接将其塞入 `pi.Message`，因此 core 只需放宽类型即可支持 pi-ai 多模态。

## 目标

- 修复 IME 误发送
- 输入框视觉优化（最小高度、边框）
- 支持文本文件附件（前端内联，零协议改动）
- 支持图片附件（真正的多模态，web → bridge → core 全链路）

## 非目标

- 任意二进制文件上传与服务端存储
- 流式期间输入排队发送（未选入本期）
- 历史消息召回（↑ 键）、草稿持久化（未选入本期）

## 设计

### 1. 即时体验修复（`input-box.tsx`）

**IME 修复**

- textarea 增加 `onCompositionStart` / `onCompositionEnd`，维护 `composingRef`
- `handleKeyDown` 中，当 `composingRef.current === true` 或 `e.nativeEvent.isComposing` 为 true 时，Enter 不触发发送（仅上屏候选词）
- 以 `nativeEvent.isComposing` 为主判断、`composingRef` 兜底（兼容 Safari 事件顺序差异）

**视觉**

- `min-h-[24px]` → `min-h-[48px]`（约 2 行）；auto-resize 逻辑与 160px 上限保持不变
- textarea 保持 `outline-none`，聚焦时不出现额外边框高亮（维持现状，确认无 focus 样式副作用）

### 2. 文本文件附件（纯前端，零协议改动）

**入口**（三选一均可触发）

- `+` 按钮唤起文件选择（accept 文本类扩展名 + `text/*` MIME）
- 拖拽文件到输入区
- Cmd/Ctrl+V 粘贴文件

**内联格式**

读取文件文本，发送时拼接在 textarea 文本之前：

```text
<file name="foo.ts">
...文件内容...
</file>
```

**UI**

- 选中后输入框上方出现文件 chip（文件名 + × 删除按钮）
- chip 内容不进入 textarea，避免用户误编辑大段注入内容

**约束**

- 单文件 ≤ 100KB，单次最多 5 个文件
- 非文本文件（按 MIME/扩展名判断）拒绝并提示

### 3. 图片多模态链路（web → bridge → core）

**Core（极小改动）**

- `UserInput.content` 放宽为：

```typescript
type UserInputContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
```

- `run-agent.ts:96` 透传 content 到 `pi.Message`，其余逻辑不变
- 不做模型多模态预检；模型不支持时由 pi-ai 报错，沿现有 `finish({error})` 链路展示

**Bridge 协议**

- `IAgentService.run()` 的 `input: string` → `input: UserInputContent`（string 保持向后兼容）
- `agent-remote-service.ts` POST body 由 `{ content: string }` 扩展为 `{ content: UserInputContent }`
- server 端 route 解析后构造 `UserInput` 传给 `coreRunAgent`
- 历史消息渲染：`agent-session.ts:163` 目前把 image 块压成 `[image]` 文本，改为透传 `{ type: 'image', data, mimeType }` 的 `UiContentBlock`；web 端 `MessageItem` 渲染图片缩略图

**Web UI**

- 图片入口：粘贴剪贴板图片、拖拽、`+` 按钮选择（`accept="image/*"`）
- 选中后输入框上方出现图片缩略图 chip（可 × 删除），与文本文件 chip 同排展示
- 发送时：FileReader 读为 base64，组装 `ContentPart[]`（文本 part + 若干 image part）调用 `send`
- 约束：单图 ≤ 5MB，单次 ≤ 4 张

**调用链签名变更**

- `InputBox.onSend(content: string)` → `onSend(content: UserInputContent)`
- `agent-bus.send` / `use-agents.send` 同步放宽

### 4. 错误处理

- 文件读取失败 / 超限 / 类型不支持：输入区上方 toast 提示，不清空已输入文本
- 发送失败（网络错误）：把内容与附件 chip 恢复到输入框（现状是发送即清空，需调整为先缓存再恢复）

### 5. 测试

- 新增 `input-box.test.tsx`：
  - IME composition 期间 Enter 不发送；composition 结束后 Enter 正常发送
  - 粘贴图片生成缩略图 chip；× 删除 chip
  - 超限文件 / 非文本文件拒绝并提示
- `chat-composer.test.tsx`：补充附件 chip 渲染与删除
- bridge：`agent-remote-service` 与 server route 的 `ContentPart[]` 序列化往返测试
- core：`runAgent` 接受 parts content 并正确构造 `pi.Message` 的透传测试

## 涉及文件

| 包 | 文件 | 改动 |
|---|---|---|
| web | `src/components/chat/input-box.tsx` | IME 修复、最小高度、附件 chip、拖拽/粘贴 |
| web | `src/components/chat/chat-composer.tsx` | props 透传 |
| web | `src/lib/agent-bus.ts` / `use-agents.ts` | send 签名放宽 |
| web | `src/components/chat/message-item.tsx` | 渲染 image 块缩略图 |
| bridge | `src/agent-service.interface.ts` | `run()` input 类型放宽 |
| bridge | `src/types.ts` | `RunRequest.content` 类型放宽（`types.ts:29`） |
| bridge | `src/agent-remote-service.ts` | POST body 协议扩展 |
| web | `src/app/api/agent/run/route.ts` | 解析 `UserInputContent` 并传给 service |
| bridge | `src/agent-session.ts` | image 块透传为 UiContentBlock |
| core | `src/types.ts` | `UserInput.content` 类型放宽 |
| core | `src/run-agent.ts` | 透传（可能无需改动，视类型推导） |
