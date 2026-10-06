# Automation Tools

云端自动化工具集合。第一个工具是 [BundleFoundry 免费档自动领取](bundlefoundry/README.md)。

程序每天检查 Gmail 两次（每 12 小时一次，启动时进行首次检查），领取邮件中仍有免费额度的 Bundle，并在网站账户中核实结果。只使用免费领取接口，不创建付费交易。

## 部署

源码仓库为 `EiraWalker/Automation-Tools`，主分支 `main`，程序目录为 `bundlefoundry`。根目录 `render.yaml` 配置 Render Web 服务、健康检查及持久磁盘。18 项领取与调度测试通过。

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

`/status` 显示 `waiting_for_authorization` 表示服务在线等待授权；显示 `ready_requires_always_on_plan` 表示授权已经导入，但常驻计划尚未启用。只有运行状态变为 `running` 并验证真实领取成功后，自动领取才算启用。凭据与用户邮件不在源码中。