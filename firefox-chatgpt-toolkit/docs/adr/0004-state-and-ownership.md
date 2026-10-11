# ADR 0004：持久化范围与标签页所有权

状态：已采纳。日期：历史决策追记 2026-10-10。

2026-10-12 环境更新：当前管理器为 [ADR 0012](0012-violentmonkey.md) 指定的 Violentmonkey，GM 状态和跨标签所有权方案继续沿用；下文 Tampermonkey 缓存说明保留为历史诊断。

## 背景

同一页面会进行 SPA 导航、切换模式，也可能在多个标签页打开同一会话。缺少范围和所有权会导致队列串入其他模式或重复发送。

## 决策

按会话和模式保存 GM 状态。保留历史 Chat 键 `cq-accent-v1:<id>`；Work 和 Codex 分别使用 `cq-accent-v1:work:<id>`、`cq-accent-v1:codex:<id>`。尚未取得会话 ID 的临时队列使用当前标签页 sessionStorage 标识，只有同模式取得真实 ID 时允许迁移。

使用 Web Locks 为每个状态键取得唯一发送所有者。其他标签页订阅持久化变化，只读展示。路由或模式变化先使旧所有者失效、暂停旧 engine，再绑定新适配器和状态。

与每个标签页独立队列相比，共享状态加独占锁保留一致队列；与全站共享队列相比，模式和会话隔离减少上下文误投。

## 影响

锁不可用或获取失败时禁用自动发送。第二个标签页不能同时调度；关闭拥有者后刷新另一页接管。刷新后的队列默认暂停，先恢复回执，再由用户接续。

Firefox 用户脚本沙箱与页面的 Promise/回调有跨 realm 边界，锁实现须保留页面 realm 的 Promise。GM 存储含队列正文，属于本机私有数据；直接改 Tampermonkey 的 extension storage 不能证明其 GM 缓存已同步。

## 依据

- [bootQueue 的键、锁与生命周期](../../userscripts/chatgpt-queue/src/browser.js)
- [多模式与导航回归测试](../../userscripts/chatgpt-queue/tests/work-codex.test.cjs)
- [状态恢复与已有会话验收](../../userscripts/chatgpt-queue/VALIDATION.md)
