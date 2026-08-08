# Rem Web Compact Dark Workbench 对齐设计

## 1. 背景与目标

当前 `packages/web` 已具备 Session 列表、中心会话、多 Agent Thread 面板、输入区、顶栏和状态栏，也已采用暗色 shadcn/ui 主题，但组件尺寸、视觉 token、信息层级和响应式策略尚未统一。

本设计在 `2026-08-06-web-ui-rebuild-design.md` 的功能与数据边界之上，将 Web 界面完整对齐 `compact-dark-workbench` 设计规范。对齐范围包含全局 token、三栏架构、组件密度、消息呈现、协作 Thread 检查器、状态表达和窄屏交互。

业务行为保持不变：不修改 Core、HTTP API、SSE 协议、消息投影规则或 Zustand 状态模型。

## 2. 已确认的设计决策

采用方案 B「Agent 语义适配」：

- 忠实复用 Compact Dark Workbench 的颜色、字号、行高、间距、尺寸、圆角和选中态 token。
- 保留 Rem 的 Agent 语义，不把聊天界面机械套成装配工具。
- 左栏映射为 Session 导航，中心舞台映射为公开会话，右栏映射为协作检查器。
- 应用占满浏览器窗口，不采用参考示例的固定 `1220 × 690px` 外框。
- 桌面端使用固定侧栏与弹性中心区；900px 以下改为左右抽屉，中心会话始终优先。

## 3. 布局架构

### 3.1 全屏工作台

应用根节点占满视口，使用三段纵向网格：

```text
48px 顶栏
1fr  主体
26px 状态栏
```

主体桌面布局：

```text
205px Session 导航 | minmax(460px, 1fr) 公开会话 | 268px 协作检查器
```

具体规则：

- 顶栏固定 48px，水平 padding 为 13px。
- 左、右面板 padding 为 11px。
- 状态栏固定 26px，水平 padding 为 10px，项目间距为 20px。
- 单 Agent Session 不渲染协作检查器，中心会话占据剩余空间。
- 所有滚动发生在各自面板内部，不允许页面根节点产生多重滚动条。

### 3.2 窄屏布局

在 900px 以下：

- 中心会话保持全宽。
- Session 导航进入左侧抽屉。
- 协作检查器进入右侧抽屉，仅多 Agent Session 提供入口。
- 顶栏显示对应的面板触发按钮。
- 抽屉复用桌面端同一内容组件，不维护第二套移动端结构。
- 抽屉具备可访问标题、焦点约束、Escape 关闭和关闭后焦点恢复。

## 4. 视觉 token

### 4.1 来源与映射

`packages/web/src/client/index.css` 是全局 token 的唯一入口。将 Compact Dark Workbench 的 `--ds-*` token 原值引入该文件，并让现有 shadcn 语义变量引用这些 token。

关键色值保持源规范：

- 页面背景：`--ds-bg: #08090c`
- 面板：`--ds-panel: #12141a`
- 抬升表面：`--ds-raised: #181a20`
- 边框：`--ds-border: #292b32`
- 主色：`--ds-primary: #6752da`
- 主色边框：`--ds-primary-border: #7059ed`
- 选中背景：`--ds-selected-bg: #28233d`
- 选中边框：`--ds-selected-border: #5e4bc2`
- 复合/多 Agent 文本：`--ds-composite-text: #b4a9ff`

shadcn 的 `background`、`card`、`primary`、`muted`、`accent`、`border`、`input` 和 `ring` 只作为这些源 token 的语义别名。业务组件不得直接写十六进制颜色。

Rem 运行状态补充语义 token：running、success、error、offline。组件只引用状态语义，不使用 `emerald-*` 等原始色值。

### 4.2 字体与密度

全局字号只使用以下七级：

| 层级 | 字号 | 用途 |
|---|---:|---|
| page title | 17px | 页面级说明标题 |
| panel title | 13px | Agent/对象身份 |
| body | 12px | 消息正文 |
| nav | 11px | 面包屑与导航 |
| control | 10px | 按钮、主行标题、品牌 |
| meta | 9px | 元数据、状态说明 |
| label | 8px | 区域标签、Tag、状态栏 |

正文行高为 1.45，紧凑标题为 1.2，按钮、Badge 和 Tag 为 1。

### 4.3 组件固定尺寸

- 顶栏和检查器按钮：27px 高，水平 padding 9px，10px 字号。
- 面板内次级按钮：25px 高，水平 padding 8px，9px 字号。
- Session/Thread 主行：34px 高。
- 子行：27px 高。
- 行图标：22px 正方形。
- Badge：16px 高，9px 字号。
- Tag：14px 高，8px 字号。

所有尺寸通过 token 或组件变体表达，业务组件不使用散落的任意值。

## 5. 组件职责

### 5.1 WorkbenchShell

负责全屏网格、桌面三栏、单 Agent 双栏以及窄屏抽屉切换。它只管理布局状态，不读取业务数据。

### 5.2 TopBar

按以下顺序组织信息：

1. REM 品牌。
2. Session 标题与当前上下文面包屑。
3. single / multi-agent Badge。
4. 窄屏面板入口。
5. 中断与新建 Session 操作。

### 5.3 SessionList

使用 34px 紧凑行呈现：

- Session 图标。
- 标题。
- 消息数量或活动状态。
- single / multi-agent Tag。

当前项使用 selected token；hover、running 和 error 使用各自语义状态。空列表使用统一低强调空态。

### 5.4 ChatView

中心区域只显示用户消息与公开 Agent 投影：

- 区域标签说明这是公开会话。
- Agent 消息使用正文层级，不伪装成面板卡片。
- 用户消息使用 selected 背景和边框形成稳定区分。
- 流式消息保留当前增量渲染行为。
- Session 级错误显示在消息流末尾。
- 输入区固定在底部，消息列表独立滚动。

### 5.5 CollaborationInspector

多 Agent Session 的右栏按以下层级组织：

1. 区域标签：协作线程。
2. Thread 选择控件。
3. Agent 身份与 Thread 元数据。
4. 私有消息流。
5. 工具调用执行、完成与失败状态。

现有 `ThreadPanel` 的职责拆成小型、内聚组件，但不为单一场景做无意义的过度拆分。右栏容器负责组合，Thread 选择、消息内容和工具状态各自保持清晰职责。

### 5.6 StatusBar

状态栏集中显示：

- 当前 Session。
- Thread 总数和运行中数量。
- SSE 连接状态。

连接状态固定在最右侧，使用状态点、文字和语义色共同表达。

## 6. shadcn/ui 约束

- 继续使用现有 Button、Badge、Card、Tabs、ScrollArea、Dialog、Textarea 等组件。
- 新增抽屉时使用 shadcn Sheet，不手写覆盖层。
- 空态、错误提示和分隔符优先使用对应 shadcn 组件。
- 组件样式通过变体和语义 token 承载；业务 `className` 只负责布局。
- 条件类统一使用 `cn()`。
- 图标按钮遵循现有 Lucide 图标库和 `data-icon` 约定。
- 不在业务组件中使用手写颜色、任意字号或重复的状态样式。

## 7. 数据流与行为边界

本次不改变现有数据路径：

```text
REST 初始加载 → Zustand stream store → 组件订阅
SSE 增量事件 → stream reducer/store → 当前 Session/Thread 视图
```

以下行为必须保持：

- Session 创建与选择。
- 中心公开消息投影。
- Thread 私有消息切换。
- 流式文本和工具调用增量展示。
- 发送与中断。
- SSE 重连后的数据重拉。

桌面侧栏与窄屏抽屉使用同一 store 状态。切换展示方式不得重置当前 Thread 选择或消息滚动上下文。

## 8. 状态与异常

- 空 Session、空消息、空 Thread 使用统一低强调空态。
- 运行中使用 running；完成使用 success；失败使用 destructive；离线使用 offline。
- Session 错误只出现在中心会话上下文。
- Thread 和工具错误只出现在协作检查器对应上下文。
- 长 Session 标题和 Agent ID 使用单行截断。
- 工具参数与输出限制高度并允许内部滚动，不能撑宽右栏。
- SSE 状态在状态栏表达，不使用遮挡消息的大型通知。

## 9. 模块边界

遵循 `module-separation-convention`：

- 布局、导航、消息、协作检查和基础 UI 变体分别承担单一职责。
- 只在出现多个真实使用点或独立演化需求时抽共享组件。
- TypeScript 实现文件保持在 200 行绝对上限内，优先控制在 150 行以内。
- 类型导入和值导入分离。
- 不修改 `archive/`。

## 10. 验证策略

### 10.1 自动化验证

- 保留并运行现有 Web 测试。
- 增加 WorkbenchShell 桌面/窄屏入口渲染测试。
- 增加 Session 选中态、单/多 Agent Tag 和空态测试。
- 增加 CollaborationInspector 的 Thread 切换与状态渲染测试。
- 增加工具调用 executing / success / error 语义状态测试。
- 运行 `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`。

### 10.2 浏览器验证

实现前先通过浏览器记录当前界面基线，实现后使用同一真实数据场景验证：

- 桌面宽屏三栏布局。
- 单 Agent 隐藏右栏。
- 900px 以下的左右抽屉。
- 消息区、Session 列表和协作检查器独立滚动。
- 长标题、长工具参数与长输出。
- Session/Thread 选择、发送、中断和流式内容。
- running、success、error、offline 状态。

## 11. 验收标准

1. 全屏应用在桌面端严格使用 48px 顶栏、205px 左栏、268px 右栏和 26px 状态栏。
2. 颜色、字号、间距、固定控件高度和选中态均来自 Compact Dark Workbench token。
3. 左侧 Session、中心公开会话和右侧协作检查器形成清晰的信息层级。
4. 单 Agent 自动扩展中心区，多 Agent 正确显示协作检查器。
5. 900px 以下通过左右抽屉访问侧栏，中心会话保持全宽。
6. 业务组件中不再存在用于视觉系统的硬编码颜色和任意字号。
7. 现有 Session、消息、Thread、流式、中断与重连行为不回退。
8. 自动化检查全部通过，真实浏览器桌面与窄屏验证无布局和交互问题。

## 12. 非目标

- 不修改 Core Agent 生命周期或消息模型。
- 不修改 server 路由和 SSE 协议。
- 不增加新的业务功能或设置页面。
- 不引入路由系统。
- 不修改 `archive/`。
- 不追求与参考示例固定画布尺寸一致；实际产品保持全屏自适应。
