# ADR 0003：回执、当前回合与错误

状态：已采纳。日期：历史决策追记 2026-10-10。

## 背景

用户要求 prompt 开始运行时立即出队，且无法确认发送结果必须作为错误报告，不能弹出“已发送/未发送”的人工判断。网页点击发送不等于收到消息。

## 决策

发送前持久化状态与用户消息基线。只有出现新的匹配用户消息回执，才从 `state.items` 移除条目，并在 `state.active` 保留正文、消息标识和运行阶段。回答完成且页面状态稳定后清除 active，再发送下一条。

刷新后根据回执恢复 active。发送确认超时、正文不匹配、上下文冲突或存储失败会记录错误码、停止自动发送并保留恢复所需状态。重新检测读取现有回执，不再次点击发送；不因发送结果不确定而自动重试。

与“答案结束才出队”相比，这能准确显示尚未发送的条目。与“点击即出队”相比，匹配回执避免把未接收消息误记为成功。

## 影响

空队列不能作为回答完成的证据。恢复必须兼容旧版本将已接收条目留在 items 中的状态。网页没有提供本脚本可用的幂等发送协议，无法承诺所有网络故障下严格 exactly-once；恢复策略优先避免不确定发送的自动重放。

错误通过 Console、`chatgpt-queue:error` 和诊断卡片可识别。诊断包含错误码、阶段与状态信号，不包含聊天正文或网址。圆框与强调/中性按钮保留在可复用 NoticeCard 中。

## 依据

- [QueueEngine](../../userscripts/chatgpt-queue/src/core.cjs)
- [回执适配与发送流程](../../userscripts/chatgpt-queue/src/browser.js)
- [NoticeCard](../../userscripts/chatgpt-queue/src/notice-card.js)
- [恢复与错误验收](../../userscripts/chatgpt-queue/VALIDATION.md)
