# 连接已有 Firefox 的本地 MCP 桥接

这是可选路径。开发本套件时，原生 UIAutomation 是真实 ChatGPT 验收的成功路径；MCP 真实页面 evaluate 曾超时，未据此宣称操作成功。浏览器已经启动时优先使用原生路径，避免为调试重复启动登录会话。

Mozilla Firefox DevTools MCP 0.10.4 的 connect-existing 需要 Marionette 与 BiDi。单独 `firefox --remote-debugging-port=9222` 不够。若用户明确要求配置或重启当前 Firefox，应先保存网页活动、正常退出，再使用同一配置启动：

```powershell
firefox --marionette --remote-debugging-port=9222
```

这不是 bridge 自动执行的步骤。Marionette 默认端口 2828；不要使用 `--new-instance`、临时 profile 或另一个 MCP 管理的测试浏览器来替代用户会话。

## 启动

在模块目录先执行 `npm ci --ignore-scripts`。使用独立、仓库外的本机目录保存 IPC；Windows 文件访问受所在目录的账户 ACL 控制，Node 的 Unix mode 不替代 NTFS ACL。不要放进共享/同步目录。

```powershell
$rpcDir = Join-Path $env:TEMP ('firefox-rpc-' + [guid]::NewGuid().ToString('N'))
node scripts/mcp-bridge.mjs --dir $rpcDir --authorize-existing
```

等待 stdout 的 `status:ready` 和目录中的 ready.json。bridge 默认仅允许 `list_pages,get_firefox_info`。需要其他工具时，从 ready.json 的 availableTools 核对名称，重启桥接并显式通过 `--allow-tools` 列出本任务授权的工具。`--server` 只用于指定可信、实现同等已有会话语义的 stdio server 入口。`--timeout-ms` 控制工具等待时间，初始化至少给 10 秒。

## 提交与轮询

在另一个终端创建本地 UTF-8 JSON 请求文件：

```json
{"name":"list_pages","arguments":{}}
```

```powershell
node scripts/rpc.mjs submit --dir $rpcDir --id inspect_01 --file $requestFile --wait-ms 10000
node scripts/rpc.mjs read --dir $rpcDir --id inspect_01 --wait-ms 10000
node scripts/rpc.mjs stop --dir $rpcDir
```

相同 ID 和参数可重复 submit，不会再次调度；同 ID 不同参数被拒绝。`pending` 用 read 继续轮询，别换 ID 重发。`completed` 包含 MCP 原始结果，仍需检查其 isError/content 和页面业务状态。超时或曾被旧桥接领取的请求标记 `indeterminate`，不自动重放；先检查浏览器再决定恢复。未获允许的工具标记 `rejected`。

bridge.lock 防止一个目录内并行调度。崩溃留下的锁仅在确认旧 PID 已结束后由调用方移除，保留 claimed 和 response 文件；重连不重发已领取请求。stop 标记保留，新的独立任务可使用新目录。结束只关闭这次 stdio 服务，不终止 Firefox 或改写全局 config.toml。

IPC 响应可能含页面文本、私有 URL 和其他浏览器数据，不提交到 Git，也不打印完整 stderr。已有会话可能仍被网站识别为自动化；验证页需用户在原生浏览器处理，不尝试绕过。

实现依据：[MCP SDK v1.29.0 client 文档](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/client.md) 与 [Mozilla Firefox DevTools MCP](https://github.com/mozilla/firefox-devtools-mcp)。
