import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	createWebfetchTool,
	decodeHtmlEntities,
	htmlToMarkdown,
	stripHtml,
} from "../src/tools/webfetch.js";

describe("decodeHtmlEntities", () => {
	it("decodes named entities", () => {
		expect(decodeHtmlEntities("a &amp; b &lt;tag&gt; &quot;q&quot;")).toBe('a & b <tag> "q"');
	});

	it("decodes &nbsp; to space", () => {
		expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b");
	});

	it("decodes decimal numeric entities", () => {
		expect(decodeHtmlEntities("&#65;&#66;")).toBe("AB");
	});

	it("decodes hex numeric entities", () => {
		expect(decodeHtmlEntities("&#x41;")).toBe("A");
	});

	it("leaves unknown sequences untouched", () => {
		expect(decodeHtmlEntities("hello &bogus; world")).toBe("hello &bogus; world");
	});

	it("returns plain text unchanged", () => {
		expect(decodeHtmlEntities("hello world")).toBe("hello world");
	});
});

describe("stripHtml", () => {
	it("removes tags and decodes entities", () => {
		expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
	});

	it("strips script/style content", () => {
		const html = "<script>alert(1)</script><style>.a{}</style><p>text</p>";
		expect(stripHtml(html)).toBe("text");
	});

	it("collapses repeated whitespace", () => {
		expect(stripHtml("<p>a\n\n\n   b</p>")).toBe("a b");
	});
});

describe("htmlToMarkdown", () => {
	it("converts anchor to markdown link", () => {
		expect(htmlToMarkdown('<a href="https://x.com">X</a>')).toBe("[X](https://x.com)");
	});

	it("converts headings to # syntax", () => {
		expect(htmlToMarkdown("<h1>Title</h1><h2>Sub</h2>")).toBe("# Title\n\n## Sub");
	});

	it("removes script and style content", () => {
		const html = "<script>bad()</script><style>.a{}</style><p>ok</p>";
		expect(htmlToMarkdown(html)).toBe("ok");
	});

	it("decodes entities", () => {
		expect(htmlToMarkdown("<p>a &amp; b</p>")).toBe("a & b");
	});

	it("converts unordered list", () => {
		expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
	});

	it("converts ordered list", () => {
		expect(htmlToMarkdown("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b");
	});

	it("wraps pre block in code fence", () => {
		const md = htmlToMarkdown("<pre>let x = 1;</pre>");
		expect(md).toContain("```");
		expect(md).toContain("let x = 1;");
	});

	it("prefixes blockquote lines with >", () => {
		const md = htmlToMarkdown("<blockquote>quoted text</blockquote>");
		expect(md).toContain("> quoted text");
	});

	it("renders a simple table", () => {
		const md = htmlToMarkdown(
			"<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
		);
		expect(md).toContain("| A | B |");
		expect(md).toContain("| --- |");
		expect(md).toContain("| 1 | 2 |");
	});

	it("does not emit runs of 3+ newlines", () => {
		const md = htmlToMarkdown("<p>a</p><p>b</p><p>c</p>");
		expect(md).not.toMatch(/\n{3,}/);
	});

	it("converts inline code to backticks", () => {
		expect(htmlToMarkdown("<p>use <code>foo()</code> here</p>")).toBe("use `foo()` here");
	});
});

describe("createWebfetchTool", () => {
	const tool = createWebfetchTool();
	let server: ReturnType<typeof Bun.serve>;
	let base: string;

	beforeAll(() => {
		server = Bun.serve({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/doc") {
					return new Response(
						"<html><head><title>T</title><style>.a{}</style></head>" +
							'<body><h1>Title</h1><p>Hello <a href="https://x.com">X</a> &amp; <b>bold</b></p>' +
							"<script>bad()</script><ul><li>one</li><li>two</li></ul></body></html>",
						{ headers: { "content-type": "text/html" } },
					);
				}
				if (url.pathname === "/big") {
					return new Response(`<p>${"x".repeat(100_000)}</p>`, {
						headers: { "content-type": "text/html" },
					});
				}
				if (url.pathname === "/404") {
					return new Response("nope", { status: 404 });
				}
				return new Response("ok");
			},
		});
		base = `http://localhost:${server.port}`;
	});

	afterAll(() => server.stop());

	const textOf = async (params: Record<string, unknown>): Promise<string> => {
		const res = await tool.execute("test-id", params, undefined);
		const first = res.content[0] as { text: string };
		return first.text;
	};

	it("rejects file:// scheme without a request", async () => {
		const text = await textOf({ url: "file:///etc/passwd" });
		expect(text).toContain("http/https");
		expect(text).toContain("file");
	});

	it("rejects a bare address with no scheme", async () => {
		const text = await textOf({ url: "example.com" });
		expect(text).toContain("http/https");
	});

	it("rejects an empty url", async () => {
		const text = await textOf({ url: "" });
		expect(text).toContain("url");
	});

	it("converts to markdown by default", async () => {
		const text = await textOf({ url: `${base}/doc` });
		expect(text).toContain("# Title");
		expect(text).toContain("[X](https://x.com)");
		expect(text).toContain("- one");
		expect(text).not.toContain("bad()");
		expect(text).not.toContain(".a{}");
	});

	it("strips to plain text when format=text", async () => {
		const text = await textOf({ url: `${base}/doc`, format: "text" });
		expect(text).toContain("Title");
		expect(text).toContain("bold");
		expect(text).not.toContain("<h1");
		expect(text).not.toContain("<script");
	});

	it("returns raw html when format=html", async () => {
		const text = await textOf({ url: `${base}/doc`, format: "html" });
		expect(text).toContain("<h1>Title</h1>");
	});

	it("truncates oversized output with a marker", async () => {
		const text = await textOf({ url: `${base}/big` });
		expect(text).toContain("[... truncated");
		expect(text.length).toBeLessThan(60_000);
	});

	it("reports non-2xx status in the error text", async () => {
		const text = await textOf({ url: `${base}/404` });
		expect(text).toContain("404");
	});

	it("clamps timeout to the 1-60 range", async () => {
		const res = (await tool.execute(
			"test-id",
			{ url: `${base}/doc`, timeout: 999 },
			undefined,
		)) as { details: { status?: number } };
		// timeout=999 钳制为 60；正常请求应成功返回 status 200，证明未因非法超时报错
		expect(res.details.status).toBe(200);
	});
});
