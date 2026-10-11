# ADR 0009：Puppeteer 后台验收与 E 盘工作区

状态：已采纳。日期：2026-10-11。工作区路径取代 ADR 0007 中的旧本机路径，其单一源码与完整 Git 历史原则继续适用。

后续：[ADR 0010](0010-nightly-runtime-remote-control.md) 将首次接入具体化为 Nightly Remote Control 运行时入口，并记录真实后台只读验收。以下保留最初选择连接器时的背景。

## 背景

用户要求验证过程不干扰本地工作，优先使用高质量现有 BiDi 连接器，并确认 ChatGPT 插件项目与调试工具一起迁移至 `E:\firefox dev`。此前通过前台 Console 执行的历史验收不足以满足当前日常工作方式。

## 决策

完整工作区迁移到 `E:\firefox dev`，保留 Git 历史、当前未提交修改与忽略的私有资料。完成逐文件校验后，旧 D 盘路径保留为指向新根的 Junction；原数据保存为明确标记的迁移备份。此 Junction 提供旧路径兼容，不构成第二份活跃源码。

后台连接复用 `puppeteer-core` 的 WebDriver BiDi 实现。模块位于 `firefox-chatgpt-toolkit/browser/firefox-puppeteer`，仅维护目标核对和项目验收逻辑。直接使用 `connect`、页面 API 和 `disconnect`，不实现 WebSocket/BiDi 协议栈、不自动启动另一浏览器。

Selenium 和现有 Firefox MCP 的 attach 路径涉及 Marionette；Playwright 的 Firefox 依赖定制浏览器。Puppeteer 更贴合连接现有原生 Firefox 的要求。依赖固定版本，升级时重新核查能力和副作用。

后台截图继续使用 AgentCapture。任务规范以模块 [SKILL](../../browser/firefox-puppeteer/SKILL.md) 与 [任务规范](../../browser/firefox-puppeteer/references/task-rules.md) 为准。旧 native UIA/MCP 模块保留用于历史追溯和只读盘点，日常验收入口改为 Puppeteer。

## 验收边界

安装和迁移验收不等于真实页面通过。首次启用 Remote Agent 需要合适的 Firefox 启动条件，安装工具不自动授权重启浏览器。必须分别记录端口监听、BiDi 握手、后台行为、油猴安装状态和业务结果。

依据：[Puppeteer FAQ](https://pptr.dev/faq)、[连接配置](https://pptr.dev/api/puppeteer.connectoptions)、[Firefox 接入](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection)。
