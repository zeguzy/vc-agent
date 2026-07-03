import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** 默认请求超时（秒） */
const DEFAULT_TIMEOUT = 20;
/** 返回内容最大字符数，防止撑爆上下文窗口 */
const MAX_OUTPUT_CHARS = 50000;

export type WebfetchFormat = "markdown" | "text" | "html";

export interface WebfetchDetails {
	url: string;
	format: WebfetchFormat;
	status: number;
	truncated: boolean;
	originalChars: number;
}

const FormatSchema = Type.Union(
	[Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")],
	{ description: "Response format. Defaults to 'markdown'." },
);

const WebfetchParams = Type.Object({
	url: Type.String({ description: "The fully-qualified http(s) URL to fetch." }),
	format: Type.Optional(FormatSchema),
	timeout: Type.Optional(
		Type.Number({
			description: `Request timeout in seconds (clamped to 1-60). Defaults to ${DEFAULT_TIMEOUT}.`,
		}),
	),
});

const DESCRIPTION = [
	"Fetch a single http(s) URL and return its content as model-friendly text.",
	"By default the HTML is converted to markdown; set format to 'text' (stripped) or 'html' (raw) to override.",
	"Use this to read web pages, documentation, blogs, or any online resource by URL.",
	"Does NOT execute JavaScript — only the server-rendered HTML is returned.",
].join(" ");

// ---------- 纯函数：HTML 处理 ----------

const ENTITY_MAP: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
	"&nbsp;": " ",
	"&#39;": "'",
	"&#x27;": "'",
	"&#x2f;": "/",
};

/** 解码常见 HTML 实体（命名实体 + 数字 / 十六进制实体）。 */
export function decodeHtmlEntities(input: string): string {
	return input.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27|#x2f|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
		if (ENTITY_MAP[m]) return ENTITY_MAP[m];
		const dec = /^&#(\d+);$/.exec(m);
		if (dec) {
			const cp = Number.parseInt(dec[1], 10);
			if (cp >= 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
		}
		const hex = /^&#x([0-9a-fA-F]+);$/i.exec(m);
		if (hex) {
			const cp = Number.parseInt(hex[1], 16);
			if (cp >= 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
		}
		return m;
	});
}

/** 仅剥离 HTML 标签，不触碰实体与空白（块处理内部使用）。 */
function stripTags(input: string): string {
	return input.replace(/<[^>]+>/g, "");
}

/** 行内文本：剥标签 + 解码实体 + 压缩空白为单空格。 */
function inlineText(input: string): string {
	return decodeHtmlEntities(stripTags(input)).replace(/\s+/g, " ").trim();
}

/** 压缩空白：行内多空格归一、行首尾空格去除、连续空行压缩。 */
function collapseWhitespace(input: string): string {
	return input
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** 移除全部 HTML 标签并解码实体，返回纯文本（format: text 使用）。 */
export function stripHtml(input: string): string {
	const cleaned = input.replace(
		/<(script|style|noscript|head|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
		"",
	);
	return decodeHtmlEntities(stripTags(cleaned)).replace(/\s+/g, " ").trim();
}

/** 从 ul/ol 内容中提取每个 li 的 markdown 文本。 */
function extractListItems(listHtml: string): string[] {
	const items: string[] = [];
	for (const m of listHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
		const item = htmlToMarkdown(m[1])
			.trim()
			.replace(/\n{2,}/g, " ");
		if (item) items.push(item);
	}
	return items;
}

/** 简单 <table> → markdown 表格（按 tr/th/td 对齐列，无合并单元格支持）。 */
function tableToMarkdown(tableHtml: string): string {
	const rows: string[][] = [];
	for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const cells: string[] = [];
		const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
		for (const cellMatch of rowMatch[1].matchAll(cellRe)) {
			cells.push(inlineText(cellMatch[1]));
		}
		if (cells.length) rows.push(cells);
	}
	if (rows.length === 0) return "";
	const width = Math.max(...rows.map((r) => r.length));
	const norm = rows.map((r) => {
		const copy = [...r];
		while (copy.length < width) copy.push("");
		return copy;
	});
	const header = norm[0];
	const sep = Array<string>(width).fill("---");
	const body = norm.slice(1);
	const lines = [
		`| ${header.join(" | ")} |`,
		`| ${sep.join(" | ")} |`,
		...body.map((r) => `| ${r.join(" | ")} |`),
	];
	return `\n\n${lines.join("\n")}\n\n`;
}

/**
 * 将 HTML 转为 LLM 友好的 markdown。
 * 覆盖常见标签（a/h1-6/ul/ol/pre/code/blockquote/table/strong/em/br/p/hr），
 * 移除 script/style 等非正文节点。非高保真，目标是"模型可读"。
 */
export function htmlToMarkdown(input: string): string {
	let s = input;

	// 1. 非正文节点整段移除
	s = s.replace(/<(script|style|noscript|head|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
	s = s.replace(/<(script|style|noscript|head|svg|template)\b[^>]*\/>/gi, "");
	// HTML 注释
	s = s.replace(/<!--[\s\S]*?-->/g, "");

	// 2. pre 块 → 代码围栏（在通用 strip 前保留内容）
	s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, content: string) => {
		const code = decodeHtmlEntities(stripTags(content))
			.replace(/\n{3,}/g, "\n")
			.trim();
		return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
	});

	// 3. 行内 code → 反引号
	s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, c: string) => `\`${inlineText(c)}\``);

	// 4. 标题 h1-h6
	s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, content: string) => {
		const hashes = "#".repeat(Number.parseInt(level, 10));
		return `\n\n${hashes} ${inlineText(content)}\n\n`;
	});

	// 5. 链接 a[href] → [text](href)
	s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, content: string) => {
		const href =
			/href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /href\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? "";
		const text = inlineText(content);
		if (!text) return "";
		return href ? `[${text}](${href})` : text;
	});

	// 6. 强调 strong/b → **，em/i → *
	s = s.replace(
		/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi,
		(_m, c: string) => `**${inlineText(c)}**`,
	);
	s = s.replace(
		/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi,
		(_m, c: string) => `*${inlineText(c)}*`,
	);

	// 7. 引用块 blockquote → > 行
	s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, content: string) => {
		const inner = htmlToMarkdown(content).trim();
		const quoted = inner
			.split("\n")
			.map((l) => `> ${l}`.trimEnd())
			.join("\n");
		return `\n\n${quoted}\n\n`;
	});

	// 8. 列表 ul → - ，ol → 1.
	s = s.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, content: string) => {
		const items = extractListItems(content).map((it) => `- ${it}`);
		return `\n\n${items.join("\n")}\n\n`;
	});
	s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, content: string) => {
		const items = extractListItems(content).map((it, i) => `${i + 1}. ${it}`);
		return `\n\n${items.join("\n")}\n\n`;
	});

	// 9. 表格
	s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, content: string) =>
		tableToMarkdown(content),
	);

	// 10. 块级换行 / 段落 / 分隔线
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<p\b[^>]*>/gi, "\n\n");
	s = s.replace(/<\/p>/gi, "\n");
	s = s.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

	// 11. 剥离剩余标签 + 解码实体 + 空白归一
	return collapseWhitespace(decodeHtmlEntities(stripTags(s)));
}

// ---------- 工具定义 ----------

export function createWebfetchTool(): ToolDefinition {
	return {
		name: "webfetch",
		label: "Webfetch",
		description: DESCRIPTION,
		promptSnippet: "webfetch — fetch a URL and return markdown/text/html",
		parameters: WebfetchParams,
		async execute(_toolCallId, params, signal) {
			const p = params as { url: string; format?: string; timeout?: number };
			const url = (p.url ?? "").trim();
			if (!url) {
				return {
					content: [{ type: "text" as const, text: "Missing required parameter: url" }],
					details: {},
				};
			}

			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				return {
					content: [
						{ type: "text" as const, text: `Invalid URL (only http/https supported): ${url}` },
					],
					details: {},
				};
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return {
					content: [
						{
							type: "text" as const,
							text: `Unsupported URL scheme '${parsed.protocol}'. Only http/https are supported.`,
						},
					],
					details: {},
				};
			}

			const requestedTimeout = typeof p.timeout === "number" ? p.timeout : DEFAULT_TIMEOUT;
			const timeout = Math.min(Math.max(Math.trunc(requestedTimeout) || 1, 1), 60);

			const format: WebfetchFormat =
				p.format === "text" || p.format === "html" ? p.format : "markdown";

			const controller = new AbortController();
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort();
			}, timeout * 1000);

			const onOuterAbort = () => controller.abort();
			if (signal) {
				if (signal.aborted) controller.abort();
				else signal.addEventListener("abort", onOuterAbort, { once: true });
			}

			try {
				const res = await fetch(url, {
					signal: controller.signal,
					redirect: "follow",
					headers: { "user-agent": "openagent-webfetch/0.1" },
				});
				if (!res.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `${res.status} ${res.statusText || "HTTP error"}: ${url}`,
							},
						],
						details: {},
					};
				}

				let body = await res.text();
				if (format === "markdown") body = htmlToMarkdown(body);
				else if (format === "text") body = stripHtml(body);

				const originalChars = body.length;
				let truncated = false;
				if (originalChars > MAX_OUTPUT_CHARS) {
					truncated = true;
					body = `${body.slice(0, MAX_OUTPUT_CHARS)}\n\n[... truncated, original ${originalChars} chars]`;
				}

				return {
					content: [{ type: "text" as const, text: body }],
					details: {
						url,
						format,
						status: res.status,
						truncated,
						originalChars,
					} as WebfetchDetails,
				};
			} catch (e) {
				if (timedOut) {
					return {
						content: [
							{ type: "text" as const, text: `Request timed out after ${timeout}s: ${url}` },
						],
						details: {},
					};
				}
				const msg = e instanceof Error ? e.message : String(e);
				return {
					content: [{ type: "text" as const, text: `Fetch failed: ${msg}` }],
					details: {},
				};
			} finally {
				clearTimeout(timer);
				if (signal) signal.removeEventListener("abort", onOuterAbort);
			}
		},
	};
}
