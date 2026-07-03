# webfetch-tool Specification

## Purpose
让 agent 能抓取任意 http/https URL 并按 markdown（默认）/ text / html 格式返回内容，把"读网页"变成与"读文件"对等的一等公民能力。包含 URL scheme 校验、请求超时控制、输出截断、错误反馈与轻量 HTML→markdown 转换。不引入新依赖、不执行 JavaScript、不做反爬绕过。

## Requirements

### Requirement: webfetch 工具抓取 URL 并返回内容

系统 SHALL 提供名为 `webfetch` 的自定义工具，接受一个 `url` 参数（http/https），抓取该 URL 的响应体，按 `format` 参数转换后作为工具结果文本返回给 agent。工具 MUST 在 `createSession` 与 `createRuntime` 两个 session 创建路径中注册到 `customTools`，保证 TUI 与 headless 模式一致可用。

#### Scenario: 成功抓取并返回 markdown

- **WHEN** agent 调用 `webfetch({ url: "https://example.com/doc", format: "markdown" })` 且目标返回 2xx 与 HTML
- **THEN** 工具返回 `{ content: [{ type: "text", text: <转换后的 markdown> }] }`，且转换后的文本不含 `<script>` / `<style>` 内容

#### Scenario: text 格式剥离所有标签

- **WHEN** agent 调用 `webfetch({ url, format: "text" })` 且目标返回 HTML
- **THEN** 返回文本为去除全部 HTML 标签后的纯文本，HTML 实体（如 `&amp;`）已解码

#### Scenario: html 格式原样返回

- **WHEN** agent 调用 `webfetch({ url, format: "html" })`
- **THEN** 返回内容为响应体原始 HTML，不做任何转换

#### Scenario: format 缺省默认 markdown

- **WHEN** agent 调用 `webfetch({ url })` 不传 `format`
- **THEN** 工具按 `markdown` 格式处理并返回

### Requirement: 非法 URL scheme 拒绝

工具 MUST 校验 `url` 的 scheme 为 `http` 或 `https`，其他 scheme（如 `file://`、`ftp://`、无 scheme 的裸字符串）SHALL 被拒绝并返回明确的错误文案，不发起请求。

#### Scenario: 非 http(s) scheme 被拒

- **WHEN** agent 调用 `webfetch({ url: "file:///etc/passwd" })`
- **THEN** 工具返回错误文本说明仅支持 http/https，且未发起任何网络请求

#### Scenario: 无 scheme 的裸地址被拒

- **WHEN** agent 调用 `webfetch({ url: "example.com" })`
- **THEN** 工具返回错误文本说明仅支持 http/https

### Requirement: 请求超时控制

工具 SHALL 对每次请求施加超时：默认 20 秒，可通过 `timeout` 参数（单位秒）在 1–60 范围内调整。超时后 MUST 中止请求并返回明确的超时文案，不得让 agent 流程卡死或抛出未捕获异常。

#### Scenario: 默认超时生效

- **WHEN** agent 调用 `webfetch({ url })` 且目标在 20 秒内无响应
- **THEN** 工具返回形如 "Request timed out after 20s" 的文本，不抛异常

#### Scenario: 自定义超时被钳制到合法区间

- **WHEN** agent 调用 `webfetch({ url, timeout: 120 })`
- **THEN** 实际生效超时为 60 秒（上限）；`timeout: 0` 或负值则生效为 1 秒（下限）

### Requirement: 输出截断防止上下文爆炸

工具 MUST 对返回文本施加最大字符数上限（`MAX_OUTPUT_CHARS`）。当响应体转换后超过上限时，SHALL 截断尾部并在末尾追加截断提示（标注原始字符数），确保单次工具结果不会撑爆 LLM 上下文窗口。

#### Scenario: 超长内容被截断并提示

- **WHEN** 抓取并转换后的文本长度 > `MAX_OUTPUT_CHARS`
- **THEN** 返回文本长度 ≤ `MAX_OUTPUT_CHARS`，且末尾包含形如 `[... truncated, original N chars]` 的提示

#### Scenario: 短内容原样保留

- **WHEN** 抓取并转换后的文本长度 ≤ `MAX_OUTPUT_CHARS`
- **THEN** 返回完整文本，无截断提示

### Requirement: 网络与 HTTP 错误明确反馈

工具 SHALL 捕获所有网络异常与非 2xx HTTP 响应，返回包含状态码/原因的明确错误文本，MUST NOT 抛出未捕获异常打断 agent 循环。

#### Scenario: 非 2xx HTTP 状态码

- **WHEN** 目标返回 HTTP 404
- **THEN** 工具返回形如 "404 Not Found: <url>" 的文本，不抛异常

#### Scenario: 网络层异常（DNS/连接失败）

- **WHEN** 目标域名无法解析或连接被拒
- **THEN** 工具返回包含底层错误 message 的文本，不抛异常

### Requirement: HTML→markdown 转换覆盖常见标签

转换器 SHALL 至少处理以下结构：链接 `<a href>`、标题 `<h1>`–`<h6>`、列表 `<ul>`/`<ol>`/`<li>`、代码 `<pre>`/`<code>`、引用 `<blockquote>`、换行 `<br>`/`<p>`、以及常见 HTML 实体解码。转换器 MUST 移除 `<script>`/`<style>`/`<noscript>`/`<head>`/`<svg>` 等非正文节点的内容。

#### Scenario: 链接转为 markdown 链接

- **WHEN** 输入 HTML 含 `<a href="https://x.com">X</a>`
- **THEN** 转换结果包含 `[X](https://x.com)`

#### Scenario: script/style 内容被移除

- **WHEN** 输入 HTML 含 `<script>alert(1)</script>` 与 `<style>.a{}</style>`
- **THEN** 转换结果不含 `alert(1)` 与 `.a{}`

#### Scenario: HTML 实体被解码

- **WHEN** 输入 HTML 含 `a &amp; b` 与 `&lt;tag&gt;`
- **THEN** 转换结果包含 `a & b` 与 `<tag>`
