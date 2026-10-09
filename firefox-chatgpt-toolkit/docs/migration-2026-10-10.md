# 工作环境迁移：2026-10-10

状态：文件迁移与新目录验证完成。决策见 [ADR 0007](adr/0007-workspace-source-authority.md)。

## 迁移内容

新根为 `D:\projects\GPT Enhancemnet`。原 Automation-Tools checkout 的完整 `.git`、107 个跟踪文件、原 origin 和提交 `bab6f11982c32b89c74863abca10cbe8a43ddc1b` 已保留。所有跟踪文件逐项 SHA-256 一致；唯一活跃插件源码改为新根下 `firefox-chatgpt-toolkit/userscripts/chatgpt-queue`。

历史 outputs、研究 clone、私有截图、Console/草稿/RPC 文件及一次性维护脚本复制为 `.local/legacy-workspace`，与旧工作区备份都保留。复制时逐文件核对哈希，完整文件清单只保存在忽略的 `.local/migration/copy-report.json`。node_modules、npm-cache、Python 缓存与旧图谱缓存可重建，没有作为活跃依赖迁入。

两套 Node 依赖已按原有锁文件重新安装，安装过程禁用生命周期脚本。新增统一 [开发入口](development.md)、context、architecture、7 篇 ADR 和文档链接检查。图谱 `gpt-enhancement-queue` 与 `gpt-enhancement-native` 已指向新目录并完整索引源/测试；原生图谱对 `tests/native-policy.ps1` 的一处 PowerShell 语法保留 partial 提示，按返回信息允许源文件补查。

已有仓库其他模块原样保留。全局 Codex 配置、Firefox profile、账号状态及已安装油猴脚本未改变。此次没有启动或操作浏览器，没有发送验证 prompt；运行产物保持 1.7.0。

## 本次验证结果

统一 verify 在新目录执行通过，7 个步骤全部成功，耗时 35.688 秒，清理错误为零。

| 检查 | 结果 |
| --- | --- |
| 插件状态机 / DOM / 完整脚本测试 | 62/62 |
| 原生自动化、文件服务、假 MCP 测试 | 11/11 |
| 截图适配器 unittest | 7/7 |
| PowerShell 5.1 / 7 policy 与 parser | 各 8 项，通过；未运行 LiveReadOnly |
| 构建产物语法 | 通过，SHA-256 与 1.7.0 基线一致 |
| 项目 context / ADR 等文档链接 | 14 份，0 个断链 |
| Git 与私有文件规则 | fsck 通过，origin 保留；私有 archive / 报告 / 依赖被忽略 |

脱敏结果见 [migration-checks-2026-10-10.json](migration-checks-2026-10-10.json)。本机完整日志在 `output/automation/20261009T171226Z-e9560eef/report.json`；执行器文件名使用 UTC 时间，本文记录使用 Asia/Taipei 日期。历史 2026-10-09 浏览器验收保留在原 VALIDATION.md，不计作本次通过。

## 回退与继续开发

本机旧工作区保持完整，必要时可直接使用其冻结副本核对文件或恢复历史材料。迁移后继续开发以新根为准；如果回退，需要先检查迁移后新变更，避免用旧快照覆盖它们。

私有材料及运行报告由 Git 忽略；root context 和 AGENTS.md 引导后续会话到新源码。此次本地迁移与文档工作未提交或推送；新环境保留这些可审阅变更。
