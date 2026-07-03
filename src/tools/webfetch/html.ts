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

function stripTags(input: string): string {
	return input.replace(/<[^>]+>/g, "");
}

function inlineText(input: string): string {
	return decodeHtmlEntities(stripTags(input)).replace(/\s+/g, " ").trim();
}

function collapseWhitespace(input: string): string {
	return input
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function stripHtml(input: string): string {
	const cleaned = input.replace(
		/<(script|style|noscript|head|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
		"",
	);
	return decodeHtmlEntities(stripTags(cleaned)).replace(/\s+/g, " ").trim();
}

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

export function htmlToMarkdown(input: string): string {
	let s = input;

	s = s.replace(/<(script|style|noscript|head|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
	s = s.replace(/<(script|style|noscript|head|svg|template)\b[^>]*\/>/gi, "");
	s = s.replace(/<!--[\s\S]*?-->/g, "");

	s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, content: string) => {
		const code = decodeHtmlEntities(stripTags(content))
			.replace(/\n{3,}/g, "\n")
			.trim();
		return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
	});

	s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, c: string) => `\`${inlineText(c)}\``);

	s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, content: string) => {
		const hashes = "#".repeat(Number.parseInt(level, 10));
		return `\n\n${hashes} ${inlineText(content)}\n\n`;
	});

	s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, content: string) => {
		const href =
			/href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /href\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? "";
		const text = inlineText(content);
		if (!text) return "";
		return href ? `[${text}](${href})` : text;
	});

	s = s.replace(
		/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi,
		(_m, c: string) => `**${inlineText(c)}**`,
	);
	s = s.replace(
		/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi,
		(_m, c: string) => `*${inlineText(c)}*`,
	);

	s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, content: string) => {
		const inner = htmlToMarkdown(content).trim();
		const quoted = inner
			.split("\n")
			.map((l) => `> ${l}`.trimEnd())
			.join("\n");
		return `\n\n${quoted}\n\n`;
	});

	s = s.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, content: string) => {
		const items = extractListItems(content).map((it) => `- ${it}`);
		return `\n\n${items.join("\n")}\n\n`;
	});
	s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, content: string) => {
		const items = extractListItems(content).map((it, i) => `${i + 1}. ${it}`);
		return `\n\n${items.join("\n")}\n\n`;
	});

	s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, content: string) =>
		tableToMarkdown(content),
	);

	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<p\b[^>]*>/gi, "\n\n");
	s = s.replace(/<\/p>/gi, "\n");
	s = s.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

	return collapseWhitespace(decodeHtmlEntities(stripTags(s)));
}
