# 私有验证入口

用户要求：今后的登录、授权、远程浏览器和管理验证入口使用 **ChatGPT Sites 管理的 OAuth**，Site 保持 **owner-private**。不提供公开验证网页，也不使用带共享令牌的链接代替 OAuth。

配置参考：[Codebase Graph MCP on Render](https://github.com/EiraWalker/Code-Tools/tree/main/Plugins/codebase-graph-mcp-render) 的 [插件配置](https://github.com/EiraWalker/Code-Tools/blob/main/Plugins/codebase-graph-mcp-render/docs/plugin.md) 和 [安全边界](https://github.com/EiraWalker/Code-Tools/blob/main/Plugins/codebase-graph-mcp-render/SECURITY.md)。

## 下次需要交互验证时

1. 阅读当前 Sites 技能，先检查是否已有该任务的 Site；复用已有项目和 canonical App，不重复创建连接。
2. 使用平台返回的真实项目 ID 保存 `.openai/hosting.json`，保持 owner-private audience。若需要 MCP 工具，声明 `capabilities: ["mcp"]`，让 Sites 提供 OAuth 和 canonical 插件连接。
3. 在 Sites 的认证宿主内检查平台验证过的用户身份并执行 owner 权限检查。`oai-authenticated-user-id`、`oai-authenticated-user-email` 等头只能在该边界内信任；裸露的 Render 服务或通用 Worker 上的同名头可以伪造。
4. Sites 网关访问固定后端 origin，使用单独的服务密钥，存于两端的平台秘密字段。后端拒绝缺少服务认证的请求，不根据客户端提供的用户头授权。OAuth 用户认证与后端服务认证分别验证。
5. OAuth 认证保护所有页面、桌面资源、HTTP 操作和 WebSocket；未经认证或无权限必须失败。MCP 发现只能返回 schema，不包含凭据、邮件或账号资料。不能只保护首页。
6. 发布私有版本后实际验证：匿名访问失败、其他身份失败、owner 操作成功；验证结束后关闭 Chrome、保存加密资料并撤销临时后端通道。不得把发布成功当成业务验收成功。

Sites OAuth 保护验证入口；Gmail API 和 BundleFoundry 的 Google 授权仍分别遵循各自服务的要求。不能用 Sites 身份、服务密钥或 ChatGPT Gmail 连接替代后台 Gmail refresh token。

## 当前状态

此次 Chrome 已关闭，Google profile 已加密归档，明文 profile 已删除。BundleFoundry 会话使用加密 vault 保存，已验证可复用。此次 Render 临时访问令牌已撤销，`server.py` 已移除浏览器中转路由；旧 `LOGIN_*` 变量不会重新启用它。

已创建独立 owner-private Sites 任务控制页，使用平台 OAuth；Google 浏览器没有重新开放。匿名访问和伪造用户头均被平台拒绝。机器更新通过平台支持的服务访问及独立后端密钥运行，服务访问不替代用户 Gmail 授权。部署架构见 [云端定时方案](cloud-scheduler.md)。

`login_environment.py`、`login_agent.py`、`login_relay.py` 保留为本地技术组件及回归测试，不能直接用于公开部署。再次需要 Google 交互时，必须通过上述 Sites OAuth 私有入口，再连接本地浏览器。
