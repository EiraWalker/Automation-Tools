---
name: firefox-puppeteer
description: 使用 Puppeteer Core 连接已登录的 Firefox Nightly Remote Control；用于后台页面诊断、webdriver 状态检查、ChatGPT Violentmonkey 脚本验收和连接故障排查。
---

# Firefox 后台任务

工作区为 `E:\firefox dev`，模块脚本相对本文件解析。开始真实页面任务前读取 [任务规范](references/task-rules.md)，安装、连接配置或错误码参见 [README](README.md)。

安装/更新 ChatGPT Queue 的 Violentmonkey 脚本时读取 [安装更新工作流](references/userscript-workflow.md)。使用 `npm run userscript:update` 构建、测试并提供本机更新源；当前未授权的浏览器进程不操作扩展页或 profile，也不刷新聊天。发布成功、文件被下载、扩展已安装、页面运行新版是独立结论。该命令会启动或复用最长运行 24 小时的隐藏 Node 更新源；收尾报告其状态与停止命令。

用户已授权 `moz-extension://` 调试时，读取 [系统访问入口](references/system-access.md)。Firefox 仅在 Nightly 启动时读取授权变量；先检查当前进程，再等待用户正常退出并通过专用入口启动。连接后实际验证权限及 Violentmonkey 管理页；下载日志和用户打开链接都不能替代已安装脚本的管理页证据。

1. 读取项目 `CONTEXT.md`，核对任务授权的完整 URL 和标签标题；将私有目标写入根目录 `.local/firefox-connection.json`。目标不明时先做本地检查。
2. 在模块目录运行 `npm run doctor`。核对配置中的可执行文件与实际监听进程；采用 README 中的 Nightly Remote Control 运行时入口。首次接入方案先汇报，原生确认由用户操作。未监听时继续独立工作，保留首次接入待办。
3. 首次接入、Nightly/连接器升级或发现网页访问异常时运行 `npm run environment`，要求 webdriver 为 false 且桌面、草稿采样未变化。日常运行 `npm run inspect`，查看 `.local/firefox-runs/` 本次报告；`inconclusive` 与失败都不能记为验收通过。
4. 对其他已授权任务，沿用 CLI 的进程核对、观察器及 `scripts/session.mjs` 的 `withExistingPage`，在任务内再次校验实际文档。新增操作分别验证后台行为；本模块只读通过不授权点击、输入或刷新。任何不确定的发送先查回执，不重放。
5. 截图调用已安装的 AgentCapture skill，保持窗口状态并查看图片内容。窗口截图只证明当前显示的标签；页面 DOM 结果不能替代像素证据。
6. 完成时记录安装版本、实际断言、运行结果和未测边界。真实浏览器证据写入私有 `.local/`，脱敏结论写入项目 `VALIDATION.md`；本地测试不冒充真实页面通过。

协议连接和等待机制归 Puppeteer 维护。优先使用它的公开 API，缺失能力先核查官方支持范围。停止或失败时断开客户端，保留原生 Firefox。
