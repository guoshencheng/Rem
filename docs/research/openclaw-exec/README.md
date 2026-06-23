# OpenClaw Exec 参数权限校验深度调研

> 调研日期：2026-06-23
> 调研范围：OpenClaw 对 exec 类工具的完整参数校验、命令解析、审批决策与持久化
> 调研方法：7 个 subagent 并行深入源码，每个聚焦一个维度；本文整合其结果并附加 Rem 对比与移植路线
> 源码位置：`/Users/guoshencheng/Documents/work/rem/refer/openclaw/`

---

## 文档结构

调研内容按"每个 subagent 一个独立文档 + 一份综合对比与移植路线"组织。所有子文档互为引用。

### 入口与背景

- [`00-summary.md`](./00-summary.md) — **整体流程总结（通俗版，建议先读）**
- [`00-background.md`](./00-background.md) — 调研背景、源码规模、调研动机
- [`00-overview.md`](./00-overview.md) — 整体架构总览（3 独立管道 + 5 顺序关卡 + 数据流图，技术版）

### 7 个 subagent 调研文档

| # | 文档 | 调研主题 | 主要源码 |
|---|---|---|---|
| 1 | [`01-schema.md`](./01-schema.md) | TypeBox Schema 声明 + Provider 适配（Gemini/OpenAI/Anthropic/xAI） | `bash-tools.schemas.ts`、`agent-tools-parameter-schema.ts` |
| 2 | [`02-parser.md`](./02-parser.md) | Shell 命令解析（POSIX 状态机 + heredoc + Windows 路径） | `infra/exec-approvals-analysis.ts` |
| 3 | [`03-wrappers.md`](./03-wrappers.md) | Wrapper / Carrier / Inline-Eval 拆解（`sh -c` / `sudo` / `env -S` / `python -c`） | `shell-wrapper-resolution.ts`、`command-carriers.ts`、`inline-eval.ts` |
| 4 | [`04-safe-bin.md`](./04-safe-bin.md) | Safe-Bin 策略 + Allowlist 匹配（per-bin profile + trust dir + glob 模式） | `exec-safe-bin-policy-*.ts`、`exec-approvals-allowlist.ts` |
| 5 | [`05-host-env.md`](./05-host-env.md) | Host 环境变量安全 + 脚本预检 + 控制命令拦截 + Sandbox 路径 | `host-env-security.ts`、`host-env-security-policy.json`、`bash-tools.exec.ts`、`sandbox-paths.ts` |
| 6 | [`06-decision-flow.md`](./06-decision-flow.md) | 5 决策模式 + 审批流 + Auto-Reviewer + 两阶段注册 | `infra/exec-approvals.ts`、`bash-tools.exec-host-gateway.ts`、`bash-tools.exec-approval-request.ts`、`exec-auto-reviewer.ts` |
| 7 | [`07-persistence.md`](./07-persistence.md) | 持久化 allow-always + Effective Policy 合并 + 测试覆盖 | `infra/exec-approvals.ts`（持久化部分）、`exec-approvals-effective.ts`、11 个测试文件 |

### 综合与建议

- [`08-synthesis.md`](./08-synthesis.md) — OpenClaw vs Rem 对比 + 移植优先级（综合调研者视角）
- [`09-appendix.md`](./09-appendix.md) — 调研文件清单

## 推荐阅读顺序

1. **快速理解整体**：`00-summary.md`（10 分钟通俗版）→ `00-overview.md`（技术版）
2. **深入某一维度**：按需读对应子文档
3. **决策移植**：`08-synthesis.md`（含 5 个最危险漏洞 + 移植优先级）
