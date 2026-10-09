# 2026-10-09 更新验收

ChatGPT Queue 1.7.0：62/62 测试与语法检查通过；已安装源码与产物哈希一致（ee99aabc50540a577ce7841b3662d9ab8f208fd2d1e2397280ed5c0fa825796c）。原生 Firefox 真实 Work 和用户指定 Codex Cloud 会话均完成两条连续消息，分别采样 busy=true/rows=1 与 busy=true/rows=0，最终无错误。队列在接收/运行开始时出队。使用原生编辑器与合成 Ctrl+Q；物理按键、真实工具/审批任务未在新增模式重测。详细证据见[队列验收](userscripts/chatgpt-queue/VALIDATION.md)。

Native 自动化 1.1.1：TabItem 查找限定浏览器工具栏；Editor 要求真实 Edit 控件。PowerShell 5.1 / 7 的 policy/parser 8 项及 LiveReadOnly 均通过，识别 1 个现有窗口，错误目标拒绝，前台保持。可见编辑器被 UIA 标成 Offscreen 时仍拒绝 SendKeys。两个指定页面的原生 Console 执行、源码保存/核验、刷新、连续发送及清理已实时验证；后台 WGC 截图已查看，私人记录未发布。

以下保留 2026-10-06 的历史验收，不将历史范围视为本轮全部重测。

# 验证记录

日期：2026-10-06。这里保留汇总结果，不发布网页截图、消息内容、会话地址、扩展 UUID 或本机窗口标识。

## 打包后检查

| 检查 | 结果 | 实际验证范围 |
| --- | --- | --- |
| ChatGPT Queue `npm test` | 51/51 通过 | 队列状态机、忙闲识别、原生编辑器、草稿保护、主题/布局、快捷键与 UI |
| 生成脚本语法与重建 | 通过 | `npm run check`、`node build.cjs`；生成产物与本次会话最终 1.6.2 一致 |
| Firefox 自动化 `npm test` | 11/11 通过 | jsdom 页面守卫、编辑器更新、草稿恢复、HTTP 文件服务、文件 RPC 并发、假 MCP 的超时与不重放 |
| Native policy / parser | PowerShell 5.1 和 7 均通过 | 完整 URL 匹配、代码 SHA-256、HWND 格式、脚本解析 |
| `-LiveReadOnly` | 两个 PowerShell 版本均通过 | 发现 4 个当前 Firefox 窗口；只读操作不改变前台，错误目标拒绝且不抢占前台 |
| 截图适配器 unittest | 7/7 通过 | JSON envelope、退出码、无 shell 启动、超时和 EXE 解析 |
| 已安装 AgentCapture 1.0.0 | help / 窗口发现通过 | 已安装 AgentCapture 完成真实后台 WGC 截图，查看错误卡片和最终恢复页面；前台窗口未改变 |
| 三个 SKILL.md | quick_validate 均通过 | YAML name/description 和 skill 格式 |

生成脚本 SHA-256：

```text
e015fb0aa6f3f5ae8753a9789c948426bad3eccc002cc2558b98803fb6b7dee7
```

## 本次开发会话的真实网页验收

以下是打包前在用户原生 Firefox、已登录 ChatGPT 和指定测试标签中完成的验收，不是 jsdom 的结果：

- Tampermonkey 正式安装并启用；确认 `https://chatgpt.com/*` 匹配，修正站点排除，刷新已有页面。仅在 Console 临时注入某个聊天不视为安装成功。
- 1.5.0：回答生成时使用原生 Enter 入队，两条排队消息在各自回答结束后自动接续；编辑复用原生输入框；全宽通过油猴设置保存和立即切换。
- 1.5.1：空队列的 `Ctrl + Enter  Enqueue` 提示持续显示，队列列表与操作按钮隐藏。
- 1.5.2 / 1.5.3：夜间配置面板跟随实际网页样式。1.5.3 的面板与网页背景同为 `#0e0e0e`，文字对比度 16.49:1；有效 Accent color 来自页面主题。
- 1.5.4：真实非空队列中没有“加入队列”按钮，快捷键提示可见。最终后台截图尝试遇到窗口最小化，未把该尝试报告为截图成功。
- 1.6.0：正式安装源码的 SHA-256 与产物一致。旧故障会话四条记录中已接收的一条没有重发，剩余三条自动接续，最终持久化队列为空。受控页面错误得到 Q_PAGE_ERROR，真实诊断复制/重新检测/删除按钮通过，测试条目未发送并已移除；圆框和双色按钮通过后台截图确认。详细步骤见 [队列验收](userscripts/chatgpt-queue/VALIDATION.md)。
- 1.6.1：运行开始即出队；两次真实网页采样分别为 busy=true/rows=1 和 busy=true/rows=0，最终两条回答顺序完成，原草稿与 Console 输入恢复。安装源码哈希与发布产物一致，50 项测试通过；详见 [队列验收](userscripts/chatgpt-queue/VALIDATION.md)。
- 1.6.2：Ctrl+Q 正式安装并以原生按键在指定真实聊天验证；消息入队、接收、运行开始出队并完成回答。常驻提示同步更新，51 项测试通过，原生按键被拦截且浏览器保持运行；新增草稿保留，Console 和临时编辑器清理。详见[队列验收](userscripts/chatgpt-queue/VALIDATION.md)。
- 会话全宽实测：会话容器 1130px，消息区从 808px 扩展到 1130px；输入框与队列从 768px 扩展到 1090px，保留原生边距；关闭设置后恢复。

真实网页会持续更新。这些结果支持当时的页面版本，不保证未来 DOM 标记保持不变。本次使用目录中的 PowerShell 工具在真实原生 Firefox 完成精确标签选择、Console 真实粘贴与哈希核验、油猴更新和源码核验、刷新、原生 Ctrl+Enter 恢复队列、诊断按钮和清理调试页。CodeMirror 的隐藏 Value、CSP eval 限制和按钮为空的点击拦截均有真实证据。`--inline` 生成器增加了 Unicode/连续空格源码保真的测试；完整生成器流程未另做真实安装重测。没有全面验证所有 UIA Action，NewTab 等控件的 Invoke 支持取决于 Firefox 的实际标记。

## MCP 的边界

临时 stdio MCP 的已有会话路径曾用于连接尝试；真实 ChatGPT evaluate 超时，不能当作功能通过。本次发布验证了 SDK 协议交互与文件调度逻辑，使用的是假 MCP server。它没有证明当前 Firefox 的 Marionette/BiDi 状态、真实 evaluate、网站挑战页或每个工具都可用。

截图成功编码、UIA Invoke、控制台执行请求、Tampermonkey 保存请求和 HTTP 200 都只是各自阶段的证据；技能要求进一步核对实际安装、输出标记、截图内容及真实网页行为。
