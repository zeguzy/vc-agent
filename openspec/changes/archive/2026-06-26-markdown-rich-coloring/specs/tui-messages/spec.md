## MODIFIED Requirements

### Requirement: 代码块语法高亮
系统 SHALL 使用 OpenTUI 的 markdown 组件渲染 Agent 回复，通过 tree-sitter 实现代码块语法高亮，并通过注册完整的 `markup.*` 与代码 token scope 实现重点元素（标题、加粗、斜体、行内代码、链接、列表、引用）的彩色与字形强调。

#### Scenario: markdown 渲染入口
- **WHEN** Agent 回复包含 markdown 格式（代码块、行内代码、标题、列表等）
- **THEN** markdown 组件 SHALL 通过 `<markdown syntaxStyle={syntaxStyle} streaming={true}>` 渲染，前景色为 `colors.markdownText`，背景色为 `colors.background`

#### Scenario: 标题染色
- **WHEN** 渲染 `#` ~ `######` 标题
- **THEN** 标题文本 SHALL 命中 `markup.heading` scope，前景色为 `markdownHeading`（#BF5AF2）+ bold
- **AND** `markup.heading.1` SHALL 额外加 underline

#### Scenario: 加粗与斜体染色
- **WHEN** 渲染 `**bold**` 或 `__bold__`
- **THEN** 文本 SHALL 命中 `markup.bold`/`markup.strong` scope，前景色为 `markdownStrong`（#FF453A）+ bold
- **WHEN** 渲染 `*italic*` 或 `_italic_`
- **THEN** 文本 SHALL 命中 `markup.italic` scope，前景色为 `markdownEmph`（#FFD60A）+ italic

#### Scenario: 行内代码与代码块染色
- **WHEN** 渲染 `` `inline code` ``
- **THEN** 文本 SHALL 命中 `markup.raw`/`markup.raw.inline` scope，前景色为 `markdownCode`（#30D158）
- **WHEN** 渲染 ``` ```block ``` ```
- **THEN** 代码块原始文本 SHALL 命中 `markup.raw.block`（前景色 `markdownCode`），代码块内部 token SHALL 按 tree-sitter capture 进一步上色（见"代码 token 细粒度染色"）

#### Scenario: 链接染色
- **WHEN** 渲染 `[label](url)` 链接
- **THEN** 包裹符 `[` `](` `)` SHALL 命中 `markup.link` scope（前景色 `markdownLink` = #64D2FF + underline）
- **AND** label 文本 SHALL 命中 `markup.link.label`（前景色 `markdownLinkText` = #30D158 + underline）
- **AND** url 文本 SHALL 命中 `markup.link.url`（前景色 `markdownLink` + underline）

#### Scenario: 列表与引用染色
- **WHEN** 渲染无序/有序列表的标记符（`-` `*` `1.`）
- **THEN** 标记 SHALL 命中 `markup.list` scope，前景色为 `markdownListItem`（#64D2FF）
- **WHEN** 渲染任务列表 `[x]`/`[ ]`
- **THEN** 已勾选项 SHALL 命中 `markup.list.checked`（前景色 `success` = #30D158），未勾选项 SHALL 命中 `markup.list.unchecked`（前景色 `textMuted` = #878787）
- **WHEN** 渲染 `> blockquote`
- **THEN** 引用文本 SHALL 命中 `markup.quote` scope，前景色为 `markdownBlockQuote`（#FFD60A）+ italic

#### Scenario: 删除线与水平线染色
- **WHEN** 渲染 `~~struck~~`
- **THEN** 文本 SHALL 命中 `markup.strikethrough` scope，前景色为 `textMuted`
- **WHEN** 渲染 `---` 水平分隔线
- **THEN** 分隔线 SHALL 沿用 `@opentui/core` 默认行为（`conceal` scope 色 = `textMuted`），本次不引入 `markdownHorizontalRule` 字段（`createHorizontalRuleRenderable` 内部直接读 `getStyle("conceal")?.fg`，未暴露 scope）

#### Scenario: 代码 token 细粒度染色
- **WHEN** 代码块内的 token 经 tree-sitter 解析产出 capture
- **THEN** 系统 SHALL 按以下 scope 映射上色（在 `syntax.ts` 中通过 `SyntaxStyle.fromTheme` 注册）：
  - `keyword`/`keyword.return`/`keyword.conditional`/`keyword.repeat`/`keyword.directive`/`keyword.modifier`/`keyword.exception` → `syntaxKeyword` + italic
  - `keyword.function`/`keyword.import`/`keyword.type` → `syntaxKeyword` 或 `syntaxFunction`/`syntaxType`（按 opencode 规则细分）
  - `function`/`function.method`/`function.call`/`function.method.call`/`constructor` → `syntaxFunction`
  - `variable`/`variable.parameter`/`variable.member`/`property`/`field` → `syntaxVariable` 或 `syntaxFunction`
  - `type`/`type.builtin`/`module`/`module.builtin`/`class`/`namespace` → `syntaxType`
  - `constant`/`constant.builtin`/`number`/`boolean`/`float` → `syntaxNumber`
  - `string`/`string.regexp`/`string.escape`/`character`/`character.special` → `syntaxString`
  - `comment`/`comment.documentation` → `syntaxComment` + italic
  - `punctuation`/`punctuation.bracket`/`punctuation.delimiter`/`punctuation.special`/`operator`/`keyword.operator` → `syntaxOperator` 或 `syntaxPunctuation`

#### Scenario: scope 注册完整性
- **WHEN** `syntax.ts` 模块加载
- **THEN** 导出的 `syntaxStyle: SyntaxStyle` SHALL 通过 `getStyle(name)` 对以下 scope 返回非空：`markup.heading`、`markup.heading.1`、`markup.bold`、`markup.strong`、`markup.italic`、`markup.raw`、`markup.raw.inline`、`markup.raw.block`、`markup.link`、`markup.link.label`、`markup.link.url`、`markup.list`、`markup.list.checked`、`markup.list.unchecked`、`markup.quote`、`markup.strikethrough`、`keyword`、`keyword.function`、`function`、`function.call`、`variable`、`variable.member`、`type`、`module`、`constant`、`number`、`string`、`comment`、`punctuation.bracket`、`punctuation.delimiter`

#### Scenario: URL 字符串染色
- **WHEN** tree-sitter 产出 `string.special` 或 `string.special.url` capture（如代码块中的 URL 字符串）
- **THEN** 文本 SHALL 命中对应 scope，前景色为 `markdownLink`（#64D2FF）+ underline，对齐 opencode（而非 vc-agent 早期错误映射的 `syntaxKeyword` 紫色）

#### Scenario: Extmark / Diff / LSP scope 注册（对齐 opencode）
- **WHEN** `syntax.ts` 模块加载
- **THEN** 导出的 `syntaxStyle` SHALL 通过 `getStyle(name)` 对以下 scope 返回非空（对齐 opencode `getSyntaxRules`，但 extmark 注入逻辑由独立提案 `markdown-extmark-injection` 实现）：
  - extmark：`prompt`、`extmark.file`、`extmark.agent`、`extmark.paste`
  - diff：`diff.plus`、`diff.minus`、`diff.delta`
  - LSP：`error`、`warning`、`info`、`debug`
- **AND** `extmark.file` SHALL 使用 `warning` + bold
- **AND** `extmark.paste` SHALL 使用 `warning` 背景与 `background` 前景 + bold
- **AND** `diff.*` SHALL 仅使用 foreground（vc-agent 当前不渲染 diff，无 `*Bg` 字段）

#### Scenario: theme 颜色字段完整
- **WHEN** `theme.ts` 加载
- **THEN** `colors` 对象 SHALL 包含以下新增字段，且与现有 `markdownHeading`/`markdownStrong`/`markdownEmph`/`markdownCode`/`markdownLink`/`markdownLinkText` 字段一并被 `syntax.ts` 引用：`markdownBlockQuote`、`markdownListItem`、`markdownListEnumeration`、`syntaxPunctuation`

#### Scenario: 死代码消除
- **WHEN** `syntax.ts` 引用 `colors.markdownHeading`/`markdownStrong`/`markdownEmph`/`markdownCode`/`markdownLink`/`markdownLinkText`
- **THEN** 这些字段 SHALL 在 `syntax.ts` 的规则数组中至少出现一次，不再为未引用死代码
