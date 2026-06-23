# OpenClaw Exec 参数权限校验深度调研

> ⚠️ **本文档已废弃。** 调研内容已拆分为独立子文档。
>
> 👉 **请阅读 [`docs/research/openclaw-exec/README.md`](./openclaw-exec/README.md)** 入口，按需加载 8 个子文档。

---

## 拆分后的结构

```
docs/research/openclaw-exec/
├── README.md                  ← 入口与索引
├── 00-background.md           ← 调研背景
├── 00-overview.md             ← 整体架构总览（综合调研者）
├── 01-schema.md               ← Schema 声明 + Provider 适配（subagent 1）
├── 02-parser.md               ← Shell 命令解析（subagent 2）
├── 03-wrappers.md             ← Wrapper/Carrier/Inline-Eval 拆解（subagent 3）
├── 04-safe-bin.md             ← Safe-Bin 策略 + Allowlist（subagent 4）
├── 05-host-env.md             ← Host 环境变量 + 脚本预检（subagent 5）
├── 06-decision-flow.md        ← 决策模式 + 审批流 + Auto-Reviewer（subagent 6）
├── 07-persistence.md          ← 持久化 allow-always + 测试覆盖（subagent 7）
├── 08-synthesis.md            ← OpenClaw vs Rem 对比 + 移植路线（综合调研者）
└── 09-appendix.md             ← 调研文件清单
```

## 快速跳转

- 想知道 **Rem 最危险的 5 个具体漏洞** → [`08-synthesis.md#9-2`](./openclaw-exec/08-synthesis.md)
- 想知道 **按 ROI 排序的移植优先级** → [`08-synthesis.md#9-3`](./openclaw-exec/08-synthesis.md)
- 想知道 **某个具体维度的实现细节** → 看对应编号的子文档

## 元信息

- 调研日期：2026-06-23
- 源码位置：`/Users/guoshencheng/Documents/work/rem/refer/openclaw/`
- 拆分日期：2026-06-23
