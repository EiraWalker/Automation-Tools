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
人工验证继续遵循 [私有 Sites OAuth 要求](private-verification.md)；
Render 不提供登录、桌面或 WebSocket 浏览器入口。

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
