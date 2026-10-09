# ADR 0001：Tampermonkey 与本地 DOM 适配

状态：已采纳。日期：历史决策追记 2026-10-10。

## 背景

目标是在 Firefox 的 ChatGPT 网页提供顺序消息队列。用户明确选择油猴脚本，并要求使用已有登录会话。

## 决策

交付单个 Tampermonkey 脚本，匹配 `https://chatgpt.com/*`。脚本读取当前页面结构、修改原生输入框并点击原生发送控件；队列存在 Tampermonkey 本地存储。日常使用无需 API Key、MCP、本地服务或 Node.js。

对比过的方向是原生 Firefox WebExtension、用户脚本和独立 API 客户端。用户脚本符合已确认的安装方式，保留网页所选模型与会话。WebExtension 的后台能力会增加打包与权限维护；独立 API 客户端不能直接复用网页会话体验。

## 影响

源码拆为状态机、网页适配与样式，构建为可完整安装的单文件。自动化套件用于开发和验收，不成为插件运行依赖。只在一个标签页临时注入代码不能证明已安装或全站启用。

DOM 标记是适配边界，前端更新需要重新检查。版本目标是 Tampermonkey 的同步 GM API；不把 Greasemonkey 的仅异步 GM API 视为已支持。

## 依据

- [安装与限制](../../userscripts/chatgpt-queue/README.md)
- [构建入口与匹配规则](../../userscripts/chatgpt-queue/build.cjs)
- [1.7.0 及历史验收](../../userscripts/chatgpt-queue/VALIDATION.md)
