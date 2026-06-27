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
- **WHEN** 用户在 NORMAL 模式下按 j/k/g/G
- **THEN** ScrollBox 按对应方向滚动（j=向下2行, k=向上2行, g=顶部, G=底部）

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
系统 SHALL 以圆角边框卡片样式渲染工具调用，按工具类型显示不同的详情和结果。

#### Scenario: 工具卡片样式
- **WHEN** 渲染工具调用消息
- **THEN** 消息 SHALL 使用 `borderStyle="rounded"` 四边圆角边框，`backgroundColor=backgroundInset`，顶部行显示状态图标 + 工具名（`secondary` 色），下方显示详情行

#### Scenario: 状态图标与边框颜色
- **WHEN** 工具执行中/完成/失败
- **THEN** 图标 SHALL 为 spinner `⠹`（running）/ `✓`（done, `success` 色）/ `✗`（error, `error` 色），边框颜色 SHALL 为 `borderActive`（running）/ `borderSoft`（done）/ `error`（error）

#### Scenario: 按工具类型显示详情
- **WHEN** 渲染工具详情行
- **THEN** read 工具 SHALL 显示 `path` + 可选行范围（offset+limit→`path:offset-(offset+limit-1)`，offset only→`path:offset+`）
- **AND** bash 工具 SHALL 显示 `command`（截断 80 字符）
- **AND** edit 工具 SHALL 显示 `path` + diff 行（`-` 红色旧文本 / `+` 绿色新文本）
- **AND** write 工具 SHALL 显示 `path` + 行数

#### Scenario: 工具结果显示
- **WHEN** 工具执行完成（status=done/error）
- **THEN** 系统 SHALL 通过 `formatToolResult` 从 Pi SDK 结构 `{content:[{type:'text',text}]}` 提取文本，显示最多 15 行
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

