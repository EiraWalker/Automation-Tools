# 完整工作区迁移到 E 盘

日期：2026-10-11。用户明确要求 ChatGPT 插件项目与 Firefox 调试工具一起迁移到 `E:\firefox dev`。

## 文件与历史

从 `D:\projects\GPT Enhancemnet` 复制完整工作区，包含 Git、12 项已有未提交修改、依赖和 `.local` 私有资料。迁移前共 9,344 个文件、114,240,563 字节。逐文件 SHA-256 校验一致；`.git/index` 是路径相关缓存，单独以 Git HEAD 与 porcelain 状态检查，未参与二进制一致断言。复制时不存在需另行处理的 ReparsePoint。

Git HEAD 保持 `6d2c02a0f42737e54be95d16ce28d759caa633ea`，remote 配置保持一致，迁移前 12 项改动全部保留。迁移原数据保留在 `D:\projects\GPT Enhancemnet.migration-backup-20261011`；旧工作路径作为 Junction 指向新根。文件校验报告在忽略的 `.local/migration-20261011.json`。

原 Git 仓库还包含 Automation-Tools 的其他模块，一并保留历史与文件；本次新增开发限定在 Firefox / ChatGPT toolkit 及其文档和验证配置。

## 新的调试入口

`firefox-chatgpt-toolkit/browser/firefox-puppeteer` 安装 Puppeteer Core 25.13.0，锁定依赖、使用官方 registry；不下载或启动另一浏览器。模块任务规范由根 AGENTS.md 指向。选择原因见 [ADR 0009](adr/0009-puppeteer-background-validation.md)。

首次安装运行时实际为 Node 26.7.0，满足包要求的 Node >=22.12.0；先前工作区记录的 Node 22.17.1 仍是历史检查值。新路径的统一验证报告存放 `output/automation/`。

从新路径运行完整 verify 通过：84 项队列/归档测试、6 项 Puppeteer 任务测试、11 项历史原生工具测试、7 项截图适配器测试、两种 PowerShell 检查及 22 份文档链接检查。报告为 `output/automation/20261010T174026Z-48c16a56/report.json`；目录时间采用 UTC，本机验收日期为 2026-10-11。重建的 1.8.1 产物 SHA-256 仍为 `f421c7868b39ec2ff583cc1be2c52ba38a3f2ffb5a2ff15478f01c6e65e0f0bb`。

`gpt-enhancement-queue`、`gpt-enhancement-native` 与 `firefox-puppeteer` 图谱已索引新路径。Codex 的 `%USERPROFILE%\.codex\skills\firefox-puppeteer` 是指向新模块的 Junction，skill 元数据检查通过；使用规范直接由项目维护。

## 真实浏览器边界

doctor 检查返回 `F_ENDPOINT_UNAVAILABLE`：本次没有 BiDi 连接成功或真实页面操作。迁移与安装不更改 Firefox profile、油猴已安装脚本、API 配置或账号。1.8.1 的真实安装及归档图标验收继续待办。没有提交或推送新的 Git 改动。
