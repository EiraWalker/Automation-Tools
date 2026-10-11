# Firefox / Nightly 的 Violentmonkey 安装与更新

工作区：`E:\firefox dev`。本流程使用 **Violentmonkey 原生 @updateURL / @downloadURL**，只向本机提供发布产物。目标扩展版本为 2.49.0，源码基础版本为 1.9.0。Firefox 和 Firefox Nightly 分别核验扩展、脚本及运行版本；扩展已安装不代表其中已安装 ChatGPT Queue。

日常发布保持现有浏览器会话、窗口、可见标签和草稿。本次迁移已授权通过现有后台连接执行 Violentmonkey 原生脚本安装和保存，无需为这些操作重复确认；浏览器原生权限及首次连接弹窗由用户处理。不用系统键鼠、共享剪贴板或 profile 数据库写入代替。完整边界见 [任务规范](task-rules.md)。

## 首次安装和切换

在模块目录发布并启动更新源：

```powershell
Set-Location -LiteralPath 'E:\firefox dev\firefox-chatgpt-toolkit\browser\firefox-puppeteer'
npm run userscript:update
```

首先核对目标浏览器中 Violentmonkey 扩展是否持久安装且已启用。用户此前要求安装扩展，并不代表脚本也已保存；以本次检查证据为准。更换脚本管理器不会解除 Firefox 对 `moz-extension://` 页面的调试权限限制。已有授权连接可按 [扩展页访问入口](system-access.md) 操作；若协议拒绝访问，记录安装待办，继续本地发布和回归，不换通道绕过。

从 Tampermonkey 切换前，完成旧脚本的待发队列与当前回答，保留草稿；只停用其中的 **ChatGPT Queue · Accent**，保留其旧数据。已打开网页中的脚本可能继续运行，须等方便时正常重载相关页面结束旧实例。不要在两个管理器中同时启用本脚本，不迁移发送结果未确认的 active 状态。

在 Violentmonkey 管理页使用“从 URL 安装”对应入口，地址为 `http://127.0.0.1:18765/chatgpt-queue.user.js`；通过管理器原生安装页保存，核对 **ChatGPT Queue · Accent** 的启用状态及本机版本。已经授权的后台安装可直接执行；出现浏览器原生权限弹窗时由用户确认。2026-10-12 最终本机副本为 1.9.0.3，后续实际版本以 `npm run userscript:status` 为准。Violentmonkey 已有同 name / namespace 的脚本时更新原项；出现重复条目时先核对，不同时启用。不要把链接下载或编辑器中出现源码当作持久安装成功。

Tampermonkey 与 Violentmonkey 的 GM 存储独立，即使键名一致也不会自动迁移。本版本不提供跨管理器数据导入工具；在脚本“设置”重新配置偏好与归档连接参数，密钥只通过设置输入。旧归档映射需要另行迁移并校验；旧数据和已验证的加密备份继续保留。未验证的 ZIP 导入不能视为迁移成功，不能为了迁移把密钥导出为明文。详细边界见 [插件说明](../../../userscripts/chatgpt-queue/README.md#从-tampermonkey-切换)。

确认该脚本的更新检查已启用，更新地址为 `http://127.0.0.1:18765/chatgpt-queue.meta.js`，下载地址为 `http://127.0.0.1:18765/chatgpt-queue.user.js`。两者都是稳定别名，不把脚本的 downloadURL 固定到某个历史版本。Violentmonkey 使用已安装记录中的下载地址；旧安装如果固定到 1.9.0.1 等版本，必须通过管理器原生编辑或安装流程一次性修正，单独发布新元数据不会改变它。实际检查周期由 Violentmonkey 设置决定，工具不改全局周期或其他用户脚本。新版本在下次正常加载 ChatGPT 页面时运行；安装流程不会自动刷新现有聊天或热替换队列。

安装后分别核对独立管理文档中的已启用版本、持久保存和新文档运行版本。管理页缓存、内存记录与源码编辑器的短时哈希一致不足以证明持久保存。2026-10-12 的 Tampermonkey Blob 写入故障及此前扩展页访问拒绝属于历史诊断，保留在 [VALIDATION](../VALIDATION.md)；不能由换用 Violentmonkey 推定已消除。持久化失败时不重复写入 profile 或直接修改扩展存储来掩盖结果。

## 日常更新

修改源码后再次执行 `npm run userscript:update`。流程依次执行：

1. 使用项目已有正数测试计数检查构建并运行插件测试，再做产物语法检查。
2. 核对脚本身份，在 `.local/userscript-update/releases/` 保存不可变源码、元数据和 SHA-256。
3. 发布本地四段版本，如 `1.9.0.1`、`1.9.0.2`。内容不变时复用版本；源码基础版本降低时拒绝发布。公共构建文件继续使用其原始版本和 `none` 更新源，本机 URL 只写入私有发布副本。
4. 原子替换当前版本指针。元数据和脚本中的 downloadURL 都保留稳定 `/chatgpt-queue.user.js` 别名；服务器校验完整性后提供当前发布快照。元数据与源码之间若发生新发布，源码请求可能取得更新版本；单次响应保持完整，不承诺两个请求同版。
5. 启动或复用隐藏的 Node 本机服务，交给 Violentmonkey 按其周期检查更新。它不连接 Puppeteer、读取聊天、热替换已运行脚本或重启浏览器。

发布命令完成不意味着 Violentmonkey 已经检查或保存更新。首次安装、权限变化或扩展策略可能需要用户确认。已授权的后台扩展页操作以持久保存、脚本列表和实际运行版本验收；至少完成一次由 Violentmonkey 自身检查并保存新版本的过程，才记录真实更新通过。2026-10-12 已发现旧固定 downloadURL 会使扩展读到新元数据后仍下载旧源码；原方案及修正依据见 [ADR 0011](../../../docs/adr/0011-native-userscript-updates.md)。

## 服务生命周期

```powershell
npm run userscript:status   # 当前发布版本、运行状态、到期时间；不声称已安装
npm run userscript:stop     # 只停止此更新源，不结束 Firefox 或其他 Node 进程
npm run userscript:start    # 启动已有发布包，不重新构建
npm run userscript:publish  # 只构建/测试/发布，不启动服务
```

服务绑定 `127.0.0.1:18765`，不注册开机启动、计划任务或系统服务。启动后最多运行 24 小时；复用现有进程不会延长到期时间。需要新的服务周期时先 stop，再 start。服务离线不会影响已安装脚本，只会让该次更新检查失败；启动后等待 Violentmonkey 下一次检查。

固定端口被其他程序占用时失败，不终止占用进程。停止通过私有实例文件请求自有进程退出，不按陈旧 PID 杀进程。服务仅支持 GET/HEAD 与固定发布路由，校验 Host，不提供目录列表、CORS 或 HTTP 写接口。服务文件、日志、版本清单全部位于根 `.local/`，不会发布项目配置或密钥。

`publish.lock` 在发布进程异常退出后可能保留；先检查该进程是否仍在运行，再人工清理锁。失败产生的不完整版本目录需要先检查和归档；工具不自动覆盖历史版本。保留旧发布包供审查；回退业务源码时重新构建发布更高的本地修订号，不把版本号降回旧值。

## 后台验收与证据

使用 [任务规范](task-rules.md)，通过已有精确 URL/标题配置执行 `npm run inspect`。新发布包运行后，队列宿主的 `data-cq-version` 来自 Violentmonkey `GM_info.script.version`；工具只读该值及归档按钮结构，不读 API 密钥或聊天正文。用户自然刷新前保留旧版本是预期行为。检查失败不自动刷新页面。

分别记录：

| 层次 | 证据 | 不能据此声称 |
| --- | --- | --- |
| 本地发布 | 测试、版本、文件 SHA-256 | 扩展或脚本已安装 |
| HTTP 交付 | `requests.jsonl` 的元数据/源码请求 | 扩展已保存或启用；请求可能来自诊断工具 |
| 扩展与脚本安装 | 目标浏览器的 Violentmonkey 状态、独立管理文档和持久保存证据 | 现有 ChatGPT 页面已经运行新版本 |
| 页面运行 | 指定页面读取的 `runningUserscriptVersion` | 所有旧标签已更新、另一个浏览器也通过 |
| 业务功能 | 真实目标上的对应断言 | 仅版本一致不能代替队列/归档验收 |
| 原生更新 | Violentmonkey 检查并保存更高版本，正常新文档运行该版本 | 自动检查周期已按预期触发；手动检查需单独注明 |

`inspect` 的 passed 表示只读检查及不干扰采样通过，仍须比较运行版本与发布版本。后台窗口/可见标签/剪贴板观察器用于实际 Puppeteer 检查；本地发布命令本身没有浏览器操作。截图继续使用 AgentCapture，不能将当前显示的其他标签当作后台目标证据。

## 选择依据

- [Violentmonkey 元数据](https://violentmonkey.github.io/api/metadata-block/)：脚本身份、版本、注入上下文与下载地址。
- [Violentmonkey v2.49.0 更新实现](https://github.com/violentmonkey/violentmonkey/blob/v2.49.0/src/background/utils/update.js)：从元数据检查版本，再获取脚本并保存更新。
- [ADR 0012](../../../docs/adr/0012-violentmonkey.md)：迁移目标、单一源码、数据切换和验收边界。

验证日期与未完成项见 [VALIDATION](../VALIDATION.md)。
