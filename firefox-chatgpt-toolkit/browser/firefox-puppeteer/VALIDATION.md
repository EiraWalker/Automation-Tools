# Firefox 后台环境验收

## 2026-10-12：原生保存成功提示与持久安装不一致

用户授权通过 Nightly 专用入口重开后，已实际读取 Tampermonkey 5.5.0 的管理页、原生编辑器和扩展管理页。使用原生 File → Save 安装本机发布版 1.8.1.1，未使用 OS 键鼠或剪贴板；自有测试页均在后台创建。源码基础版本为 1.8.1，统一 verify 报告 `output/automation/20261011T191552Z-77efd081/report.json` 通过，插件测试 84 项。本轮尚未修改业务源码。

- 原生保存后管理页缓存行显示脚本启用、版本 1.8.1.1；编辑器源码 SHA-256 与发布包 `417dea2541dd39bb1a1a7444438b3b121dd3476b49dec8eeb16e37e19fdc52e6` 相同。第二个管理页和短时间内断开重连也曾读到此状态；这些结果不能证明持久保存。
- 随后同一次连接比较保留的管理页与新管理页：旧页仍保留脚本行，新页为空；新开的指定聊天没有队列、全宽或归档通知宿主。已撤销此前“持久化安装通过”的中间结论。
- 指定聊天的编辑器及 2 条回答能被现有选择器匹配，回答容器内有原生操作栏。按钮为 0 的结果不能作为修改消息 adapter 的依据；当前没有按钮恢复、像素或 Obsidian 写入通过的证据。
- 通过授权扩展页的原生 API 仅读取目标脚本的持久化记录存在性及元数据；油猴后台内存脚本数保存后为 1，原生 `storage.local` 中对应 UID、源码和元数据均不存在，后台重建后内存数变为 0。全局启用、普通窗口、存储后端 `storage.local`、同步关闭均已核对，不读取或输出 GM 配置值。
- 自有临时存储键验证：小字符串、脚本文本、UID、URL 条件可写入；唯一失败的元数据字段是 `tfd`，其内容为 Blob。新建 5 字节 Blob 同样失败；错误为 `An unexpected error occurred`，原生保存的 warning 也包含此错误。JSON 克隆的元数据可写入，但会破坏 Blob 内容，因此未用它改写实际脚本记录。
- 实验临时键逐项删除；为捕获原生存储 warning 而暂时添加的监听包装已恢复。没有编辑 Firefox profile、SQLite 或真实脚本存储记录。
- 仅重新加载油猴扩展，Firefox 进程保持；随后扩展管理页确认油猴仍启用。重新核对入口时按 `protocol + host` 保存扩展地址，不能使用 Node `URL.origin` 解析 `moz-extension:`。后续 Blob 检查遇到 `DiscardedBrowsingContextError`，判为未通过，不能推定重载已经修复。

为下一步修复准备了 AMO 官方 5.5.0 安装包，SHA-256 为 `190031c78dbc5696114835601f2c8e6b855ad1e134df5df278f8fc158c065908`，与官方清单一致；包内 manifest 版本、扩展 ID 和签名文件也已核对。持久脚本 UID 数为 0，配置与残留 GM 存储通过 Windows DPAPI 加密备份及解密回环校验；不会把备份值写入报告。重装会清除扩展数据，已请求追加授权，尚未卸载或重装。

私有续接入口：`.local/nightly-userscript-install.mjs`；证据为 `.local/userscript-update/nightly-install.json`、`nightly-storage-check.json`、`combined-check.json`、`nightly-button-check.json`、`nightly-prepare-reinstall.json` 及 `tampermonkey-repair-plan.json`。多个阶段会覆盖同名报告，应同时看本段的已核对结论。部分运行 Windows 观察器失败或检测变化，属于 inconclusive；原生保存分字段实验、重载及备份运行的窗口/可见标签/剪贴板采样无变化，不扩大为整段任务的连续保证。

当前状态：首次持久安装、指定聊天按钮恢复和真实保存均待完成。安装授权本身仍有效；追加授权仅针对扩展卸载后的存储清除。更新源仍运行，预计 2026-10-13 03:16（UTC+8）到期；模块目录可执行 `npm run userscript:stop` 停止自有更新源。

## 2026-10-11：归档按钮缺失诊断

02:49～02:50（UTC+8）复用已授权目标及已有 Nightly 运行时连接。`npm run doctor` 与 `npm run inspect` 成功；inspect 的归档按钮数为 0，运行版本为 null。补充只读诊断复用 `withExistingPage`、进程核对及 Windows 观察器，不读取聊天正文、凭据或扩展存储。

- 页面地址匹配脚本的 `https://chatgpt.com/*`，readyState 为 complete，输入框存在，没有挑战页标记。
- 实际适配器范围内有 1 条可见回答，其归档工具栏选择器匹配；原生复制按钮存在。
- `chatgpt-queue-accent`、`chatgpt-queue-width`、`chatgpt-archive-notices` 均不存在，归档宿主与全宽根属性数量均为 0。这表明该页没有当前脚本正常启动的产物；单纯图标颜色或工具栏定位问题不足以解释全部标记缺失。
- 文档 timeOrigin 对应 02:22:48，本机发布包下载记录始于 02:33:19，之后仍保持同一文档。最符合证据的是安装前已打开的页面尚未加载脚本；下载不是安装/启用证明，扩展内部状态仍未验证。
- 前后台窗口、可见标签与剪贴板采样无变化，页面草稿指纹、尺寸、滚动及显隐状态前后相同，断开后浏览器进程保留。

私有证据为仓库根 `.local/obsidian-button-diagnosis.json`、对应只读任务 `.local/obsidian-button-diagnosis.mjs`，以及 `.local/firefox-runs/2026-10-10T18-49-29-899Z-inspect.json`。诊断任务只输出结构数量和启动标记；不将窗口截图或临时注入当作运行证据。

本次没有刷新、热替换、安装或点击业务按钮，也没有发送消息或写入 Obsidian。用户自然重新加载页面后需再次核对运行版本和按钮；若仍无启动标记，检查油猴脚本启用与站点权限，必要时诊断初始化错误。未声称按钮已恢复。

## 2026-10-11：油猴本机更新源

采用 Tampermonkey 5.5.0 原生元数据更新。原先尝试在自有后台标签打开扩展管理页，被 Firefox 的 `unsupported operation: Navigation ... is not allowed in this context` 拒绝；自有空白标签已关闭，没有绕过限制。该尝试的桌面观察无变化。

本机发布副本版本 **1.8.1.1**，源码基础版本 1.8.1；发布文件 SHA-256 为 `417dea2541dd39bb1a1a7444438b3b121dd3476b49dec8eeb16e37e19fdc52e6`。HTTP 记录了源码请求，但用户随后提供 Nightly 油猴管理页截图，清楚显示“No script is installed”。**首次安装失败或未完成**；此前“用户已安装”的表述撤销。必须在管理页查到已启用脚本及版本，再报告安装通过。

新增 4 项测试覆盖：身份/权限/正文保留及版本递增、不可变发布与锁、完整性损坏拒绝、真实 loopback HTTP 的版本固定/Host/方法/路径限制。统一 verify 报告 `output/automation/20261010T183821Z-7a90e0b4/report.json` 通过，共 115 项测试（84 插件、13 Puppeteer、11 历史原生、7 截图），另有语法、PowerShell 与文档检查。

对实际更新源完成 stop/start/start/publish 生命周期验收：重复启动复用同一实例、相同源码不增加版本，HTTP 下载哈希与发布清单一致。保持指定 ChatGPT 页面后台状态，观察 20 个样本、覆盖 4.475 秒，前台 HWND、可见标签、窗口、剪贴板序号和页面草稿指纹均未改变；Nightly 进程保持运行。证据位于 `.local/userscript-update/lifecycle-validation.json`。服务仅本机隐藏运行，最长 24 小时，不注册系统启动项。

既有目标聊天只读检查未发现运行版本标记/归档按钮；没有为验证而刷新该页。报告 `2026-10-10T18-37-43-590Z-inspect.json` 的 passed 仅表示只读检查及桌面采样通过。用户截图已证明扩展脚本列表为空，此时不能将缺少运行标记解释为旧页面未刷新。实际安装、下一次页面运行版本与视觉功能仍待验收。

## 2026-10-11：Nightly Remote Control

环境：Windows、Node.js 26.7.0、Puppeteer Core 25.13.0、Firefox Nightly 160.0a1（Build 20261010084543）。Nightly 由用户安装、登录并开启 Remote Control；首次原生连接确认由用户允许。工具复用该进程，使用运行时 BiDi 端口，没有浏览器启动操作。

### 真实网页结果

- 多次 Puppeteer connect/disconnect 成功；监听者为 Nightly，绑定 127.0.0.1，无命令行自动化参数。
- 用户指定的 ChatGPT 聊天通过完整 URL 和精确标题唯一定位。目标文档处于 hidden、未获焦点，原生输入框存在，readyState 为 complete，未检测到当前挑战页标记。
- 5 次页面采样中 navigator.webdriver 均为 false，原生 getter 的 native 标记存在。没有注入或覆盖此属性。
- environment 观察器取得 12 个样本，覆盖约 1.45 秒：前台 HWND、Nightly 可见标签的运行时 ID、窗口位置/尺寸/最小化状态及剪贴板序号保持不变；页面尺寸、滚动位置及现有草稿指纹保持不变。
- 结束后 Nightly 进程及端口仍在运行，第二次只读图标检查可再次连接。图标检查未检测到归档按钮，未据此声称插件安装通过。

原始记录保存在忽略的 `.local/firefox-runs/`：environment 时间戳为 `2026-10-10T18-19-22-817Z`，inspect 为 `2026-10-10T18-19-52-982Z`（UTC，对应本地 2026-10-11）。记录不包含问答、草稿正文、cookie 或 API key；私有目标配置不进入版本控制。

### 验收边界

本次是已加载的真实 ChatGPT 页面后台读取。未刷新页面、触发新的 Cloudflare 挑战、点击业务按钮、输入/发送消息、安装 Tampermonkey 脚本或执行 Obsidian 写入；这些结果不能从环境通过推定。目标是未选中的后台标签，未用其他可见标签的截图冒充视觉证明。

Windows 状态按约 100 ms 加实际 UI Automation 开销采样，不证明两个样本之间绝无短暂变化。检测到变化时报告 inconclusive，区分用户活动和工具原因，不自动恢复用户窗口。首次原生确认属于安装连接阶段；日常重复连接的窗口观察单独验收。

### 工具兼容性

Windows PowerShell 5.1 的观察脚本直接调用可成功，但通过本机 Node 子进程调用时无输出退出 2；改用已安装的 PowerShell 7 后，进程核对与观察器均成功。只读观察器不依赖前台输入和剪贴板内容。

本地回归覆盖目标唯一性、导航竞争、任务失败清理、自动化模式拒绝、端口进程归属及观察证据不足。统一 verify 报告 `output/automation/20261010T182235Z-71ce1f25/report.json` 全部通过：84 项插件、9 项 Puppeteer、11 项历史自动化和 7 项截图测试，共 111 项，另有产物语法、两种 PowerShell policy 检查及 24 份文档的链接检查。更新后的 skill 元数据检查通过。

根目录 firefox-doctor 与 firefox-environment phase 也已实际通过，分别记录在 `20261010T182235Z-32a91755` 与 `20261010T182300Z-0b12aa27` 的自动化报告中。Windows 观察器随后补充“观察超时不得视为完成”和每轮窗口清单刷新，完整 environment phase 再次执行通过。本地测试、CLI 接入及真实网页结果分别成立。

## 2026-10-12：Violentmonkey 1.9.0 本机发布及 Nightly 持久安装

此处的 1.9.0 是 ChatGPT Queue 源码版本，目标管理器为 Violentmonkey 2.49.0。本机发布副本为 1.9.0.1，使用现有 loopback 更新工作流，保留身份和固定版本下载地址。源码与发布 SHA-256 分别为 `ab804069bc1367c63cb6f12abc6232114cb8c248b190b7fc5540be2bd11ea6e7`、`337c3f2172b19a048e243e56ff7441444feb57e59ea159998c4d8d37ddf68240`。

统一 verify 报告 `output/automation/20261011T213102Z-e80aeb46/report.json` 的 8 个步骤均通过，当次计数为插件 93、Puppeteer 13、历史原生工具 11、截图 7，另有语法、两种 PowerShell 和文档检查。之后新增一个 `exportFunction` 身份回归，`userscript:update` 的 `last-check.log` 记录最终插件测试 94/94、无失败/取消/跳过，产物语法通过。两次验证范围和计数分别保留。

只读 profile 审核确认普通 Firefox 与 Nightly 均持久安装并启用 Violentmonkey 2.49.0：没有用户或应用禁用状态，签名状态正常，XPI 存在且文件 SHA-256 一致。这纠正了此前“扩展安装尚未确认”的状态；仍不能由扩展清单推出脚本已安装。普通 Firefox 没有可用后台监听，本次尚无该浏览器的脚本安装或页面运行证据。

Nightly 继续复用现有获授权的后台连接，通过 Violentmonkey 自有原生编辑器和保存按钮安装。编辑器使用 CodeMirror；直接 `setValue` 没有触发所需的 dirty 状态，改用 `replaceRange` 并指定 `paste` 来源后，原生保存成功。此操作是编辑器内部 API，不读取或修改系统剪贴板，也没有模拟 OS 键鼠。

独立新管理文档中只读核对目标脚本的 `browser.storage.local` 源码与元数据：持久源码 SHA-256 与本机 1.9.0.1 发布包一致，版本、启用状态、允许更新和 `page` 注入配置均符合预期，管理页存在对应条目。未直接写入扩展存储、修改 profile 数据库或将旧页缓存当作持久化证明。

| 运行 | 观察样本 | 覆盖时间 | 采样结论 |
| --- | --- | --- | --- |
| 原生安装 `vm-install.json` | 81 | 13.957 秒 | 窗口、可见标签、剪贴板均无变化 |
| 独立复核 `vm-verify-1.9.0.1.json` | 68 | 11.808 秒 | 窗口、可见标签、剪贴板均无变化 |

两次完成后 Nightly 进程保留；以上是有界采样结论，不证明样本之间绝无瞬时变化。早前诊断阶段存在观察器失败或变化的 inconclusive 结果，继续保留，未合并为全程通过。

真实新目标文档的注入与运行检查尚在后续验收范围；本段不声称 Chat/Work/Codex 发送、跨标签所有权、刷新恢复或归档业务通过。未发送新 prompt、未写入 Obsidian、未迁移旧配置和归档映射，也未完成真正的新版本自动更新。私有证据位于根 `.local/userscript-update/vm-*.json`，扩展地址、profile 标识、会话地址和凭据不进入本记录。

### 同日后续：新文档执行与后台计时器

自有后台新标签载入已指定聊天后，确认正式安装脚本运行版本为 1.9.0.1，Violentmonkey 注入上下文为 page；`navigator.webdriver=false`，文档 hidden，队列 owner、全宽和归档通知宿主存在，队列为空。此处只确认新文档执行与结构状态，没有验证队列实际发送、跨标签竞争或归档写入。

页面中两条回答及原生操作栏可匹配，归档按钮仍为 0。Firefox 窗口处于最小化状态；调查使用页面原生 `setTimeout(0)` 与 `setInterval(500)`，在 15 秒后台轮询结束时两者仍分别为未触发和 0 次，Promise microtask 已完成。该后台文档计时器未执行，不能在本次窗口状态下完成依赖定时扫描的按钮显示及业务验收；没有为此激活窗口、切换可见标签或推测性修改生产代码。

该阶段 `.local/userscript-update/vm-page-1.9.0.1.json` 记录外部用户/系统状态变化，观察器 `nonInterference=false`，本次非干扰结论为 inconclusive。原生安装和独立复核的两个通过窗口仍分别有效，不扩大为整次任务连续无变化。页面另有两条未分类的通用 Error，未发现自有队列错误 Console，不能将未分类错误归因为本脚本。自有新测试标签已关闭；未发送新 prompt，未写入 Obsidian，目标页面像素显示仍无单独验收。

### 同日最终：原生更新至 1.9.0.3、持久复核与新文档

对已安装 1.9.0.1 进行原生更新检查时，实际请求先取得 1.9.0.2 元数据，再从旧 downloadURL 下载 1.9.0.1，版本未变。确认 Violentmonkey 使用已安装记录中的下载地址后，发布器改用稳定 `/chatgpt-queue.user.js` 别名，并在原生编辑器中一次性修正旧安装地址。随后通过目标脚本的原生“检查更新”成功升级至 **1.9.0.3**，`vm-update.json` 记录观察采样无变化、Nightly 进程保留。这是手动触发管理器真实更新，不是定时检查周期的验收。

最终公共构建基础版本仍为 1.9.0，SHA-256 为 `2acce2fe4f5a24ecb102fee0a9f26bc04e5f1c38ade0f23a658d501a9b0531f9`；本机发布及持久安装的 1.9.0.3 源码 SHA-256 为 `7721d28e137c422601694bfda2fd0a42e1974f016b78823eef2730ac98557216`。最终独立新管理文档确认一个匹配脚本、版本 1.9.0.3、启用、允许更新、page 注入、稳定的更新/下载 URL，以及源码哈希完全一致。`vm-verify.json` 的非干扰采样通过，浏览器进程保留。

最终 `vm-page.json` 对自有隐藏新目标文档确认运行版本 1.9.0.3、Violentmonkey page 注入、原生 webdriver getter 和 webdriver=false，owner、全宽与归档通知宿主存在，待发列表为空；观察采样无变化、浏览器进程保留。最小化状态下 15 秒原生计时器诊断仍为 interval=0、timeout 未触发、microtask 已完成，两个原生复制操作可匹配但归档按钮为 0。自有队列错误为空，另有两条未分类通用 Error。发送、跨标签竞争、恢复、归档显示和写入仍未验收，没有发送 prompt 或写入 Obsidian。

正确解析旧 Tampermonkey 目标存储槽的 `value.data` 后，`vm-migration-state.json` 确认 Nightly 没有持久旧脚本、没有归档配置或路径映射，但有 **2 个残留队列存储键**；已保留，未迁移、未重放，不将键数当作消息数。此前仅检查顶层字段的零队列键结果作废。本次旧存储检查非干扰采样通过且进程保留。普通 Firefox 没有可用后台调试监听，其旧数据及本脚本安装状态仍未核验。

最终统一验证报告 `output/automation/20261011T215331Z-ab486684/report.json` 的 8 个步骤均通过：94 插件、14 Puppeteer、11 历史原生工具、7 截图测试，共 126 项，另有语法、两种 PowerShell 和文档检查。发布器测试新增对已安装稳定下载地址实际推进版本及跨发布请求的覆盖；历史不可变发布仍保留，已撤销“固定 downloadURL 防止跨请求版本变化”的当前保证，见 [ADR 0011](../../docs/adr/0011-native-userscript-updates.md)。

较早 1.9.0.1 页面检查的 inconclusive 原始证据另存为 `.local/userscript-update/vm-page-1.9.0.1.json`，保留原结论；当前 `vm-page.json` 是上述最终 1.9.0.3 的通过观察窗口。所有通过均只针对对应采样区间，不代表整次工作期间没有用户活动。自有测试标签已关闭。更新源仍运行，预计 2026-10-13 03:16（UTC+8）到期，模块内 `npm run userscript:stop` 可停止自有服务。
