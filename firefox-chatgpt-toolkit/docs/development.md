# 开发与验证

从 `D:\projects\GPT Enhancemnet` 打开项目。阅读 [CONTEXT.md](CONTEXT.md) 后，只在 `firefox-chatgpt-toolkit/userscripts/chatgpt-queue` 修改插件源码；原生自动化和截图代码分别位于 toolkit 的 browser 与 windows 模块。

## 本机工具

使用项目清单约束的 Node.js 版本和锁文件；本次迁移环境实际为 Node.js 22.17.1、npm 11.19.1、Python 3.12.6、PowerShell 7.6.5，并保留 Windows PowerShell 5.1。构建器自身无依赖；Node 测试需要锁定的 jsdom，原生自动化的可选 MCP 测试还使用其模块锁定依赖。

统一入口复用已安装的 `project-dev-automation` skill。`scripts/project.ps1` 默认从当前用户 `.codex/skills/project-dev-automation` 读取执行器；其他安装位置用 `-AutomationSkill` 指定。普通 Firefox UIA CLI 独立使用时不需要这个入口或 npm。

```powershell
Set-Location -LiteralPath 'D:\projects\GPT Enhancemnet'
pwsh -NoProfile -File .\scripts\project.ps1 -Phase install
pwsh -NoProfile -File .\scripts\project.ps1 -Phase verify
```

install 按两份锁文件执行 `npm ci --ignore-scripts`。verify 运行插件测试与构建、产物语法、原生自动化测试、两种 PowerShell policy/parser、截图适配器测试及文档链接检查。Node/unittest 的零测试、失败或跳过会导致入口失败。命令、工作目录和超时以 [automation.json](../../automation.json) 为权威。

成功条件是入口退出码为 0，报告 status=passed 且每个步骤均通过。日志和 JSON 报告保存在 Git 忽略的 `output/automation/<run>/`，不要只看最后一个命令的输出。此 phase 不操作 Firefox、不发送网页消息。

不使用统一执行器时，可进入对应模块执行其 README 命令；[插件](../userscripts/chatgpt-queue/README.md)、[原生自动化](../browser/firefox-native-automation/README.md)、[截图](../windows/background-window-capture/README.md) 分别说明独立用法。插件依赖同样按锁文件安装。

## 浏览器与后台截图

先 Inspect 读取当前原生 Firefox。只在本次明确指定的聊天验证，不复制历史任务的会话 ID 或窗口标识。保留草稿与 Console 输入；安装或更新完成后，核对实际源码/版本，并刷新准备验收的标签。

可选只读环境检查：

```powershell
pwsh -NoProfile -File .\scripts\project.ps1 -Phase native-readonly
```

该 phase 只枚举现有窗口并验证错误目标被拒绝，不是 UI 输入或队列验收。真实队列验收需核对匹配消息回执、开始出队、每条回答完成及最终持久化状态。合成事件与物理按键、fixture 与真实工具任务分别记证据。

截图调用已安装 AgentCapture 完整运行目录，程序不复制进项目。可通过 `AGENTCAPTURE_EXE`、`--tool` 或忽略的模块 `config.local.json` 指向实际位置。后台捕获后查看图片并读取 foreground/warnings；本轮迁移不需要浏览器截图。

## 变更与交付

改源码后重新构建生成产物。adapter 或发送状态变化追加带日期、脱敏的验收记录，并明确未测边界；修改架构时补充或替代对应 ADR。当前本地测试不能替代未来网页改版后的真实验收。

发布仍沿用 Automation-Tools 仓库的 `firefox-chatgpt-toolkit`，保留 GPL 源码与上游说明。Git 暂存限定本次相关文件；`.local`、node_modules、运行报告和私有材料保持忽略。提交/推送依据当前任务的授权进行，本次迁移不发布新的脚本版本。
