import { SyntaxStyle, type ThemeTokenStyle } from "@opentui/core";
import { colors } from "./theme.js";

/**
 * 基础 / 回退 scope
 *
 * 对齐 @opentui/core MarkdownRenderable 内部查找逻辑：
 * - `default`: 所有未命中 scope 的兜底前景色
 * - `conceal`: markdown 语法标记（`#`、`**`、`` ` `` 等）在 conceal 模式下的染色
 * - `spell`/`nospell`: 拼写检查相关 capture，回退为正文色
 */
const baseRules: ThemeTokenStyle[] = [
	{ scope: ["default"], style: { foreground: colors.text } },
	{ scope: ["conceal"], style: { foreground: colors.textMuted } },
	{ scope: ["spell", "nospell"], style: { foreground: colors.text } },
];

/**
 * 代码 token scope
 *
 * 对齐 @opentui/core/assets/typescript/highlights.scm 的 tree-sitter capture。
 * 覆盖关键字、函数、变量、类型、字符串、数字、注释、标点等细粒度分类。
 */
const codeRules: ThemeTokenStyle[] = [
	{
		scope: ["comment", "comment.documentation"],
		style: { foreground: colors.syntaxComment, italic: true },
	},
	{ scope: ["comment.error"], style: { foreground: colors.error, italic: true, bold: true } },
	{ scope: ["comment.warning"], style: { foreground: colors.warning, italic: true, bold: true } },
	{
		scope: ["comment.todo", "comment.note"],
		style: { foreground: colors.info, italic: true, bold: true },
	},
	{ scope: ["string", "symbol"], style: { foreground: colors.syntaxString } },
	{ scope: ["string.escape", "string.regexp"], style: { foreground: colors.syntaxKeyword } },
	{
		scope: ["string.special", "string.special.url"],
		style: { foreground: colors.markdownLink, underline: true },
	},
	{ scope: ["character", "character.special"], style: { foreground: colors.syntaxString } },
	{ scope: ["number", "boolean", "float", "constant"], style: { foreground: colors.syntaxNumber } },
	{ scope: ["keyword"], style: { foreground: colors.syntaxKeyword, italic: true } },
	{ scope: ["keyword.import", "keyword.export"], style: { foreground: colors.syntaxKeyword } },
	{
		scope: [
			"keyword.return",
			"keyword.conditional",
			"keyword.repeat",
			"keyword.coroutine",
			"keyword.exception",
			"keyword.modifier",
			"keyword.directive",
		],
		style: { foreground: colors.syntaxKeyword, italic: true },
	},
	{ scope: ["keyword.conditional.ternary"], style: { foreground: colors.syntaxOperator } },
	{ scope: ["keyword.function", "function.method"], style: { foreground: colors.syntaxFunction } },
	{ scope: ["keyword.type"], style: { foreground: colors.syntaxType, bold: true, italic: true } },
	{
		scope: ["operator", "keyword.operator", "punctuation.delimiter", "punctuation.special"],
		style: { foreground: colors.syntaxOperator },
	},
	{
		scope: [
			"variable",
			"variable.parameter",
			"function.method.call",
			"function.call",
			"property",
			"field",
			"parameter",
		],
		style: { foreground: colors.syntaxVariable },
	},
	{
		scope: ["variable.member", "function", "constructor"],
		style: { foreground: colors.syntaxFunction },
	},
	{
		scope: ["type", "type.definition", "module", "namespace", "class"],
		style: { foreground: colors.syntaxType },
	},
	{
		scope: [
			"variable.builtin",
			"type.builtin",
			"function.builtin",
			"module.builtin",
			"constant.builtin",
			"variable.super",
		],
		style: { foreground: colors.error },
	},
	{
		scope: ["punctuation", "punctuation.bracket"],
		style: { foreground: colors.syntaxPunctuation },
	},
	{ scope: ["tag"], style: { foreground: colors.error } },
	{ scope: ["tag.attribute"], style: { foreground: colors.syntaxKeyword } },
	{ scope: ["tag.delimiter"], style: { foreground: colors.syntaxOperator } },
	{ scope: ["attribute", "annotation"], style: { foreground: colors.warning } },
	{ scope: ["label"], style: { foreground: colors.markdownLinkText } },
];

/**
 * Markdown 元素 scope
 *
 * 对齐 @opentui/core/assets/{markdown,markdown_inline}/highlights.scm 的 tree-sitter capture，
 * 以及 @opentui/core MarkdownRenderable.renderInlineTokenWithStyle 内部使用的 scope 名
 * （index.js:8137-8708 实证）。命名严格匹配，未命中将回退到默认前景色。
 *
 * scope 完整列表见 @opentui/core 官方文档：
 * https://anomalyco-opentui.mintlify.app/components/markdown#syntax-style-groups
 */
const markdownRules: ThemeTokenStyle[] = [
	{ scope: ["markup.heading"], style: { foreground: colors.markdownHeading, bold: true } },
	{
		scope: ["markup.heading.1"],
		style: { foreground: colors.markdownHeading, bold: true, underline: true },
	},
	{ scope: ["markup.heading.2"], style: { foreground: colors.markdownHeading, bold: true } },
	{ scope: ["markup.heading.3"], style: { foreground: colors.markdownHeading, bold: true } },
	{ scope: ["markup.heading.4"], style: { foreground: colors.markdownHeading, bold: true } },
	{ scope: ["markup.heading.5"], style: { foreground: colors.markdownHeading, bold: true } },
	{ scope: ["markup.heading.6"], style: { foreground: colors.markdownHeading, bold: true } },
	{
		scope: ["markup.bold", "markup.strong"],
		style: { foreground: colors.markdownStrong, bold: true },
	},
	{ scope: ["markup.italic"], style: { foreground: colors.markdownEmph, italic: true } },
	{ scope: ["markup.list"], style: { foreground: colors.markdownListItem } },
	{ scope: ["markup.list.checked"], style: { foreground: colors.success } },
	{ scope: ["markup.list.unchecked"], style: { foreground: colors.textMuted } },
	{ scope: ["markup.quote"], style: { foreground: colors.markdownBlockQuote, italic: true } },
	{ scope: ["markup.raw", "markup.raw.block"], style: { foreground: colors.markdownCode } },
	{
		scope: ["markup.raw.inline"],
		style: { foreground: colors.markdownCode, background: colors.background },
	},
	{ scope: ["markup.link"], style: { foreground: colors.markdownLink, underline: true } },
	{
		scope: ["markup.link.label"],
		style: { foreground: colors.markdownLinkText, underline: true },
	},
	{ scope: ["markup.link.url"], style: { foreground: colors.markdownLink, underline: true } },
	{ scope: ["markup.strikethrough"], style: { foreground: colors.textMuted } },
	{ scope: ["markup.underline"], style: { foreground: colors.text, underline: true } },
];

/**
 * Extmark scope —— 应用层在 markdown 流中识别文件路径 / @agent / 粘贴片段后注入的标记。
 * 注册是必要前提；注入逻辑见独立提案 `markdown-extmark-injection`。
 */
const extmarkRules: ThemeTokenStyle[] = [
	{ scope: ["prompt"], style: { foreground: colors.accent } },
	{ scope: ["extmark.file"], style: { foreground: colors.warning, bold: true } },
	{ scope: ["extmark.agent"], style: { foreground: colors.secondary, bold: true } },
	{
		scope: ["extmark.paste"],
		style: { foreground: colors.background, background: colors.warning, bold: true },
	},
];

const diffRules: ThemeTokenStyle[] = [
	{ scope: ["diff.plus"], style: { foreground: colors.diffAdded, background: colors.diffAddedBg } },
	{
		scope: ["diff.minus"],
		style: { foreground: colors.diffRemoved, background: colors.diffRemovedBg },
	},
	{ scope: ["diff.delta"], style: { foreground: colors.textSubtle } },
];

const lspRules: ThemeTokenStyle[] = [
	{ scope: ["error"], style: { foreground: colors.error, bold: true } },
	{ scope: ["warning"], style: { foreground: colors.warning, bold: true } },
	{ scope: ["info"], style: { foreground: colors.info } },
	{ scope: ["debug"], style: { foreground: colors.textMuted } },
];

/**
 * 完整的 TextMate 风格 scope 规则数组。
 *
 * 暴露为独立函数以便单测断言覆盖度（每条 scope 是否注册、每个 theme 颜色字段是否被引用）。
 */
export function getSyntaxRules(): ThemeTokenStyle[] {
	return [...baseRules, ...codeRules, ...markdownRules, ...extmarkRules, ...diffRules, ...lspRules];
}

/**
 * 全局单例 SyntaxStyle。在模块加载时构建一次。
 *
 * 由 `<markdown syntaxStyle={...}>` 组件接收，按 scope 名查找样式。
 * 修改时只需调整上面的规则数组，无需改动 MessageList.tsx。
 */
export const syntaxStyle = SyntaxStyle.fromTheme(getSyntaxRules());
