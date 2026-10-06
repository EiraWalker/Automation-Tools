# BundleFoundry 自动领取免费档

收到 `news@bundlefoundry.com` 的新品、最后机会或免费通知后，程序每天检查 Gmail 两次（每 12 小时一次，启动时进行首次检查），跟随邮件中的 Bundle 链接，检查免费额度，调用网站的 `/checkout/claim-free`，再验证账户已拥有该 Bundle。它不会创建付费交易、修改邮件或向别人发送邮件。

## 当前交付状态

已实现领取逻辑并提供自动化测试。`server.py` 提供健康检查和后台监听，未配置授权时保持 `waiting_for_authorization` 状态；该状态表示服务在线，但领取尚未启用。首次授权仍需要 Gmail OAuth refresh token 和 BundleFoundry 登录会话。连接在 ChatGPT 中的 Gmail 授权不能导出成后台程序的凭据。

## 首次授权（在你自己的电脑完成）

1. 在自己的 Google Cloud 项目中开启 Gmail API，配置 OAuth consent screen，并创建 **Desktop app** OAuth client，下载 JSON。权限只申请 `gmail.readonly`。若 consent screen 为 External / Testing，含 Gmail 权限的 refresh token 通常在 7 天后过期；长期运行需切换到适当的发布状态并遵循 Google 的要求。参见 [Google refresh token 过期规则](https://developers.google.com/identity/protocols/oauth2#expiration)。
2. 安装 Python 3.12+ 和 Google Chrome，下载本目录，运行：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-setup.txt
python setup_auth.py --client-secret /path/to/client_secret.json
```

Windows 激活命令为 `.venv\Scripts\activate`。

授权脚本会打开 Google 的 Gmail 只读授权页面，然后打开单独的 Chrome 窗口。你在该窗口点击 BundleFoundry 的 Google 登录，完成二次验证，进入 My Bundles 后，在终端按 Enter。脚本会核对两个服务的账号一致。

无需把 Google 密码发送给助手。云端只保存 Gmail refresh token 与 BundleFoundry 域名的 HTTPS cookies。Google 浏览器 cookies 留在你电脑的 `state/google-browser`，不会上传。凭据使用 Fernet 加密，文件仅允许当前用户访问；云端密钥放在平台的秘密环境变量。

## 运行和检查

```bash
python worker.py --doctor
python worker.py --once
python worker.py
python server.py
```

`--doctor` 仅检查配置文件是否齐全，不代表登录有效或后台任务已启动。首次运行检查近 7 天邮件，之后重复读取并通过 SQLite 去重。查询不依赖未读状态，也不标记邮件已读。已领取记录和重试队列保存在 `state/queue.sqlite3`。失败按退避间隔重试；登录失效写入日志，队列不会被当作领取成功。

后台每 15 分钟访问一次 My Bundles 保持网站会话活跃，但服务端仍可能撤销或限制登录有效期，无法保证 Google 网站会话永久有效。网站登录失效时重新运行：

```bash
python setup_auth.py --bundle-only
```

保持密钥不变，更新云端的 `CREDENTIALS_ENCRYPTED` 并重启 worker。程序会识别新授权、替换磁盘上的旧会话，并继续重试未领取邮件。

## Render 持续运行

`server.py` 在常驻 Python Web 服务中启动单一监听器。`/health` 和 `/status` 返回服务及授权状态，不包含凭据、邮件内容或账户邮箱。未授权时，服务在线等待授权，不执行领取。该方案使用 Starter 计划，有费用；免费 Web 服务会休眠，不适合持续监听。

如果 Render 工作区尚未添加付款方式，只能先部署免费状态预览。预览设定 `CONTINUOUS_POLLING_ENABLED=false`，即使导入授权也不会开始监听。添加付款方式并升级到常驻计划后，将该变量改为 `true` 并重新部署，才会启用监听。

目标部署仓库为 `EiraWalker/Automation-Tools`，分支为 `main`，目录为 `bundlefoundry`。该仓库公开，源码不含凭据或用户邮件。Render 的 Environment 页面需要导入授权脚本生成的 `state/.env.render` 两项秘密变量，然后重启服务。代码仓库不得包含 `state/`、OAuth JSON、密钥或 `.env`。`/status` 变为 `running` 后，再确认第一条 `status=claimed` 或 `status=already_owned` 日志；仅 HTTP 200 不能证明 Google 授权有效或已完成领取。

通过当前 MCP 直接创建的服务使用临时本地缓存。重新部署会重放近 7 天邮件，并根据网站账户的已拥有状态避免重复领取；持久秘密环境变量保存首次授权的加密凭据。需要保留长期失败队列和最新会话文件时，`render.yaml` 已配置 1 GB 持久磁盘，可以通过 Blueprint 导入或 Dashboard 添加。挂载路径为 `/var/data`，对应 `STATE_DIR=/var/data`。加入磁盘前，不能依赖本地缓存跨部署保存。

本 Codex 会话中的进程无法保证在会话结束后持续运行。只有 Render 服务上线、完成 Google 授权并验证真实领取后，才能视为自动领取已启用。

## 验证

```bash
python -m unittest discover -s tests -v
python worker.py --probe massive-3d-art-tutorial-learning-bundle
```

第二条仅查询公开免费档状态，不领取。集成基于网站 2026-10-06 的公开页面数据和前端请求格式；需要用户登录后完成真实领取验证。若网站改版、免费码售罄、会话失效或出现验证码，程序记录原因，不会转入付费结账或自动绕过验证码。
