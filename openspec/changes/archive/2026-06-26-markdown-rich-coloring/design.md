## Context

当前 `src/tui/syntax.ts` 只注册了 8 个代码 token scope，导致 `@opentui/core` 的 `<markdown>` 组件渲染 Agent 回复时，标题/加粗/链接/行内代码等 `markup.*` scope 全部 miss，回退到默认前景色，消息呈现一片灰白。

数据流（修复前）：

```
┌─────────────┐    ┌────────────────────┐    ┌──────────────────────┐
│ theme.ts    │───▶│ syntax.ts          │───▶│ <markdown> 组件      │
│ 8 个 syntax │    │ fromStyles({       │    │ 查 scope:            │
│ 字段        │    │   comment, keyword,│    │  markup.heading ❌   │
│ + 6 个      │    │   string, variable,│    │  markup.strong  ❌   │
│ markdown*   │    │   number, type,    │    │  markup.link    ❌   │
│ (死代码)    │    │   function,        │    │  markup.raw     ❌   │
│             │    │   operator         │    │  keyword        ✅   │
│             │    │ })                 │    │  string         ✅   │
└─────────────┘    └────────────────────┘    └──────────────────────┘
                                                     │
                                                     ▼
                                       未命中的 markup.* → 默认 fg #EDEDED
                                       消息一片灰白，无重点色
```

数据流（修复后）：

```
┌─────────────────┐   ┌──────────────────────────┐   ┌─────────────────────┐
│ theme.ts        │   │ syntax.ts                │   │ <markdown> 组件     │
│ 扩展为完整字段: │   │ SyntaxStyle.fromTheme([  │   │ 按 scope 查样式：    │
│  syntaxComment  │   │   {scope, style}...      │   │  markup.heading ✅  │
│  syntaxKeyword  │   │ ])                       │   │  markup.strong  ✅  │
│  syntaxFunction │   │                          │   │  markup.link    ✅  │
│  syntaxVariable │   │ 规则来源：对齐            │   │  markup.raw     ✅  │
│  syntaxString   │   │  · tree-sitter captures  │   │  markup.list    ✅  │
│  syntaxNumber   │   │    (assets/**/*.scm)     │   │  markup.quote   ✅  │
│  syntaxType     │   │  · opencode getSyntaxRules│   │  markup.italic  ✅  │
│  syntaxOperator │   │                          │   │  keyword.*      ✅  │
│  syntaxPunctuat │   │ markdown scope:          │   │  variable.*     ✅  │
│ +               │   │  markup.heading[.1~6]    │   │  function.*     ✅  │
│ markdownHeading │   │  markup.bold/strong      │   │  constant       ✅  │
│ markdownStrong  │   │  markup.italic           │   │  punctuation.*  ✅  │
│ markdownEmph    │   │  markup.raw[.inline/.blk]│   └─────────────────────┘
│ markdownCode    │   │  markup.link[.label/.url]│
│ markdownLink    │   │  markup.list[.chk/.unchk]│   每种 scope 命中后：
│ markdownLinkText│   │  markup.quote            │   → 对应 (fg, bold/italic/
│ markdownBlockQu │   │  markup.strikethrough    │   │  underline) 样式
│ markdownListItem│   │                          │
│ markdownListEnu │   │ 代码 scope:              │
│ markdownHorizRul│   │  keyword[.func/.type/...]│
│ markdownText    │   │  variable[.member/...]   │
└─────────────────┘   │  function[.call/.method] │
                      │  constant / module       │
                      │  punctuation[.bracket...]│
                      │  + 原 8 个 token         │
                      └──────────────────────────┘
```

## Goals / Non-Goals

**Goals:**
- 让 Agent 回复中的标题、加粗、斜体、行内代码、链接、列表、引用、删除线出现可辨识颜色与字形（bold/italic/underline）
- 让代码块内的关键字、函数、变量、常量、标点等按 tree-sitter capture 精细上色
- 把 `theme.ts` 已定义但未引用的 `markdownHeading/Strong/Emph/Code/Link/LinkText` 死代码接通
- scope 命名与 opencode 对齐，降低未来引入多主题 / 外部主题 JSON 的迁移成本

**Non-Goals:**
- 不做多主题切换 / 用户可配置主题
- 不引入第三方高亮库（shiki / highlight.js）
- 不做代码块语言检测（沿用 `@opentui/core` 默认 typescript/javascript 解析）
- 不重构用户气泡、工具卡片、思考内容着色

## Decisions

### D1: 用 `SyntaxStyle.fromTheme(rules)` 而非扩展 `fromStyles`

**选择**：切换到 `SyntaxStyle.fromTheme(rules)`，输出 TextMate 风格 `{scope: string[], style: {...}}` 规则数组。

**理由**：
- `fromStyles(name → style)` 单 scope 一条，无法表达"同一颜色覆盖多个 scope"（如 `keyword.function` + `function.method` 同色）——会重复或丢失
- `fromTheme` 支持单规则多 scope（`scope: ["keyword.function", "function.method"]`），与 tree-sitter capture 的层级匹配（`keyword.function` 命中 `keyword`）天然契合
- `MarkdownRenderable` 内部用 `getStyle("markup.heading")` 按 scope 名查找，命名严格对齐，零猜测

**备选**：继续用 `fromStyles` 手写 ~50 条 key-value → 重复严重、维护差，否决。

### D2: scope 命名严格对齐 tree-sitter capture + opencode

**选择**：直接抄 opencode `theme.tsx` 的 `getSyntaxRules`，覆盖：
- **markdown**：`markup.heading[.1~.6]` / `markup.bold|strong` / `markup.italic` / `markup.raw[.inline|.block]` / `markup.link[.label|.url]` / `markup.list[.checked|.unchecked]` / `markup.quote` / `markup.strikethrough` / `markup.underline`
- **代码**：`keyword[.function|.return|.type|.import|.conditional|.modifier|.operator|.directive]` / `function[.call|.method|.builtin]` / `variable[.member|.parameter|.builtin]` / `constant[.builtin]` / `type[.builtin]` / `module[.builtin]` / `punctuation[.bracket|.delimiter|.special]` / `string[.escape|.regexp]` / `number|boolean|float`

**理由**：经核 `@opentui/core/assets/{markdown,markdown_inline,typescript}/highlights.scm`，这些 capture 名就是 tree-sitter 实际产出的 scope。opencode 生产用同样命名，迁移多主题时几乎零改动。

**备选**：自定义简短命名（如 `heading`/`bold`）→ 与 `@opentui/core` 查找逻辑不匹配，必须再写一层映射，否决。

### D3: theme 字段命名沿用 opencode 约定

**选择**：`theme.ts` 新增字段使用 opencode 命名 `markdownBlockQuote` / `markdownListItem` / `markdownListEnumeration` / `markdownHorizontalRule` / `syntaxPunctuation`。

**理由**：未来引入外部主题 JSON（如 catppuccin.json）时直接复用 opencode 主题生态，字段名一致 = 零改键名。

**备选**：起独立命名（如 `quoteColor`）→ 迁移时要改键，否决。

### D4: 颜色取值沿用现有 Apple Dark 系

**选择**：新字段映射到现有 palette：
- `markdownBlockQuote` ← `warning`（#FFD60A，与 thinking 标签同系，视觉呼应）
- `markdownListItem` ← `secondary`（#64D2FF，列表项作为锚点色）
- `markdownListEnumeration` ← `markdownLinkText`（#30D158）
- `syntaxPunctuation` ← `text`（#EDEDED，标点保持中性，避免噪音）

**理由**：不引入新 hue，整体调色板维持当前 Apple Dark 一致性。opencode 用 ANSI 色，我们用 hex，但语义一致。

**关于水平分隔线**：经查 `@opentui/core` 的 `createHorizontalRuleRenderable`，水平线 borderColor 直接取 `getStyle("conceal")?.fg ?? this._fg ?? "#888888"`——不暴露 scope，无法挂自定义颜色。本次沿用 conceal 色（`textMuted` = #878787），与 @opentui/core 默认行为一致，不引入 `markdownHorizontalRule` 字段。

### D5: 不引入 SyntaxStyle cache

**选择**：`syntax.ts` 模块加载时构建一次 `syntaxStyle` 常量并 export。

**理由**：theme 是单例常量，规则数组在 module init 时算一次。`<markdown>` 组件接收同一 `SyntaxStyle` 实例引用，React 无需重渲染。零运行时开销。

### D6: 对齐 opencode 完整 scope 集（含 extmark / diff / LSP）

**选择**：除 base/code/markdown 三类外，追加注册三类 opencode 自定义 scope：
- **extmark**（`prompt`/`extmark.file`/`extmark.agent`/`extmark.paste`）：opencode 在 markdown 流中识别文件路径、@agent、粘贴片段后注入 extmark 标记。**注册是必要前提**，但真正的注入逻辑（识别正则 + extmark API 调用）由独立提案 `markdown-extmark-injection` 实现。
- **diff**（`diff.plus`/`diff.minus`/`diff.delta`）：vc-agent 当前不渲染 diff（AGENTS.md 明示），scope 注册不亏——未来引入 diff 组件时直接生效。简化映射：仅 foreground（vc-agent theme 无 `diffAddedBg`/`diffRemovedBg`/`diffContextBg` 字段）。
- **LSP**（`error`/`warning`/`info`/`debug`）：vc-agent 未集成 LSP，但 markdown 内联诊断标签（如 `[error]...`）可能触发，注册为前提。

**理由**：用户要求"完美复刻 opencode 消息高亮能力"。光做 markdown/code 染色只是表层；extmark/diff/LSP 是 opencode 完整规则集的一部分，注册成本低（共 11 条规则），且让 vc-agent 的 `syntaxStyle` 在结构上与 opencode 等价，未来引入新功能（diff 渲染、LSP、extmark 注入）零迁移成本。

**风险**：注册了暂时不会触发的 scope 看似"死代码"，但与"消除死代码"目标不冲突——这些是**显式注册的设计意图**（注释明示状态），而非被遗忘的旧字段。

### D7: 修正 string.special.* 映射错误

**选择**：将 `string.special`/`string.special.url` 从 `syntaxKeyword`（紫色）改为 `markdownLink`（蓝色）+ underline。

**理由**：tree-sitter 对 URL 字符串产出 `string.special.url` capture，语义上是"URL"，应该按链接渲染（蓝色 + 下划线），而非关键字紫色。opencode 即采用 `markdownLink + underline` 映射。这是 vc-agent 早期实现的错误，本次顺带修正。

## Risks / Trade-offs

- **[覆盖度风险]** tree-sitter 仅配置了 typescript/javascript wasm，python/go/rust 代码块降级为单色。
  → **缓解**：与现状一致（原本就只有 8 个 token），未来按需追加 wasm 即可，本次不扩大范围。

- **[视觉过载风险]** 一次新增 50+ 条彩色规则，可能让 Agent 长回复显得花哨。
  → **缓解**：标题/加粗保留 bold + 单色（不加 italic），斜体单独走 italic + 弱色（warning），代码用 success 绿，链接用 secondary 蓝 + underline——形成"粗体强色 / 斜体暖色 / 代码冷色 / 链接蓝下划线"四个清晰层次，不堆叠。

- **[scope 写错风险]** tree-sitter capture 名写错（如误写 `markup.bold` 而实际叫 `markup.strong`）会静默 miss。
  → **缓解**：规则直接对齐 `@opentui/core/assets/**/*.scm` 与 opencode `getSyntaxRules`，并通过单测 `tests/syntax.test.ts` 断言每条 scope 在 `SyntaxStyle` 中已注册（`getStyle(name)` 非空）。

- **[流式渲染抖动]** markdown 流式过程中 partial token 可能短暂显示错误颜色。
  → **缓解**：`<markdown streaming={true}>` 已由 `@opentui/core` 处理 trailing unstable block，本次只换样式不影响流式逻辑。
