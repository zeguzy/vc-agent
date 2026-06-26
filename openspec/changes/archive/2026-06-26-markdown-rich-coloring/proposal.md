## Why

当前 Agent 回复消息缺乏重点色：标题、加粗、斜体、行内代码、链接、列表、引用等 markdown 元素全部回退到默认前景色（`markdownText = #EDEDED`），看上去一片灰白，用户难以快速扫到重点。

根因：`src/tui/syntax.ts` 用 `SyntaxStyle.fromStyles({...})` 只注册了 8 个代码 token（comment/keyword/string/variable/number/type/function/operator），**完全没注册任何 `markup.*` scope**。经核 `@opentui/core` 的 `MarkdownRenderable` 源码，渲染标题/加粗/链接/代码时分别按 `markup.heading`、`markup.strong`、`markup.link`、`markup.raw` 等 scope 名查样式，未命中就回退默认色——这是消息单调的真相。更糟糕的是 `theme.ts` 里定义的 `markdownHeading`、`markdownStrong`、`markdownCode`、`markdownLink` 等字段成了死代码，从未被引用。

参考 opencode（`sst/opencode` 的 `theme.tsx` `getSyntaxRules`）——它用 `SyntaxStyle.fromTheme(rules)` 一次性注册 ~70 条 TextMate 风格 scope（含全部 `markup.*` + 代码细粒度 scope），生产验证可行。

## What Changes

- **重写 `src/tui/syntax.ts`**：从 `SyntaxStyle.fromStyles` 切换到 `SyntaxStyle.fromTheme(rules)`，按 opencode 模式输出规则数组。
- **补齐 markdown scope**：注册 `markup.heading[.1~.6]`、`markup.bold`/`strong`、`markup.italic`、`markup.raw[.inline/.block]`、`markup.link[.label/.url]`、`markup.list[.checked/.unchecked]`、`markup.quote`、`markup.strikethrough`。
- **补全代码块 scope**：在已有 8 个 token 基础上补 `keyword.function`/`keyword.return`/`keyword.type`/`variable.member`/`function.call`/`function.method`/`constant`/`module`/`punctuation.bracket`/`punctuation.delimiter` 等（对应 `assets/typescript/highlights.scm` 的 capture）。
- **扩展 `src/tui/theme.ts`**：新增缺失颜色字段 `markdownBlockQuote`、`markdownListItem`、`markdownListEnumeration`、`syntaxPunctuation`，并把已存在的 `markdownHeading/Strong/Emph/Code/Link/LinkText` 死代码接上。
- **不改 `MessageList.tsx`**：渲染入口（`<markdown syntaxStyle={...}>`）已经正确，只换 `syntaxStyle` 内容。

## Non-goals

- **不做**多主题切换 / 用户可配置主题（沿用当前单一硬编码主题）
- **不做**自定义 scope 配置或外部主题 JSON 加载（保持硬编码规则数组）
- **不做**代码块语言检测 / 按语言切换高亮（沿用 tree-sitter 默认 typescript/javascript 解析）
- **不重构**用户消息气泡、工具卡片、思考内容的着色（这些已有 `text`/`warning`/`secondary` 等独立配色，本次只管 Agent 回复正文）
- **不引入**shiki/highlight.js 等第三方高亮库（`@opentui/core` 内置 tree-sitter 已够用）

## Capabilities

### New Capabilities
<!-- 本次不引入新能力，仅扩展 tui-messages 的 markdown 染色规则 -->

### Modified Capabilities
- `tui-messages`: 扩展"代码块语法高亮"requirement 为完整的"Markdown 重点内容染色"——从仅声明"用 syntaxStyle + theme 颜色"细化为按 `markup.*` 与代码 token scope 注册颜色规则，覆盖标题、加粗、斜体、行内代码、链接、列表、引用、删除线等元素。

## Impact

- **代码**：
  - `src/tui/syntax.ts`：重写（约 14 行 → ~80 行规则数组）
  - `src/tui/theme.ts`：扩展 `colors` 对象（新增 5 个字段）
  - `src/tui/components/MessageList.tsx`：零改动（继续传 `syntaxStyle`）
- **依赖**：无新增，仅复用 `@opentui/core` 已有 `SyntaxStyle.fromTheme` API
- **运行时**：Bun TUI 启动后 Agent 回复消息会出现彩色 markdown 渲染，无破坏性 API 变更
- **测试**：`src/tui/syntax.ts` 是纯函数 + 配置，无副作用，可补充单测验证规则覆盖度（scope → 颜色映射）
