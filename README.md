# Automation Tools

云端自动化工具集合。第一个工具是 [BundleFoundry 免费档自动领取](bundlefoundry/README.md)。

今后的交互验证入口使用 **owner-private ChatGPT Sites OAuth**。Render 仅提供无私人资料的健康状态，不提供浏览器登录网页。配置边界与参考项目见 [私有验证入口](docs/private-verification.md)。

程序每天检查 Gmail 两次（每 12 小时一次，启动时进行首次检查），领取邮件中仍有免费额度的 Bundle，并在网站账户中核实结果。只使用免费领取接口，不创建付费交易。

## 部署

源码仓库为 `EiraWalker/Automation-Tools`，主分支 `main`，程序目录为 `bundlefoundry`。根目录 `render.yaml` 配置 Render Web 服务、健康检查及持久磁盘。

| 字段 | 值 |
|---|---|
| Repository | `https://github.com/EiraWalker/Automation-Tools` |
| Branch | `main` |
| Root Directory | `bundlefoundry` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `python server.py` |
| Health Check | `/health` |
| Gmail Check Interval | `43200` 秒 |

Render 免费状态预览会休眠，不能承担常驻轮询。工作区需要先添加付款方式，才能使用 Starter 常驻计划与持久磁盘。Google 首次授权使用 `bundlefoundry/setup_auth.py`，授权生成的秘密变量通过 Render 环境设置导入；完整步骤在工具目录的说明中。

`/status` 显示 `waiting_for_authorization` 表示服务在线等待授权；显示 `ready_requires_always_on_plan` 表示授权已经导入，但常驻计划尚未启用。凭据与用户邮件不在源码中。

## 项目终止条件

项目交付须在目标常驻服务上真实完成一次：Gmail 筛选经过发件人验证的通知邮件 → 解析对应 Bundle → 检查免费额度 → 使用免费接口新领取 → 同一账号确认已拥有该资产包 → 持久保存邮件 ID 与 Bundle ID 对应的验收记录。`/status` 的 `project_acceptance_complete=true` 表示这段业务流程已有成功记录，交付时仍须核查常驻计划、持久磁盘与每天两次轮询均已启用。单元测试、HTTP 200、公开页面查询、种子邮件、`already_owned` 和服务上线均不能替代真实新领取。验收后，每天两次的自动化继续运行；终止的是项目实施与验收工作。

Google 使用只读 OAuth refresh token 自动更新访问 token；BundleFoundry 使用域名限定的 HTTPS cookie，并定期保存网站发出的续期结果。目标是跨月复用，不伪造 cookie 到期日期。网站当前发出的会话 cookie 为 7 天，服务端撤销或强制失效仍需重新登录。完整说明见工具目录。
