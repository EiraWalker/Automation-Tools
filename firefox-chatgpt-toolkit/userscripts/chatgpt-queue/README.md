# ChatGPT Queue · Accent

Firefox / Firefox Nightly + Violentmonkey 的单文件用户脚本。源码版本 1.9.0，项目运行环境基线为 Violentmonkey 2.49.0；当前本机发布及 Nightly 已安装版本为 1.9.0.3。支持 ChatGPT Chat、Work，以及当前 Codex Cloud 的 `/local/*` 会话页面，并可将对应问答保存到 Obsidian。环境定义、安装与真实验收状态见 [项目 context](../../docs/CONTEXT.md#项目运行环境)，历史 Tampermonkey 证据保留原日期。

## 安装

两个浏览器的安装与后续更新参见 [后台安装与更新工作流](../../browser/firefox-puppeteer/references/userscript-workflow.md)。本机下载成功不代表脚本已安装，需要分别核对 Violentmonkey 管理页中的已启用版本、持久保存和目标页面运行版本。当前聊天不自动刷新，新脚本在下次正常加载时生效。以下为不使用开发更新源时的手动安装方法。

1. 在需要使用的 Firefox 或 Firefox Nightly 中安装并启用 [Violentmonkey](https://violentmonkey.github.io/get-it/)，完成浏览器的原生安装确认。
2. 打开 Violentmonkey 管理页，创建新脚本。
3. 删除编辑器模板，把同目录 `chatgpt-queue.user.js` 的完整内容粘贴进去，通过编辑器保存操作完成安装，核对脚本名称、版本和启用状态。该公共构建的更新地址为 `none`；需要本机自动更新时，按更新工作流安装带本机地址的发布副本。
4. 安装、更新或修改排除规则后，新代码会在页面下次加载时生效。等当前生成/队列结束并保留草稿后，由你在方便时刷新需要使用的标签；开发工具不会代为刷新。有待发送消息时，队列直接显示在原生输入框上方；空队列仍显示 `Ctrl + Q  Enqueue` 快捷键提示。随后在该标签页内切换聊天无需逐个刷新。

如果面板没有出现，在 Violentmonkey 中核对扩展及脚本开关、站点访问权限和该脚本的排除规则，确认没有排除 `chatgpt.com`。脚本匹配整个 `https://chatgpt.com/*`，没有限定验收聊天。保留脚本声明的 `@inject-into page`；原生输入框适配需要访问页面的编辑器对象，不能将 `content` 模式视为等价替代。页面 CSP 或扩展注入限制需要记录并诊断，不能由本地测试推定注入成功。

使用队列和全宽不需要 Node.js、API key、本地服务或 Firefox DevTools MCP。Obsidian 归档需要目标库的 Local REST API 插件和 OpenAI 兼容分类服务。
脚本继续使用同步 `GM_getValue` / `GM_setValue` 等接口，不支持 Greasemonkey 的仅异步 GM API。当前标准运行环境为 Violentmonkey；Tampermonkey 的兼容元数据及既有存储键继续保留，未重新验收的平台不能据此宣称通过。

### 从 Tampermonkey 切换

两个扩展的脚本存储相互独立。相同的名称、namespace 和 GM 键不会自动带来旧配置、队列或归档映射；安装脚本源码也不包含这些数据。

1. 在旧脚本中处理完待发队列及当前回答，保留原生草稿；不要迁移仍在发送或等待确认的 active 状态。
2. 切换前只停用 Tampermonkey 中的 **ChatGPT Queue · Accent**，保留旧脚本和数据作为回退依据。停用扩展中的脚本不保证已打开页面上的实例立即退出；等安全时正常重新加载这些页面，再运行 Violentmonkey 版本。两个管理器不要同时启用本脚本。
3. 在 Violentmonkey 安装 1.9.0 或对应本机发布副本，重新设置全宽偏好和归档连接参数。API key 通过脚本设置输入，不写入明文导出文件、日志或 Git。已有加密备份继续保留。
4. 旧归档路径映射需要单独迁移并校验。本版本没有跨管理器数据迁移工具，也未验收 Tampermonkey ZIP 中脚本值的完整导入；未迁移映射前，不把旧回答的覆盖和旧路径清理视为已延续。原有笔记保留在 Obsidian 中。
5. 分别核对 Firefox 与 Nightly 的持久安装、页面运行版本、输入框写入、跨标签所有权、队列恢复和归档。详细验收边界见 [VALIDATION](VALIDATION.md)；脚本代码迁移完成不等同这些运行验收已通过。

切换决策与执行环境边界见 [ADR 0012](../../docs/adr/0012-violentmonkey.md)。

## 使用

三种模式均复用当前页面的原生输入框。Work 等待当前任务的完成状态；工具运行、等待批准或等待补充输入期间不会发送下一条。需要操作的批准仍由你在原生页面处理。Codex Cloud 使用其原生后续修改输入框，并识别独立的用户消息回执与最终回答。

- 直接使用 ChatGPT 原生输入框：空闲且没有待发条目时，Enter 保持原生发送；回答进行中或已有待发条目时，Enter 将消息加入队列。
- 排队 prompt 在网页确认接收、开始运行时立即从队列移出。队列只显示尚未发送的消息；当前回合单独记录，仍然等回答完成后才发送下一条。最后一条开始运行时列表立即隐藏，快捷键提示继续显示。
- Ctrl+Q 随时入队。入队后清空原生输入框，自动等待当前回答完成并逐条发送，没有加入队列或运行队列按钮。
- Shift+Enter 保留换行，输入法正在选词的 Enter 不入队。只接收文字，不转移附件。
- 点击条目的“编辑”，在原生输入框修改，用 Enter、Ctrl+Q 或“保存修改”更新原条目，位置保持。编辑期间暂停发送；保存后自动接续。“取消编辑”保留原条目和输入框中的文字，原本运行中的队列恢复等待。
- 有待发送消息时直接显示队列，可编辑、调整顺序或删除条目；空队列隐藏列表与操作按钮，`Ctrl + Q  Enqueue` 快捷键提示始终显示。没有加入队列按钮、折叠菜单、运行按钮或状态文本，队列不创建消息文本框。
- Esc 或 ChatGPT 的停止生成按钮暂停队列。再次入队会接续；原生输入框为空时按 Ctrl+Q 可继续现有待发队列。
- 原生输入框有草稿时等待，不覆盖你的内容。每个模式和会话保存独立队列；刷新或返回后待发队列默认暂停，用空输入框 Ctrl+Q 接续。
- 会话全宽默认开启。点击 Firefox 工具栏 Violentmonkey → ChatGPT Queue · Accent 下的“设置”，在脚本设置面板勾选/取消“会话全宽”；修改立即保存并生效，刷新和切换聊天后保留。聊天页面没有全宽按钮。配置面板直接读取 ChatGPT 页面的实际背景、文字、字体和明暗模式；边框和控件跟随当前主题，按钮与复选框使用当前 Accent color。

新聊天先通过原生 Enter 发送首条消息、取得会话 ID；随后生成回答时即可直接排队。首次建立会话前用 Ctrl+Q 放入的队列会迁入新会话，在原生输入框为空时按 Ctrl+Q 接续。没有跨会话自动调度。

## 保存到 Obsidian

1. 打开目标 Obsidian 库并启用 **Local REST API for Obsidian**。首版只连接单个库，不启动额外后台服务。
2. 在 ChatGPT 标签点击 Firefox 工具栏 Violentmonkey → **ChatGPT Queue · Accent 设置**。填写库路径、Obsidian API 地址和 API key、AI API 地址与 key、模型 ID，点击“保存配置”。Obsidian key 与 AI key 是两项独立凭证。
3. 本机预设库路径为 `E:\Obsidian`，Obsidian 地址为 `https://127.0.0.1:27124`，AI 地址为 `http://127.0.0.1:8045/v1`，模型为 `gemini-3.8-flash-high`。密钥默认留空，填写后仅存于当前脚本管理器的本地配置。
4. 使用 HTTPS 时，先在同一个 Firefox 打开 Obsidian API 地址，核对并信任插件自己的证书，否则浏览器请求会失败。脚本不关闭 TLS 校验。Obsidian 官方[连接说明](https://github.com/coddingtonbear/obsidian-local-rest-api)提供证书配置方式。
5. 在回答下方操作栏最右侧点击软盘形的“保存到 Obsidian”图标，悬停可见名称；它位于原生复制、朗读、重新生成等按钮之后。每次只保存对应的一问一答；生成中的回答暂时禁用按钮。
6. AI 根据这次问答、库内目录树和已有标签建议标题、文件夹及标签。预览只显示这三项和最终路径，可以修改；新目录/标签会标明。点击“保存”归档，取消不写入笔记。

问答正文保持原始 Markdown，保留代码、公式、表格和来源链接。附件仅记录名称和可取得的来源，不下载文件；不保存工具执行日志。AI 只整理元信息，不改写正文，不读取其他笔记正文。

同一回答重复保存直接覆盖，包括手动修改过的归档内容；重新生成的回答独立归档。文件名附稳定回答短标识，避免同名不同回答相互覆盖。改标题或目录时先写入并核验新路径，再删除旧路径；失败保留错误和重试所需记录。

Obsidian 未运行、API 不可用或凭证错误时，页面右上角显示具体错误码。AI 分类失败仍可在预览中手动填写并保存。Console 只记录错误码；维护工具可监听 `chatgpt-archive:error`，事件 detail 仅包含错误码。没有专门的超长输入处理策略。

API 地址应指向可信且直接响应的端点。Violentmonkey 2.49.0 的 GM 请求不会按 `redirect: 'error'` 预先阻止重定向；脚本检查返回的最终 URL，发生地址变化或 3xx 时报告 `A_REQUEST_REDIRECT`，缺失或无效最终 URL 时报告 `A_REQUEST_RESPONSE`，并停止采用该结果及后续保存步骤。这个检查发生在请求之后，不能阻止凭证或正文已被发往重定向目标。配置端点时避免依赖 HTTP 到 HTTPS、登录页或其他跳转。

库路径用于显示目标位置；REST 插件实际操作其所在的已打开库，修改磁盘路径不会切换库。现有连接权限包含 `127.0.0.1` 与 `localhost`；其他主机仍需核对当前脚本管理器的站点与请求权限。

## Accent color

队列的主按钮、编号、焦点边框和高亮使用当前页面的主题值：

1. 当前新版的 `--color-background-composer-primary` 与 `--color-text-composer-primary`；
2. 旧版的 `--theme-submit-btn-bg`、`--theme-submit-btn-text`、`--interactive-bg-accent-default` / `--text-accent`；
3. 主题变量不存在时，取原生发送按钮的实际背景色和文字色。

主题值继承到 Shadow DOM，并定期重新采样，不读账号设置、不映射硬编码颜色名称。
如果 ChatGPT 某个页面版本不提供任何可识别的主题值和发送按钮，使用中性灰；不会使用固定橙色。
2026-10-06 已在原生 Firefox 的已登录 ChatGPT 验证：当前有效颜色为 `#7849d1`，队列按钮与页面一致；临时改变页面主题变量后也会同步，并在还原后恢复。该换色测试没有修改账号的主题设置。

## 会话全宽

默认开启，配置入口为 Violentmonkey 菜单中 ChatGPT Queue · Accent 下的“设置”。这是本脚本的配置面板；扩展管理页的通用设置不提供本脚本自定义选项。同一管理器内已有明确保存的关闭设置会保留；跨管理器切换按上述迁移步骤处理。

使用当前页面的 `--thread-content-*`、`--thread-body-max-width` 和 `--composer-adjacent-max-width` 宽度变量，将上限改为会话容器的 100%。保留原生边距与侧栏空间，不把整个浏览器的 `100vw` 强塞进聊天区。

作用域优先限定在当前输入框所属的 `[data-request-input-activity-root]`，首页使用 `main` / `[role="main"]`。只添加自己的属性与样式规则；关闭时移除属性，不改写原生内联样式。CSS 百分比会随窗口和侧栏的尺寸重新计算；页面切换后重新定位作用域。

参考 [KeepChatGPT](https://github.com/xcanwin/KeepChatGPT) 的扩展布局思路，独立实现。没有沿用其 `main#main`、`section.text-token-text-primary` 或 `#thread-bottom` 旧选择器，也没有复制其 GPL-2.0 代码。

迁移前的真实网页历史测量：会话容器 1130px 时，消息区 808 → 1130px，队列与输入框 768 → 1090px（左右保留 20px 原生边距）；关闭后精确恢复。Violentmonkey 上的实际显示另行验收。

## 恢复与限制

- 发送前保存状态。刷新或返回会话后，自动依据消息标识、发送前基线和正文核对网页回执；已经确认接收的消息不会重发。
- 确认超时、回执不匹配、存储失败等属于执行错误：停止自动发送、保留相关条目、显示错误码，并在 Console 输出 `[ChatGPT Queue][错误码]`。没有“已发送，移出”或“未发送，退回”的人工判断。
- 错误卡片提供“复制诊断”和“重新检测”。诊断只包含错误码、阶段、时间、条目数量及页面状态信号，不包含消息正文、草稿、会话地址或消息标识。重新检测只核对现有页面，不重新点击发送；错误解除后，用空输入框 Ctrl+Q 接续。
- 维护工具可监听 document 上的 `chatgpt-queue:error` 事件；`event.detail` 为 JSON 字符串。圆框与双色按钮封装在 `src/notice-card.js`，可复用于后续提示。
- 同一会话只能由一个标签页管理，使用浏览器 Web Locks；第二个标签页只读。关闭拥有者标签页后刷新另一页接管。
- 页面关闭、被丢弃或电脑休眠时不会继续发送。后台标签可能受 Firefox 调度节流。
- 使用当前网页所选模型；不为各条消息自动切换模型。
- 不支持附件队列、语音、Chat 模式的独立 Deep Research 流程、图片生成、账号间队列迁移。Work 支持任务队列；既有真实网页历史验收使用短文字任务，带工具、审批与异常状态通过 DOM 回归测试验证，未做完整真实工具任务验收。
- 排队期间修改历史消息、切分支或手动发送其他消息会暂停；恢复时发现上下文与已保存回执冲突会报告 `Q_CONTEXT_CHANGED`。
- 队列文字保存在当前脚本管理器的本地存储，不上传第三方、不调用 ChatGPT 私有接口。不要把它当成加密存储。
- 适配当前 `[data-composer-markdown][contenteditable="true"][role="textbox"]`、`data-codex-composer-root` 与消息搜索单元的语义标记，同时兼容 Chat 的 `[data-chatgpt-composer]` 与旧版 `#prompt-textarea`。模式依据任务结构与当前路径识别，不把 Work 的显示名称固定为英文。ChatGPT 再次改版后若识别失败会等待或暂停，需要更新 `src/browser.js` 中的 adapter。
- 某些登录前页面使用不同输入框，不属于已经确认支持的界面。

## 源码与构建

```text
chatgpt-queue.user.js  直接安装的完整脚本
src/core.cjs          队列状态机与持久化边界
src/browser.js        ChatGPT 页面适配、队列 UI、跨标签互斥
src/queue.css         跟随 Accent color 的样式
src/notice-card.js    可复用的圆框与双色按钮提示组件
src/archive-core.cjs  分类接口、元信息、保存与迁移
src/archive-dom.js    对应问答提取与 Markdown 转换
src/archive-browser.js  回答栏按钮、元信息预览与错误通知
tests/               状态机与 DOM 适配测试
build.cjs            无依赖构建器
LICENSE              GPL v3 全文
THIRD_PARTY_NOTICES.md  上游参考与许可证说明
```

重建不需要安装依赖：`node build.cjs`。
开发测试：使用 Node.js 22.13+，按锁文件执行 `npm ci --ignore-scripts`，然后 `npm test` 与 `npm run check`。统一入口见[开发与验证](../../docs/development.md)。

UI 参考 [kgruiz/chatgpt-queue](https://github.com/kgruiz/chatgpt-queue)，本项目以 GPL-3.0-or-later 提供完整源码。

## 验证边界

详见 [VALIDATION.md](VALIDATION.md)。1.8.0 的 83 项测试及当时原生 Firefox 安装、Obsidian 与分类 API、Chat/Work/Codex 归档证据保留历史日期，不能作为 Violentmonkey 1.9.0 的验收结果。1.9.0 的本地测试、两个浏览器的持久安装、页面注入、队列/归档和真实自动更新分别记录；未取得对应证据前标为待验收。1.7.0 的 Work/Codex 队列历史证据与新增归档证据分别保留。
