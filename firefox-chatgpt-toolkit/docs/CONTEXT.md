# ChatGPT Queue 项目 context

更新：2026-10-10。本文件承载持续维护所需的当前状态；选择理由记入 [ADR](adr/README.md)，实现边界见 [架构](architecture.md)。

## 项目与源码权威

为现有 Firefox 的 ChatGPT 网页提供类似 Codex CLI 的后续消息 FIFO 队列。交付形式是 Tampermonkey 单文件用户脚本。ChatGPT Chat、Work 和当前 Codex Cloud `/local/<id>` 页面共用队列引擎。

本机根目录是 `D:\projects\GPT Enhancemnet`。唯一活跃源码为根下 `firefox-chatgpt-toolkit/userscripts/chatgpt-queue`；同目录的 `chatgpt-queue.user.js` 由源码构建。Firefox 原生自动化和后台截图模块与插件同处 toolkit，供开发验收使用。

根仓库保留 Automation-Tools 历史及 origin。迁移基线为 `bab6f11982c32b89c74863abca10cbe8a43ddc1b`，其他模块按其自身说明维护。[迁移记录](migration-2026-10-10.md) 说明备份、文件核对和本次检查。旧 outputs、研究 clone 和 `.local/legacy-workspace` 仅供历史追溯。

## 已确认的产品约束

- 复用原生输入框，Ctrl+Q 入队；忙碌或已有队列时普通 Enter 入队，空闲且队列为空时保持原生发送。Shift+Enter 保持换行与 IME 行为。
- 自动顺序发送；条目在匹配回执、开始运行时出队，当前回合继续在 active 中等待完成。队列存在时直接显示列表，空队列仍显示 `Ctrl + Q  Enqueue`。
- 条目支持编辑、排序、删除；编辑在原生输入框进行。没有第二个文本框、加入队列按钮、运行按钮或折叠下拉菜单。
- 使用网页实际生效的 Accent color、背景、文字和字体。会话全宽默认开启，配置放在油猴脚本的设置入口。
- 保存并尊重用户草稿；队列按模式、会话隔离，一个标签拥有发送权。无法确认发送是 coded error：停止调度、保留证据，重新检测不会重发。

用户操作说明以 [插件 README](../userscripts/chatgpt-queue/README.md) 为准；本文件不复制全部设置、命令或页面选择器。

## 当前版本与证据边界

迁移时版本为 **1.7.0**，产物 SHA-256 为 `ee99aabc50540a577ce7841b3662d9ab8f208fd2d1e2397280ed5c0fa825796c`。来源是已有文件及 [1.7.0 验收记录](../userscripts/chatgpt-queue/VALIDATION.md)，不是迁移时重新读取 Firefox 安装状态。

2026-10-09 的正式安装版在已有原生 Firefox 的 Work 和用户指定 Codex Cloud 页面各完成两条短文字消息：顺序发送、运行开始出队、最终队列/active/fault 均为空。入队由合成 Ctrl+Q 触发。Chat 模式的物理按键历史证据见 1.6.2；新增模式的物理快捷键、完整真实工具/审批流程及其他 Codex URL/layout 未完整验收。

2026-10-10 的迁移检查验证文件、Git、锁定依赖、本地测试及文档链接；不把历史真实网站验收改写为今天通过。运行报告及各步骤结果按 [开发流程](development.md) 保存。

## 维护入口与已知限制

先按 [development.md](development.md) 在新根运行验证。代码发现使用图谱 `gpt-enhancement-queue`；浏览器工具索引为 `gpt-enhancement-native`。索引覆盖缺口以工具返回信息为准，尤其 PowerShell 和测试文件需按需读取源文件。

ChatGPT 前端会变化。改动 adapter 后需在明确指定的真实聊天验收；MCP、UIA 或 Console 的执行请求不是收到消息的证明。用户指定使用已有原生 Firefox，截图采用后台 AgentCapture；实际 tab/HWND 每次实时识别，不复用历史标识。

不支持附件队列、语音、账号间迁移、关闭页面后持续发送。Work 的工具/审批状态有 DOM 回归测试覆盖，审批动作仍由原生界面处理。Codex 的异步编辑器同步等待及回执核对不可因 Send 按钮可用而省略。更多限制以当前 README 为准。

私有 Console 任务、消息/草稿、截图、扩展标识与 RPC 文件保存到忽略的 `.local/`；脱敏验收、源码、许可证和持久化文档才进入版本控制。全局 Codex 配置、Firefox profile 和已安装油猴脚本在本次迁移中未改动。

架构或状态规则变化时更新对应 ADR；行为、验证边界或当前任务变化时更新本 context。验收记录保留日期和实际执行范围。

## Obsidian 归档

1.8.0 已实现原生回答栏归档按钮、AI 标题/文件夹/标签建议、无正文预览、可编辑保存和脚本配置。单库通过 Obsidian Local REST API 通信；分类模型、端点与密钥由用户配置。产品规则见 [归档规划](obsidian-export/plan.md)，领域词汇见 [归档 context](obsidian-export/CONTEXT.md)，接口选择见 [ADR 0008](adr/0008-obsidian-rest-api.md)。

2026-10-10 的统一检查通过 83 项插件测试及自动化套件检查。真实 Obsidian 与 AI API 验证通过；原生 Firefox 安装源码 SHA-256 为 `aa5916d4a111a40ebad3cbb61278172c43b25655dd7667f67008a4bd2191946a`，与构建产物一致。Chat、Work 和当前 Codex 页面均完成分类、编辑和保存；Chat 还验证覆盖与路径迁移。生成中禁用、重新生成版本和复杂格式的具体边界见带日期的 [验证记录](../userscripts/chatgpt-queue/VALIDATION.md)。迁移基线和 1.7.0 队列历史证据继续保留。
