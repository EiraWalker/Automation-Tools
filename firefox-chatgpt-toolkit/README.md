# ChatGPT 使用体验优化

本项目用于优化 ChatGPT 的使用体验，当前以 Firefox / Violentmonkey 用户脚本提供消息队列、会话全宽、原生主题适配和 Obsidian 问答归档。ChatGPT Queue 是现有脚本名称，后续功能可按需求扩展。

本目录同时包含配套的开发自动化工具和 skill，用于安装更新、后台调试与真实页面验收。工具连接已有 Firefox，保持用户其他工作不受干扰。

维护入口：[项目 context](docs/CONTEXT.md)、[架构与 ADR](docs/architecture.md)、[开发与验证](docs/development.md)。2026-10-10 的本机工作区迁移及边界见[迁移记录](docs/migration-2026-10-10.md)。

Agent 开发规范：[AGEMT.md](AGEMT.md)，由标准入口 [AGENTS.md](AGENTS.md) 引用。

| 模块 | 用途 | Skill |
| --- | --- | --- |
| [Puppeteer 后台验收](browser/firefox-puppeteer/README.md) | 默认的已有 Firefox BiDi 连接、目标检查和归档按钮诊断 | [firefox-puppeteer](browser/firefox-puppeteer/SKILL.md) |
| [Firefox 原生自动化](browser/firefox-native-automation/README.md) | 只读窗口盘点；保留历史 Web Console、Tampermonkey 更新及 MCP 桥接工具 | [firefox-native-automation](browser/firefox-native-automation/SKILL.md) |
| [后台窗口截图](windows/background-window-capture/README.md) | 通过 AgentCapture 的 WGC / PrintWindow 截取已有窗口 | [background-window-capture](windows/background-window-capture/SKILL.md) |
| [ChatGPT Queue](userscripts/chatgpt-queue/README.md) | Chat / Work / Codex Cloud 队列、Accent color、会话全宽和 Obsidian 问答归档 | [chatgpt-queue-userscript](userscripts/chatgpt-queue/SKILL.md) |

## 使用

日常使用队列：将 [chatgpt-queue.user.js](userscripts/chatgpt-queue/chatgpt-queue.user.js) 完整内容保存到 Firefox 或 Firefox Nightly 的 Violentmonkey 中。源码版本为 1.9.0，项目运行环境基线为 Violentmonkey 2.49.0；两个浏览器分别安装、分别核验。首次安装、配置迁移与本机自动更新见 [插件说明](userscripts/chatgpt-queue/README.md#安装) 和 [更新工作流](browser/firefox-puppeteer/references/userscript-workflow.md)。环境定义与当前验收状态见 [项目 context](docs/CONTEXT.md#项目运行环境)。

安装或更新后，等当前生成和队列结束、保留草稿，再在方便时正常加载需要使用的 ChatGPT 页面。队列日常运行无需 Node.js、MCP、API Key 或本地服务。

Obsidian 归档另需运行目标库的 Local REST API 插件并配置 AI 分类服务；具体设置与保存规则见[插件使用说明](userscripts/chatgpt-queue/README.md#保存到-obsidian)。

当前工作区为 `E:\firefox dev`，默认浏览器验收使用 [Puppeteer 任务规范](browser/firefox-puppeteer/SKILL.md)。旧 native 工具保留只读窗口盘点和历史流程；前台 Console、切换标签及模拟键鼠不用于日常后台验收。

后台截图：另行取得 [AgentCapture](https://github.com/EiraWalker/AgentCapture) 的完整运行目录，通过 `AGENTCAPTURE_EXE` 或适配器 `--tool` 指定程序，读取窗口列表后用精确 HWND 截图。

供 Agent 使用：把需要的**整个模块目录**复制到工具的 skills 目录，分别命名为 `firefox-native-automation`、`background-window-capture`、`chatgpt-queue-userscript`；保留 SKILL.md、scripts、references 和必要源码的相对位置，排除 node_modules、本地配置和运行产物。例如 Codex 的目录是 `$env:USERPROFILE\.codex\skills`。安装后让客户端刷新技能列表或新开聊天。三个 skill 可分别安装。

本机新增 `firefox-puppeteer` skill 已通过 Junction 注册到 Codex skills 目录，指向本工作区的模块；保持与项目共同维护，从 `E:\firefox dev` 运行任务。客户端刷新技能列表后可按名称调用；当前聊天可直接读取模块 SKILL.md。

## 验证

见 [VALIDATION.md](VALIDATION.md)。真实 ChatGPT 验收与打包后自动化工具的单元测试分开记录。可选 MCP 桥接的超时不视作浏览器操作成功。

这些工具只提供本地 CLI、stdio 和绑定 127.0.0.1 的单文件脚本下载，不发布登录页、远程浏览器页面或管理入口。运行时 IPC、生成的控制台任务、截图与草稿属于本机数据，保存到仓库外或已忽略的目录。若另行搭建托管交互入口，仍须遵循仓库根目录 AGENTS.md 的 owner-private Sites OAuth 要求。

各模块许可证见 [LICENSES.md](LICENSES.md)。
