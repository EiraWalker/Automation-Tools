# ChatGPT Queue · Accent

Firefox + Tampermonkey 的单文件油猴脚本。当前版本 1.5.4。

## 安装

1. 在 Firefox 中启用 Tampermonkey。
2. 点击 Tampermonkey → 添加新脚本。
3. 删除编辑器模板，把同目录 `chatgpt-queue.user.js` 的完整内容粘贴进去，按 Ctrl+S 保存。
4. 安装、更新或修改排除规则后，把已经打开的每个 ChatGPT 标签页各刷新一次（先保存未发送草稿）。有待发送消息时，队列直接显示在原生输入框上方；空队列仍显示 `Ctrl + Enter  Enqueue` 快捷键提示。随后在该标签页内切换聊天无需逐个刷新。

如果面板没有出现，打开本脚本的 Settings → User excludes，确认没有排除 `chatgpt.com`；脚本开关开启不代表被排除的网站也会运行。脚本匹配整个 `https://chatgpt.com/*`，没有限定验收聊天。

不需要 Node.js、API Key、本地服务或 Firefox DevTools MCP 来日常使用。
不支持 Greasemonkey 的仅异步 GM API；本版本以 Tampermonkey 为目标。

## 使用

- 直接使用 ChatGPT 原生输入框：空闲且没有待发条目时，Enter 保持原生发送；回答进行中或已有待发条目时，Enter 将消息加入队列。
- Ctrl+Enter（macOS 为 Cmd+Enter）随时入队。入队后清空原生输入框，自动等待当前回答完成并逐条发送，没有加入队列或运行队列按钮。
- Shift+Enter 保留换行，输入法正在选词的 Enter 不入队。只接收文字，不转移附件。
- 点击条目的“编辑”，在原生输入框修改，用 Enter、Ctrl+Enter 或“保存修改”更新原条目，位置保持。编辑期间暂停发送；保存后自动接续。“取消编辑”保留原条目和输入框中的文字，原本运行中的队列恢复等待。
- 有消息时直接显示队列，可编辑、调整顺序或删除条目；空队列隐藏列表与操作按钮，`Ctrl + Enter  Enqueue` 快捷键提示始终显示。没有加入队列按钮、折叠菜单、运行按钮或状态文本，队列不创建消息文本框。
- Esc 或 ChatGPT 的停止生成按钮暂停队列。再次入队会接续；原生输入框为空时按 Ctrl+Enter 可继续现有待发队列。
- 原生输入框有草稿时等待，不覆盖你的内容。每个会话保存独立队列；刷新或返回后待发队列默认暂停，用空输入框 Ctrl+Enter 接续。
- 会话全宽默认开启。点击 Firefox 工具栏 Tampermonkey → ChatGPT Queue · Accent 下的“设置”，在脚本设置面板勾选/取消“会话全宽”；修改立即保存并生效，刷新和切换聊天后保留。聊天页面没有全宽按钮。配置面板直接读取 ChatGPT 页面的实际背景、文字、字体和明暗模式；边框和控件跟随当前主题，按钮与复选框使用当前 Accent color。

新聊天先通过原生 Enter 发送首条消息、取得会话 ID；随后生成回答时即可直接排队。首次建立会话前用 Ctrl+Enter 放入的队列会迁入新会话，在原生输入框为空时按 Ctrl+Enter 接续。没有跨会话自动调度。

## Accent color

队列的主按钮、编号、焦点边框和高亮使用当前页面的主题值：

1. 当前新版的 `--color-background-composer-primary` 与 `--color-text-composer-primary`；
2. 旧版的 `--theme-submit-btn-bg`、`--theme-submit-btn-text`、`--interactive-bg-accent-default` / `--text-accent`；
3. 主题变量不存在时，取原生发送按钮的实际背景色和文字色。

主题值继承到 Shadow DOM，并定期重新采样，不读账号设置、不映射硬编码颜色名称。
如果 ChatGPT 某个页面版本不提供任何可识别的主题值和发送按钮，使用中性灰；不会使用固定橙色。
2026-10-06 已在原生 Firefox 的已登录 ChatGPT 验证：当前有效颜色为 `#7849d1`，队列按钮与页面一致；临时改变页面主题变量后也会同步，并在还原后恢复。该换色测试没有修改账号的主题设置。

## 会话全宽

默认开启，配置入口为油猴菜单中 ChatGPT Queue · Accent 下的“设置”。这是本脚本的配置面板；Tampermonkey Dashboard 的通用 Settings 页不提供本脚本自定义选项。已有明确保存的关闭设置会保留。

使用当前页面的 `--thread-content-*`、`--thread-body-max-width` 和 `--composer-adjacent-max-width` 宽度变量，将上限改为会话容器的 100%。保留原生边距与侧栏空间，不把整个浏览器的 `100vw` 强塞进聊天区。

作用域优先限定在当前输入框所属的 `[data-request-input-activity-root]`，首页使用 `main` / `[role="main"]`。只添加自己的属性与样式规则；关闭时移除属性，不改写原生内联样式。CSS 百分比会随窗口和侧栏的尺寸重新计算；页面切换后重新定位作用域。

参考 [KeepChatGPT](https://github.com/xcanwin/KeepChatGPT) 的扩展布局思路，独立实现。没有沿用其 `main#main`、`section.text-token-text-primary` 或 `#thread-bottom` 旧选择器，也没有复制其 GPL-2.0 代码。

真实网页测量：会话容器 1130px 时，消息区 808 → 1130px，队列与输入框 768 → 1090px（左右保留 20px 原生边距）；关闭后精确恢复。

## 恢复与限制

- 发送前保存状态。点击后无法确认接收时停止，保留该条并提供“已发送，移出”/“未发送，退回”。请核对聊天记录再选择；网页操作无法保证服务端严格 exactly-once。
- 同一会话只能由一个标签页管理，使用浏览器 Web Locks；第二个标签页只读。关闭拥有者标签页后刷新另一页接管。
- 页面关闭、被丢弃或电脑休眠时不会继续发送。后台标签可能受 Firefox 调度节流。
- 使用当前网页所选模型；不为各条消息自动切换模型。
- 不支持附件队列、语音、Deep Research、图片生成、账号间队列迁移。
- 排队期间修改历史消息、切分支或手动发送其他消息会暂停；请核对上下文再继续。
- 队列文字保存在 Tampermonkey 本地存储，不上传第三方、不调用 ChatGPT 私有接口。不要把它当成加密存储。
- 适配当前 `[data-chatgpt-composer] .ProseMirror[role="textbox"]` 与消息搜索单元的语义标记，同时兼容旧版 `#prompt-textarea`。ChatGPT 再次改版后若识别失败会等待或暂停，需要更新 `src/browser.js` 中的 adapter。
- 某些登录前页面使用不同输入框，不属于已经确认支持的界面。

## 源码与构建

```text
chatgpt-queue.user.js  直接安装的完整脚本
src/core.cjs          队列状态机与持久化边界
src/browser.js        ChatGPT 页面适配、队列 UI、跨标签互斥
src/queue.css         跟随 Accent color 的样式
tests/               状态机与 DOM 适配测试
build.cjs            无依赖构建器
LICENSE              GPL v3 全文
THIRD_PARTY_NOTICES.md  上游参考与许可证说明
```

重建不需要安装依赖：`node build.cjs`。
开发测试：使用 Node.js 22.13+，执行 `npm install`，然后 `npm test` 与 `npm run check`。

UI 参考 [kgruiz/chatgpt-queue](https://github.com/kgruiz/chatgpt-queue)，本项目以 GPL-3.0-or-later 提供完整源码。

## 验证边界

详见 `VALIDATION.md`。1.5.4 已在真实非空队列确认加入队列按钮不存在，快捷键提示可见，37 项测试通过。1.5.3 已确认配置背景与当前网页完全一致，均为 #0e0e0e，文字对比度 16.49:1。1.5.2 已在真实 ChatGPT 夜间模式确认配置面板深色背景、文字对比度 13.75:1 与当前 Accent color，37 项测试通过。1.5.1 已在用户原生 Firefox 的真实 ChatGPT 确认空队列时快捷键提示持续可见、列表与按钮隐藏，并通过 37 项测试。1.5.0 已验证：油猴设置入口、全宽保存与立即切换、有消息时直接显示队列、空队列隐藏、回答中原生 Enter 入队和两条自动接续发送。37 项自动测试通过，原草稿恢复，临时调试界面已关闭。
