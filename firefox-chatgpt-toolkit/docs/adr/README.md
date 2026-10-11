# 架构决策记录

ADR 记录选择及其原因；当前工作状态与验证边界见 [CONTEXT.md](../CONTEXT.md)，模块关系见 [architecture.md](../architecture.md)。历史实现的准确决策日期无法从源码确定，以下相关记录统一标为“历史决策追记 2026-10-10”，不把追记日期作为功能完成或验收日期。

| ADR | 决策 | 状态 |
| --- | --- | --- |
| [0001](0001-userscript-local-dom.md) | 使用 Tampermonkey 和本地 DOM 适配 | DOM 方案保留；管理器选择由 0012 更新 |
| [0002](0002-native-composer-fifo.md) | 复用原生输入框，自动顺序发送 | 已采纳 |
| [0003](0003-receipt-active-errors.md) | 接收即出队，独立记录当前回合，错误停止发送 | 已采纳 |
| [0004](0004-state-and-ownership.md) | 按模式与会话保存，用 Web Locks 管理标签页所有权 | 已采纳 |
| [0005](0005-work-codex-adapters.md) | 根据语义结构区分 Chat、Work 和 Codex | 已采纳 |
| [0006](0006-native-theme-layout.md) | 跟随原生主题，在会话容器内默认全宽 | 已采纳 |
| [0007](0007-workspace-source-authority.md) | 迁移完整 Git 工作环境，保留唯一源码入口 | 已采纳 |
| [0008](0008-obsidian-rest-api.md) | 通过 Obsidian Local REST API 归档，接受应用运行依赖 | 已采纳，1.8.0 已实现 |
| [0009](0009-puppeteer-background-validation.md) | 使用 Puppeteer Core 后台验收，完整项目迁移到 E 盘 | 已采纳，启动方式由 0010 补充 |
| [0010](0010-nightly-runtime-remote-control.md) | Nightly Remote Control 运行时接入与桌面观察 | 已采纳，真实后台只读验收通过 |
| [0011](0011-native-userscript-updates.md) | 油猴原生元数据与本机后台更新源 | 发布流程保留；当前管理器及安装路径由 0012 补充 |
| [0012](0012-violentmonkey.md) | 迁移到 Violentmonkey，显式 page 注入并保留单一源码 | 已采纳；运行与迁移验收按带日期记录分别确认 |

改变上述约束时新增 ADR，并在旧记录标明取代关系；修正文档中的事实错误可直接修改原记录。证据链接指向带日期的验收或源码，历史验收不代表当前网页版本通过验证。
