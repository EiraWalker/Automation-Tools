# Firefox / ChatGPT 自动化套件

本目录收录开发 ChatGPT Queue 油猴脚本时用到的本地自动化方法、工具和配套 skill。连接已有 Firefox，不创建测试浏览器或独立配置文件。

| 模块 | 用途 | Skill |
| --- | --- | --- |
| [Firefox 原生自动化](browser/firefox-native-automation/README.md) | 窗口与标签页识别、Web Console、Tampermonkey 更新、草稿保护、可选已有会话 MCP 桥接 | [firefox-native-automation](browser/firefox-native-automation/SKILL.md) |
| [后台窗口截图](windows/background-window-capture/README.md) | 通过 AgentCapture 的 WGC / PrintWindow 截取已有窗口 | [background-window-capture](windows/background-window-capture/SKILL.md) |
| [ChatGPT Queue](userscripts/chatgpt-queue/README.md) | Chat / Work / Codex Cloud 原生输入框排队发送、跟随 Accent color、默认会话全宽 | [chatgpt-queue-userscript](userscripts/chatgpt-queue/SKILL.md) |

## 使用

日常使用队列：将 [chatgpt-queue.user.js](userscripts/chatgpt-queue/chatgpt-queue.user.js) 完整内容保存到 Firefox 的 Tampermonkey 中。安装和更新后刷新已有 ChatGPT 标签页。无需 Node.js、MCP、API Key 或本地服务。

原生浏览器自动化：Windows PowerShell 5.1 或 PowerShell 7 执行 `firefox-native.ps1 -Action Inspect`，从实时返回结果选取目标 HWND 和标签页名称，再按照模块 README 操作。独立的 PowerShell 操作不依赖 npm。

后台截图：另行取得 [AgentCapture](https://github.com/EiraWalker/AgentCapture) 的完整运行目录，通过 `AGENTCAPTURE_EXE` 或适配器 `--tool` 指定程序，读取窗口列表后用精确 HWND 截图。

供 Agent 使用：把需要的**整个模块目录**复制到工具的 skills 目录，分别命名为 `firefox-native-automation`、`background-window-capture`、`chatgpt-queue-userscript`；保留 SKILL.md、scripts、references 和必要源码的相对位置，排除 node_modules、本地配置和运行产物。例如 Codex 的目录是 `$env:USERPROFILE\.codex\skills`。安装后让客户端刷新技能列表或新开聊天。三个 skill 可分别安装。

## 验证

见 [VALIDATION.md](VALIDATION.md)。真实 ChatGPT 验收与打包后自动化工具的单元测试分开记录。可选 MCP 桥接的超时不视作浏览器操作成功。

这些工具只提供本地 CLI、stdio 和绑定 127.0.0.1 的单文件脚本下载，不发布登录页、远程浏览器页面或管理入口。运行时 IPC、生成的控制台任务、截图与草稿属于本机数据，保存到仓库外或已忽略的目录。若另行搭建托管交互入口，仍须遵循仓库根目录 AGENTS.md 的 owner-private Sites OAuth 要求。

各模块许可证见 [LICENSES.md](LICENSES.md)。
