## Why

当前 agent 的工具集只覆盖本地能力（read/bash/edit/write/grep/find/lsp/todo/question/notify/subagent），无法获取任何网络资源。当用户让 agent 查阅一份在线文档、对比某个库的最新用法、或读取一个 URL 的内容时，agent 只能要求用户手动粘贴。

新增 `webfetch` 工具，让 agent 能自行抓取指定 URL 并把内容转成 LLM 友好的 markdown，把"读网页"变成和"读文件"一样自然的一等公民能力。

## What Changes

- **新增 `webfetch` 自定义工具**：抓取 HTTP/HTTPS URL，将 HTML 转为 markdown（或 text/html），返回给 agent。
- **轻量 HTML→markdown 转换器**：项目内自实现，**不引入新依赖**（保持现有精简依赖风格，且避免网络受限场景下的装包问题）。
- **超时与截断**：请求级超时（AbortController）+ 输出字符截断，防止超大页面撑爆上下文。
- **format 选项**：`markdown`（默认）/ `text` / `html`，匹配不同抓取场景。
- **注册到 agent session**：在 `createSession` 与 `createRuntime` 两处 `customTools` 数组中接入。

## Non-goals

- **不做 JavaScript 渲染**：不处理 SPA / 动态 JS 渲染页面，只抓取服务端返回的原始 HTML。
- **不做反爬 / WAF 绕过**：不伪装 UA、不走 TLS 指纹、不做 Cloudflare 绕过；遇到 403 即如实报错。
- **不做网页搜索**：只抓取用户/agent 指定的 URL，不提供搜索引擎集成。
- **不做高保真 HTML→markdown**：转换目标是"LLM 可读"，覆盖常见标签（a/p/h1-6/ul/ol/li/code/pre/blockquote/br/table），不追求像素级还原。
- **不引入新 npm 依赖**：MVP 用 Bun 原生 `fetch` + 自实现转换器，不引入 turndown / jsdom / readability 等。
- **不做缓存与去重**：每次调用都重新抓取，不在工具层做响应缓存。

## Capabilities

### New Capabilities

- `webfetch-tool`: agent 可调用的 URL 抓取工具——给定 URL，返回转换后的页面内容（markdown/text/html），含超时、截断与错误处理。

### Modified Capabilities

<!-- webfetch 是纯新增能力，不改 agent-session 的现有 spec requirements（工具注册是实现细节，非 spec 行为变更）。故无修改项。 -->

## Impact

- **新增代码**：`src/tools/webfetch.ts`（工具定义 + 转换器），`tests/webfetch.test.ts`（转换器单测）。
- **修改代码**：`src/agent/session.ts`——`createSession`(L187) 与 `createRuntime`(L238) 的 `customTools` 数组各加入 `createWebfetchTool()`。
- **依赖**：无新增（使用 Bun 原生 `fetch`、`AbortController`、`typebox` schema）。
- **OpenSpec spec**：新增 `openspec/specs/webfetch-tool/spec.md`。
- **回归风险**：极低。仅新增一个可选工具并注册到 customTools，不触碰现有工具逻辑与 session 生命周期。
