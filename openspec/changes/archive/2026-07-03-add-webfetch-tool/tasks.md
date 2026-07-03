# Tasks — add-webfetch-tool

> 实现顺序遵循依赖：骨架 → 纯函数（可先测）→ execute 主流程 → 注册 → 测试 → 校验。

## 1. 工具骨架与参数定义

- [x] 1.1 创建 `src/tools/webfetch.ts`：定义常量 `DEFAULT_TIMEOUT = 20`、`MAX_OUTPUT_CHARS = 50000`；用 TypeBox 定义 `WebfetchParams`（`url: string` 必填、`format: Union<"markdown"|"text"|"html">` 可选、`timeout: number` 可选）；编写 `DESCRIPTION`
- [x] 1.2 实现 `createWebfetchTool(): ToolDefinition` 工厂骨架——含 `name/label/description/promptSnippet/parameters`，`execute` 暂返回占位文本，确保类型与 `src/tools/todo.ts` 一致

## 2. HTML 转换纯函数（可独立单测）

- [x] 2.1 实现 `decodeHtmlEntities(s: string): string`——解码 `&amp; &lt; &gt; &quot; &#39; &apos; &nbsp;` 等常见实体
- [x] 2.2 实现 `stripHtml(s: string): string`——移除全部 HTML 标签后调用 `decodeHtmlEntities`，供 `format: "text"` 使用
- [x] 2.3 实现 `htmlToMarkdown(s: string): string`——先整段移除 `<script>/<style>/<noscript>/<head>/<svg>`，再映射 `a→[text](href)`、`h1-6→#/…`、`ul→-`、`ol→1.`、`pre/code→代码围栏`、`blockquote→>`、`br→\n`、`p→双换行`、基本 `table→markdown 表格`，最后实体解码 + 连续空行压缩

## 3. execute 抓取主流程

- [x] 3.1 实现 URL scheme 校验：仅允许 `http`/`https`，拒绝 `file://`/`ftp://`/无 scheme 裸地址，返回明确错误文本；`timeout` 钳制到 1–60（默认 20）
- [x] 3.2 实现抓取：`AbortController` + `setTimeout(timeout*1000)` + `fetch(url, { signal, redirect: "follow" })` + 非 2xx 状态码校验 + `await res.text()`
- [x] 3.3 接入 `format` 分支（`markdown→htmlToMarkdown` / `text→stripHtml` / `html→原样`，缺省 markdown）+ 超过 `MAX_OUTPUT_CHARS` 时截断尾部并追加 `[... truncated, original N chars]` + 返回 `{ content:[{type:"text",text}], details:{url,format,status,truncated,originalChars} }`
- [x] 3.4 错误统一处理：scheme 错误 / 非 2xx / `AbortError`（超时文案）/ 网络异常 全部 `catch` 返回错误文本，**不得抛出未捕获异常**打断 agent 循环

## 4. 注册到 agent session

- [x] 4.1 在 `src/agent/session.ts` 导入 `createWebfetchTool`，加入 `createSession`（L187 附近）的 `customTools` 数组
- [x] 4.2 在同一文件 `createRuntime`（L238 附近）的 `customTools` 数组加入 `createWebfetchTool()`

## 5. 测试

- [x] 5.1 编写 `tests/webfetch.test.ts`：覆盖三个纯函数——`decodeHtmlEntities`（&amp;/&lt;/&nbsp; 等）、`stripHtml`（去标签+解码）、`htmlToMarkdown`（链接→`[text](href)`、标题→`#`、script/style 移除、实体解码、空行压缩）
- [x] 5.2 在同文件加 `createWebfetchTool` 集成测试：scheme 拒绝（`file://`/裸地址返回错误且不发请求）、`format` 分支、超长截断行为（用 `Bun.serve` 起本地 server 返回受控内容，或 mock 全局 `fetch`）

## 6. 质量校验

- [x] 6.1 运行 `bun run check`（typecheck + lint + test）确认全绿；修复 biome lint（tab 缩进、双引号、行宽 100）与 tsc 类型问题
