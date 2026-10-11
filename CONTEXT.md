# GPT Enhancement 工作区

当前插件开发入口为 [项目 context](firefox-chatgpt-toolkit/docs/CONTEXT.md)。修改代码前读取该文档；架构决策、开发操作和验证边界由它指向各自文档。

项目运行环境为 **Firefox / Firefox Nightly + Violentmonkey**。安装、配置与更新均以 Violentmonkey 为标准；环境基线与验收状态见 [运行环境](firefox-chatgpt-toolkit/docs/CONTEXT.md#项目运行环境)。

仓库根保留 Automation-Tools 的完整 Git 历史和原有模块。ChatGPT Queue 的活跃源码为 `firefox-chatgpt-toolkit/userscripts/chatgpt-queue`。`.local/legacy-workspace` 与旧目录是迁移备份，不是第二个开发入口。

本机工作目录为 `E:\firefox dev`。旧 `D:\projects\GPT Enhancemnet` 路径通过 Junction 指向此处；迁移证据见 [2026-10-11 记录](firefox-chatgpt-toolkit/docs/migration-2026-10-11.md)。
