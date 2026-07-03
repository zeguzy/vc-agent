## Context

openagent 当前的工具集（read/bash/edit/write/grep/find/lsp/todo/question/notify/subagent）全部面向本地。Pi SDK（`@earendil-works/pi-coding-agent`）的内置工具同样不含任何网络抓取能力。这意味着 agent 一旦需要在线信息（查文档、读博客、对比 API），只能中断流程让用户手动粘贴。

自定义工具的接入点已验证：`src/agent/session.ts` 的 `createSession`(L187) 与 `createRuntime`(L238) 各有一个 `customTools: [...]` 数组，现有 notify/question/todo/subagent 都通过 `createXxxTool(): ToolDefinition` 工厂注册进去。`webfetch` 复用同一模式即可。

约束：
- 项目依赖极简（仅 5 个 runtime dep），且当前网络环境 `bun install` 不稳定 → **MVP 不引入新依赖**。
- 运行时为 Bun，原生 `fetch`（WebKit 实现）可用，支持 `AbortController`、自动 redirect。
- 转换目标是"LLM 可读"，非高保真还原。

## Goals / Non-Goals

**Goals:**
- agent 可通过 `webfetch` 工具抓取任意 http/https URL，拿到 markdown/text/html 格式的内容。
- 零新依赖（Bun 原生 fetch + 自实现转换器）。
- 防护：请求超时 + 输出截断 + 清晰的错误反馈。
- 注册到两个 session 创建路径，所有运行模式（TUI / headless）一致可用。

**Non-Goals:**
- 不做 JS 渲染、反爬绕过、网页搜索、响应缓存、高保真转换（详见 proposal Non-goals）。

## Decisions

### 决策 1：HTTP 客户端用 Bun 原生 `fetch`，不引入第三方库

- **选择**：`fetch(url, { signal, redirect: "follow" })`。
- **理由**：Bun 内置、零依赖、支持 abort/redirect，完全够用。
- **备选**：undici / node-fetch / got —— 都需额外装包，无功能增益，且加剧网络受限时的装包问题。

### 决策 2：HTML→markdown 自实现，不引入 turndown

- **选择**：`src/tools/webfetch.ts` 内置一个轻量转换器（标签映射 + 实体解码 + 无关标签剥离）。
- **理由**：① 零新依赖，规避装包与维护成本；② 目标是 LLM 可读而非像素还原；③ 覆盖常见标签即可满足绝大多数文档/博客场景。
- **备选**：turndown（质量更高但需装包）、@mozilla/readability + turndown（正文提取更好但依赖更重）。
- **兜底**：提供 `format: "text" | "html"`，agent 遇到复杂页面可退回原始格式。

### 决策 3：转换流水线 —— 先清洗再结构映射

处理顺序（见数据流图）：
1. **剥离无关节点**：`<script> <style> <noscript> <head> <svg>` 整段移除。
2. **结构标签映射**：`a→[text](href)`、`h1-6→#/##/...`、`ul→-`、`ol→1.`、`pre/code→```、`blockquote→>`、`br→\n`、`p→双换行`。
3. **表格简化**：基本 `<table>` 转 markdown 表格（含表头分隔行），复杂表格降级为 text。
4. **实体解码**：`&amp; &lt; &gt; &quot; &#39; &nbsp;` 等常见实体。
5. **空白归一**：连续空行压缩为单空行，trim 首尾。

### 决策 4：超时用 `AbortController` + 可配置 timeout

- **默认 20s**，参数 `timeout`（秒）允许 1–60。
- 超时即 `controller.abort()`，捕获 `AbortError` 返回明确文案，不抛异常打断 agent loop。

### 决策 5：输出截断防上下文爆炸

- 常量 `MAX_OUTPUT_CHARS = 50000`（与项目既有 output-guard 量级一致）。
- 超长截断尾部并追加 `\n\n[... truncated, original X chars]`。

### 决策 6：注册到 `customTools`，不进 `BUILTIN_TOOLS` / `activeToolsFor`

- `BUILTIN_TOOLS` / `activeToolsFor(agentMode)` 是 SDK 内置工具的激活开关集合，customTool 默认随 session 创建即激活。
- webfetch 与 todo/notify 一致，作为常驻 customTool 注册到 `createSession` + `createRuntime` 两处。

## 数据流与架构

```
 Agent (LLM) ──tool_call: webfetch({url, format?, timeout?})──┐
                                                              ▼
                ┌─────────────────────────────────────────────────┐
                │ createWebfetchTool().execute(toolCallId, params)│
                │                                                 │
                │  1. 校验 url scheme ∈ {http, https}             │
                │  2. 解析 timeout（默认 20，钳制 1–60）            │
                │  3. AbortController + setTimeout                │
                │  4. fetch(url, { signal, redirect:"follow" })   │
                │  5. 校验 status ∈ 2xx                            │
                │  6. body = await res.text()                     │
                │  7. switch(format):                              │
                │       markdown → htmlToMarkdown(body)           │
                │       text     → stripHtml(body)                │
                │       html     → body                           │
                │  8. 截断到 MAX_OUTPUT_CHARS                      │
                │  9. return { content:[{text}], details:{...} }  │
                └─────────────────────────────────────────────────┘
                              │ 错误路径（任一步失败）：
                              │   非 2xx → "{status} {statusText}: <url>"
                              │   AbortError → "Request timed out after Xs"
                              │   网络/解析异常 → 原始 message
                              ▼
                        Agent 收到内容或错误文案
```

**文件结构**（`src/tools/webfetch.ts`）：

```
常量:  DEFAULT_TIMEOUT = 20
       MAX_OUTPUT_CHARS = 50000
schema: WebfetchParams (TypeBox)
纯函数(可单测):
       decodeHtmlEntities(s): string
       stripHtml(s): string
       htmlToMarkdown(s): string
工厂:  createWebfetchTool(): ToolDefinition
```

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 复杂/非标准页面 markdown 转换质量一般 | 提供 `text` / `html` format 兜底；agent 可自行改 format 重试 |
| 超大页面撑爆上下文 | `MAX_OUTPUT_CHARS` 截断 + 截断提示 |
| 网络受限 / 目标不可达 | 超时 + 明确错误文案，不静默吞错 |
| SSRF（agent 抓内网地址） | MVP 仅校验 scheme；本地终端 agent 信任边界内可接受，后续可加内网 IP 拦截 |
| 自实现转换器的边界 bug | 转换器拆为纯函数，配 `tests/webfetch.test.ts` 覆盖常见标签 |
| 两处注册点漏改 | tasks 显式列出两处 + 单测覆盖 createSession/customTools 含 webfetch |

## Migration Plan

- 纯新增工具，无数据/接口迁移。
- 回滚策略：删除 `webfetch.ts`、移除 session.ts 两处 `createWebfetchTool()` 调用即可，零副作用。
