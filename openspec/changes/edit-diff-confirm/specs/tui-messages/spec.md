## MODIFIED Requirements

### Requirement: 工具调用卡片
系统 SHALL 以圆角边框卡片样式渲染工具调用，按工具类型显示不同的详情和结果。edit 工具在执行成功且携带 `toolResult.details.patch` 时，SHALL 渲染 OpenTUI `<diff>` 组件展示带语法高亮、行号与 +/- 标记的 unified diff，替代早期单行 old/new 文本。

#### Scenario: 工具卡片样式
- **WHEN** 渲染工具调用消息
- **THEN** 消息 SHALL 使用 `borderStyle="rounded"` 四边圆框，`backgroundColor=backgroundInset`，顶部行显示状态图标 + 工具名（`secondary` 色），下方显示详情行

#### Scenario: 状态图标与边框颜色
- **WHEN** 工具执行中/完成/失败
- **THEN** 图标 SHALL 为 spinner `⠹`（running）/ `✓`（done, `success` 色）/ `✗`（error, `error` 色），边框颜色 SHALL 为 `borderActive`（running）/ `borderSoft`（done）/ `error`（error）

#### Scenario: 按工具类型显示详情
- **WHEN** 渲染工具详情行
- **THEN** read 工具 SHALL 显示 `path` + 可选行范围（offset+limit→`path:offset-(offset+limit-1)`，offset only→`path:offset+`）
- **AND** bash 工具 SHALL 显示 `command`（截断 80 字符）
- **AND** edit 工具 SHALL 仅显示 `path` 标题（diff 由下方 unified diff 渲染 Scenario 接管，不再显示单行 old/new 文本）
- **AND** write 工具 SHALL 显示 `path` + 行数

#### Scenario: edit 工具渲染 unified diff
- **WHEN** 渲染 edit 工具调用且 `message.toolResult.details.patch` 为非空字符串
- **THEN** 系统 SHALL 在 path 标题行下方渲染 `<EditDiffView patch={toolResult.details.patch} filePath={toolArgs.path}>`，内部使用 OpenTUI `<diff>` 元素，传入：
  - `diff={patch}`（jsdiff `createTwoFilesPatch` 输出的 unified diff 文本）
  - `filetype={pathToFiletype(toolArgs.path)}`（按扩展名映射的 tree-sitter 语言名）
  - `syntaxStyle={syntaxStyle}`（复用 markdown 代码块同款）
  - `view="unified"`、`showLineNumbers={true}`
  - +/- 染色与背景由 DiffRenderable 默认配色 + `addedSignColor`/`removedSignColor`/`addedBg`/`removedBg` 显式注入
- **AND** DiffRenderable SHALL 内部完成 parseDiff + 行号对齐 + `+`/`-`/` ` 前缀染色 + tree-sitter 语法高亮
- **AND** 该 `<diff>` 区 SHALL 设 `flexShrink={0}` 保证在消息列表 ScrollBox 内不被压扁

#### Scenario: edit diff 的 filetype 映射
- **WHEN** 计算 edit diff 的 `filetype` prop
- **THEN** 系统 SHALL 通过纯函数 `pathToFiletype(path)` 按扩展名映射：`.ts`/`.tsx`/`.mts`/`.cts`→`typescript`、`.js`/`.jsx`/`.mjs`→`javascript`、`.py`→`python`、`.go`→`go`、`.rs`→`rust`、`.java`→`java`、`.kt`→`kotlin`、`.md`→`markdown`、`.json`→`json`、`.sh`/`.bash`→`bash`、`.c`/`.h`→`c`、`.cpp`→`cpp`、`.yml`/`.yaml`→`yaml`、`.toml`→`toml`；`Dockerfile` 特判
- **AND** 未知扩展名/无扩展名 SHALL 不传 `filetype`，`<diff>` 退化为纯 +/- 染色无语法高亮，仍可读

#### Scenario: edit 工具结果文本不重复显示
- **WHEN** edit 工具成功渲染了 `<diff>` 区
- **THEN** 系统 SHALL 不再通过 `formatToolResult` 显示 "Successfully replaced N block(s)" 文本行（该信息已由 diff 区表达）
- **AND** 该抑制 SHALL 仅作用于 edit 工具的成功路径

#### Scenario: edit 工具无 diff 数据时降级
- **WHEN** 渲染 edit 工具调用且 `toolResult.details.patch` 缺失/非字符串（如 edit 失败、旧会话恢复历史消息、匹配错误）
- **THEN** 系统 SHALL 不渲染 `<diff>` 组件
- **AND** 系统 SHALL 回退到 `formatToolResult(message.toolResult)` 文本行展示（与现有非 read 工具一致，上限 15 行）
- **AND** 错误结果 SHALL 使用 `error` 色

#### Scenario: 工具结果显示（非 edit 成功路径）
- **WHEN** 非 edit 工具执行完成（status=done/error），或 edit 工具处于降级态/错误态
- **THEN** 系统 SHALL 通过 `formatToolResult` 从 `{content:[{type:'text',text}]}` 提取文本，显示最多 15 行
- **AND** read 工具 SHALL 跳过结果显示
- **AND** 错误结果 SHALL 使用 `error` 色

### Requirement: 代码块语法高亮
系统 SHALL 使用 OpenTUI 的 markdown 组件渲染 Agent 回复，通过 tree-sitter 实现代码块语法高亮，并通过注册完整的 `markup.*` 与代码 token scope 实现重点元素（标题、加粗、斜体、行内代码、链接、列表、引用）的彩色与字形强调；diff scope SHALL 同时注册前景与背景色以支持 edit 工具的 unified diff 渲染。

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
- **THEN** 文本 SHALL 命中 `markup.italic` scope，前景色为 `markdownEmpl`（#FFD60A）+ italic

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
- **THEN** 分隔线 SHALL 沿用 `@opentui/core` 默认行为（`conceal` scope 色 = `textMuted`），不引入 `markdownHorizontalRule` 字段

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
- **AND** `diff.plus`/`diff.minus`/`diff.delta` SHALL 同时设置 foreground 与 background（解除早期"vc-agent 当前不渲染 diff，无 `*Bg`"约束），background 引用 theme 的 `diffAddedBg`/`diffRemovedBg`/`diffContextBg`

#### Scenario: theme 颜色字段完整
- **WHEN** `theme.ts` 加载
- **THEN** `colors` 对象 SHALL 包含以下新增字段，且与现有 `markdownHeading`/`markdownStrong`/`markdownEmpl`/`markdownCode`/`markdownLink`/`markdownLinkText` 字段一并被 `syntax.ts` 引用：`markdownBlockQuote`、`markdownListItem`、`markdownListEnumeration`、`syntaxPunctuation`
- **AND** `colors` 对象 SHALL 包含 diff 背景与行号字段：`diffAddedBg`、`diffRemovedBg`、`diffContextBg`、`diffLineNumber`、`diffAddedLineNumberBg`、`diffRemovedLineNumberBg`（dark/light 配色对齐 opencode）

#### Scenario: 死代码消除
- **WHEN** `syntax.ts` 引用 `colors.markdownHeading`/`markdownStrong`/`markdownEmpl`/`markdownCode`/`markdownLink`/`markdownLinkText`
- **THEN** 这些字段 SHALL 在 `syntax.ts` 的规则数组中至少出现一次，不再为未引用死代码

## ADDED Requirements

### Requirement: edit 确认叠加层（DiffConfirmBox）
系统 SHALL 在 edit 工具写盘前，当 `EditConfirmBridge.pending` 非空时，在消息流之上渲染 `DiffConfirmBox` 叠加层，展示 unified diff 预览并提供 Allow / Reject 交互。这是 edit 工具"编辑前确认"流程的 TUI 表现层（流程契约见 agent-session 规格"工具调用确认（edit）"）。

#### Scenario: 确认框触发条件
- **WHEN** `editBridge.pending` 变为非空（edit execute 已算好 patch 并阻塞等待）
- **THEN** App SHALL 设置 `pendingEditConfirm` state，渲染 `<DiffConfirmBox bridge={editBridge}>`
- **AND** DiffConfirmBox SHALL 在 InputBox 区域或叠加层渲染（位置参照 QuestionBox）
- **AND** 当 `bridge.pending` 为空时 SHALL 不渲染

#### Scenario: 确认框结构与 diff 渲染
- **WHEN** 渲染 DiffConfirmBox
- **THEN** 顶部 SHALL 显示标题行 `△ 确认 edit · <filePath>`（`warning` 色 三角 + 文本）
- **AND** 中部 SHALL 用 `<scrollbox>` 包裹原生 `<diff diff={pending.patch} filetype={pathToFiletype(filePath)} syntaxStyle={syntaxStyle} view="unified" showLineNumbers addedBg={colors.diffAddedBg} removedBg={colors.diffRemovedBg} contextBg={colors.diffContextBg} addedSignColor removedSignColor>`，支持长 diff 滚动
- **AND** 底部 SHALL 渲染按钮行 `[ Allow once ] [ Reject ]`，选中按钮 SHALL 使用 `warning` 背景与 `background` 前景，未选中 SHALL 使用 `backgroundMenu`

#### Scenario: 选择阶段键盘交互
- **WHEN** DiffConfirmBox 处于 `choose` 阶段（默认）
- **THEN** `←/→` 或 `tab`/`shift+tab` SHALL 在 Allow once / Reject 间切换（默认选中 Allow once）
- **AND** `enter` SHALL 确认当前选中：Allow once → `bridge.resolve({kind:"accept"})`；Reject → 进入 `reject-feedback` 阶段
- **AND** `esc` SHALL 直接 `bridge.resolve({kind:"reject", feedback:""})`（通用拒绝）

#### Scenario: 拒绝反馈子步骤
- **WHEN** DiffConfirmBox 处于 `reject-feedback` 阶段
- **THEN** SHALL 渲染 `<input>` 文本框，placeholder 为 "告诉 agent 该怎么改（空提交=通用拒绝）"
- **AND** `enter` SHALL 提交：调 `bridge.resolve({kind:"reject", feedback:<输入文本>})`
- **AND** `esc` SHALL 返回 `choose` 阶段（不提交）

#### Scenario: 确认完成后清理
- **WHEN** `bridge.resolve` 被调用（Allow 或 Reject）
- **THEN** App SHALL 清空 `pendingEditConfirm` state，DiffConfirmBox 卸载
- **AND** edit execute 恢复执行（accept 写盘 / reject 返回错误）后，工具卡片按"工具调用卡片"Requirement 渲染结果

#### Scenario: 会话切换清理确认框
- **WHEN** 会话切换触发 `clearEditConfirmBridge`
- **THEN** DiffConfirmBox SHALL 卸载，`pendingEditConfirm` 清空
- **AND** 该清理 SHALL 不阻塞切换流程
