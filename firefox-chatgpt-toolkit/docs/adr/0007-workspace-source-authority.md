# ADR 0007：迁移与唯一源码入口

状态：已采纳。日期：2026-10-10。

## 背景

用户要求把工作环境迁移至 `D:\projects\GPT Enhancemnet`，并建立持久化项目文档。旧环境同时存在 outputs 中的源码、副本式发布 checkout、研究克隆和私有浏览器证据。

## 选择

| 方案 | 影响 |
| --- | --- |
| 完整现有 Git checkout 作为新根，另存私有历史 | 保留提交、remote 和自动化模块，一处开发与发布来源 |
| 继续以 outputs 为源码，另外复制发布 checkout | 延续两个可编辑副本，变更和构建容易不同步 |
| 抽取独立仓库 | 目录更小，但增加新历史/remote 与回传原发布仓库的维护 |

## 决策

采用第一种方案，将已有 Automation-Tools checkout 复制迁移为 `D:\projects\GPT Enhancemnet` 根仓库，保留完整 `.git` 历史和 remote。唯一插件开发源码位于根仓库的 `firefox-chatgpt-toolkit/userscripts/chatgpt-queue`，自动化模块仍与它同处 toolkit。

旧 workspace 保留为迁移备份，不再作为开发入口。私有材料副本位于新根的 `.local/legacy-workspace`，由 Git 忽略；历史 zip、页面证据、草稿备份和一次性任务属于本地历史。依赖安装、缓存与运行产物可重建，不迁入活跃源码。

## 影响与完成条件

源码修正、构建、验证与后续交付从新 checkout 完成。生成脚本由同目录源码构建，不手工维护第二份实现。已有仓库的其他模块保留，后续 Git 暂存限定本项目文件。

迁移完成需核对关键文件哈希、Git HEAD/remote、私有材料忽略规则，并从新路径运行适当的本地检查。持久化文档和知识图谱使用新路径；重建索引不代表浏览器验收。

本次迁移不重新安装油猴、不迁移 Firefox profile，也不改变已安装脚本或账号状态。远端发布和浏览器复验另记实际执行结果；ADR 本身不声称已经提交、推送或复验。

## 依据

- [项目上下文](../CONTEXT.md)
- [模块入口](../../README.md)
- [版本验收历史](../../userscripts/chatgpt-queue/VALIDATION.md)
