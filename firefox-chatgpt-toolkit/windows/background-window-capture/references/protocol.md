# AgentCapture 1.0.0 协议

运行适配器 `help` 可读取安装版本的实际参数。

- `list [--pid PID] [--title TEXT] [--include-hidden]`
- `capture (--hwnd HWND | --pid PID) --output FILE.png [--method wgc|printwindow|auto] [--timeout-ms 8000] [--overwrite] [--printwindow-flags 0|2]`
- `version`

每次返回一个 UTF-8 JSON 对象。适配器使用 shell=False、隐藏控制台、透传有效 envelope 与退出码。原生默认 method=wgc，timeoutMs=8000，foregroundActivation=false，restoreMinimized=false。

成功截图字段：`schemaVersion`、`ok`、`requestedMethod`、`method`、`output`、`target`、`image`、`foreground`、`warnings`、`attempts`、`elapsedMs`。

`target` 含 HWND/PID、标题、窗口边界及状态。`image` 含尺寸、PNG SHA-256、contentVerified:false 和新鲜度提示。`foreground` 含前后台窗口记录与 targetActivationRequested:false。前台事件可能来自用户并发操作，不单凭该字段推断因果。

错误包含 `ok:false` 和 `error.code/message/exitCode`。退出码 0 成功，2 参数/目标不明确/输出已存在，3 截图或状态失败，4 超时，5 运行时错误。适配器没有找到程序、响应格式异常或外层超时也返回相同风格 envelope。

ambiguous_window 应重新选择唯一 HWND；invalid_window/window_changed 应刷新发现结果；window_resized/window_state_changed 可在状态稳定后尝试一次。window_not_capturable 不通过自动恢复窗口解决。PrintWindow 成功可能只有图标或旧画面；blank_frame 也可能是全黑场景，需要查看背景事实。重复相同错误时停止，避免无效循环。

上游工具有 40 megapixel 限制；WGC 保留系统捕获边框、排除鼠标，不打开选择器。auto 不回退到前台截图或屏幕复制。只在成功返回并人工/模型查看 PNG 后报告可见内容。
