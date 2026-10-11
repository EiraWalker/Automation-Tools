# ChatGPT 使用体验优化项目 context

更新：2026-10-12。本文件承载持续维护所需的当前状态；选择理由记入 [ADR](adr/README.md)，实现边界见 [架构](architecture.md)。

## 项目与源码权威

本项目的整体目标是优化 ChatGPT 的使用体验，范围不限于消息队列。当前在原生 Firefox 的 ChatGPT 网页中提供后续消息 FIFO 队列、会话全宽、原生主题适配和 Obsidian 问答归档；后续按用户需求扩展其他体验优化功能。浏览器自动化工具是开发与验收设施。

当前交付形式是名为 ChatGPT Queue 的 Violentmonkey 单文件用户脚本，源码版本 1.9.0，迁移决策见 [ADR 0012](adr/0012-violentmonkey.md)。ChatGPT Chat、Work 和当前 Codex Cloud `/local/<id>` 页面共用队列引擎。保持现有脚本名称、namespace 和持久化键；历史 Tampermonkey 记录保留原日期。

本机根目录是 `E:\firefox dev`。唯一活跃源码为根下 `firefox-chatgpt-toolkit/userscripts/chatgpt-queue`；同目录的 `chatgpt-queue.user.js` 由源码构建。Puppeteer、历史原生自动化和后台截图模块与插件同处 toolkit，供开发验收使用。旧 D 盘路径作为 Junction 兼容入口，详见 [2026-10-11 迁移记录](migration-2026-10-11.md)。

根仓库保留 Automation-Tools 历史及 origin。迁移基线为 `bab6f11982c32b89c74863abca10cbe8a43ddc1b`，其他模块按其自身说明维护。[迁移记录](migration-2026-10-10.md) 说明备份、文件核对和本次检查。旧 outputs、研究 clone 和 `.local/legacy-workspace` 仅供历史追溯。

## 项目运行环境

产品运行环境为 **Firefox / Firefox Nightly + Violentmonkey**，Violentmonkey 版本基线为 **2.49.0**。脚本安装、设置、GM 状态持久化和原生更新均以 Violentmonkey 为标准，环境选择见 [ADR 0012](adr/0012-violentmonkey.md)，操作见 [安装更新工作流](../browser/firefox-puppeteer/references/userscript-workflow.md)。

日常队列运行依赖已登录的 ChatGPT 网页和已安装的用户脚本。Node.js、Puppeteer 和截图工具用于开发、发布与验收；启用问答归档时另需 Obsidian Local REST API 和所配置的 AI 服务。

Tampermonkey 仅保留为历史验收、兼容元数据与旧数据切换的说明。环境基线不表示所有浏览器和功能都已验收；具体安装版本、当前证据和待办见下方“当前版本与证据边界”。

## 已确认的产品约束

- 复用原生输入框，Ctrl+Q 入队；忙碌或已有队列时普通 Enter 入队，空闲且队列为空时保持原生发送。Shift+Enter 保持换行与 IME 行为。
- 自动顺序发送；条目在匹配回执、开始运行时出队，当前回合继续在 active 中等待完成。队列存在时直接显示列表，空队列仍显示 `Ctrl + Q  Enqueue`。
- 条目支持编辑、排序、删除；编辑在原生输入框进行。没有第二个文本框、加入队列按钮、运行按钮或折叠下拉菜单。
- 使用网页实际生效的 Accent color、背景、文字和字体。会话全宽默认开启，配置放在油猴脚本的设置入口。
- 保存并尊重用户草稿；队列按模式、会话隔离，一个标签拥有发送权。无法确认发送是 coded error：停止调度、保留证据，重新检测不会重发。

用户操作说明以 [插件 README](../userscripts/chatgpt-queue/README.md) 为准；本文件不复制全部设置、命令或页面选择器。

## 当前版本与证据边界

2026-10-12 按用户要求迁移到 Violentmonkey。源码基础版本为 **1.9.0**，最终本机发布及 Nightly 已安装版本为 **1.9.0.3**。最终统一验证报告 `output/automation/20261011T215331Z-ab486684/report.json` 的 8 个步骤全部通过：94 项插件、14 项 Puppeteer、11 项历史原生工具、7 项截图测试，另有语法、PowerShell 和文档检查。较早运行的计数与范围保留在 [插件验收](../userscripts/chatgpt-queue/VALIDATION.md)。

普通 Firefox 和 Firefox Nightly 的 profile 清单均确认 Violentmonkey 2.49.0 已持久安装并启用。Nightly 已通过获授权后台连接在 Violentmonkey 原生编辑器保存脚本，并在独立新管理文档中核验最终持久源码、版本、启用状态、更新开关和 `page` 注入配置。1.9.0.3 安装源码 SHA-256 为 `7721d28e137c422601694bfda2fd0a42e1974f016b78823eef2730ac98557216`，与本机发布副本一致；公共构建的 SHA-256 为 `2acce2fe4f5a24ecb102fee0a9f26bc04e5f1c38ade0f23a658d501a9b0531f9`。普通 Firefox 没有可用后台调试监听，尚无其 ChatGPT Queue 脚本安装或运行证明。

Nightly 在自有后台新文档中已确认实际运行版本 1.9.0.3、Violentmonkey page 注入、`navigator.webdriver=false` 且 getter 保持原生、文档 hidden；队列拥有权、全宽和归档通知宿主存在，队列为空。**归档按钮验收未完成**：页面中能匹配到两条回答及原生复制操作，但没有归档按钮。Firefox 窗口处于最小化状态，原生 `setTimeout(0)` 和 `setInterval(500)` 在 15 秒轮询内均未执行，而 Promise microtask 完成，表明该后台文档的计时器没有正常推进；此环境下不能完成依赖定时扫描的归档显示与业务验收，未据此推测性修改生产代码。

原生安装、最终原生更新、独立复核和 1.9.0.3 新页面检查的非干扰采样通过，Nightly 进程保留。较早 1.9.0.1 页面诊断检测到外部用户/系统状态变化，仍按 inconclusive 保存到 `vm-page-1.9.0.1.json`，不能将整个任务称为全程无变化。自有测试标签已关闭，未激活窗口或要求置前。后续在具备计时器执行条件的后台目标继续分别验证 Chat/Work/Codex 输入、跨标签调度、恢复和归档。

真实原生更新发现 Violentmonkey 沿用已安装脚本的 downloadURL：旧固定地址导致取得 1.9.0.2 元数据后仍下载 1.9.0.1。发布器已改用稳定下载别名，通过管理器原生编辑一次性修正旧安装后，手动触发单脚本原生更新，成功从 1.9.0.1 升到 1.9.0.3；独立持久核验再次确认源码哈希及两个稳定 URL。此结果证明真实原生更新流程，尚未等待或验证定时自动检查周期。规则修正见 [ADR 0011](adr/0011-native-userscript-updates.md)。

两个管理器的 GM 存储独立。本轮按正确嵌套结构检查 Nightly 的目标旧存储槽，未发现归档配置或路径映射，发现 **2 个残留队列存储键**；这些键保留，未迁移、未重放，不能等同两条待发消息。普通 Firefox 旧存储未检查；旧数据与已验证的加密备份保留。未发送新 prompt、未写入 Obsidian。源码、安装、实际注入与业务验收分别记证据；最新记录见 [浏览器验收](../browser/firefox-puppeteer/VALIDATION.md)。

本机更新源仍运行，预计 2026-10-13 03:16（UTC+8）到期；在 `browser/firefox-puppeteer` 执行 `npm run userscript:stop` 可停止自有服务。服务停止不影响已安装脚本，仅影响后续更新检查；完整步骤见 [工作流](../browser/firefox-puppeteer/references/userscript-workflow.md)。

## 工作区迁移与历史证据

迁移时版本为 **1.7.0**，产物 SHA-256 为 `ee99aabc50540a577ce7841b3662d9ab8f208fd2d1e2397280ed5c0fa825796c`。来源是已有文件及 [1.7.0 验收记录](../userscripts/chatgpt-queue/VALIDATION.md)，不是迁移时重新读取 Firefox 安装状态。

2026-10-09 的正式安装版在已有原生 Firefox 的 Work 和用户指定 Codex Cloud 页面各完成两条短文字消息：顺序发送、运行开始出队、最终队列/active/fault 均为空。入队由合成 Ctrl+Q 触发。Chat 模式的物理按键历史证据见 1.6.2；新增模式的物理快捷键、完整真实工具/审批流程及其他 Codex URL/layout 未完整验收。

2026-10-10 的迁移检查验证文件、Git、锁定依赖、本地测试及文档链接；不把历史真实网站验收改写为今天通过。运行报告及各步骤结果按 [开发流程](development.md) 保存。

## 维护入口与已知限制

先按 [development.md](development.md) 在新根运行验证。代码发现使用图谱 `gpt-enhancement-queue`；浏览器工具索引为 `gpt-enhancement-native` 和 `firefox-puppeteer`。索引覆盖缺口以工具返回信息为准，尤其 PowerShell 和测试文件需按需读取源文件。

ChatGPT 前端会变化。改动 adapter 后需在明确指定的真实聊天验收；MCP、UIA 或 Console 的执行请求不是收到消息的证明。用户指定使用已有原生 Firefox，截图采用后台 AgentCapture；实际 tab/HWND 每次实时识别，不复用历史标识。

不支持附件队列、语音、账号间迁移、关闭页面后持续发送。Work 的工具/审批状态有 DOM 回归测试覆盖，审批动作仍由原生界面处理。Codex 的异步编辑器同步等待及回执核对不可因 Send 按钮可用而省略。更多限制以当前 README 为准。

私有 Console 任务、消息/草稿、截图、扩展标识与 RPC 文件保存到忽略的 `.local/`；脱敏验收、源码、许可证和持久化文档才进入版本控制。2026-10-10 工作区迁移时未改动全局 Codex 配置、Firefox profile 或已安装油猴脚本；后续脚本安装结果以上方当前状态及带日期验收为准。

架构或状态规则变化时更新对应 ADR；行为、验证边界或当前任务变化时更新本 context。验收记录保留日期和实际执行范围。

## Obsidian 归档与历史安装诊断

以下按原日期保留 1.8.x 的实现、验收及 Tampermonkey 安装诊断。Violentmonkey 1.9.0 的当前状态以上方记录为准。

1.8.0 已实现原生回答栏归档按钮、AI 标题/文件夹/标签建议、无正文预览、可编辑保存和脚本配置。单库通过 Obsidian Local REST API 通信；分类模型、端点与密钥由用户配置。产品规则见 [归档规划](obsidian-export/plan.md)，领域词汇见 [归档 context](obsidian-export/CONTEXT.md)，接口选择见 [ADR 0008](adr/0008-obsidian-rest-api.md)。

2026-10-10 的统一检查通过 83 项插件测试及自动化套件检查。真实 Obsidian 与 AI API 验证通过；原生 Firefox 安装源码 SHA-256 为 `aa5916d4a111a40ebad3cbb61278172c43b25655dd7667f67008a4bd2191946a`，与构建产物一致。Chat、Work 和当前 Codex 页面均完成分类、编辑和保存；Chat 还验证覆盖与路径迁移。生成中禁用、重新生成版本和复杂格式的具体边界见带日期的 [验证记录](../userscripts/chatgpt-queue/VALIDATION.md)。迁移基线和 1.7.0 队列历史证据继续保留。

用户随后报告看不到图标。Chat 后台截图未显示可辨识的新增图标；原生页面读取被前台窗口校验阻止。1.8.1 源码已修复图标颜色继承：跟随同一操作栏原生按钮的实际颜色，避免暗色容器继承黑色。新增回归重现黑色与灰色的差异，统一检查 84 项插件测试通过。修复尚未安装到 Firefox，当前页面的根因和实际显示效果仍待后台验证。API 配置与队列状态键保持兼容。

2026-10-11 用户要求验收不得干扰其他工作。停止前台激活、切换标签、键鼠及剪贴板操作；保留后台截图和已有后台调试协议路径。当前只读检查未发现 Firefox 调试监听端口，主进程也未启用 remote-debugging 或 Marionette 参数。1.8.1 的安装和真实页面验收因此待完成；后续按 [开发流程](development.md) 的后台约束继续，不再要求用户置前窗口或自行重启浏览器。

同日用户确认采用成熟连接器并迁移整个项目。`browser/firefox-puppeteer` 已安装锁定的 Puppeteer Core 25.13.0；任务规范见该模块 [SKILL](../browser/firefox-puppeteer/SKILL.md)，迁移理由见 [ADR 0009](adr/0009-puppeteer-background-validation.md)。

用户随后报告命令行调试启动会遭到 Cloudflare 拒绝，并安装、登录了 Nightly 160.0a1、手动开启 Remote Control。现已通过官方运行时入口连接用户指定的后台 ChatGPT 聊天，webdriver 为 false 且 getter 未被页面覆盖；窗口、可见标签、剪贴板和草稿采样保持不变，断开后浏览器继续运行。工具增加运行时进程核对与 `firefox-environment` 统一入口，依据见 [ADR 0010](adr/0010-nightly-runtime-remote-control.md)，具体证据范围见 [工具验收](../browser/firefox-puppeteer/VALIDATION.md)。

本次只读检查未刷新页面、发送消息或安装用户脚本。新测试聊天未检测到归档按钮，这不能证明其他安装状态；1.8.1 在 Nightly 的正式安装和实际图标显示仍待业务验收。已加载页面正常不代表新的 Cloudflare 挑战一定通过。测试窗口及原生连接确认由用户管理，日常工具继续只在后台工作。

用户要求不干扰工作的安装更新流程。现采用 [ADR 0011](adr/0011-native-userscript-updates.md) 的油猴原生元数据发布：本机发布副本 `1.8.1.1` 已生成，但 HTTP 请求只证明脚本被下载。源码构建仍为 1.8.1；发布副本仅改写版本和更新 URL。发布流程及后台服务命令见 [安装更新工作流](../browser/firefox-puppeteer/references/userscript-workflow.md)。指定聊天没有运行标记；不能由下载记录推定扩展已保存脚本。

2026-10-11 02:50（UTC+8）再次诊断归档按钮缺失：指定聊天有回答及原生复制操作栏，但归档宿主、队列宿主、全宽样式和通知宿主均不存在，运行版本为 null。随后用户提供 Nightly 油猴管理页截图，明确显示“No script is installed”；当前 Nightly **尚未安装脚本**，这解释了页面无功能。此前“已安装”和“旧页面未加载”是错误结论，不再用它们判断状态。后台采样中窗口、可见标签、剪贴板和页面状态保持不变，未刷新、注入脚本、发送或归档。诊断记录见 [工具验收](../browser/firefox-puppeteer/VALIDATION.md)。

用户已明确授权配置对 `moz-extension://` 页面的调试访问，并要求从 [Nightly 专用入口](../browser/firefox-puppeteer/references/system-access.md) 重开。2026-10-12 已完成授权启动和真实 BiDi 扩展页访问，原生连接确认由用户允许；目前无需再次请求启动授权。

同日安装诊断发现更深的阻塞：Tampermonkey 5.5.0 的原生 File → Save 会在内存及管理页缓存中显示 1.8.1.1，但扩展持久存储中没有对应的 UID、源码和元数据。后台重建后，新管理页为空，新聊天没有运行标记。此前以第二个管理页和已打开源码的哈希判断持久安装通过的结论撤销；缓存、内存与持久化必须分别核验。

分字段临时写入实验定位到油猴生成的 `tfd.blob`：脚本文本、UID、条件和其余元数据能保存，Blob（包括新建的 5 字节 Blob）写入报 `An unexpected error occurred`。这些实验只使用自有临时键并清理；未改真实脚本记录或浏览器 profile。指定聊天的回答及工具栏选择器仍可匹配，因此没有据此修改 adapter。油猴扩展重新加载保留了 Firefox 进程，但后续 Blob 检查出现上下文失效，不能记作修复通过。

官方同版本安装包已核对 AMO SHA-256；油猴配置及残留脚本存储已做 Windows DPAPI 加密备份并通过解密回环校验，私有材料均在根 `.local/userscript-update/`。当时请求追加授权：仅重装油猴以尝试重建异常存储，再恢复配置、安装脚本并验收。重装会清除扩展数据，未收到明确授权便不执行卸载。改用 Violentmonkey 前，Tampermonkey 安装和按钮恢复仍未通过，源码基础版本为 1.8.1，本机发布版本为 1.8.1.1；此历史修复方案不会随当前迁移自动执行，具体证据见 [工具验收](../browser/firefox-puppeteer/VALIDATION.md)。
