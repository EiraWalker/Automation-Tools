# BundleFoundry 自动领取免费档

收到 `news@bundlefoundry.com` 的新品、最后机会或免费通知后，程序每天检查 Gmail 两次（每 12 小时一次，启动时进行首次检查），跟随邮件中的 Bundle 链接，检查免费额度，调用网站的 `/checkout/claim-free`，再验证账户已拥有该 Bundle。它不会创建付费交易、修改邮件或向别人发送邮件。

## 当前交付状态

已实现领取逻辑并提供自动化测试。`server.py` 提供健康检查和后台监听，未配置授权时保持 `waiting_for_authorization` 状态；该状态表示服务在线，但领取尚未启用。首次授权仍需要 Gmail OAuth refresh token 和 BundleFoundry 登录会话。连接在 ChatGPT 中的 Gmail 授权不能导出成后台程序的凭据。

## 首次授权（在你自己的电脑完成）

也可使用受保护的临时云浏览器完成 BundleFoundry Google 登录。`login_environment.py` 连接一个正常的、带界面的 Chrome 和仅监听 localhost 的 VNC 服务；`login_agent.py` 主动通过 HTTPS/WebSocket 连接 Render，`login_relay.py` 中转桌面和页面请求。用户直接在真实 Google 页面输入密码与验证码，程序不记录键盘、剪贴板、浏览器画面或 HTTP 授权头。专属入口令牌与代理令牌分离，设置 24 小时有效期，Cookie 为 HttpOnly / Secure / SameSite=Strict。未配置秘密变量时，中转入口关闭。

Google 登录资料在使用期间保存在专用、权限为 700 的 Chrome profile 中；登录成功后，只把 BundleFoundry 域名的 HTTPS cookie 保存到加密 vault。点击“保存并关闭浏览器”后，Chrome 资料压缩加密为 `state/google-browser.tar.enc`，并删除本次 profile 的明文目录，供后续安全复用。云浏览器登录不等于 Gmail API 授权；邮箱后台仍需要下述只读 OAuth 配置。临时浏览器依赖当前 Codex 环境存活，不承担长期监听。

Render 中转秘密变量：`LOGIN_ACCESS_TOKEN`、`LOGIN_AGENT_TOKEN`、`LOGIN_SESSION_EXPIRES_AT`。它们不得提交源码。访问令牌只放在专属链接的 URL fragment 中，页面交换访问 Cookie 后立即从地址栏移除；入口密钥与 Google 凭据均不得出现在日志中。

1. 在自己的 Google Cloud 项目中开启 Gmail API，配置 OAuth consent screen，并创建 **Desktop app** OAuth client，下载 JSON。权限只申请 `gmail.readonly`。若 consent screen 为 External / Testing，含 Gmail 权限的 refresh token 通常在 7 天后过期；长期运行需切换到适当的发布状态并遵循 Google 的要求。参见 [Google refresh token 过期规则](https://developers.google.com/identity/protocols/oauth2#expiration)。
2. 安装 Python 3.12+ 和 Google Chrome，下载本目录，运行：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-setup.txt
python setup_auth.py --client-secret /path/to/client_secret.json
```

Windows 激活命令为 `.venv\Scripts\activate`。

授权脚本优先验证已有凭据；有效时直接复用，不打开浏览器，也不重复请求 Google consent。首次运行才打开 Gmail 只读授权页面及专用 Chrome 窗口。网站登录失效时，它先复用专用浏览器的登录状态，再进入 Google 登录流程；需要二次验证时由你完成。脚本自动检测网站登录完成，并核对两个服务的账号一致，无需在终端按 Enter。

无需把 Google 密码发送给助手。云端只保存 Gmail refresh token 与 BundleFoundry 域名的 HTTPS cookies。Google 浏览器 cookies 留在你电脑的 `state/google-browser`，不会上传。凭据使用 Fernet 加密，文件仅允许当前用户访问；云端密钥放在平台的秘密环境变量。

### 跨月复用策略

Gmail 的短期 access token 在内存中按需更新；长期 refresh token 加密保存，若 Google 返回替代 refresh token，则自动持久保存替代值。避免反复创建新的授权。OAuth 项目必须避免 External / Testing 的 7 天过期限制；修改密码、撤销授权及账号安全策略仍可能要求重新授权。

2026-10-06 对网站登录页的实际响应检查显示，`bundlefoundry-session` 和 `XSRF-TOKEN` 的 `Max-Age` 为 `604800`（7 天）。程序保留服务端真实有效期，每 15 分钟访问 My Bundles，并将响应中更新的 cookie 写入加密文件；域名限定的 Remember cookie 若由网站发出，也一并保留。前端的 Remember me 属于密码登录表单，没有证据证明该选项会改变 Google 登录的服务端有效期。

一个月是连续复用的目标，不能通过本地把 `expires` 改为 30 天来实现。持续访问及服务器续期可避免因闲置而反复登录，但首次真实授权后仍须核实该账号的续期行为，不能承诺网站永不撤销会话。Render 必须挂载持久磁盘：最新会话不能仅保存在部署时导入的旧环境变量中。密钥放秘密环境变量，更新后的加密凭据放 `/var/data/credentials.enc`，重启后复用最新文件；不把密钥或 cookies 提交 GitHub。

Google 浏览器登录可用于网站的 `/auth/google/redirect` 流程，但 Gmail 只读 OAuth token 不能直接充当 BundleFoundry 的登录凭据：两者属于不同 OAuth 客户端。专用 Chrome profile 保留已有 Google 登录，供需要重建网站会话时复用；健康的后台领取直接使用网站会话，不需要每天再次登录 Google。

## 运行和检查

```bash
python worker.py --doctor
python worker.py --once
python worker.py --verify-e2e
python worker.py --acceptance-status
python worker.py
python server.py
```

`--doctor` 仅检查配置文件是否齐全，不代表登录有效或后台任务已启动。首次运行检查近 7 天邮件，之后重复读取并通过 SQLite 去重。查询不依赖未读状态，也不标记邮件已读。已领取记录和重试队列保存在 `state/queue.sqlite3`。失败按退避间隔重试；登录失效写入日志，队列不会被当作领取成功。

后台每 15 分钟访问一次 My Bundles 保持网站会话活跃，但服务端仍可能撤销或限制登录有效期，无法保证 Google 网站会话永久有效。网站登录失效时重新运行：

```bash
python setup_auth.py --bundle-only
```

保持密钥不变，更新云端的 `CREDENTIALS_ENCRYPTED` 并重启 worker。程序会识别新授权、替换磁盘上的旧会话，并继续重试未领取邮件。

重复运行 `setup_auth.py --state state` 会复用有效授权；只有 Gmail 被撤销时才需再次提供 `--client-secret`。确实需要更换 Gmail 授权时使用 `--reauthorize-gmail --client-secret /path/to/client_secret.json`。无需为更新网站 cookie 重做 Gmail consent。

## 项目终止条件与真实验收

项目交付须在已启用的目标常驻服务上跑通一次真实流程：

1. 从目标 Gmail 账号获取邮件，筛选通过 DMARC 的 BundleFoundry 通知。
2. 从该邮件解析对应 bundle，核实免费档有效且仍有额度。
3. 使用 `/checkout/claim-free` 新领取免费档。
4. 从同一账号重新读取相同 Bundle ID 的页面，确认 `owned_license_types` 已存在。
5. 将邮件 ID、Bundle ID、免费档编号、账户摘要、领取与归属核实时间写入持久 SQLite 验收记录。

`python worker.py --verify-e2e` 执行一次真实业务循环，并且只有存在上述成功证据时才返回退出码 0；缺少授权返回 2，尚无成功记录返回 3。本地运行可排查登录，但不能替代目标云服务上的部署验收。`--acceptance-status` 可在服务终端读取完整验收记录；记录只保存在私有状态目录。公开 `/status` 仅返回 `project_acceptance_complete` 布尔值，不返回邮件、账号或 cookie。

已拥有的资产（`already_owned`）、种子邮件、模拟测试、免费额度查询及单纯 HTTP 200 均不通过这个验收条件。验收完成仍保持每日两次检查，不因首次成功关闭长期自动化。交付还须确认目标服务使用常驻计划、持久磁盘，以及 `CONTINUOUS_POLLING_ENABLED=true`、`POLL_SECONDS=43200`。目前尚未完成真实授权和新领取，不能标记项目已完成。

## Render 持续运行

`server.py` 在常驻 Python Web 服务中启动单一监听器。`/health` 和 `/status` 返回服务及授权状态，不包含凭据、邮件内容或账户邮箱。未授权时，服务在线等待授权，不执行领取。该方案使用 Starter 计划，有费用；免费 Web 服务会休眠，不适合持续监听。

如果 Render 工作区尚未添加付款方式，只能先部署免费状态预览。预览设定 `CONTINUOUS_POLLING_ENABLED=false`，即使导入授权也不会开始监听。添加付款方式并升级到常驻计划后，将该变量改为 `true` 并重新部署，才会启用监听。

目标部署仓库为 `EiraWalker/Automation-Tools`，分支为 `main`，目录为 `bundlefoundry`。该仓库公开，源码不含凭据或用户邮件。Render 的 Environment 页面需要导入授权脚本生成的 `state/.env.render` 两项秘密变量，然后重启服务。代码仓库不得包含 `state/`、OAuth JSON、密钥或 `.env`。`/status` 变为 `running` 后，还须确认 `project_acceptance_complete=true` 并检查私有验收记录；仅 HTTP 200 不能证明 Google 授权有效或已完成领取。

通过当前 MCP 直接创建的服务使用临时本地缓存。重新部署会重放近 7 天邮件，并根据网站账户的已拥有状态避免重复领取；持久秘密环境变量保存首次授权的加密凭据。需要保留长期失败队列和最新会话文件时，`render.yaml` 已配置 1 GB 持久磁盘，可以通过 Blueprint 导入或 Dashboard 添加。挂载路径为 `/var/data`，对应 `STATE_DIR=/var/data`。加入磁盘前，不能依赖本地缓存跨部署保存。

本 Codex 会话中的进程无法保证在会话结束后持续运行。只有 Render 服务上线、完成 Google 授权并验证真实领取后，才能视为自动领取已启用。

## 验证

```bash
python -m unittest discover -s tests -v
python worker.py --probe massive-3d-art-tutorial-learning-bundle
```

第二条仅查询公开免费档状态，不领取。集成基于网站 2026-10-06 的公开页面数据和前端请求格式；需要用户登录后完成真实领取验证。若网站改版、免费码售罄、会话失效或出现验证码，程序记录原因，不会转入付费结账或自动绕过验证码。
