import { describe, expect, it } from "bun:test";
import { getSyntaxRules, syntaxStyle } from "../src/tui/syntax.js";
import { colors } from "../src/tui/theme.js";

/**
 * Markdown 元素 scope —— 对应 spec.md「scope 注册完整性」scenario
 * 来源：@opentui/core/assets/{markdown,markdown_inline}/highlights.scm
 *       + MarkdownRenderable 内部 createChunk 第二参数（index.js:8137-8708）
 */
const MARKUP_SCOPES = [
	"markup.heading",
	"markup.heading.1",
	"markup.heading.2",
	"markup.heading.3",
	"markup.heading.4",
	"markup.heading.5",
	"markup.heading.6",
	"markup.bold",
	"markup.strong",
	"markup.italic",
	"markup.raw",
	"markup.raw.inline",
	"markup.raw.block",
	"markup.link",
	"markup.link.label",
	"markup.link.url",
	"markup.list",
	"markup.list.checked",
	"markup.list.unchecked",
	"markup.quote",
	"markup.strikethrough",
] as const;

/**
 * 代码 token scope —— 对应 spec.md「scope 注册完整性」scenario
 * 来源：@opentui/core/assets/typescript/highlights.scm
 */
const CODE_SCOPES = [
	"keyword",
	"keyword.function",
	"keyword.import",
	"keyword.type",
	"keyword.return",
	"keyword.conditional",
	"function",
	"function.call",
	"function.method",
	"variable",
	"variable.member",
	"variable.parameter",
	"variable.builtin",
	"type",
	"type.builtin",
	"module",
	"constant",
	"constant.builtin",
	"number",
	"string",
	"string.escape",
	"string.regexp",
	"comment",
	"comment.documentation",
	"punctuation",
	"punctuation.bracket",
	"punctuation.delimiter",
	"punctuation.special",
	"operator",
	"tag",
	"attribute",
] as const;

/**
 * 基础 / 回退 scope
 */
const BASE_SCOPES = ["default", "conceal", "spell", "nospell"] as const;

/**
 * Extmark / Diff / LSP scope —— 对齐 opencode getSyntaxRules（非 tree-sitter 产出）
 */
const EXTMARK_SCOPES = ["prompt", "extmark.file", "extmark.agent", "extmark.paste"] as const;
const DIFF_SCOPES = ["diff.plus", "diff.minus", "diff.delta"] as const;
const LSP_SCOPES = ["error", "warning", "info", "debug"] as const;

describe("syntaxStyle scope 注册完整性", () => {
	describe.each([
		["base", BASE_SCOPES],
		["code", CODE_SCOPES],
		["markup", MARKUP_SCOPES],
		["extmark", EXTMARK_SCOPES],
		["diff", DIFF_SCOPES],
		["lsp", LSP_SCOPES],
	])("%s scope", (_label, scopes) => {
		for (const scope of scopes) {
			it(`registers ${scope}`, () => {
				const style = syntaxStyle.getStyle(scope);
				expect(style, `expected scope "${scope}" to be registered`).toBeDefined();
				expect(style?.fg ?? style?.bg ?? style?.bold ?? style?.italic).toBeTruthy();
			});
		}
	});

	it("covers all spec-required scopes in a single call to getRegisteredNames", () => {
		const all = new Set(syntaxStyle.getRegisteredNames());
		const required = [
			...MARKUP_SCOPES,
			...CODE_SCOPES,
			...BASE_SCOPES,
			...EXTMARK_SCOPES,
			...DIFF_SCOPES,
			...LSP_SCOPES,
		];
		const missing = required.filter((s) => !all.has(s));
		expect(missing, `missing scopes: ${missing.join(", ")}`).toEqual([]);
	});
});

describe("opencode 对齐 - 映射一致性", () => {
	it("string.special 与 string.special.url 命中 markdownLink + underline（非 syntaxKeyword）", () => {
		const special = syntaxStyle.getStyle("string.special");
		const url = syntaxStyle.getStyle("string.special.url");
		expect(special?.fg?.toString()).toBe(url?.fg?.toString());
		expect(special?.underline).toBe(true);
	});

	it("extmark.file 命中 warning + bold", () => {
		const style = syntaxStyle.getStyle("extmark.file");
		expect(style?.bold).toBe(true);
	});

	it("extmark.paste 命中 warning 背景", () => {
		const style = syntaxStyle.getStyle("extmark.paste");
		expect(style?.bg).toBeDefined();
		expect(style?.bold).toBe(true);
	});
});

describe("theme 死代码消除", () => {
	const rules = getSyntaxRules();

	/**
	 * 收集所有 rule.style.foreground 的字符串字面量，用于断言某 theme 颜色字段被引用。
	 * foreground 可能是 hex 字符串、RGBA 实例或 ANSI 数字；这里只关注 hex 字符串场景
	 * （theme.ts 中所有 markdown / syntax 系列字段都是 hex 字符串）。
	 */
	const foregrounds = new Set<string>();
	for (const rule of rules) {
		const fg = rule.style.foreground;
		if (typeof fg === "string") foregrounds.add(fg);
	}

	describe.each([
		["markdownHeading", colors.markdownHeading],
		["markdownStrong", colors.markdownStrong],
		["markdownEmph", colors.markdownEmph],
		["markdownCode", colors.markdownCode],
		["markdownLink", colors.markdownLink],
		["markdownLinkText", colors.markdownLinkText],
		// 本次新增字段也应被引用
		["markdownBlockQuote", colors.markdownBlockQuote],
		["markdownListItem", colors.markdownListItem],
		["syntaxPunctuation", colors.syntaxPunctuation],
	] as const)("%s 被规则引用", (_field, hex) => {
		it(`foreground 包含 ${hex}`, () => {
			expect(foregrounds.has(hex), `expected ${hex} to appear in some rule.style.foreground`).toBe(
				true,
			);
		});
	});
});

describe("getSyntaxRules 结构", () => {
	it("返回非空数组", () => {
		expect(getSyntaxRules().length).toBeGreaterThan(0);
	});

	it("每条规则都至少有一个 scope", () => {
		for (const rule of getSyntaxRules()) {
			expect(rule.scope.length, "scope array must be non-empty").toBeGreaterThan(0);
		}
	});

	it("每条规则都有 style 字段", () => {
		for (const rule of getSyntaxRules()) {
			expect(rule.style, "style must be present").toBeDefined();
			expect(typeof rule.style).toBe("object");
		}
	});
});
