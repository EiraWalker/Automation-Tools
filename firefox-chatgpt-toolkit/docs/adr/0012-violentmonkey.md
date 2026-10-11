# ADR 0012：迁移到 Violentmonkey，保留单一源码与脚本身份

- 日期：2026-10-12
- 状态：已采纳；当前安装与验收结果见 [CONTEXT](../CONTEXT.md) 和 [VALIDATION](../../userscripts/chatgpt-queue/VALIDATION.md)
- 关系：更新 [ADR 0001](0001-userscript-local-dom.md) 的脚本管理器选择，保留本地 DOM 适配及 [ADR 0011](0011-native-userscript-updates.md) 的本机发布机制

## 背景

用户要求把脚本迁移到 Violentmonkey，并在 Firefox 和 Firefox Nightly 中使用。此前 Nightly 的 Tampermonkey 5.5.0 安装诊断出现 Blob 持久写入异常；内存和已打开管理页中的成功记录不能证明保存完成。该故障及既有普通 Firefox 验收属于带日期的历史证据，不能推定更换管理器后自动修复。

队列核心、页面适配、设置和归档已分为源码模块。现有同步 GM 存储、菜单、剪贴板、跨标签通知与请求接口不需要为了迁移重写业务状态机。

## 决策

源码版本升至 1.9.0，项目运行环境统一为 Firefox / Firefox Nightly + Violentmonkey，扩展版本基线为 2.49.0。保留 `ChatGPT Queue · Accent` 名称、namespace、匹配范围、权限和 GM 键；同一套源码生成一个完整用户脚本，不建立管理器专用分支。

为 Violentmonkey 显式声明 `@inject-into page`。当前 adapter 直接访问页面的 ProseMirror 对象，所有权管理还涉及页面 Promise 和 Web Locks；自动回退到隔离的 `content` 上下文不能视为等价兼容。保留 Tampermonkey `@sandbox JavaScript` 供原有环境使用，兼容元数据不代表该环境已重新验收。若当前网页 CSP 阻止 page 注入，记录失败并调查，不静默宣称兼容或自动降低页面安全限制。[Violentmonkey 注入文档](https://violentmonkey.github.io/api/metadata-block/#inject-into)

选择 page 上下文以复用原生编辑器，代价是信任同一页面 JavaScript 环境：页面可以修改共享对象和调用所经过的浏览器 API。GM 持久存储仍由扩展管理，但这不意味着读取到内存并用于请求的 API key 与页面运行环境隔离；脚本不把密钥挂到页面全局对象，也不能把 page 模式描述为独立的凭证隔离边界。

继续通过管理器提供的 GM API 持久化状态和执行跨源归档请求。保留 `anonymous: true` 及 Tampermonkey 的 `redirect: 'error'` 兼容选项，但 Violentmonkey 2.49.0 不处理后者。对响应要求可解析的 `finalUrl`，忽略 fragment 后必须与请求地址一致；3xx 或地址变化报 `A_REQUEST_REDIRECT`，最终地址缺失或无效报 `A_REQUEST_RESPONSE`。错误中不携带响应正文或凭证。该检查阻止采用异常响应及后续归档验证、映射更新和旧笔记删除，发生在请求之后，不能保证敏感请求事前未被转发。配置必须使用可信且直接响应的 API 地址。[Violentmonkey GM API](https://violentmonkey.github.io/api/gm/)、[v2.49.0 请求实现](https://github.com/violentmonkey/violentmonkey/blob/v2.49.0/src/injected/web/requests.js)

公共构建保留 `none` 更新源；本机发布副本使用 1.9.0.1 起的递增版本，继续复用 loopback 发布器。`@updateURL` 和 `@downloadURL` 均使用稳定别名，分别为 `/chatgpt-queue.meta.js` 和 `/chatgpt-queue.user.js`，旧版本文件与哈希仍不可变归档。Violentmonkey 使用已安装记录中的下载地址；将该地址固定到旧发布文件会阻止后续升级，仅修改新元数据不能修复。已固定的旧安装需在管理器原生流程中一次性修正。详见 [ADR 0011 的实测修正](0011-native-userscript-updates.md#2026-10-12violentmonkey-使用稳定下载地址)。[Violentmonkey 更新实现](https://github.com/violentmonkey/violentmonkey/blob/v2.49.0/src/background/utils/update.js#L111-L138)

服务的原子当前指针及完整性校验保证每次响应属于完整发布快照。元数据与源码是两个独立请求，发布竞争时源码可能比之前读到的元数据更新；不再承诺两次请求固定到同一版本。Violentmonkey 自己比较版本并保存更新，最终核对实际保存版本及哈希，不把 HTTP 成功称作安装成功。

## 数据与切换边界

两个管理器的存储彼此独立；相同 name、namespace 和 GM 键只保持数据格式，不能跨扩展读取。先处理完旧队列和当前回答、保存草稿，再停用旧脚本，在方便时正常重载相关页面以结束已注入实例。不要同时运行两份脚本，也不复制发送结果尚未确认的 active 状态。

保留旧脚本及其数据，已有加密备份继续复用。1.9.0 不新增跨管理器导入工具：归档连接参数和偏好在新管理器中配置，密钥只进入脚本设置；旧归档映射需单独迁移和校验。没有验证 Tampermonkey ZIP 值导入的完整性前，不将普通源码导入或通用 ZIP 支持描述为配置迁移完成。操作路径见 [插件说明](../../userscripts/chatgpt-queue/README.md#从-tampermonkey-切换)。

更换管理器不解除 Firefox 的扩展页调试访问限制。本次迁移授权覆盖通过已有获授权后台连接执行脚本管理器的原生安装和保存；浏览器原生权限与首次连接弹窗仍由用户确认。不激活窗口、切换可见标签、模拟系统输入、改共享剪贴板或自行重启浏览器。协议拒绝访问时继续本地检查，记录剩余安装工作，不能换通道绕过。

## 验收

本地检查覆盖元数据、页面对象访问分支、所有权及 GM 请求适配，并继续执行现有队列和归档回归。Firefox 与 Nightly 各自确认：

1. 扩展安装及脚本持久保存，独立管理文档中的启用版本；缓存行不作为唯一依据。
2. 指定测试页面的新文档实际运行版本及注入上下文，队列、全宽、菜单和归档宿主。
3. Chat、Work、Codex 输入框写入及回执、跨标签独占、刷新恢复、归档请求与错误。
4. 一次由管理器检查并保存新版本的真实更新，以及下次正常页面加载后的版本。

本地构建及测试、扩展安装、旧数据切换和网页业务验收分别记录。历史 Tampermonkey 结果不会被改写为 Violentmonkey 通过。
