# ADR 0006：原生主题与会话全宽

状态：已采纳。日期：历史决策追记 2026-10-10。

2026-10-12 环境更新：当前设置入口为 Violentmonkey 的 ChatGPT Queue 脚本菜单，见 [ADR 0012](0012-violentmonkey.md)；下文保留原管理器名称，主题与全宽决策继续沿用。

## 背景

用户要求 Accent color 跟随 ChatGPT 当前有效值、设置面板与网页夜间模式一致、默认全宽，并移除网页中的全宽按钮。参考项目可能使用已经失效的前端选择器。

## 决策

队列使用 Shadow DOM 隔离自有样式，读取页面主题变量及原生发送按钮的有效颜色。设置面板读取实际背景、文字、字体和 color-scheme；缺失可识别的 accent 时使用中性灰。背景随原生明暗主题变化，不固定为橙色或固定黑色。

默认开启会话全宽，由 Tampermonkey 的脚本“设置”菜单保存开关。只在当前输入框所属的会话容器添加 `data-cq-wide-root`，覆盖原生宽度变量为容器的 `100%`；切换页面重定位，关闭时移除自有属性。

对比固定配色和 `100vw`，原生主题取值与容器百分比保留网页当前样式、原生边距和侧栏空间。参考 KeepChatGPT 的布局思路，独立实现当前页面结构，未复制其旧选择器或源码。

## 影响

主题取值和宽度变量仍依赖前端结构，应在对应改动时检查当前页面。默认值不会覆盖用户已经保存的关闭设置。

历史主题与宽度数值见验收记录；它们不是今天或所有 Work/Codex 布局的测量。UI 参考归属和许可保留在 THIRD_PARTY_NOTICES。

## 依据

- [WideLayout、QueuePanel 与 QueueSettings](../../userscripts/chatgpt-queue/src/browser.js)
- [Shadow DOM 样式](../../userscripts/chatgpt-queue/src/queue.css)
- [主题与宽度历史验收](../../userscripts/chatgpt-queue/VALIDATION.md)
- [第三方说明](../../userscripts/chatgpt-queue/THIRD_PARTY_NOTICES.md)
