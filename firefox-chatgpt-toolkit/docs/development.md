# 开发与验证

从 `E:\firefox dev` 打开项目。阅读 [CONTEXT.md](CONTEXT.md) 后，只在 `firefox-chatgpt-toolkit/userscripts/chatgpt-queue` 修改插件源码；Puppeteer、原生自动化和截图代码分别位于 toolkit 的 browser 与 windows 模块。

## 产品运行环境

项目使用 Firefox / Firefox Nightly + Violentmonkey，版本基线以 [项目 context](CONTEXT.md#项目运行环境) 为准。开发和浏览器验收针对安装在 Violentmonkey 中的完整用户脚本；安装、设置和发布更新使用其原生管理流程。下方本机工具用于开发与验收，日常队列运行无需这些工具。

## 本机工具

使用项目清单约束的 Node.js 版本和锁文件；本次迁移环境实际为 Node.js 22.17.1、npm 11.19.1、Python 3.12.6、PowerShell 7.6.5，并保留 Windows PowerShell 5.1。构建器自身无依赖；Node 测试需要锁定的 jsdom，原生自动化的可选 MCP 测试还使用其模块锁定依赖。

统一入口复用已安装的 `project-dev-automation` skill。`scripts/project.ps1` 默认从当前用户 `.codex/skills/project-dev-automation` 读取执行器；其他安装位置用 `-AutomationSkill` 指定。普通 Firefox UIA CLI 独立使用时不需要这个入口或 npm。

```powershell
Set-Location -LiteralPath 'E:\firefox dev'
pwsh -NoProfile -File .\scripts\project.ps1 -Phase install
pwsh -NoProfile -File .\scripts\project.ps1 -Phase verify
```

install 按各模块锁文件执行 `npm ci --ignore-scripts`。verify 运行插件测试与构建、产物语法、Puppeteer 任务测试、原生自动化测试、两种 PowerShell policy/parser、截图适配器测试及文档链接检查。Node/unittest 的零测试、失败或跳过会导致入口失败。命令、工作目录和超时以 [automation.json](../../automation.json) 为权威。

成功条件是入口退出码为 0，报告 status=passed 且每个步骤均通过。日志和 JSON 报告保存在 Git 忽略的 `output/automation/<run>/`，不要只看最后一个命令的输出。此 phase 不操作 Firefox、不发送网页消息。

不使用统一执行器时，可进入对应模块执行其 README 命令；[插件](../userscripts/chatgpt-queue/README.md)、[原生自动化](../browser/firefox-native-automation/README.md)、[截图](../windows/background-window-capture/README.md) 分别说明独立用法。插件依赖同样按锁文件安装。

## 浏览器与后台截图

默认连接器为 [Puppeteer Core](../browser/firefox-puppeteer/README.md)，通过原生 Firefox Nightly 的 Remote Control 面板在运行时接入。执行前读取其 [任务规范](../browser/firefox-puppeteer/SKILL.md)。`scripts/project.ps1 -Phase firefox-doctor` 核对监听进程、路径与启动方式；`-Phase firefox-environment` 验证 webdriver 实际值及桌面/草稿采样；`-Phase firefox-inspect` 执行归档图标只读检查。私有目标配置为根目录 `.local/firefox-connection.json`，结果保存到 `.local/firefox-runs/`。这些 phase 不作为离线 verify 的前置条件。首次接入前汇报方案，原生确认由用户允许；失败时继续排查上游连接器，保持当前窗口和标签。

用户于 2026-10-11 明确要求测试不干扰其他工作。只读检查当前窗口和后台调试接口；只在明确指定的测试页面操作，保留草稿与队列。真实页面读取与更新使用已经启用、不会激活窗口或切换可见标签的后台协议。后台截图使用 AgentCapture，保持前台与最小化状态。

前台 UIAutomation、Web Console 粘贴、键鼠模拟、共享剪贴板修改、标题栏点击和重启 Firefox 不用于日常后台验收。以前通过这些操作取得的证据保留历史日期，不作为继续采用该路径的授权。调试通道缺失时继续本地回归和 API 检查，浏览器安装与显示验收明确标为待完成；不反复要求用户把窗口置前。具备可用后台通道后，先核对目标页面及草稿/生成/队列状态，再执行更新和验收。

可选只读环境检查：

```powershell
pwsh -NoProfile -File .\scripts\project.ps1 -Phase native-readonly
```

该 phase 只枚举现有窗口并验证错误目标被拒绝，不是 UI 输入或队列验收。真实队列验收需核对匹配消息回执、开始出队、每条回答完成及最终持久化状态。合成事件与物理按键、fixture 与真实工具任务分别记证据。

截图调用已安装 AgentCapture 完整运行目录，程序不复制进项目。可通过 `AGENTCAPTURE_EXE`、`--tool` 或忽略的模块 `config.local.json` 指向实际位置。后台捕获后查看图片并读取 foreground/warnings；本轮迁移不需要浏览器截图。

## 变更与交付

Nightly 的 Violentmonkey 安装/更新使用 [本机更新工作流](../browser/firefox-puppeteer/references/userscript-workflow.md)：进入 `browser/firefox-puppeteer` 执行 `npm run userscript:update`，构建、测试并启动只监听本机的更新源。已授权的后台安装使用管理器原生流程，原生权限弹窗由用户确认；之后交给管理器自己的更新周期，不刷新正在使用的聊天。`npm run userscript:stop` 停止自有更新源。完整命令、版本策略与证据边界见工作流文档；它不作为离线 verify 的后台服务，因此不会脱离统一执行器的服务生命周期管理。

本机发布使用稳定元数据和源码下载地址，历史版本仍不可变归档。Violentmonkey 沿用已安装脚本的 downloadURL；旧安装若指向固定版本，须通过管理器原生流程一次性修正。元数据与源码请求之间发布新版本时可能取到更新的完整源码，验收核对实际保存的版本与哈希，不能仅根据元数据版本推定。原因见 [ADR 0011](adr/0011-native-userscript-updates.md)。

改源码后重新构建生成产物。adapter 或发送状态变化追加带日期、脱敏的验收记录，并明确未测边界；修改架构时补充或替代对应 ADR。当前本地测试不能替代未来网页改版后的真实验收。

发布仍沿用 Automation-Tools 仓库的 `firefox-chatgpt-toolkit`，保留 GPL 源码与上游说明。Git 暂存限定本次相关文件；`.local`、node_modules、运行报告和私有材料保持忽略。提交/推送依据当前任务的授权进行；本机脚本发布与 Git 推送分别授权。
