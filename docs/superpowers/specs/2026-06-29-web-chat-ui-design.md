# Web Chat UI 设计方案

## 概述

为 Rem Agent 构建面向非技术用户的 Web 聊天界面。基于 Next.js 15 App Router，React + shadcn/ui 纯自建组件方案。

## 一、项目结构

新增 `packages/web/` 包，以 workspace 依赖引入 `rem-agent-core`。

```
packages/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # 根布局（主题、字体）
│   │   ├── page.tsx                   # 主聊天页
│   │   └── api/
│   │       ├── agent/
│   │       │   ├── run/route.ts       # POST：启动 agent，返回 streamUrl
│   │       │   ├── interrupt/route.ts # POST：中断
│   │       │   └── reset/route.ts     # POST：重置会话
│   │       ├── sessions/
│   │       │   ├── route.ts           # GET（列表）/ POST（新建）
│   │       │   └── [id]/
│   │       │       └── route.ts       # GET/PATCH/DELETE 单个会话
│   │       └── stream/
│   │           └── [sessionId]/
│   │               └── route.ts       # GET：SSE 流式输出
│   ├── components/
│   │   ├── chat/
│   │   │   ├── chat-panel.tsx         # 聊天主容器
│   │   │   ├── message-list.tsx       # 消息列表（虚拟滚动）
│   │   │   ├── message-item.tsx       # 单条消息
│   │   │   ├── input-box.tsx          # 输入框 + 发送
│   │   │   ├── reasoning-block.tsx    # 推理折叠块（默认折叠，流式时自动展开）
│   │   │   ├── tool-call-block.tsx    # 工具调用折叠块
│   │   │   └── thinking-bar.tsx       # 流式进行中的状态指示条
│   │   ├── sidebar/
│   │   │   ├── session-sidebar.tsx    # 侧边栏容器
│   │   │   ├── session-list.tsx       # 会话列表
│   │   │   └── session-item.tsx       # 单个会话项（含重命名/删除/置顶菜单）
│   │   └── ui/                        # shadcn/ui 组件
│   ├── lib/
│   │   ├── agent-client.ts            # API 调用封装
│   │   ├── stream-parser.ts           # SSE → AgentStreamChunk 解析
│   │   ├── use-sse.ts                 # ReadableStream 消费 hook
│   │   ├── session-store.ts           # 会话状态管理（Zustand）
│   │   └── types.ts                   # 前端类型
│   └── styles/
│       └── globals.css                # Tailwind + shadcn 主题变量
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── components.json                    # shadcn/ui 配置
└── tsconfig.json
```

## 二、集成方式

- `packages/web` 通过 workspace 依赖 `rem-agent-core`，API Routes 中直接 `import { createAgentFromEnv } from 'rem-agent-core'`
- 保留 core 不变，原 bridge/service 逻辑迁入 Next.js API Routes
- 新增的不属于 Bridge 模式的服务直接在 Next.js 中维护
- 部署：`pnpm --filter rem-agent-web dev`

## 三、API 路由设计

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/sessions` | GET | 返回会话列表（搜索参数 `?q=`） |
| `/api/sessions` | POST | 新建会话（返回 `{ id, title }`） |
| `/api/sessions/[id]` | GET | 获取会话详情（含消息历史） |
| `/api/sessions/[id]` | PATCH | 更新会话（重命名 `{ title }` 或置顶 `{ pinned }`） |
| `/api/sessions/[id]` | DELETE | 删除会话 |
| `/api/agent/run` | POST | 启动 agent，body: `{ sessionId, input }`，返回 `{ streamUrl }` |
| `/api/agent/interrupt` | POST | 中断当前运行 |
| `/api/agent/stream/[sessionId]` | GET | SSE 流，逐条推送 `AgentStreamChunk` |

### SSE 流式通信流程

```
用户输入 → POST /api/agent/run → 获得 streamUrl
  → EventSource 连接 /api/stream/[sessionId]
    → 逐个接收 AgentStreamChunk
      → text-delta → 追加到当前 assistant 消息文本
      → reasoning-delta → 追加到推理块
      → tool-call-start → 展开工具调用卡片
      → tool-result → 更新卡片为完成状态
      → finish → 标记流结束，自动生成会话标题
```

## 四、UI 布局

```
┌──────────┬──────────────────────────────────────┐
│          │  Header Bar                          │
│          │  会话标题 | 中断按钮 | 新建对话按钮    │
│  Sidebar ├──────────────────────────────────────┤
│          │                                      │
│  搜索框  │                                      │
│ [+新对话]│        Message List                  │
│          │   (react-virtuoso 虚拟滚动)           │
│  会话列表│                                      │
│  · 会话1 │   ┌──────────────────────────┐      │
│  · 会话2 │   │ User: 帮我写一段代码       │      │
│  · 会话3 │   └──────────────────────────┘      │
│          │   ┌──────────────────────────┐      │
│  (右键: │   │ Assistant:               │      │
│   重命名│   │  ▶ Thinking (折叠)        │      │
│   删除) │   │  这是代码...              │      │
│          │   │  ▶ Tool: write_file (折叠)│     │
│          │   └──────────────────────────┘      │
│          ├──────────────────────────────────────┤
│          │        Input Box          [发送]    │
└──────────┴──────────────────────────────────────┘
```

### 核心组件职责

| 组件 | 职责 |
|------|------|
| `SessionSidebar` | 搜索 + 新建按钮 + 会话列表，支持右键菜单（重命名/删除/置顶） |
| `ChatPanel` | 聊天主容器，组合其他组件 |
| `MessageList` | 基于 react-virtuoso 的虚拟滚动消息列表，自动滚到底部，接近底部时不强制滚动 |
| `MessageItem` | 单条消息：用户消息纯 Markdown 渲染；assistant 消息含推理块和工具调用块 |
| `ReasoningBlock` | 折叠块（默认折叠），显示思考过程文本，流式时自动展开 |
| `ToolCallBlock` | 折叠块，展示工具名、参数、执行结果，三种状态：执行中 / 完成 / 错误 |
| `ThinkingBar` | 当 agent 正在流式输出但还没有文本时，显示 "Thinking..." 动画指示条 |
| `InputBox` | 多行文本输入（Shift+Enter 换行，Enter 发送），流式时切换为"中断"按钮 |

### 消息生命周期

```
用户发消息 → UIMessage status='pending'
  → SSE 连接建立 → status='streaming'
    → reasoning-delta 到达 → ReasoningBlock 自动展开，文字逐字出现
    → reasoning-finish → ReasoningBlock 停止动画，恢复折叠
    → tool-call-start → 插入 ToolCallBlock(status='executing')
    → tool-result → ToolCallBlock 更新为 status='done'/'error'
    → text-delta 到达 → content 逐字累加
    → finish 到达 → status='done'，自动生成标题
```

## 五、会话管理功能

### 列表排序
- 置顶的会话排最前，按置顶时间倒序
- 非置顶的按最后活动时间倒序
- 搜索时忽略排序规则，按匹配度排列

### 搜索
- 前端防抖 300ms，query 参数传给 `GET /api/sessions?q=xxx`
- 后端对会话标题做简单模糊匹配

### 右键菜单
- 置顶 / 取消置顶：即时切换，调 PATCH
- 重命名：点击后标题变为可编辑 input，回车或失焦提交
- 删除：确认对话框后调 DELETE，删除当前会话则自动切到最近会话

### 自动标题生成
- 会话第一轮结束后（收到 `finish` chunk），调用 `CoreAgent.generateTitle()` 获取标题
- 标题返回后自动 PATCH 更新会话标题，前端同步刷新侧边栏

## 六、流式渲染与 Agent 特性

### Reasoning 显示
- 默认折叠，标题显示 "Thinking"
- 流式输出 reasoning-delta 时自动展开
- reasoning-finish 后恢复折叠状态

### Tool Call 显示
- 默认折叠，标题显示工具名（如 "🔧 write_file"）
- 三种状态：
  - `executing`：灰色加载动画，标题 "执行中..."
  - `done`：绿色勾，展示参数和输出摘要
  - `error`：红色叉，展示错误信息
- 点击展开可查看完整输入/输出

### Markdown 渲染
- react-markdown + rehype-highlight（highlight.js）
- 支持代码块语法高亮、表格、列表、引用、粗斜体
- 代码块设置 max-height + 横向滚动
- 不支持数学公式和 Mermaid（B 级需求）

## 七、错误处理与边界情况

### 网络异常
| 场景 | 处理 |
|------|------|
| SSE 连接中断 | 显示 "连接中断，正在重连..." 提示条，3s 后自动重连（最多 3 次） |
| API 请求超时 | Toast 提示 "操作超时，请重试" |
| 服务不可用（5xx） | 顶部 banner "服务异常"，禁止发送 |

### SSE 流异常
| 场景 | 处理 |
|------|------|
| `error` chunk | 消息状态标记 error，红色显示错误信息 |
| 意外格式 | 跳过该 chunk，console.warn，不中断流 |
| 用户手动中断 | 调 POST /api/agent/interrupt，保留已输出内容 |
| 中断失败 | Toast 提示，不阻塞 UI |

### UI 边界
| 场景 | 处理 |
|------|------|
| 消息列表为空 | 引导文案 "你好，请问有什么可以帮助你的？" |
| 会话列表为空 | "暂无对话" |
| 搜索无结果 | "未找到匹配的对话" |
| 流式进行中发送 | 输入框禁用，发送按钮变为"中断" |
| 切换会话时正在流式 | 自动中断当前会话再切换 |
| 最小宽度 | 768px，侧边栏推入可切换显示 |

## 八、前端状态管理（Zustand）

```typescript
interface SessionStore {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  searchQuery: string;
  messages: UIMessage[];
  streaming: boolean;
  error: string | null;

  createSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setSearchQuery: (q: string) => void;
}

interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls: ToolCallRecord[];
  status: 'pending' | 'streaming' | 'done' | 'error';
}
```

## 九、技术栈

| 类别 | 选择 | 理由 |
|------|------|------|
| 框架 | Next.js 15 App Router | 已确定 |
| 样式 | Tailwind CSS 4 + shadcn/ui | 设计系统基础 |
| 状态管理 | Zustand v5 | 轻量（~1KB），API 简洁 |
| 虚拟滚动 | react-virtuoso v4 | 消息列表性能 |
| Markdown | react-markdown + rehype-highlight | 纯前端渲染 |
| 代码高亮 | highlight.js | 按需加载语言 |
| 流式消费 | 自定义 useSSE hook（fetch + ReadableStream） | 不依赖 Vercel AI SDK |
| Toast | shadcn/ui Sonner | 轻量提示 |
| 右键菜单 | shadcn/ui DropdownMenu | 会话操作菜单 |
| 图标 | lucide-react | shadcn/ui 自带 |

### 不引入
- Vercel AI SDK（遵循项目规范）
- 额外动画库（Tailwind 动画 + CSS transition）
- 额外图标库（lucide-react 足够）

### workspace 依赖

```json
{
  "dependencies": {
    "rem-agent-core": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next": "^15.0.0",
    "zustand": "^5.0.0",
    "react-virtuoso": "^4.0.0",
    "react-markdown": "^10.0.0",
    "rehype-highlight": "^7.0.0",
    "highlight.js": "^11.0.0"
  }
}
```

## 十、不做什么（YAGNI）

- 不实现文件上传 / 附件
- 不实现语音输入
- 不实现消息编辑 / 消息重新生成 / 消息分支
- 不实现多模型切换
- 不实现数学公式（LaTeX）和 Mermaid 图表渲染
- 不实现多语言 / 国际化
- 不实现用户认证 / 多用户
- 不实现 PWA / 离线支持

---

**待定：**
- 视觉设计稿（用户自行提供）
