# Nightly 扩展页调试权限

用户于 2026-10-11 明确授权配置对 `moz-extension://` 页面的访问。当前 Nightly 160.0a1 的 Remote Agent 在构造时读取 `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`；已运行的进程不会因为稍后更改环境变量而获得权限。Mozilla 的 [Remote Agent 安全文档](https://firefox-source-docs.mozilla.org/remote/Security.html#system-access)规定在启动 Firefox 时设置此变量。

项目准备了 [启动脚本](../scripts/start-nightly-system-access.ps1)，仅给将要启动的 Nightly 进程设置变量，不修改 Windows 用户/系统环境变量，不修改普通 Firefox、浏览器 profile 或现有调试端口。启动脚本发现 Nightly 仍在运行时会拒绝另起一个进程，避免命令被已有浏览器接收而误判已经授权。

当前已登录 Nightly 正在运行，不能在不结束该进程的情况下应用此授权。用户完成当前工作、正常退出全部 Nightly 窗口后，在 PowerShell 7 执行：

```powershell
pwsh -NoProfile -File 'E:\firefox dev\firefox-chatgpt-toolkit\browser\firefox-puppeteer\scripts\start-nightly-system-access.ps1'
```

该入口打开可见、可交互的 Nightly，继续使用原有登录配置。然后在 Nightly 原生 Remote Control 面板开启连接；工具用原有 `doctor` 核对 PID、路径和 loopback 端口，再以一个自有后台标签尝试读取油猴 `moz-extension://` 页面。只有实际导航及读取成功，才记录为“系统访问已生效”。该权限会赋予 BiDi/Marionette 客户端更高的浏览器及宿主访问能力，连接继续限定本机端口，任务只访问油猴安装所需页面。

当前版本可无副作用检查就绪状态：

```powershell
pwsh -NoProfile -File 'E:\firefox dev\firefox-chatgpt-toolkit\browser\firefox-puppeteer\scripts\start-nightly-system-access.ps1' -Check
```

`-Check` 中的 `running: true` 表示应等待用户正常退出；不代表当前进程已授权。未来不需要系统访问时按普通方式启动 Nightly 即可恢复默认限制。

首次安装的完成条件仍是油猴管理页中出现已启用的 `ChatGPT Queue · Accent` 和发布版本。`userscript:update` 只准备脚本及更新源；HTTP GET 不证明安装。安装后再于用户允许的页面自然加载时检查运行标记，保持已有聊天、草稿与队列。
