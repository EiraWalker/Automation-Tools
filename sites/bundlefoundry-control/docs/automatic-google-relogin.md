# BundleFoundry 会话失效后的自动 Google 登录

Render 的 `RecoveringBundleFoundry` 在读取页面或免费结账遇到会话失效时，
调用 `SessionRecovery`。有效会话直接使用原 Cookie；网络错误不会启动登录；
账号不一致立即拒绝。

## 执行与保管主体

| 内容 | 执行或保管主体 |
| --- | --- |
| Google 浏览器会话恢复与登录 | Render 中临时启动的 headless Chromium，由 Playwright 控制 |
| 精简浏览器资料 | 加密后进入现有 checkpoint，持久保存在 Sites 管理的 D1 中 |
| 浏览器资料独立密钥 | Render 秘密环境变量 `GOOGLE_BROWSER_KEY` |
| BundleFoundry Cookie 和队列 | 原 `CREDENTIAL_KEY` 加密的 checkpoint |
| 初始浏览器资料 | Render 秘密环境变量 `GOOGLE_BROWSER_PROFILE_ENCRYPTED`，仅用于首次恢复 |
| 私有控制页及失效测试入口 | owner-private ChatGPT Sites，平台 OAuth 认证 |

Gmail 连接凭据仍留在平台；自动登录不使用 Gmail OAuth token。
精简 profile 只包含 Chrome 的 Local State、Cookie 数据库和 Preferences，
没有历史记录和缓存。它仍是敏感登录资料，不能放入 GitHub。
独立密文中的 schema 2 还包含 Google 域的 Cookie 导入数据，
用来应对不同 Chromium 发行版或宿主的 Cookie 数据库解密差异；
导入时限制 Google 域并要求 HTTPS，保留真实有效期，不延长服务端授权。
浏览器资料先使用独立密钥加密，再随整体 checkpoint 使用原密钥加密；
Site 不持有两把解密密钥。生产平台秘密变量及其调用参数不得打印。

## 自动恢复

1. Sites 的 D1 lease 与单实例 Render API 锁保证一次只执行一个任务。
2. 在权限受限的临时目录解密 profile，启动 Chromium。
3. 清除 profile 中所有 BundleFoundry Cookie，保证恢复使用 Google 登录流程。
4. 访问 `/auth/google/redirect`。只允许选择预期账号，不输入密码、验证码或同意新权限。
5. 核对网站返回的邮箱；只导出 BundleFoundry HTTPS Cookie。
6. 使用领取程序自己的 HTTP 客户端访问 My Bundles，确认新会话可用。
7. 删除浏览器中的网站 Cookie、关闭 Chromium 并等待进程退出，再加密更新后的 Google profile。
8. 更新检查点，删除临时明文目录。恢复领取时先核对已有购买和 pending journal。

每个任务最多尝试一次自动登录。Google 要求人工验证或账号不一致时，
保存 `needs_authorization`，冷却 12 小时；浏览器或网络不可用时冷却 15 分钟。
状态及冷却时间进入 checkpoint，实例重启不会取消冷却。
账号选择兼容 `data-identifier` 和 `data-email` 两种标记，只点击预期账号。
Google 的拒绝登录页立即记录 `google_session_rejected`，密码验证页记录
`google_password_required`，不把它们作为普通网络错误反复重试。
Google Cookie 文件能够恢复、Cookie 数量大于零，都不能证明 Google 接受会话；
只有网站回调后的账号核对和 My Bundles 验证通过，才记录自动重登录成功。
人工验证继续遵循 [私有 Sites OAuth 要求](private-verification.md)；
Render 不提供登录、桌面或 WebSocket 浏览器入口。

## Google 要求重新验证时

首选私有 Site 的 `/google-authorization` 远程浏览器入口，额外要求所有者身份。
用户直接在画面中的 Google 官方页面操作，进入 BundleFoundry 后点击“保存并测试”。
Chromium 运行于临时 Codex 工作环境；Sites 对每次画面读取和输入操作核验所有者身份，
使用后端服务密钥调用 Render 的机器 API。Render 不托管交互网页、不信任外部身份头。
Codex 浏览器代理以独立的 `GOOGLE_BROWSER_AGENT_TOKEN` 连接机器 API，
HTTPS 传输画面与一次性输入队列；帧、输入和导入资料仅在内存中暂存，不写日志或数据库。
会话 15 分钟过期，关闭、过期和提交后清除帧及输入；代理停止 Chrome 后才归档，
删除临时明文 profile。代理保留独立加密的恢复备份，不记录密码、验证码或截图。
Render 核实账号并加密新资料，私有 Site 保存 checkpoint，然后执行云端失效测试。
定时任务只有平台服务身份，不能操作远程浏览器；此入口依赖临时 Codex 环境在线。
日常自动重登录仍由 Render 执行，不依赖这个临时人工授权代理。

以下本地脚本方式作为备用入口 `/google-authorization/local` 保留：

所有者打开该备用入口，下载本地授权脚本。
在自己的电脑安装 Python 3 和 Chrome，执行 `python -m pip install playwright`，
再运行下载的 `google-local-auth.py`。输入预期邮箱，在专用 Chrome 窗口的
Google 官方页面完成登录；脚本核对 BundleFoundry 邮箱，导出 Google 与网站会话。
脚本不读取密码或验证码，Chrome 退出后才归档精简 profile，最后删除临时浏览器目录。

生成的 `google-session-import.json` 是敏感的临时明文文件（在支持 POSIX 权限的系统上为 `600`）。
只在私有 Site 上传，导入后删除；不要提交仓库、转发或粘贴到聊天。
上传接口 `/api/google/import` 要求 Sites 所有者身份、同源 Origin 和 JSON，
仅有平台服务凭据的定时任务不能更换会话。
Sites 通过 HTTPS 和独立后端服务认证转发资料，不将明文写入 D1。
Render 限制导入域名、归档内容和大小，通过 My Bundles 核对账号后，
才用既有独立浏览器密钥加密资料并返回检查点。失败不覆盖原检查点。
导入保留原领取队列与验收记录，不执行购买；新授权清除旧冷却状态。
页面在导入成功后立即发起云端失效测试；导入成功本身不表示自动重登录通过。

## 配置与初始迁移

Render 设置 `AUTO_RELOGIN_ENABLED=true`、`GOOGLE_BROWSER_KEY`、
`GOOGLE_BROWSER_PROFILE_ENCRYPTED`。浏览器密钥必须独立生成，不能复用 `CREDENTIAL_KEY`。
初始 profile 从已有加密 Google 归档提取上述会话文件，再用新密钥重新加密。
密钥和生产资料只在平台秘密配置中导入。

现有 Render build 命令安装 `requirements.txt` 中的 Playwright；服务启动后在后台
安装其对应 Chromium Headless Shell，`browser_runtime_ready` 表示下载完成。
可在自管宿主设置 `GOOGLE_BROWSER_EXECUTABLE` 使用预安装的 Chromium。
运行环境需要 Chromium 系统依赖；最终是否可运行，以真实云端登录验收为准。
Google 判断会话是否可用，资料可恢复不能保证永久免交互。

更换 Google 授权或轮换浏览器密钥时，要同时重新导入独立加密 profile 和
更新后的凭据 bootstrap，使旧 checkpoint 的 bootstrap 摘要失配；保留队列和验收记录。
正常任务优先保留 checkpoint 中更新后的 profile，初始配置不会覆盖它。

## 主动失效验收

仅在验收期间，将 Sites 和 Render 的 `SESSION_RECOVERY_TEST_ENABLED` 都设为 `true`。
通过私有 Site POST `/api/session-recovery/test`，请求体为 `{source_account, messages: []}`。
网关读取已有 checkpoint；后端只清空本次临时 vault 的网站 Cookie，
先确认匿名访问 My Bundles 失败，再自动 Google 登录并核实账号。
验收不会处理领取队列，也不会执行购买；失败不会覆盖原来可用的检查点。

成功证据为：`site_session_invalid_before_login`、`google_session_reused`、
`account_verified`、`site_session_valid_after_login`、`no_interactive_input`、
`browser_profile_reencrypted` 均为 `true`。
再次运行普通更新应复用新 Cookie，不再打开浏览器。
重启后重复失效测试应复用 checkpoint 中更新后的 Google profile。
结束后关闭两端测试开关；私有快照保留验收结果，公开仓库只保存无凭据的说明。
