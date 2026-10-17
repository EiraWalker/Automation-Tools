# ChatGPT 使用体验优化

本项目用于优化 ChatGPT 的使用体验，当前以 Firefox / Violentmonkey 用户脚本提供消息队列、会话全宽、原生主题适配和 Obsidian 问答归档。ChatGPT Queue 是现有脚本名称，后续功能可按需求扩展。

Firefox 自动化工具和 skill 已迁至[独立仓库](https://github.com/EiraWalker/Firefox-Nightly-Automation)。本目录保留 ChatGPT 插件和截图适配器。旧 Firefox 模块及其专用命令已退役，归档分支仅供历史追溯。

维护入口：[项目 context](docs/CONTEXT.md)、[架构与 ADR](docs/architecture.md)、[开发与验证](docs/development.md)。2026-10-10 的本机工作区迁移及边界见[迁移记录](docs/migration-2026-10-10.md)。

Agent 开发规范：[AGEMT.md](AGEMT.md)，由标准入口 [AGENTS.md](AGENTS.md) 引用。

| 模块 | 用途 | Skill |
| --- | --- | --- |
| [Firefox Nightly 自动化](https://github.com/EiraWalker/Firefox-Nightly-Automation) | 独立维护的已有 Nightly 连接及永久 XPI 安装 | [firefox-nightly-automation](https://github.com/EiraWalker/Firefox-Nightly-Automation/blob/main/skills/firefox-nightly-automation/SKILL.md) |
| [后台窗口截图](windows/background-window-capture/README.md) | 通过 AgentCapture 的 WGC / PrintWindow 截取已有窗口 | [background-window-capture](windows/background-window-capture/SKILL.md) |
| [ChatGPT Queue](userscripts/chatgpt-queue/README.md) | Chat / Work / Codex Cloud 队列、Accent color、会话全宽和 Obsidian 问答归档 | [chatgpt-queue-userscript](userscripts/chatgpt-queue/SKILL.md) |

## 使用

日常使用队列：将 [chatgpt-queue.user.js](userscripts/chatgpt-queue/chatgpt-queue.user.js) 完整内容保存到 Firefox 或 Firefox Nightly 的 Violentmonkey 中。源码版本为 1.9.0，项目运行环境基线为 Violentmonkey 2.49.0；两个浏览器分别安装、分别核验。首次安装、配置迁移与本机自动更新见 [插件说明](userscripts/chatgpt-queue/README.md#安装) 和 [更新工作流](https://github.com/EiraWalker/Automation-Tools/blob/legacy/firefox-automation-20261017/firefox-chatgpt-toolkit/browser/firefox-puppeteer/references/userscript-workflow.md)。环境定义与当前验收状态见 [项目 context](docs/CONTEXT.md#项目运行环境)。

安装或更新后，等当前生成和队列结束、保留草稿，再在方便时正常加载需要使用的 ChatGPT 页面。队列日常运行无需 Node.js、MCP、API Key 或本地服务。

Obsidian 归档另需运行目标库的 Local REST API 插件并配置 AI 分类服务；具体设置与保存规则见[插件使用说明](userscripts/chatgpt-queue/README.md#保存到-obsidian)。

Firefox 浏览器任务使用[独立工具的 skill](https://github.com/EiraWalker/Firefox-Nightly-Automation/blob/main/skills/firefox-nightly-automation/SKILL.md)。本仓库不再提供旧 Firefox 自动化入口。

后台截图：另行取得 [AgentCapture](https://github.com/EiraWalker/AgentCapture) 的完整运行目录，通过 `AGENTCAPTURE_EXE` 或适配器 `--tool` 指定程序，读取窗口列表后用精确 HWND 截图。

供 Agent 使用：截图和队列 skill 继续按各模块说明安装；Firefox 自动化 skill 按独立仓库说明联接至唯一源目录。

旧 Firefox skill 已移除；归档文档中的命令不再作为当前受支持入口。

## 验证

见 [VALIDATION.md](VALIDATION.md)。真实 ChatGPT 验收与打包后自动化工具的单元测试分开记录。可选 MCP 桥接的超时不视作浏览器操作成功。

这些工具只提供本地 CLI、stdio 和绑定 127.0.0.1 的单文件脚本下载，不发布登录页、远程浏览器页面或管理入口。运行时 IPC、生成的控制台任务、截图与草稿属于本机数据，保存到仓库外或已忽略的目录。若另行搭建托管交互入口，仍须遵循仓库根目录 AGENTS.md 的 owner-private Sites OAuth 要求。

各模块许可证见 [LICENSES.md](LICENSES.md)。
