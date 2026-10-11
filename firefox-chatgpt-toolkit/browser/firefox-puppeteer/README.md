# Firefox Puppeteer 后台验收

活跃工作区：`E:\firefox dev`。连接器采用锁文件中的 `puppeteer-core`，连接用户已登录的 Firefox Nightly Remote Control。协议通信交由 Puppeteer；Windows 观察器仅核对进程和记录桌面状态。需要 Node.js >=22.12 与 PATH 中的 PowerShell 7 (`pwsh.exe`)。

## 使用

项目脚本运行于 Firefox / Firefox Nightly 的 Violentmonkey，环境基线见 [项目 context](../../docs/CONTEXT.md#项目运行环境)。安装与更新见 [后台更新工作流](references/userscript-workflow.md)：`npm run userscript:update` 自动构建、测试并启动本机更新源；首次绑定由用户确认，后续交给 Violentmonkey 原生更新机制。此命令不连接或刷新浏览器。`npm run userscript:status` 查看服务状态，`npm run userscript:stop` 停止自有服务。

Nightly 的 `moz-extension://` 页面访问权限见 [受控启动入口](references/system-access.md)。此权限必须在 Nightly 进程启动时设置；现有进程不被重新配置或自动重启。

从本目录执行 `npm ci --ignore-scripts` 安装锁定依赖。项目 `.npmrc` 使用官方 registry，不更改全局 npm 配置，不下载浏览器。

```powershell
Set-Location -LiteralPath 'E:\firefox dev\firefox-chatgpt-toolkit\browser\firefox-puppeteer'
npm test
npm run doctor
npm run environment
npm run inspect
```

`doctor` 核对端口监听者、可执行文件路径、loopback 绑定与启动参数，不连接页面。检查失败退出 2；检查通过仍不代表 BiDi 握手成功。

`environment` 在指定页面检查原生 webdriver getter、实际值、输入框存在性、页面显隐、尺寸和草稿指纹。连接前启动 Windows 只读观察器，断开后检查浏览器进程仍运行。`inspect` 使用同样的连接保护，采集归档图标的颜色、尺寸、禁用和祖先显隐状态。图标数为零也会输出，检查成功不代表插件已安装。

命令默认读取项目根的 `.local/firefox-connection.json`。首次配置参考 [connection.example.json](connection.example.json)，填写实际 Nightly 可执行文件路径和用户指定标签的完整 URL、精确标题。重复 URL、标题变化或页内导航校验失败均停止。可用 `--config` 指定另一份本地配置。

每次连接的结果保存在 `.local/firefox-runs/<UTC timestamp>-<command>.json`，包括窗口采样和失败代码；终端不输出会话 URL、问答正文或凭据。草稿只保留长度及 SHA-256，不记录正文。结果 `passed` 表示本次只读采样通过；窗口/剪贴板变化或采样不完整标记 `inconclusive` 并退出 2，不能据此认定变化一定由工具引起。业务操作与视觉效果独立验收。

## 首次接入与日常连接

1. 正常启动并登录原生 Firefox Nightly。打开 `about:config`，将 `remote.experimental.dynamicstart.enabled` 设为 `true`。
2. 在工具栏的 Remote Control 面板开启连接。这个操作使用 Mozilla 的运行时入口，不需要重启或命令行自动化参数。
3. 运行 `doctor`，确认监听进程属于配置中的 Nightly。首次连接若出现 Firefox 原生确认，由用户允许；用户可选择记住本次浏览器运行期间的决定。工具保留该确认机制，不自动点击或修改确认偏好。
4. 运行 `environment`。任务只在 `navigator.webdriver === false` 时继续。通过后再运行具体检查。关闭和重新打开浏览器后重新核查 Remote Control 状态及原生确认。

命令行 `--remote-debugging-port` / `--marionette` 启动的进程会被任务入口拒绝。Nightly 面板可能同时启动 BiDi 和 Marionette；本模块只连接 BiDi，不关闭面板管理的其他服务。`navigator.webdriver` 不通过页面注入改写。

Windows 观察器通过 PowerShell 7 子进程以隐藏窗口方式运行，仅调用读取 API。实际采样间隔受 UI Automation 耗时影响，报告保留每次时间；采样不能证明两个样本之间绝无短暂变化。Native 连接确认属于首次设置的人机交互，若在一次观察期间出现，结果可能为 `inconclusive`。

日常任务先读 [SKILL.md](SKILL.md) 和 [任务规范](references/task-rules.md)。所有新增操作复用 Puppeteer 的公开 API；结束调用 `disconnect()`。截图继续使用用户指定的 AgentCapture skill。

## 验证范围

`npm test` 验证任务范围、导航竞争和失败清理，不是真实浏览器证明。插件本地回归仍由根目录 `scripts/project.ps1 -Phase verify` 执行。Violentmonkey 中已安装的脚本版本、图标实际可见性与消息发送必须另行记录真实页面结果。

Puppeteer 的 `page.evaluate()` 支持页面上下文读取；BiDi 并不支持所有 CDP 功能，扩展 realm、完整网络响应读取等能力不得据 API 名称推定可用。Violentmonkey 安装验收需核对扩展中保存的脚本版本和真实页面，临时注入不等于安装。已加载页面正常不等于新的 Cloudflare 挑战一定通过；运行时的错误值和网页访问结果分别记录。当前实测见 [VALIDATION.md](VALIDATION.md)。

常见错误：`F_ENDPOINT_UNAVAILABLE` 表示尚未监听；`F_BROWSER_EXECUTABLE_MISMATCH` 表示端口属于另一安装；`F_AUTOMATION_STARTUP` 表示仍使用命令行自动化参数；`F_AUTOMATION_MODE` 表示页面值不是 false；`F_TARGET_NOT_UNIQUE` / `F_TARGET_CHANGED` 表示目标不明确或发生导航；`F_WINDOWS_OBSERVER_FAILED` 表示桌面证据不完整。先排查具体阶段，保持原生浏览器和已有标签。

依据：[Puppeteer](https://github.com/puppeteer/puppeteer)、[BiDi 支持范围](https://pptr.dev/webdriver-bidi)、[连接配置](https://pptr.dev/api/puppeteer.connectoptions)、[断开连接](https://pptr.dev/api/puppeteer.browser.disconnect)、[Firefox BiDi 接入](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection)。
