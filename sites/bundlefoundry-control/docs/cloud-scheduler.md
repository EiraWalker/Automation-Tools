# Sites 定时任务与 Render 领取后端

当前方案复用用户已经连接的 Gmail，避免要求另建 Google OAuth 客户端或导出连接凭据。私有控制入口遵循 [Sites OAuth 要求](private-verification.md)。完整 Site 源码模板在 [sites/bundlefoundry-control](../)。

Epic 使用每周五台北时间 09:00 的独立关联任务：POST `/api/epic/update` 更新公开游戏链接，GET `/api/epic/status` 回读。
用户在本地浏览器手动领取；Epic 更新无需凭据，也不经过 Render。每日资产包任务不再执行 Epic 续期。
新的架构与验收条件见 [Epic 链接服务](epic-automation.md)。

## 部署组成

| 组件 | 职责 |
| --- | --- |
| owner-private ChatGPT Site | OAuth 浏览器入口、平台服务认证的云任务入口、领取记录 |
| Sites 关联定时任务 | 在用户授权的上下文中读取原生 Gmail 连接，每日两次 |
| Render `/internal/run` | 独立服务密钥认证；解析通知、领取免费档、核实归属 |
| Sites D1 | 保存包含网站会话、去重队列和验收记录的加密 checkpoint |

Gmail 密钥留在平台连接内。Google 浏览器会话文件使用独立密钥加密，随 checkpoint 保存在 D1；Render 保管浏览器密钥和网站 vault 密钥，临时启动 Chromium 完成自动重登录。Site 只持有独立后端服务密钥及不含明文凭据的 checkpoint。详见 [自动 Google 重登录](automatic-google-relogin.md)。Render 免费实例会休眠，由每次云任务的请求唤醒；不是依赖在休眠实例里运行定时器。

## 配置

1. 从 Site 模板创建独立私有 checkout；用 Sites 创建一次项目，把返回的真实 ID 合并到 `.openai/hosting.json`。示例 manifest 使用 `d1: "DB"`，由平台创建真实资源；生产 ID 不进入此公开模板。
2. 在 Sites 秘密运行时变量中设置 `OWNER_EMAIL`、固定的 `RENDER_ORIGIN` 和 `AUTOMATION_SERVICE_TOKEN`。Render 设置同一服务密钥、`SCHEDULER_MODE=sites`、`CREDENTIAL_KEY`、`CREDENTIALS_ENCRYPTED`，保持 `CONTINUOUS_POLLING_ENABLED=false`，避免第二个邮箱轮询器。
3. 生成并检查 Drizzle schema-only migration，构建 Worker，推送精确源码到该 Site 的私有 source repository，保存并发布 owner-private 版本。
4. 用 fresh `get_site` 取得平台支持的服务访问，执行私有 updater 和 readback；匿名访问、伪造身份头及未认证 Render API 必须失败。服务访问不制造用户身份或 connected-app consent；邮箱在原生云任务的用户连接中读取，不从身份缺失的 Site 请求调用 Gmail。
5. 确认 Site 的 `automations` 可读取且无重复后创建关联任务。当前选择 Asia/Taipei 每日 09:00、21:00。开启状态以平台返回值为准，不以文档或页面文字代替。

## 每次运行

读取原生 Gmail profile，搜索 `from:news@bundlefoundry.com newer_than:7d -in:spam -in:trash`，分页读取完整 MIME payload。每批不超过 25 封，POST `{source_account, messages}` 到私有 Site 的 `/api/update`，再 GET `/api/status` 核查保存结果。任务从关联 Site 的 fresh 元数据获取真实 URL 和平台服务认证；不将密钥写入任务提示、源码或日志。

后台再次校验发件人、DMARC、通知主题、账户一致和 URL allowlist。Brevo 的 HTTP 跳转与 HTML meta refresh 均支持，HTML 中的脚本不执行。领取前读取 My Bundles 避免重复领取；只调用 `/checkout/claim-free`，再验证相同账号、Bundle ID、tier 0、金额 0.00 的购买记录。

详情页 `owned_license_types=[]` 不能证明未领取：网站免费购买可能只出现在 My Bundles。成功且未跳过的免费 API 响应先写入加密领取 journal，再确认归属；确认暂时失败时，下次在同一邮件和 Bundle 下恢复验证，不重复 POST、不把其他邮件的既有购买当成新领取。

首次部署发现详情页字段差异时，实际云端免费请求已产生购买。该次恢复证据来自对应 Render 应用日志和同账号的免费购买记录，并明确标记 `render_trace_recovery`；未保存到的原始响应内容或精确请求起始时间不会补造。后续 journal 由程序自动保存原始响应摘要与请求时间。

Render 返回加密 checkpoint，Site 用 D1 batch 原子保存会话和快照。D1 lease 防止并发更新；恢复时保留续期后的 cookies，显式导入新凭据时覆盖被撤销的旧授权。任务失败应报告并在下次检查时先核实网站归属，不能自动转入付费结账。

## 验收

需要实际新领取、同账号 My Bundles 免费购买、邮件关联证据和 Site readback；还需要 Render 重启后恢复同一记录且不再 POST。`project_acceptance_complete` 仅反映业务证据，关联任务启用与调度时间另行检查。Google 或网站撤销登录时仍可能需要重新认证，入口必须使用私有 Sites OAuth。
