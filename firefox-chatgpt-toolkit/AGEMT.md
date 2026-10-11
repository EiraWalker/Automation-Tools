# ChatGPT 使用体验优化：Agent 工作规范

适用范围：`E:\firefox dev\firefox-chatgpt-toolkit`。仓库根为 `E:\firefox dev`；下文相对链接以本文件目录为起点。本文件按用户指定命名为 `AGEMT.md`，由同目录 `AGENTS.md` 引用。

## 项目定位

本项目用于优化 ChatGPT 的使用体验。当前通过 Firefox/Violentmonkey 增强 ChatGPT 网页，已包含消息队列、会话全宽、原生主题适配和 Obsidian 问答归档；后续可按用户需求增加其他体验优化功能。ChatGPT Queue 是现有脚本名称，不代表项目仅限于队列功能。管理器迁移见 [ADR 0012](docs/adr/0012-violentmonkey.md)，历史 Tampermonkey 验收保留原日期。

Firefox 后台连接、安装更新和截图工具属于开发与验收设施。产品改动围绕用户在 ChatGPT 中的实际操作展开，沿用原生交互和主题；开发设施服务于这些功能的可靠交付，并保持用户其他工作不受干扰。

项目运行环境统一为 Firefox / Firefox Nightly + Violentmonkey，基线见 [运行环境](docs/CONTEXT.md#项目运行环境)。后续安装、设置与更新按 Violentmonkey 工作流维护；Tampermonkey 文档用于历史追溯、兼容说明及旧数据切换。

## 开始任务

1. 阅读 [项目 context](docs/CONTEXT.md)，确认当前任务、已确认约束和未完成验收；版本及历史结果以该文档链接到的记录为准。
2. 检查 `git status --short`，保留已有改动。唯一活跃源码在本工作区；旧 D 盘 Junction 是兼容入口，迁移备份不是开发目录。
3. 按任务读取对应文档：

| 任务 | 必读入口 |
| --- | --- |
| 修改队列、页面适配器或持久化状态 | [架构](docs/architecture.md)、相关 [ADR](docs/adr/README.md)、[插件说明](userscripts/chatgpt-queue/README.md) |
| 修改 Obsidian 归档 | [归档 context](docs/obsidian-export/CONTEXT.md)、[已确认计划](docs/obsidian-export/plan.md) |
| 构建、依赖安装或验证 | [开发流程](docs/development.md)、仓库根 [自动化清单](../automation.json) |
| Firefox 连接、网页诊断或真实验收 | [Puppeteer skill](browser/firefox-puppeteer/SKILL.md)及其任务规范 |
| 安装、更新油猴脚本 | [后台更新工作流](browser/firefox-puppeteer/references/userscript-workflow.md) |
| 截图 | 已安装的 AgentCapture skill、[项目截图适配器](windows/background-window-capture/README.md) |

## 代码发现与修改

- 优先使用 codebase-memory-mcp：`search_graph` 定位符号，`trace_path` 查调用关系，`get_code_snippet` 读实现；复杂关系使用 `query_graph`。索引不存在或路径过期时先 `index_repository`。
- 插件索引为 `gpt-enhancement-queue`，浏览器索引为 `firefox-puppeteer`、`gpt-enhancement-native`。字符串、配置、非代码文档及图谱覆盖缺口可使用 `rg`。
- 查询第三方库/API 的用法、配置或兼容性时，通过 Context7 先 resolve-library-id，再按单一主题 query-docs；一般业务逻辑修改无需查询库文档。
- 插件实现位于 `userscripts/chatgpt-queue/src/`，修改源模块后运行构建。`chatgpt-queue.user.js` 是生成产物，不能仅编辑产物交付。
- 优先复用锁定依赖及成熟连接器。Puppeteer 负责协议；项目代码只承载目标选择、业务任务和证据采集。新增依赖按模块锁文件维护。

## 现有功能约束

- 队列复用 ChatGPT 原生输入框，Ctrl+Q 入队，自动 FIFO 调度；保留普通 Enter、Shift+Enter 和 IME 的既有语义。条目在匹配回执、开始运行时出队，下一条仍等待当前任务完成。
- 保存用户草稿，按模式和会话隔离队列；发送结果不明时记录可识别的错误与证据，核查回执后处理，不能盲目重发。Work/Codex 的工具运行与审批状态继续阻止提前发送。
- 队列存在时直接显示，快捷键提示持续显示。沿用原生输入框及现有精简交互，不重新加入独立输入框、运行/加入队列按钮或折叠菜单。
- 颜色跟随页面实际主题和 Accent color；会话全宽默认开启，开关位于脚本设置。视觉更改需同时考虑浅色、深色主题。
- Obsidian 保存对应的一问一答并保留原始正文。AI 仅建议标题、文件夹和标签；预览只编辑这些信息，不展示问答正文。连接单库 Local REST API，不增加独立产品后台服务；不可用时按既有页面通知机制报错。

## 不干扰用户的 Firefox 验证

使用用户已登录的原生 Firefox Nightly Remote Control，通过锁定的 Puppeteer Core 后台连接。以用户指定的完整 URL 和标题唯一定位标签，操作前复核页面身份；日常检查保留窗口、可见标签、剪贴板、草稿和队列。

禁止为测试激活窗口、切换可见标签、模拟系统键鼠、粘贴 Console、重启 Firefox 或改写 `navigator.webdriver`。结束时断开客户端，保留浏览器。原生权限确认由用户处理；协议拒绝访问的页面不能换通道绕过。

连接器或调试环境变更先汇报方案。连接失败时继续本地/API 检查并排查成熟连接器，不反复要求用户置前窗口。发送消息、点击业务按钮或写入 Obsidian 必须符合本次任务已授权的范围；只读检查不扩大该范围。

截图使用后台 AgentCapture 并实际查看结果。未选中的目标标签，不能用其他可见标签的窗口截图证明其显示效果。观察器采样不足或状态变化时记录 inconclusive，不自动恢复用户窗口来掩盖变化。

## 验证与安装更新

代码变更按 [开发流程](docs/development.md) 运行对应检查；交付前执行适用的统一验证：

```powershell
Set-Location -LiteralPath 'E:\firefox dev'
pwsh -NoProfile -File .\scripts\project.ps1 -Phase verify
```

核对退出码、报告及每个步骤结果。纯文档变更检查链接和路径即可，无需触发浏览器或重复业务测试。真实网页验收分别覆盖受影响的 Chat、Work、Codex 适配器；fixture 不能替代真实网页证据。

安装或更新任务进入 `browser/firefox-puppeteer`，按更新工作流执行 `npm run userscript:update`。它会测试、构建、保存版本并启动或复用本机更新源；保持脚本身份及用户配置，由油猴按自身周期检查更新。首次绑定由用户确认，不自动刷新已有聊天或热替换正在运行的队列。收尾说明服务运行状态、到期时间和停止方式。

分别记录本地发布、HTTP 下载、油猴管理页中的已安装且启用版本、指定页面运行版本、真实业务结果。只有对应证据成立，才报告该层验收通过；按钮存在不等于可见，点击不等于消息送达，下载不等于扩展安装成功。

## 文档、私有数据与交付

- 当前状态与待办写入 [CONTEXT](docs/CONTEXT.md)，架构决策写入 [ADR](docs/adr/README.md)，带日期的证据与未测边界写入对应模块 `VALIDATION.md`。操作命令集中维护在对应流程文档。
- 私有目标 URL、调试配置、截图、诊断与本机发布副本保存在仓库根 `.local/`；运行报告保存在忽略的输出目录。凭据不写入源码、日志、文档或 Git；遵循仓库根 [授权规范](../AGENTS.md)。
- 若任务新增托管的交互验证、登录、远程浏览器或管理入口，使用 owner-private ChatGPT Sites 与 Sites-managed OAuth；本项目本机 CLI/loopback 工具不因此改造成公共管理页面。
- 保留各模块许可证和上游来源。Git 提交只暂存本次任务相关文件；提交不等于授权推送。
- 最终说明改动、已完成检查及尚未验证的边界，并链接产物。任务中断时将续接入口和剩余工作写入项目文档，避免后续 Agent 从历史验收推定当前状态。
