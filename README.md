# Automation Tools

云端自动化工具集合。第一个工具是 [BundleFoundry 免费档自动领取](bundlefoundry/README.md)。

今后的交互验证入口使用 **owner-private ChatGPT Sites OAuth**。Render 仅提供无私人资料的健康状态，不提供浏览器登录网页。配置边界与参考项目见 [私有验证入口](docs/private-verification.md)。

程序每天检查 Gmail 两次，领取邮件中仍有免费额度的 Bundle，并在网站账户中核实结果。只使用免费领取接口，不创建付费交易。

当前部署使用 **私有 Sites 定时任务 → 已连接的 Gmail → Render 领取 API → Sites D1 加密状态保存**。不导出 ChatGPT 的 Google 凭据，也不需要另建 Gmail OAuth 客户端。定时任务可以在页面关闭时运行，Render 免费实例按请求唤醒；网站会话、队列和验收记录由加密 checkpoint 跨重启恢复。详见 [云端定时架构](docs/cloud-scheduler.md)。

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

根目录 `render.yaml` 保留独立 Gmail OAuth 的 Starter 常驻轮询方案。该方案需要付款方式、持久磁盘和后台 Gmail refresh token。当前 Sites 定时方案通过云任务唤醒 Render，并在 Sites D1 保存状态，因此不依赖付费常驻轮询或 Render 临时磁盘。

`/status` 显示 `external_scheduler_ready` 表示外部云任务接口已配置；实际调度是否启用须检查 Sites 的关联任务，业务验收须检查私有 Sites 的领取记录。凭据与用户邮件不在源码中。

## 项目终止条件

项目交付须在目标云端部署真实完成一次：Gmail 筛选经过发件人验证的通知邮件 → 解析对应 Bundle → 检查免费额度 → 使用免费接口新领取 → 同一账号的 My Bundles 确认免费购买 → 持久保存邮件 ID、Bundle ID 和购买记录对应的验收证据。Sites 定时方案还须确认关联任务启用、每天两次运行、D1 记录与加密会话可跨 Render 重启恢复；独立轮询方案还须核查常驻计划和持久磁盘。单元测试、HTTP 200、公开页面查询、种子邮件、`already_owned` 和服务上线均不能替代真实新领取。验收后自动化继续运行，终止的是项目实施与验收工作。

Google 使用只读 OAuth refresh token 自动更新访问 token；BundleFoundry 使用域名限定的 HTTPS cookie，并定期保存网站发出的续期结果。目标是跨月复用，不伪造 cookie 到期日期。网站当前发出的会话 cookie 为 7 天，服务端撤销或强制失效仍需重新登录。完整说明见工具目录。
