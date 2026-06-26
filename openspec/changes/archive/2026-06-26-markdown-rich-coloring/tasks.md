## 1. Theme 颜色字段扩展

- [x] 1.1 在 `src/tui/theme.ts` 的 `colors` 对象中新增 4 个字段：`markdownBlockQuote`（映射 `warning` = #FFD60A）、`markdownListItem`（映射 `secondary` = #64D2FF）、`markdownListEnumeration`（映射 `markdownLinkText` = #30D158）、`syntaxPunctuation`（映射 `text` = #EDEDED）。字段位置放在现有 `markdown*` 与 `syntax*` 分组末尾，保持视觉聚合。（原计划 5 字段，实现时发现 `markdownHorizontalRule` 无 scope 可绑——@opentui/core 的 `createHorizontalRuleRenderable` 直接读 `conceal` 色，故删除该字段，详见 design.md D4）
- [x] 1.2 运行 `bun run lint:fix src/tui/theme.ts` 确保新增字段符合 biome 格式（tab 缩进、双引号、尾逗号）。

## 2. Syntax 规则重写

- [x] 2.1 重写 `src/tui/syntax.ts`：从 `SyntaxStyle.fromStyles({...})` 切换到 `SyntaxStyle.fromTheme(rules)`，新增 `getSyntaxRules()` 函数返回 `ThemeTokenStyle[]` 规则数组。先注册 markdown scope（按 design.md D2 列表：`markup.heading[.1~.6]`、`markup.bold|strong`、`markup.italic`、`markup.raw[.inline|.block]`、`markup.link[.label|.url]`、`markup.list[.checked|.unchecked]`、`markup.quote`、`markup.strikethrough`、`markup.underline`），引用 `colors.markdownHeading/Strong/Emph/Code/Link/LinkText/BlockQuote/ListItem/ListEnumeration/HorizontalRule`。
- [x] 2.2 在 `getSyntaxRules()` 中追加代码 token scope（按 design.md D2 + opencode `getSyntaxRules`）：`keyword[.function|.return|.type|.import|.conditional|.modifier|.operator|.directive]`、`function[.call|.method|.builtin]`、`variable[.member|.parameter|.builtin|.super]`、`constant[.builtin]`、`type[.builtin|.definition]`、`module[.builtin]`、`punctuation[.bracket|.delimiter|.special]`、`string[.escape|.regexp|.special]`、`number|boolean|float`、`comment[.documentation|.error|.warning|.todo]`、`class|namespace|field|property|parameter|tag|attribute|annotation|label`。引用 `colors.syntaxKeyword/Function/Variable/String/Number/Type/Operator/Comment/Punctuation` 与 `colors.error/warning/info`。
- [x] 2.3 注册 `default`/`conceal`/`spell`/`nospell` scope（按 opencode 规则）：`default` → `colors.text`、`conceal` → `colors.textMuted`、`spell|nospell` → `colors.text`。确保 `<markdown>` 组件查找未命中元素时有合理回退。
- [x] 2.4 运行 `bun run typecheck` 确认 `SyntaxStyle.fromTheme` 的类型签名匹配（`ThemeTokenStyle[]`），无 `as any`。

## 3. 单元测试

- [x] 3.1 新增 `tests/syntax.test.ts`：导入 `syntaxStyle`，对 spec.md "scope 注册完整性" 场景列出的 ~30 个 scope（含所有 `markup.*` 和关键代码 token）逐一断言 `syntaxStyle.getStyle(name)` 返回非空；对 `colors` 中的 `markdownHeading/Strong/Emph/Code/Link/LinkText` 字段断言在 `getSyntaxRules()` 返回的规则数组中以 `foreground` 形式至少被引用一次（消除死代码）。测试用 `bun test` 运行通过。

## 4. 验证与回归

- [x] 4.1 在 worktree 根目录运行 `bun run check`（typecheck + lint + test 三合一），确认全绿，无新增 warning。
- [x] 4.2 运行 `bun run dev` 启动 TUI —— 已验证：TUI 成功启动并加载新版 `syntax.ts`（`SyntaxStyle.fromTheme` 调用未崩溃，用户气泡/错误提示正常渲染）。**未触发 Agent 回复**（当前环境无 API key），最终视觉验收（标题/加粗/斜体/行内代码/链接/列表/引用/代码块的彩色 + bold/italic/underline）需用户在配置 API key 后手动跑 `bun run dev` 验证。
- [x] 4.3 检查 `src/tui/components/MessageList.tsx` 零改动（仅导入 `syntaxStyle`），如有 lint/typecheck 因新 scope 而报错则回滚检查规则数组。

## 5. opencode 完整对齐扩展（L1）

- [x] 5.1 修正 `src/tui/syntax.ts` 中 `string.special` 与 `string.special.url` 的映射：从 `syntaxKeyword`（紫色）改为 `markdownLink`（蓝色）+ underline，对齐 opencode URL 字符串染色。
- [x] 5.2 新增 `extmarkRules` 数组，注册 4 条 scope：`prompt`（accent）、`extmark.file`（warning + bold）、`extmark.agent`（secondary + bold）、`extmark.paste`（warning bg + background fg + bold）。
- [x] 5.3 新增 `diffRules` 数组，注册 3 条 scope：`diff.plus`（diffAdded）、`diff.minus`（diffRemoved）、`diff.delta`（textSubtle），仅 foreground（vc-agent 无 *Bg 字段）。
- [x] 5.4 新增 `lspRules` 数组，注册 4 条 scope：`error`（error + bold）、`warning`（warning + bold）、`info`（info）、`debug`（textMuted）。
- [x] 5.5 在 `tests/syntax.test.ts` 新增 `EXTMARK_SCOPES`/`DIFF_SCOPES`/`LSP_SCOPES` 常量并接入 `describe.each` 注册完整性测试，新增 "opencode 对齐 - 映射一致性" describe 块（3 个 it：string.special 一致性、extmark.file bold、extmark.paste bg）。
- [x] 5.6 同步更新 spec.md（追加「URL 字符串染色」「Extmark/Diff/LSP scope 注册」scenario）与 design.md（追加 D6/D7 决策）。
- [x] 5.7 重跑 `bun run check` 确认全绿（83 tests pass，新增 14 个断言覆盖 L1 扩展）。

## 6. extmark 注入逻辑（L2，独立提案 `markdown-extmark-injection`）

- [ ] 6.1 新开提案 `markdown-extmark-injection`，调研 @opentui/core 的 onChunks / renderNode 钩子或 extmark API，设计在 markdown 流中识别文件路径（正则）并注入 `extmark.file` 标记的机制。本提案 `markdown-rich-coloring` 仅完成 scope 注册（L1），extmark 注入由 L2 提案完成。
