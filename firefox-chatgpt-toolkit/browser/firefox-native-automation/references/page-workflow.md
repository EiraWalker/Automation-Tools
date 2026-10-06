# Web Console 与 Tampermonkey

## 生成和执行

在实时 Inspect 中确认指定窗口与标签。在已有标签中读取 `document.title` 和 `location.href`；无法确认实际页面时仅执行无修改的识别代码，再为任务使用精确值。网站重定向或 SPA 路由改变后重新读取。

payload 文件是 async 函数体，最后返回简短 JSON 对象，例如：

```javascript
return { composerCount: document.querySelectorAll('#prompt-textarea').length };
```

以下命令在模块目录执行。`$pageTitle`、`$pageUrl`、`$hwnd`、`$tab` 由当前真实页面填写，`$taskDir` 使用仓库外的本地工作目录。每个任务文件名保持唯一：

```powershell
$taskDir = Join-Path $env:TEMP 'firefox-toolkit-tasks'
node scripts/prepare-page-task.mjs payload --inline --title $pageTitle --url $pageUrl --sentinel CHECK_COMPOSER_01 --file "$taskDir\inspect-body.js" --out "$taskDir\inspect-task.js"
$cli = Join-Path $PWD 'scripts\firefox-native.ps1'
$target = @{ Hwnd=$hwnd; ExpectedTab=$tab }
& $cli -Action OpenConsole @target
$written = & $cli -Action ConsoleWrite @target -File "$taskDir\inspect-task.js" -PasteConsole | ConvertFrom-Json
if (-not $written.ok) { throw $written.error }
& $cli -Action ConsoleExecute @target -ConsoleSha256 $written.consoleSha256
& $cli -Action ReadConsole @target -Sentinel CHECK_COMPOSER_01
```

ReadConsole 可能需等结果后再读；不要重新执行已经提交的修改任务。返回 `ok:true` 的标记才表示 payload 返回成功；还需核对业务结果。Console 输入和 Run 按钮不应由笼统全局快捷键操作。若 Firefox 的自粘贴保护阻止输入，由用户在实际 Console 完成原生提示；工具不会替用户关闭该保护。

当前 Firefox 的 CodeMirror 隐藏 textarea 可能一直返回空 Value。`-PasteConsole` 使用真实 Ctrl+V 更新编辑器，并保存和恢复剪贴板；若期间用户复制了其他内容，保留用户的新内容。工具从编辑器的实际语法文本读取代码，不把隐藏 textarea 的 SetValue 成功当作写入成功。

这条原生路径使用 `--inline` 单行任务。一般 payload 必须本来就是单行，生成器不会压缩任意代码；文件末尾换行会移除，避免行注释。userscript 与 draft 使用固定模板，可直接生成单行。读取语法文本遇到多行或连续空格时可能无法逐字节还原；哈希核验失败会停止执行。油猴源码以 UTF-8 Base64 数据嵌入并通过 TextDecoder 解码，不使用 eval 或 Function，避免 CSP 拦截，也保留源码中的连续空格和中文。CodeMirror 会规范化 CRLF，生成器将油猴源代码统一为 LF。

## 更新油猴脚本

初次安装可在 Tampermonkey 添加新脚本，粘贴完整 `.user.js` 并保存。或使用单文件下载器：

```powershell
node scripts/serve-userscript.mjs --file '<完整 .user.js 文件路径>' --port 8766
```

浏览器打开返回的 127.0.0.1 URL，再在原生 Tampermonkey 安装界面确认。服务器只提供指定文件的 GET/HEAD，没有目录索引、HTML 页面或身份验证流程；Ctrl+C 关闭它。

自动更新已存在的编辑器时：在实际 Tampermonkey 编辑页确认 URL、标题、脚本 namespace、保存控件 id。使用唯一 .CodeMirror 实例；生成器不依赖固定扩展 UUID，也不查询或导出扩展存储。

```powershell
node scripts/prepare-page-task.mjs userscript --inline --mode prepare --file $sourceFile --namespace $namespace --save-id $saveId --title $editorTitle --url $editorUrl --sentinel CHECK_PREPARE_01 --out "$taskDir\prepare.js"
# 用上述 ConsoleWrite / ConsoleExecute / ReadConsole 执行并检查 prepared
node scripts/prepare-page-task.mjs userscript --inline --mode apply --file $sourceFile --namespace $namespace --save-id $saveId --title $editorTitle --url $editorUrl --sentinel CHECK_APPLY_01 --out "$taskDir\apply.js"
# 单独执行；apply 拒绝写入后被修改的源代码
```

prepare 在编辑页 sessionStorage 留存旧代码备份，尚未保存；apply 请求点击保存，但返回 `installedVerified:false`。检查 Tampermonkey Dashboard 的已安装版本、脚本启用状态、`@match` 和 User excludes；安装完成后刷新相关网站标签，再验证真实 DOM。若出现 Userscript modification 冲突，先核对其他编辑页和已安装版本，不盲目覆盖。备份在成功确认后由调用方按已知 key 清理，或关闭该编辑标签。

## 草稿

```powershell
node scripts/prepare-page-task.mjs draft --inline --mode backup --selector '#prompt-textarea' --title $pageTitle --url $pageUrl --sentinel CHECK_BACKUP_01 --out "$taskDir\backup.js"
node scripts/prepare-page-task.mjs draft --inline --mode restore --selector '#prompt-textarea' --busy-selector '[data-testid="stop-button"]' --title $pageTitle --url $pageUrl --sentinel CHECK_RESTORE_01 --out "$taskDir\restore.js"
```

backup 只在当前文档 sessionStorage 保存内容，标记结果仅包含长度；重复备份不会覆盖原备份。restore 在页面繁忙或已有不同草稿时拒绝写入，验证读回一致才删除备份。contenteditable 使用原生 insertText；文本框使用原生 setter 和 input 事件。编辑器的可见性、busy selector 与业务状态应在具体页面确认，这个工具不推断所有网站的排队状态。sessionStorage 不是加密存储，也无法恢复已关闭标签。
