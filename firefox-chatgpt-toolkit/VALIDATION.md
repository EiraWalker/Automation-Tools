# 验证记录

日期：2026-10-06。这里保留汇总结果，不发布网页截图、消息内容、会话地址、扩展 UUID 或本机窗口标识。

## 打包后检查

| 检查 | 结果 | 实际验证范围 |
| --- | --- | --- |
| ChatGPT Queue `npm test` | 37/37 通过 | 队列状态机、忙闲识别、原生编辑器、草稿保护、主题/布局、快捷键与 UI |
| 生成脚本语法与重建 | 通过 | `npm run check`、`node build.cjs`；生成产物与本次会话最终 1.5.4 一致 |
| Firefox 自动化 `npm test` | 10/10 通过 | jsdom 页面守卫、编辑器更新、草稿恢复、HTTP 文件服务、文件 RPC 并发、假 MCP 的超时与不重放 |
| Native policy / parser | PowerShell 5.1 和 7 均通过 | 完整 URL 匹配、代码 SHA-256、HWND 格式、脚本解析 |
| `-LiveReadOnly` | 两个 PowerShell 版本均通过 | 发现 3 个当前 Firefox 窗口；只读操作不改变前台，错误目标拒绝且不抢占前台 |
| 截图适配器 unittest | 7/7 通过 | JSON envelope、退出码、无 shell 启动、超时和 EXE 解析 |
| 已安装 AgentCapture 1.0.0 | help / 窗口发现通过 | 新目录中的适配器可读取当前 Firefox 窗口；打包时未新拍用户网页截图 |
| 三个 SKILL.md | quick_validate 均通过 | YAML name/description 和 skill 格式 |

生成脚本 SHA-256：

```text
f3979eec383b20b936d100688c0478dccdbf300427dc9c12fee29f826967e4d1
```

## 本次开发会话的真实网页验收

以下是打包前在用户原生 Firefox、已登录 ChatGPT 和指定测试标签中完成的验收，不是 jsdom 的结果：

- Tampermonkey 正式安装并启用；确认 `https://chatgpt.com/*` 匹配，修正站点排除，刷新已有页面。仅在 Console 临时注入某个聊天不视为安装成功。
- 1.5.0：回答生成时使用原生 Enter 入队，两条排队消息在各自回答结束后自动接续；编辑复用原生输入框；全宽通过油猴设置保存和立即切换。
- 1.5.1：空队列的 `Ctrl + Enter  Enqueue` 提示持续显示，队列列表与操作按钮隐藏。
- 1.5.2 / 1.5.3：夜间配置面板跟随实际网页样式。1.5.3 的面板与网页背景同为 `#0e0e0e`，文字对比度 16.49:1；有效 Accent color 来自页面主题。
- 1.5.4：真实非空队列中没有“加入队列”按钮，快捷键提示可见。最终后台截图尝试遇到窗口最小化，未把该尝试报告为截图成功。
- 会话全宽实测：会话容器 1130px，消息区从 808px 扩展到 1130px；输入框与队列从 768px 扩展到 1090px，保留原生边距；关闭设置后恢复。

真实网页会持续更新。这些结果支持当时的页面版本，不保证未来 DOM 标记保持不变。新目录里的 PowerShell 工具是在原有会话方案上整理、增加守卫与独立测试后的版本；打包期间只进行了只读窗口发现和拒绝目标测试，没有重新发送 ChatGPT 消息或全面重测所有 UIA Action。

## MCP 的边界

临时 stdio MCP 的已有会话路径曾用于连接尝试；真实 ChatGPT evaluate 超时，不能当作功能通过。本次发布验证了 SDK 协议交互与文件调度逻辑，使用的是假 MCP server。它没有证明当前 Firefox 的 Marionette/BiDi 状态、真实 evaluate、网站挑战页或每个工具都可用。

截图成功编码、UIA Invoke、控制台执行请求、Tampermonkey 保存请求和 HTTP 200 都只是各自阶段的证据；技能要求进一步核对实际安装、输出标记、截图内容及真实网页行为。
