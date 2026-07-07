# tui-messages Specification

## Purpose
定义消息列表的渲染规则，包括用户消息气泡、Agent 回复（含思考内容）、工具调用卡片、read 合并、流式更新和轮次分隔。
## Requirements
### Requirement: 消息列表滚动渲染
系统 SHALL 使用 OpenTUI 的 ScrollBox 组件渲染消息列表（`stickyScroll` + `stickyStart="bottom"`），支持内容超出可视区域时自动滚动到最新消息。

#### Scenario: 新消息自动滚动
- **WHEN** Agent 产生新的流式文本或工具调用消息，且消息列表超出可视区域
- **THEN** ScrollBox 自动滚动到底部，显示最新内容

#### Scenario: NORMAL 模式手动滚动
- **WHEN** 用户在 NORMAL 模式下按 `g` 或 `G`
- **THEN** ScrollBox 滚动到对应位置（`g`=顶部, `G`=底部），虚拟光标重定位到新视口的首/末个内容行
- **AND** `j`/`k` 不再触发滚动，改为移动虚拟光标（行为由 `Normal Mode Keymap` requirement 定义）

### Requirement: Normal Mode Keymap

The NORMAL mode keymap SHALL be extended to include vim cursor navigation commands. The `j` and `k` keys SHALL change from viewport scrolling to cursor movement with auto-scroll.

#### Scenario: j/k cursor movement

- **WHEN** the user is in NORMAL mode and presses `j`
- **THEN** the virtual cursor SHALL move one row down (instead of scrolling by 2 lines)
- **AND** if the cursor reaches the bottom of the visible viewport, the message area SHALL auto-scroll to keep the cursor visible
- **WHEN** the user presses `k`
- **THEN** the virtual cursor SHALL move one row up
- **AND** if the cursor reaches the top of the visible viewport, the message area SHALL auto-scroll to keep the cursor visible

#### Scenario: New motion bindings in NORMAL mode

- **WHEN** the user is in NORMAL mode
- **THEN** the following keys SHALL be active: `h` (cursor left), `l` (cursor right), `w` (word forward), `b` (word back), `e` (word end), `0` (line start), `$` (line end), `^` (first non-blank), `v` (visual mode), `s` (easymotion), `f/F/t/T` (char find/till)
- **AND** the following keys remain unchanged: `i/a/o` (to INSERT), `g/G` (scroll top/bottom), `t` is repurposed as till-char (was toggle thinking — moved to a different key)

### Requirement: Vim Cursor Navigation in Normal Mode

The TUI SHALL provide vim-style cursor navigation within the message area when the user is in NORMAL mode. A virtual cursor SHALL be rendered at the current position and SHALL move in response to vim motion commands.

#### Scenario: Basic cursor movement with h/j/k/l

- **WHEN** the user is in NORMAL mode and presses `h`
- **THEN** the virtual cursor SHALL move one cell to the left, stopping at the message area's left boundary
- **WHEN** the user presses `l`
- **THEN** the virtual cursor SHALL move one cell to the right, stopping at the last non-empty cell on the current line
- **WHEN** the user presses `j` and the cursor is not at the bottom of the visible viewport
- **THEN** the virtual cursor SHALL move one row down
- **WHEN** the user presses `j` and the cursor IS at the bottom of the visible viewport
- **THEN** the message area SHALL scroll down by one line to reveal the next row, and the cursor SHALL move to that row
- **WHEN** the user presses `k` and the cursor is not at the top of the visible viewport
- **THEN** the virtual cursor SHALL move one row up

#### Scenario: Word movement with w/b/e

- **WHEN** the user presses `w`
- **THEN** the cursor SHALL jump to the start of the next word (skipping whitespace and current word)
- **WHEN** the user presses `b`
- **THEN** the cursor SHALL jump to the start of the previous word
- **WHEN** the user presses `e`
- **THEN** the cursor SHALL jump to the end of the current word (or next word if already at end)

#### Scenario: Line navigation with 0/$/^

- **WHEN** the user presses `0`
- **THEN** the cursor SHALL move to the first cell of the current visual line
- **WHEN** the user presses `$`
- **THEN** the cursor SHALL move to the last non-empty cell of the current visual line
- **WHEN** the user presses `^`
- **THEN** the cursor SHALL move to the first non-blank cell of the current visual line

#### Scenario: Cursor clamping to non-empty cells

- **WHEN** the cursor is moved to a cell that is empty (whitespace or void)
- **THEN** the cursor SHALL be clamped to the nearest non-empty cell on that line
- **WHEN** the cursor is on a line that has no non-empty cells
- **THEN** the cursor SHALL remain at the first column of that line

#### Scenario: Cursor display

- **WHEN** the user is in NORMAL mode and the virtual cursor is active
- **THEN** the terminal cursor SHALL be visible at the cursor position via `renderer.setCursorPosition()`
- **AND** the cell at the cursor position SHALL be highlighted (inverted colors) to indicate cursor location

### Requirement: Character Find and Easymotion Jump

The TUI SHALL support vim-style character search (`f/F/t/T`) and easymotion-style screen-wide jump (`s`) in NORMAL mode.

#### Scenario: Find char with f/F

- **WHEN** the user presses `f` followed by a character `<char>`
- **THEN** the cursor SHALL jump to the next occurrence of `<char>` on the current line
- **WHEN** the user presses `F` followed by a character
- **THEN** the cursor SHALL jump to the previous occurrence of that character on the current line
- **WHEN** no match is found on the current line
- **THEN** the cursor SHALL remain in place

#### Scenario: Till char with t/T

- **WHEN** the user presses `t` followed by a character
- **THEN** the cursor SHALL jump to the cell immediately before the next occurrence of that character
- **WHEN** the user presses `T` followed by a character
- **THEN** the cursor SHALL jump to the cell immediately after the previous occurrence of that character

#### Scenario: Easymotion jump with s

- **WHEN** the user presses `s` followed by a character `<char>`
- **THEN** the TUI SHALL scan all visible cells in the message area for occurrences of `<char>`
- **AND** SHALL assign short labels to each match using the SCTree algorithm (sorted by Manhattan distance from cursor)
- **AND** SHALL render the labels on screen via buffer overlay
- **WHEN** the user then presses the label key(s) corresponding to a target
- **THEN** the cursor SHALL jump to that target position
- **WHEN** the user presses `Escape` during easymotion label selection
- **THEN** the easymotion overlay SHALL be cleared and the cursor SHALL remain at its original position
- **WHEN** no matches are found for the searched character
- **THEN** no labels SHALL be displayed and the cursor SHALL remain in place

### Requirement: Visual Selection and Yank

The TUI SHALL support vim-style visual mode for selecting text and yanking (copying) it to the clipboard.

#### Scenario: Enter visual mode

- **WHEN** the user is in NORMAL mode and presses `v`
- **THEN** the TUI SHALL enter VISUAL mode with the current cursor position as the selection anchor
- **AND** the status indicator SHALL reflect VISUAL mode

#### Scenario: Extend selection

- **WHEN** the user is in VISUAL mode and uses any motion command (h/j/k/l/w/b/e/f/etc.)
- **THEN** the selection SHALL extend from the anchor to the new cursor position
- **AND** all cells within the selection range SHALL be highlighted (inverted colors)

#### Scenario: Yank selection

- **WHEN** the user is in VISUAL mode and presses `y`
- **THEN** the selected text SHALL be extracted from the screen model and copied to the clipboard
- **AND** the TUI SHALL return to NORMAL mode
- **AND** the selection highlight SHALL be cleared
- **AND** a toast notification SHALL confirm the copy

#### Scenario: Exit visual mode

- **WHEN** the user is in VISUAL mode and presses `Escape`
- **THEN** the TUI SHALL return to NORMAL mode and clear the selection

### Requirement: 用户消息圆角气泡
系统 SHALL 以圆角边框卡片样式渲染用户发送的消息，与 Agent 消息形成视觉对比。

#### Scenario: 用户消息样式
- **WHEN** 渲染用户提交的输入消息
- **THEN** 消息 SHALL 使用 `borderStyle="rounded"` 四边圆角边框，`borderColor=borderSoft`，`backgroundColor=backgroundPanel`，paddingTop/Bottom=1，paddingLeft/Right=2
- **AND** 外层 box 只包含边框，内层嵌套 box 包含背景色和 padding

### Requirement: Agent 回复与思考内容分离
系统 SHALL 将 Agent 回复中的 `type:text` 和 `type:thinking` 内容分别提取和渲染。

#### Scenario: 思考内容提取
- **WHEN** 收到 Agent 消息（`message_start`/`message_update`/`message_end`）
- **THEN** 系统 SHALL 通过 `extractAssistantContent(content)` 返回 `{text, thinking}`，分别存储到 Message 的 `content` 和 `thinking` 字段

#### Scenario: 思考内容渲染（展开）
- **WHEN** 渲染 Agent 回复且 `thinkingCollapsed` 为 false
- **THEN** 思考内容 SHALL 显示为：橙色（`warning`）`- Thinking` 标签 + 灰色（`textSubtle`）思考正文（按行分割），与下方 markdown 正文之间有 marginTop=1 间距

#### Scenario: 思考内容渲染（折叠）
- **WHEN** 渲染 Agent 回复且 `thinkingCollapsed` 为 true
- **THEN** 思考内容 SHALL 显示为：橙色 `+ Thinking …` 标签，不展示正文

#### Scenario: 无思考内容
- **WHEN** Agent 回复不包含 thinking 块
- **THEN** 不渲染 Thinking 标签和内容

### Requirement: Agent 流式文本渲染
系统 SHALL 将 Agent 的回复以流式方式渲染到消息列表中，使用节流（120ms）避免渲染抖动。

#### Scenario: 流式文本追加（节流）
- **WHEN** 收到 `message_update` 事件
- **THEN** 增量文本 SHALL 存入 `pendingTextRef` 和 `pendingThinkingRef`，通过 120ms `setTimeout` 节流后批量 `setMessages` 更新

#### Scenario: 消息完成立即刷新
- **WHEN** 收到 `message_end` 事件
- **THEN** 系统 SHALL 清除节流定时器，立即 `setMessages` 写入最终文本和思考内容

#### Scenario: 新 Agent 消息开始
- **WHEN** 收到 `message_start` 事件
- **THEN** 在消息列表中创建新的 Agent 消息块，通过 `extractAssistantContent` 提取初始文本和思考内容

### Requirement: React.memo 性能优化
系统 SHALL 对非流式组件使用 `React.memo` 包装，避免不必要的重渲染。

#### Scenario: 非流式组件 memo 化
- **WHEN** 消息列表重渲染（如流式更新）
- **THEN** `UserMessageView`、`ToolMessageView`、`ReadGroupView`、`SeparatorView` SHALL 被 `memo()` 跳过重渲染，仅 `AssistantMessageView` 重渲染

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

### Requirement: 连续 Read 调用合并
系统 SHALL 将连续的 read 工具调用消息合并为一个卡片，每行代表一次 read 调用。

#### Scenario: 合并渲染
- **WHEN** 消息列表中存在连续的 read 工具消息（≥2 条相邻）
- **THEN** 系统 SHALL 将其合并为 `ReadGroupView` 卡片，每行显示 `[N] path:range`，使用 `textSubtle` 色

#### Scenario: 单条 read 不合并
- **WHEN** 只有一条 read 工具消息（非连续）
- **THEN** 系统 SHALL 使用标准 `ToolMessageView` 卡片渲染

### Requirement: 轮次分隔线
系统 SHALL 在每轮 Agent 响应结束后在消息列表中输出分隔线。

#### Scenario: 分隔线渲染
- **WHEN** 收到 `agent_end` 事件
- **THEN** 在消息列表底部追加一条 `SeparatorView`（顶部边框线 `─`），并更新上下文用量（`session.getContextUsage()`）

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

### Requirement: 排队消息指示器
系统 SHALL 在 InputBox 上方渲染排队消息的独立指示器，不混入消息流。

#### Scenario: 排队消息渲染
- **WHEN** 消息列表中存在 `queued: true` 的消息
- **THEN** 系统 SHALL 从 MessageList 中过滤排队消息，在 InputBox 上方渲染独立的圆角指示器：`Queued →` 标签（`secondary` 色）+ 消息内容（`textMuted` 色）

### Requirement: OpenTUI 应用层 selection 启用
系统 SHALL 依赖 OpenTUI 默认的 mouse tracking（DECSET 1000/1002/1003/1006）让 `renderer.getSelection()` API 能跟踪用户鼠标拖选，渲染选中区域反色高亮（由 OpenTUI 自动处理）。

#### Scenario: 不显式禁用 mouse tracking
- **WHEN** `src/index.tsx` 调用 `createCliRenderer`
- **THEN** 配置对象 SHALL **不**包含 `useMouse: false`
- **AND** OpenTUI SHALL 按默认行为启用 mouse tracking（向终端发送 `\x1b[?1000h` / `\x1b[?1002h` / `\x1b[?1003h` / `\x1b[?1006h`）

#### Scenario: 鼠标拖选消息文本
- **WHEN** 用户在 vc-agent 运行时鼠标拖动选消息列表中的文本
- **THEN** OpenTUI SHALL 跟踪 selection（应用层 `renderer.getSelection()` 返回非空）
- **AND** 选中区域 SHALL 反色高亮（由 OpenTUI 渲染，不需 vc-agent 处理）

#### Scenario: 取消 selection
- **WHEN** 用户在有 selection 状态下按 `Escape`
- **THEN** 系统 SHALL 调用 `renderer.clearSelection()` 清空选区
- **AND** 此 Esc 事件 SHALL **不**触发 insert→normal 模式切换（专门用于清 selection）
- **AND** 无 selection 时 Esc 维持原行为（insert→normal）

### Requirement: Ctrl+C / Cmd+C 智能复制选中（Windows Terminal + macOS 风格）
系统 SHALL 在 `useKeyboard` 头部拦截 `Ctrl+C`（`key.name === "c" && key.ctrl === true`）或 `Cmd+C`（macOS，`key.name === "c" && key.super === true`），有 selection 时复制并消费事件，无 selection 时透传给原 action。

注：OpenTUI 的 `KeyEvent` 字段中，macOS Cmd 键编码为 `super: true`（跨平台术语，Win 键同字段），不是 `meta: true`（meta 是 ESC/Alt）。

#### Scenario: 有 selection 时 Ctrl+C 或 Cmd+C 触发复制
- **WHEN** `renderer.getSelection()` 返回非空（用户拖选了文本）
- **AND** 用户按 `Ctrl+C` 或 `Cmd+C`（macOS）
- **THEN** 系统 SHALL 调用 `copySelection(renderer, onCopied)`，helper 内部：
  1. 调 `renderer.getSelection().getSelectedText()` 取选中文字
  2. 调 `copyToClipboard(text)`（OSC 52 + 平台命令双写）
  3. 调 `renderer.clearSelection()` 清空选区
  4. 调 `onCopied` 回调（设置 `copyFeedback` state 触发 StatusBar 反馈）
- **AND** 系统 SHALL **不**触发 abort / 双击退出逻辑（事件被消费）

#### Scenario: 无 selection 时 Ctrl+C 透传给 abort，Cmd+C 静默
- **WHEN** `renderer.getSelection()` 返回 null（用户没拖选）
- **AND** 用户按 `Ctrl+C`
- **THEN** 系统 SHALL 透传事件给原 `ctrlC` action（保持 vc-agent 原有行为：单击 abort Agent，双击 1 秒内退出）
- **WHEN** 用户按 `Cmd+C`（无 selection）
- **THEN** 系统 SHALL 静默无操作（不 abort，不退出；Cmd+C 在 vc-agent 语义中是"复制"，无可复制即什么也不做）

#### Scenario: OSC 52 + 平台命令双写剪贴板
- **WHEN** `copyToClipboard(text)` 被调用
- **THEN** 函数 SHALL 同时执行：
  1. **OSC 52 路径**：若 `process.stdout.isTTY` 为 true，拼接 `\x1b]52;c;<base64>\x07` 序列；若 `TMUX` 或 `STY` 环境变量存在，用 `\x1bPtmux;\x1b...\x1b\\` 包装 passthrough；写 `process.stdout`
  2. **平台命令路径**：macOS 用 `osascript -e 'set the clipboard to "<escaped>"'`；Linux + `WAYLAND_DISPLAY` 用 `wl-copy`（stdin 传文本）；Linux + X11 用 `xclip -selection clipboard`（stdin 传文本）
- **AND** 两条路径独立执行，任一失败 SHALL 不影响另一条

#### Scenario: 复制成功 transient 反馈
- **WHEN** `copySelection` 调用 `onCopied` 回调
- **THEN** App SHALL 设置 `copyFeedback = { ts: Date.now() }`
- **AND** StatusBar SHALL 显示 `Copied to clipboard`（`colors.success` 色）2 秒
- **AND** 2 秒后通过 `useEffect + setTimeout` 自动清空 `copyFeedback`，恢复 mode/model/context 显示

### Requirement: LSP 工具卡片显示

系统 SHALL 在消息列表中为 LSP 工具调用渲染专用的工具卡片，显示关键参数和结果。

#### Scenario: lsp_diagnostics 工具卡片

- **WHEN** 渲染 `lsp_diagnostics` 工具调用
- **THEN** 详情行 SHALL 显示 `filePath` + severity（若非 `"all"`）

#### Scenario: lsp_goto_definition 工具卡片

- **WHEN** 渲染 `lsp_goto_definition` 工具调用
- **THEN** 详情行 SHALL 显示 `filePath` + `line:character`

#### Scenario: lsp_find_references 工具卡片

- **WHEN** 渲染 `lsp_find_references` 工具调用
- **THEN** 详情行 SHALL 显示 `filePath` + `line:character` + includeDeclaration（若为 `false`）

#### Scenario: LSP 工具结果透传

- **WHEN** LSP 工具执行完成
- **THEN** 系统 SHALL 通过 `formatToolResult` 提取文本显示（与其他非 read 工具一致）
- **AND** 上限 15 行，超出提示"... (N more lines)"

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

### Requirement: worker 角色消息与并行流式渲染

系统 SHALL 在 `src/message.ts:MessageRole` 新增 `"worker"` 角色，并扩展 `Message` 接口可选字段 `workerId?` / `workerAgent?` / `workerStatus?: "running" | "idle" | "done" | "error" | "cancelled"` / `workerSummary?` / `workerModel?` / `workerTurns?` / `workerTokensIn?` / `workerTokensOut?` / `workerDurationMs?` / `workerCost?` / `workerError?`。`src/tui/components/MessageList.tsx` SHALL 在主消息流内**为每个 active worker 渲染一条独立的 worker 消息块**：running 态实时显示流式 token；终态（done/error）切换为结果卡片，展示 member 返回的完整 summary 与 usage 元信息。

#### Scenario: worker 消息插入主消息流
- **WHEN** `team_worker_event` `kind: "message_delta"` 到达且不存在对应 `workerId` 的 worker 角色消息
- **THEN** SHALL 创建 `{role: "worker", workerId, workerAgent, workerStatus: "running", content: text_delta}` 消息插入主消息流，位置紧邻上一个 `team.spawn` 工具调用消息之后
- **AND** SHALL 使用 80ms 节流更新（参照现有 `useStreamingBuffer` 机制），避免渲染抖动

#### Scenario: worker 流式 token 实时追加
- **WHEN** 收到 `kind: "message_delta"` 且已存在对应 workerId 的 worker 消息
- **THEN** SHALL 追加 `text_delta` 到该 worker 消息的 content 字段
- **AND** MessageList SHALL 触发对应 worker 消息块重渲染（不重新渲染整列表，对齐 `React.memo` 既有约定）

#### Scenario: worker 终态切换为结果卡片
- **WHEN** 收到 `member_done` 事件（携带 summary、cost、tokens、turns、durationMs、model）
- **THEN** SHALL 置 `workerStatus` 为 `"done"`，并把 summary 写入 `workerSummary`（不覆盖流式 content），usage 写入对应 `worker*` 字段
- **AND** MessageList SHALL 把该 worker 消息块切换为结果卡片：`borderDim` 圆角框，header（状态图标 + workerId/agent + 状态），meta 行（model · turns），结果区用 `<markdown>` + `<scrollbox minHeight3 maxHeight15>` 完整渲染 summary（不截断），usage 行（$cost · tokens↑↓ · duration），error 态用 `error` 边色 + `↳ workerError` 行
- **AND** 同一 member 再次完成（re-done）时 SHALL 新建 worker 消息（不 patch 旧终态消息）

#### Scenario: worker 消息块视觉样式
- **WHEN** 渲染 worker 角色消息
- **THEN** SHALL 使用 `borderStyle="rounded"` 圆角框
- **AND** 顶部行 SHALL 显示状态图标 + `workerId` / `workerAgent`（`secondary` 色）：running → `⠹ wkr_a1 / lysosome`，done → `✓ wkr_a1 / lysosome`，error → `✗ wkr_a1 / lysosome`（`error` 色）
- **AND** running 态内容区 SHALL 渲染流式 token（`markdown` 组件复用 markdownText 前景色，sticky scrollbox）

#### Scenario: 并行 worker 互不污染渲染
- **WHEN** `TeamSessionPool` 同时有 2 个 running worker 各自流式输出
- **THEN** MessageList SHALL 渲染 2 条独立的 worker 消息块，各自独立节流渲染
- **AND** 一条 worker 的 delta SHALL 不触发另一条 worker 消息块重渲染

### Requirement: /workers 选择器视图

系统 SHALL 通过 `src/tui/components/WorkersView.tsx` 实现 workers 选择器视图，由 `/workers` slash 命令触发进入。该视图 SHALL 显示所有 worker 列表，支持 j/k 导航 + Enter 聚焦单个 worker 历史 + ESC 退出。

#### Scenario: 列表视图渲染
- **WHEN** 用户输入 `/workers` 且 `client.listWorkers().length > 0`
- **THEN** TUI SHALL 切到 `view: "workers"` 状态，渲染 `<WorkersView workers={listWorkers()} />`
- **AND** WorkersView SHALL 渲染 `<scrollbox>` 包裹的列表，每行：`<状态图标> <workerId> · <agent> · <status> · <lastSummary(truncated 60 chars)>`
- **AND** 当前选中行 SHALL 反色高亮（`backgroundMenu` 背景 + `backgroundMenuText` 前景）

#### Scenario: 列表内导航
- **WHEN** WorkersView 处于列表态且用户按 `j` / `k` / `g` / `G`
- **THEN** SHALL 上下移动选中行（对齐 NORMAL 模式消息列表导航约定）
- **AND** 列表超出视窗时 SHALL 自动滚动到选中行

#### Scenario: 聚焦单个 worker 历史
- **WHEN** 用户在列表选中某 worker 按 `Enter`
- **THEN** SHALL 进入聚焦态：渲染该 worker 的完整流式输出历史（从 spawn 到当前），使用独立 `<scrollbox>`
- **AND** 输出超长时 SHALL 支持滚动浏览
- **AND** 顶部 SHALL 显示返回提示 `<- ESC back`

#### Scenario: 退出 workers 视图
- **WHEN** 用户在 WorkersView（列表或聚焦态）按 `ESC`
- **THEN** SHALL 切回 `view: "chat"`，恢复主消息流
- **AND** workers 列表状态 SHALL 保留（下次进入仍在原选中位置）

#### Scenario: 空列表提示
- **WHEN** `/workers` 触发但 `client.listWorkers().length === 0`
- **THEN** SHALL 在主消息流末尾显示提示行 `No active workers. Spawn one with /team spawn <agent> "<task>"`
- **AND** SHALL **不**切换 view 状态

#### Scenario: 列表实时刷新
- **WHEN** workers 列表已有展示且新 worker 被 spawn / 旧 worker 终结
- **THEN** `client.onWorkerEvent` 触发 SHALL 重渲染 WorkersView，列表条目数与状态实时变化
- **AND** 已聚焦某 worker 时若该 worker 终结 SHALL 刷新其状态指示符但不退出聚焦


### Requirement: 成员消息源切换

系统 SHALL 支持 MessageList 根据 `activeMemberName` 状态切换消息源，显示不同成员的子会话消息。

#### Scenario: 成员消息源

- **WHEN** `activeMemberName` 不为 null
- **THEN** MessageList SHALL 从 `client.getMember(activeMemberName).session.messages` 获取消息并通过 `mapSdkMessagesToTui()` 转换后渲染
- **AND** 成员消息 SHALL 使用完整的消息渲染规则（用户消息气泡、工具卡片、read 合并等）

#### Scenario: leader 消息源

- **WHEN** `activeMemberName` 为 null
- **THEN** MessageList SHALL 渲染 `messages` state（orchestrator 主会话消息）
- **AND** 行为与当前一致

#### Scenario: 切换时滚动到底部

- **WHEN** `activeMemberName` 变化（切换成员）
- **THEN** 消息列表 SHALL 自动滚动到底部
