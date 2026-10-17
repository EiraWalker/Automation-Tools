# ADR 0010：Nightly Remote Control 运行时接入

状态：已采纳。日期：2026-10-11。补充 [ADR 0009](0009-puppeteer-background-validation.md) 的连接启动方式，保留 Puppeteer 与既有工作区。

## 背景

用户报告仅用 `--remote-debugging-port` 启动 Firefox、尚未连接 Puppeteer，就遇到 Cloudflare 拒绝。Mozilla 的命令行启动路径声明浏览器自动化状态；更换客户端并不能消除该状态。用户随后安装 Firefox Nightly、登录 ChatGPT 并开启原生 Remote Control。

## 决策

使用 Nightly 官方面板启动运行时调试服务，通过锁定的 Puppeteer Core 连接 BiDi。Mozilla 的运行时入口使用 `isBrowserAutomation: false`。保留浏览器原生确认，由用户允许连接；不改写页面的 navigator.webdriver。连接前核对 loopback 端口、实际可执行文件、启动参数，连接后检查页面值。

任务通过 PowerShell 7 的隐藏子进程观察前台窗口、目标浏览器各窗口的标签选择、尺寸和剪贴板序号。任务退出时只断开连接，保留浏览器。窗口观察与页面检查分别留存证据，出现变化只判定本次证据不足，不推断工具必然造成变化。

## 结果与边界

Nightly 160.0a1 + Puppeteer Core 25.13.0 已在用户指定的后台 ChatGPT 标签通过只读验收：webdriver 为 false，原生 getter 存在，草稿指纹不变，窗口/剪贴板采样不变，断开后进程仍运行。详细范围见 [工具验收记录](https://github.com/EiraWalker/Automation-Tools/blob/legacy/firefox-automation-20261017/firefox-chatgpt-toolkit/browser/firefox-puppeteer/VALIDATION.md)。

已加载的 ChatGPT 页面可读取，不证明未来所有 Cloudflare 挑战会通过。未刷新、发送消息或安装用户脚本。本方案依赖 Nightly 实验功能；升级后重新执行 environment。背景输入、真实按钮点击和截图需要分别验收。

依据：[Mozilla Remote Agent](https://github.com/mozilla-firefox/firefox/blob/main/remote/components/RemoteAgent.sys.mjs)、[运行时面板](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/remotecontrol/RemoteControlPanel.sys.mjs)、[Puppeteer connect](https://pptr.dev/api/puppeteer.connectoptions)。本次还读取了本机 Nightly 安装包中的模块，确认其实际运行时实现。
