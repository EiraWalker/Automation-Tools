# ADR 0005：Work 与 Codex 的语义适配

状态：已采纳。日期：历史决策追记 2026-10-10；新增模式真实验收日期为 2026-10-09。

## 背景

Work 的工具、审批和补充输入阶段可能保留 Copy 控件。当前 Codex Cloud 使用 `/local/<id>`、不同 composer 根和不带角色后缀的消息键。Work 的显示名称也可能随全局体验变化。

## 决策

保留共用 QueueEngine，让 ChatGPTAdapter 把不同页面结构转换为同一 snapshot、write、send 和 receipt 接口。模式识别优先路径与任务结构，不把 Work 固定为一个英文输入框名称。

| 模式 | 关键结构 | 完成依据 |
| --- | --- | --- |
| Chat | 原生 composer 与用户/助手消息单元 | 当前回答完成控件，且没有 Stop/streaming |
| Work | 当前回合的 `data-talvt-turn-state` | 仅 `complete`；工具、审批、补充输入期间继续等待 |
| Codex | `/local/`、`data-codex-composer-root`、用户气泡和最终回答结构 | 当前最终回答的 Copy/Rate 控件，且没有 Stop/streaming |

Codex 写入后等待原生编辑器异步更新，再点击 Send，并核对用户回执。发送按钮已启用不能证明提交处理器已经读取新文字。

对比按按钮文字统一判断，分模式的语义结构能处理保留控件和不同消息键；共用引擎避免复制调度与恢复逻辑。

## 影响与证据边界

2026-10-09 的 1.7.0 在真实已安装脚本、已有原生 Firefox 中分别完成两个 Work 和两个 Codex 短文字 prompt；队列在收到回执时出队。触发是合成 Ctrl+Q，不能作为新增模式的物理快捷键证据。

工具、审批、补充输入及异常状态有 DOM 回归测试，但尚未完整真实任务验收；其他 Codex URL/layout 变体也未验证。这些结果支持当时页面，迁移本身不构成今天的浏览器复验。

## 依据

- [ChatGPTAdapter](../../userscripts/chatgpt-queue/src/browser.js)
- [Work/Codex 回归测试](../../userscripts/chatgpt-queue/tests/work-codex.test.cjs)
- [1.7.0 验收记录](../../userscripts/chatgpt-queue/validation-1.7.0.json)
