# 开发与验证

从 `E:\firefox dev` 打开项目。阅读 [CONTEXT.md](CONTEXT.md) 后，只在 `firefox-chatgpt-toolkit/userscripts/chatgpt-queue` 修改插件源码；Firefox 自动化在[独立仓库](https://github.com/EiraWalker/Firefox-Nightly-Automation)维护；截图代码仍在 toolkit 的 windows 模块。

## 产品运行环境

项目使用 Firefox / Firefox Nightly + Violentmonkey，版本基线以 [项目 context](CONTEXT.md#项目运行环境) 为准。开发和浏览器验收针对安装在 Violentmonkey 中的完整用户脚本；安装、设置和发布更新使用其原生管理流程。下方本机工具用于开发与验收，日常队列运行无需这些工具。

## 本机工具

使用项目清单约束的 Node.js 版本和锁文件；本次迁移环境实际为 Node.js 22.17.1、npm 11.19.1、Python 3.12.6、PowerShell 7.6.5，并保留 Windows PowerShell 5.1。构建器自身无依赖；Node 测试需要锁定的 jsdom，旧 Firefox 模块的依赖安装和测试已从本仓库统一入口移除。

统一入口复用已安装的 `project-dev-automation` skill。`scripts/project.ps1` 默认从当前用户 `.codex/skills/project-dev-automation` 读取执行器；其他安装位置用 `-AutomationSkill` 指定。Firefox 自动化改用独立仓库的入口。

```powershell
Set-Location -LiteralPath 'E:\firefox dev'
pwsh -NoProfile -File .\scripts\project.ps1 -Phase install
pwsh -NoProfile -File .\scripts\project.ps1 -Phase verify
```

install 按各模块锁文件执行 `npm ci --ignore-scripts`。verify 运行插件测试与构建、产物语法、截图适配器测试及文档链接检查。Node/unittest 的零测试、失败或跳过会导致入口失败。命令、工作目录和超时以 [automation.json](../../automation.json) 为权威。

成功条件是入口退出码为 0，报告 status=passed 且每个步骤均通过。日志和 JSON 报告保存在 Git 忽略的 `output/automation/<run>/`，不要只看最后一个命令的输出。此 phase 不操作 Firefox、不发送网页消息。

不使用统一执行器时，可进入对应模块执行其 README 命令；[插件](../userscripts/chatgpt-queue/README.md)、[截图](../windows/background-window-capture/README.md) 分别说明独立用法。插件依赖同样按锁文件安装。

## 浏览器与后台截图

Firefox 连接和任务使用[独立仓库](https://github.com/EiraWalker/Firefox-Nightly-Automation)及其 skill；原 firefox-doctor、firefox-environment、firefox-inspect phase 已退役。独立工具的 status 只读取状态；其他操作依照各自任务授权执行。

用户于 2026-10-11 明确要求测试不干扰其他工作。只读检查当前窗口和后台调试接口；只在明确指定的测试页面操作，保留草稿与队列。真实页面读取与更新使用已经启用、不会激活窗口或切换可见标签的后台协议。后台截图使用 AgentCapture，保持前台与最小化状态。

前台 UIAutomation、Web Console 粘贴、键鼠模拟、共享剪贴板修改、标题栏点击和重启 Firefox 不用于日常后台验收。以前通过这些操作取得的证据保留历史日期，不作为继续采用该路径的授权。调试通道缺失时继续本地回归和 API 检查，浏览器安装与显示验收明确标为待完成；不反复要求用户把窗口置前。具备可用后台通道后，先核对目标页面及草稿/生成/队列状态，再执行更新和验收。

旧 native-readonly phase 已退役。独立工具的 status 不代表业务验收通过；真实队列验收仍需核对消息回执及持久化状态。

截图调用已安装 AgentCapture 完整运行目录，程序不复制进项目。可通过 `AGENTCAPTURE_EXE`、`--tool` 或忽略的模块 `config.local.json` 指向实际位置。后台捕获后查看图片并读取 foreground/warnings；本轮迁移不需要浏览器截图。

## 变更与交付

旧模块提供的 userscript:update/stop 等专用命令已退役。历史发布流程保存在归档分支；当前通过管理器原生流程安装完整用户脚本，不刷新正在使用的聊天。

历史本机发布使用稳定元数据和源码下载地址，历史版本仍不可变归档。Violentmonkey 沿用已安装脚本的 downloadURL；旧安装若指向固定版本，须通过管理器原生流程一次性修正。元数据与源码请求之间发布新版本时可能取到更新的完整源码，验收核对实际保存的版本与哈希，不能仅根据元数据版本推定。原因见 [ADR 0011](adr/0011-native-userscript-updates.md)。

改源码后重新构建生成产物。adapter 或发送状态变化追加带日期、脱敏的验收记录，并明确未测边界；修改架构时补充或替代对应 ADR。当前本地测试不能替代未来网页改版后的真实验收。

发布仍沿用 Automation-Tools 仓库的 `firefox-chatgpt-toolkit`，保留 GPL 源码与上游说明。Git 暂存限定本次相关文件；`.local`、node_modules、运行报告和私有材料保持忽略。提交/推送依据当前任务的授权进行；本机脚本发布与 Git 推送分别授权。
