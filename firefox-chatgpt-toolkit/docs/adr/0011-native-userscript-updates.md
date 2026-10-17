# ADR 0011：使用油猴原生机制后台更新本机开发脚本

- 日期：2026-10-11
- 状态：发布流程已采纳；2026-10-12 改由 [ADR 0012](0012-violentmonkey.md) 指定 Violentmonkey，并按下文修正下载地址。实际安装与更新状态见带日期验收

## 背景

用户要求脚本安装和更新不干扰其他工作。当前脚本构建中的 updateURL/downloadURL 均为 none。Puppeteer 可以读取指定后台网页，但 Firefox 在未授予 system access 的会话中拒绝导航到油猴扩展页。用户随后提供的 Nightly 管理页截图显示没有已安装脚本；此前把下载请求视为安装成功的判断已撤销。

## 初始决策（2026-10-11）

采用 Tampermonkey 原生元数据更新，专用 Node HTTP 分发器仅监听 loopback 并提供已验证的一个脚本。首次绑定由用户在方便时确认；此后发布流程构建、测试、保存不可变版本、原子切换元数据，交由油猴按自身周期检查安装。协议与安装行为仍由成熟的油猴实现负责。

本机发布副本采用递增四段版本，保持 name/namespace、业务源码、存储键与权限；公共构建保持可离线安装。初始方案将下载地址固定到发布版本，意图避免元数据/源码竞争；这一选择在下述 Violentmonkey 真实更新检查中被证实不能延续更新，已被稳定下载地址取代。服务按需启动、隐藏运行、24 小时退出，不安装常驻系统服务。每个历史发布副本保留 SHA-256。

不自动刷新已有聊天，不热更新正在运行的队列，不改浏览器 profile、不使用前台键鼠，不绕过 Firefox 扩展页导航限制。Puppeteer 只读指定页面上的运行版本，不能将下载日志或 DOM 标记称作扩展持久化源码哈希证明。

## 替代方案

- 后台油猴编辑器：当前会话明确受 Firefox 权限限制，放弃这条路径。
- TamperDAV：官方外部编辑器方案，但会涉及全部脚本同步和另一个同步配置；当前单脚本更新无需采用。
- 修改扩展数据库、Console 粘贴、系统键鼠：不能满足可维护性和不干扰要求。

## 2026-10-11 安装验收修正

本机发布及 HTTP 下载已通过，但首次安装仍未完成。用户明确授权配置 `moz-extension://` 调试权限；下一步使用 [Nightly 系统访问入口](https://github.com/EiraWalker/Automation-Tools/blob/legacy/firefox-automation-20261017/firefox-chatgpt-toolkit/browser/firefox-puppeteer/references/system-access.md)，待用户正常结束当前 Nightly 会话后以带权限的新进程进入扩展管理页完成安装，并核对管理页中的真实版本。发布流程保留用于后续更新，安装成功不能再由请求日志或用户打开链接推定。

## 2026-10-12：Violentmonkey 使用稳定下载地址

在 Violentmonkey 2.49.0 对已安装 1.9.0.1 执行原生更新检查时，扩展获取了 1.9.0.2 元数据，但随后仍从已安装脚本保存的 downloadURL 下载 1.9.0.1，版本未升级。上游实现先从已安装记录取 update/download URL，新的元数据只用于版本判断，不替换本轮下载地址。[更新实现](https://github.com/violentmonkey/violentmonkey/blob/v2.49.0/src/background/utils/update.js#L111-L138)、[地址选择](https://github.com/violentmonkey/violentmonkey/blob/v2.49.0/src/common/script.js#L86-L96)

本机脚本的 `@downloadURL` 因此改为稳定别名 `http://127.0.0.1:18765/chatgpt-queue.user.js`；`@updateURL` 继续指向稳定元数据地址。已安装并固定到旧版本的脚本必须通过管理器原生流程一次性修正其下载地址，仅发布新元数据不能自愈。不直接改写扩展存储。

每个版本的文件与 SHA-256 继续不可变归档，服务读取原子切换的当前版本指针并校验完整性。它保证单次响应来自一个完整发布快照，不保证元数据和源码两个独立请求读取同一版本：二者之间若发布新版本，源码请求可能得到更新的完整版本。以实际保存的版本及哈希验收，原“固定地址防混版”不再作为当前保证。

## 后果

日常发布无需控制浏览器。更新不是即时推送；受油猴设置、服务在线时间、权限确认影响。已打开聊天继续运行旧版，正常下次加载才使用新版本。初次绑定和油猴实际自动安装需要分别验证，不能仅依据 HTTP 成功报告完成。

操作与上游依据见 [工作流](https://github.com/EiraWalker/Automation-Tools/blob/legacy/firefox-automation-20261017/firefox-chatgpt-toolkit/browser/firefox-puppeteer/references/userscript-workflow.md)。
