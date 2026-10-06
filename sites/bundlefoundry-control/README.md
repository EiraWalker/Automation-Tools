# BundleFoundry private automation

This owner-private ChatGPT Site uses platform OAuth for its browser and platform
service access for cloud tasks. It never receives Google passwords or provider
tokens. Native Gmail connector reads happen in the owner's cloud task, not through
identity-less Site connector invocation. Gmail profile must match the Render vault
account. Each notification is revalidated by the Render backend.

Each task obtains this Site's actual URL and supported service credential through
Sites get_site, searches native Gmail for
`from:news@bundlefoundry.com newer_than:7d -in:spam -in:trash`, reads the returned
MIME trees and native Gmail profile, POSTs `{source_account, messages}` to
`/api/update`, then reads `/api/status`. Pass platform service authorization only
to this Site. Never write or expose its value. Handle pagination in batches of 25.
Do not mark emails read or send email. No paid checkout is permitted.

The Site sends batches to a fixed Render machine endpoint authenticated with an
independent service key. Render verifies source account, sender/DMARC, destinations,
free availability and ownership after claiming. It returns an encrypted checkpoint
including renewed site cookies, deduplication and acceptance receipts; D1 persists
it across Render cold starts and restarts. Plain cookies and backend secrets are
never returned to the caller. Latest receipts and pending state can be read back.

On upstream transport failure, persist a recoverable error and do not retry the
mutation immediately. The next run checks ownership before attempting a new claim.
An atomic D1 lease prevents concurrent updates. Google may still revoke login.
The encrypted Google profile remains separate in the authorized login environment.

Timing is configured on the linked Sites automation, Asia/Taipei, twice daily.
Do not create duplicate schedules. Reuse this updater and this private Site.

## Epic 服务

此模板同时包含 Epic 服务与私有授权页面。Epic 请求直接由本站 Worker 发往官方服务，
不经过 Render。Epic OAuth 令牌使用独立 AES-GCM 密钥加密保存于 D1；秘密配置为
`EPIC_CREDENTIAL_KEY` 与 `EPIC_CLIENT_SECRET`。既有 BundleFoundry Fernet checkpoint、
Gmail 连接和 Render 服务认证保持各自的职责。

所有者在本站提交 Epic 官方一次性授权代码。凭据修改需要真实 Sites 所有者身份及同源请求；
仅有平台服务认证的定时任务不能连接或断开账号。任务通过 `/api/epic/run` 运行，
通过 `/api/epic/status` 回读；没有授权时只查询公开促销，不尝试领取。
订单预览必须明确为免费且全部支付金额为零；入库以账号权益核实。
测试及详细部署、凭据位置和验收限制见 [Epic 说明](docs/epic-automation.md)。

下面的原图描述 BundleFoundry 部分；Epic 的新增架构图在上述说明中。
## 目录与运行

本站沿用 `sites/bundlefoundry-control/`，Sites Worker、Python 后端和本站文档统一保存在这里。

| 目录／文件 | 用途 |
| --- | --- |
| [`bundlefoundry/`](bundlefoundry/README.md) | Render Python 领取后端、授权工具及测试 |
| [`docs/`](docs/cloud-scheduler.md) | 云端调度、私有验证及自动重登录说明 |
| `worker.js`、`scripts/` | Sites 控制页、API 和构建脚本 |
| `db/`、`drizzle/` | D1 schema 与迁移 |

在本站目录执行 `npm test`；在 `bundlefoundry/` 中执行 `python -m unittest discover -s tests -v`。
Render Root Directory 为 `sites/bundlefoundry-control/bundlefoundry`，部署配置见仓库根目录的 [`render.yaml`](../../render.yaml)。
既有手动创建的 Render 服务在下一次部署前，也需把 Dashboard 中的 Root Directory 更新为这个路径。

## 服务主体与技术架构

每个大框标明负责的公司或平台，框内标明它保存什么、执行什么。
图中时间为台北时间（Asia/Taipei）。

```mermaid
flowchart TB
    subgraph YOU["你：个人电脑"]
        Browser["Firefox / ChatGPT Desktop<br/>负责把网页显示出来"]
    end

    subgraph OPENAI["OpenAI：ChatGPT 云端服务"]
        OAuth["Sites OAuth<br/>验证你的身份"]
        Site["Sites 网站程序<br/>生成网页 HTML、转发领取任务"]
        Task["定时任务<br/>每天台北时间 09:00、21:00 执行"]
        Connector["Gmail 连接服务<br/>保管 Google 授权凭据"]
    end

    subgraph GOOGLE["Google"]
        Gmail["Gmail<br/>保存你的邮件"]
    end

    subgraph CLOUDFLARE["Cloudflare：数据库提供商"]
        DB[("D1 数据库<br/>由 Sites 平台创建和接入<br/>保存加密 Cookie、任务状态、领取记录")]
    end

    subgraph RENDER["Render：托管你的后端项目"]
        Secret["秘密配置<br/>保存 Fernet 解密密钥"]
        Backend["Python 后端程序<br/>解密 Cookie、领取免费包、核实结果"]
    end

    subgraph BF["BundleFoundry：资产包网站"]
        Bundle["签发登录 Cookie<br/>提供免费领取与购买记录"]
    end

    subgraph CODEX["OpenAI：Codex 工作环境"]
        Archive["保存本地副本<br/>① 加密 Google 浏览器资料<br/>② Fernet 密钥副本"]
    end

    Browser -->|"登录"| OAuth
    OAuth -->|"认证通过"| Site
    Site -->|"返回 HTML / CSS"| Browser

    Task -->|"读取邮件"| Connector
    Connector -->|"使用 Google 授权"| Gmail
    Task -->|"提交筛选后的邮件"| Site

    Site <-->|"读取、保存状态"| DB
    Site -->|"发送邮件和加密 Cookie"| Backend
    Secret -->|"提供解密密钥"| Backend
    Backend <-->|"复用 Cookie 领取并核实"| Bundle
    Backend -->|"返回加密 Cookie 和领取结果"| Site
```

加密 Cookie 存在 Cloudflare D1；解密密钥存在 Render 的秘密配置中。
数据库中的领取状态和结果快照受私有 Site 访问权限保护，会话检查点另行加密。
Codex 中的资料是本地保留副本，日常任务由云端定时服务和 Render 后端执行。
本公开目录只包含源码模板，不包含生产密钥、Cookie、浏览器资料或生产项目配置。
