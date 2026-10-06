# 后台窗口截图

Python 标准库适配器，调用 [EiraWalker/AgentCapture](https://github.com/EiraWalker/AgentCapture) 的原生 WGC / PrintWindow 截图工具；不会把截图窗口切到前台。适配器与配套 skill 沿用 AgentCapture 的 MIT 许可，原版权声明保留在 LICENSE 中。

`scripts/invoke.py` 与上游 [7cbfc7e 的适配器](https://github.com/EiraWalker/AgentCapture/blob/7cbfc7edad23d8d402be85162fb9c9c20d192e91/skills/agentcapture/scripts/invoke.py) 内容一致（忽略换行编码）。本目录不包含 AgentCapture 可执行程序。

## 安装

Python 3.10+；Windows 10 2004 / Windows 11 x64。AgentCapture 1.0.0 当前部署需要 .NET 10 Desktop Runtime，可用 .NET 10 SDK 在上游运行 build.ps1。部署时保留完整 bin/win-x64 目录，只有 EXE 不足以运行。具体版本需求以取得的上游版本为准。

在本模块目录设置真实安装路径，或每次通过 `--tool` 指定：

```powershell
$env:AGENTCAPTURE_EXE = 'C:\Tools\AgentCapture\AgentCapture.exe'
python -X utf8 scripts/invoke.py version
python -X utf8 scripts/invoke.py list --title 'Firefox'
python -X utf8 scripts/invoke.py capture --hwnd 0x123456 --method wgc --output 'C:\Temp\firefox.png'
```

最后一条命令的 HWND 必须替换为刚读取的实际值。可使用 `list --pid <PID>` 缩小范围。路径解析顺序：`--tool` → `AGENTCAPTURE_EXE` → 本模块的 config.local.json `executable` 字段 → PATH → 上游开发目录的 bin/win-x64。个人配置不进入 Git。

WGC 支持被其他窗口遮挡的可见窗口，窗口被最小化时拒绝；PrintWindow 可尝试兼容路径，但成功编码不保证截图新鲜、完整。`--method auto` 共用超时预算，返回实际使用的方法。方法不会自动恢复窗口、移动窗口或复制全屏。

读取 JSON 的 `ok`、`output`、`image`、`foreground`、`warnings`，然后查看图片；截图不能代替 DOM 或发送完成验证。字段详见 [protocol.md](references/protocol.md)。适配器不提供输入注入或浏览器控制。

测试：`python -m unittest discover -s tests -v`。它使用假的子进程响应验证适配器，不产生真实网页截图。
