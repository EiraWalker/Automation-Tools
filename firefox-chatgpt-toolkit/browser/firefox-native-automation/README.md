# Firefox 原生自动化

Windows 本地 CLI，复用正在运行的 Firefox。Windows PowerShell 5.1 和 PowerShell 7 均可使用；原生操作无需 npm 或远程调试端口。

## 窗口和标签页

```powershell
$cli = Join-Path $PWD 'scripts\firefox-native.ps1'
$inventory = & $cli -Action Inspect | ConvertFrom-Json
$inventory.windows | Select-Object hwnd, selectedTab, minimized
```

从结果选择真实的 HWND、当前选中标签名称及地址；下列变量由你填写，示例不自动选取第一个窗口：

```powershell
$hwnd = '<Inspect 返回的十六进制 HWND>'
$currentTab = '<当前选中标签的完整名称>'
$targetTab = '<要操作的标签完整名称>'
& $cli -Action SelectTab -Hwnd $hwnd -ExpectedTab $currentTab -TabName $targetTab
```

标签发现仅读取 Firefox 浏览器工具栏的 `tabbrowser-tabs`，避免把网页内的 TabItem 当成浏览器标签。

每次修改都先核对目标。标签、地址或前台窗口变化会中止操作。窗口被最小化时不会自动恢复。操作输入需要让指定 Firefox 窗口成为前台；只读 Inspect 不改变前台。

| Action | 额外参数 / 返回含义 |
| --- | --- |
| Inspect | 只读，所有 Firefox 窗口和标签 |
| SelectTab | `-TabName`，精确且唯一的标签名 |
| NewTab / CloseTab | CloseTab 必须指定 `-TabName`，没有关闭整个浏览器的操作 |
| Navigate | `-Url`，请求导航；另行确认实际文档 |
| Reload | 请求刷新；调用前保存草稿并确认没有待发队列/生成任务 |
| OpenConsole / CloseConsole | 原生 Web Console |
| ConsoleWrite | `-File` UTF-8；CodeMirror 使用 `-PasteConsole` 真实粘贴并恢复剪贴板；返回 `consoleSha256`，不执行；已有内容需明确 `-ReplaceConsole` |
| ConsoleExecute | `-ConsoleSha256`；只执行与写入时完全一致的内容 |
| ReadConsole | `-Sentinel`，只输出匹配该标记的结果 |
| SendKeys | `-Focus Chrome\|Console\|Editor -Keys`，Editor 名称可用 `-EditorName` 配置；仅接受唯一、非 Offscreen 的 Edit 控件 |
| Invoke | 唯一 `-AutomationId` 或 `-ElementName`，可用 `-ScopeId` 缩小范围 |

ReadConsole 与所有修改操作都需要 `-Hwnd -ExpectedTab`。`-ExpectedUrl` 可选，比较完整地址（仅兼容 Firefox 隐去 https://）；它不是文档 URL 的替代。地址栏被用户编辑后，应检查草稿，不自动修正。

当前 CodeMirror 原生路径使用生成器的 `--inline` 单行任务，详见 page-workflow；多行/连续空格的语法文本不能可靠还原时，哈希核验会拒绝执行。ConsoleExecute 在单行 Console 用 Enter；多行模式按原生 Run 按钮，要求其坐标位于屏幕且属于目标窗口。按钮名称可用 `-RunButtonName` 配置。本地化、Firefox UIA 标记或开发者工具布局变化可能需要适配。CLI 只报告 `executionRequested`、`save_requested` 等请求状态，不能据此断言执行成功。

## 页面代码、安装与调试

见 [page-workflow.md](references/page-workflow.md)。`prepare-page-task.mjs` 生成带标题、URL 和唯一输出标记的任务；支持一般 payload、Tampermonkey prepare/apply，以及原生草稿 backup/restore。需要 Node.js 22.13+，生成器本身没有第三方依赖。

## 可选 MCP

见 [mcp-bridge.md](references/mcp-bridge.md)。需要 `npm ci --ignore-scripts`，固定使用 SDK 1.29.0 与 Mozilla Firefox DevTools MCP 0.10.4。桥接只连接已有 Firefox；不会修改全局 MCP 注册、打开网页或启动浏览器。

## 测试

```powershell
npm ci --ignore-scripts
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\native-policy.ps1
```

可选 `-LiveReadOnly` 检查当前 Firefox 的只读发现和错误目标拒绝；不发送按键。Node 测试使用假 stdio MCP server 和 jsdom，不连接真实浏览器。真实网页证据见套件 VALIDATION.md。
