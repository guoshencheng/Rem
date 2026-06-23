<!--
调研背景文档
主题：调研动机、源码规模、上下文
作者：综合调研者
原合并文档位置：调研背景
关联文档：README.md、00-overview.md
-->

# 00. 调研背景

> 作者：综合调研者
> 主题：调研动机、Rem vs OpenClaw 的差距、调研覆盖的源码规模

## 调研背景

OpenClaw 是 Hermes 的姊妹项目，在 exec 类工具的安全校验上做了**13 层结构化校验管道**，远超当前 Rem 的字符串模式匹配。本调研逐层深入 OpenClaw 的实现，为 Rem 后续的安全策略升级提供参考。

调研覆盖的源码规模：

- `src/agents/bash-tools.*` 约 15 个文件，5000+ 行
- `src/infra/exec-approvals-*.ts` 约 10 个文件，3000+ 行
- `src/infra/command-analysis/` 约 6 个文件
- `src/infra/host-env-security.*` 2 个文件
- 11 个测试文件，约 380 个测试用例

---

