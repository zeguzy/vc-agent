import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchStatic, renderWithBrowser } from "./browser.js";
import type { WebfetchAction, WebfetchFormat, WebfetchParams } from "./types.js";

const DEFAULT_TIMEOUT = 20;

const FormatSchema = Type.Union(
	[Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")],
	{ description: "Response format. Defaults to 'markdown'." },
);

const ActionSchema = Type.Union([Type.Literal("fetch"), Type.Literal("render")], {
	description:
		"'fetch' (default): fast HTTP GET, no JS execution. 'render': headless browser with full JS rendering — use for SPAs and dynamic pages.",
});

const ParamsSchema = Type.Object({
	url: Type.String({ description: "The fully-qualified http(s) URL to fetch." }),
	action: Type.Optional(ActionSchema),
	format: Type.Optional(FormatSchema),
	login: Type.Optional(
		Type.Boolean({
			description:
				"Only valid with action='render'. When true, opens a visible browser window so you can log in manually. The session (cookies, localStorage) persists in ~/.config/openagent/browser-profile for future headless renders.",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: `Request timeout in seconds (clamped to 1-120). Defaults to ${DEFAULT_TIMEOUT}.`,
		}),
	),
});

const DESCRIPTION = [
	"Fetch a single http(s) URL and return its content as model-friendly text.",
	"action='fetch' (default): fast HTTP GET, converts server-rendered HTML to markdown/text/html.",
	"action='render': launches a browser to fully render JavaScript, then extracts the resulting HTML.",
	"login=true (with action='render'): opens a visible browser window for manual login; session persists across calls.",
	"By default the HTML is converted to markdown; set format to 'text' (stripped) or 'html' (raw) to override.",
].join(" ");

export function createWebfetchTool(): ToolDefinition {
	return {
		name: "webfetch",
		label: "Webfetch",
		description: DESCRIPTION,
		promptSnippet:
			"webfetch — fetch a URL (action=fetch for static, action=render for JS-rendered pages)",
		parameters: ParamsSchema,
		async execute(_toolCallId, params, signal) {
			const p = params as WebfetchParams;
			const url = (p.url ?? "").trim();
			if (!url) return errorResult("Missing required parameter: url");

			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				return errorResult(`Invalid URL (only http/https supported): ${url}`);
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return errorResult(
					`Unsupported URL scheme '${parsed.protocol}'. Only http/https are supported.`,
				);
			}

			const action: WebfetchAction = p.action === "render" ? "render" : "fetch";
			const requestedTimeout = typeof p.timeout === "number" ? p.timeout : DEFAULT_TIMEOUT;
			const maxTimeout = action === "render" ? 120 : 60;
			const timeout = Math.min(Math.max(Math.trunc(requestedTimeout) || 1, 1), maxTimeout);
			const format: WebfetchFormat =
				p.format === "text" || p.format === "html" ? p.format : "markdown";

			if (action === "render") {
				return await renderWithBrowser(url, format, timeout, signal, p.login === true);
			}
			return await fetchStatic(url, format, timeout, signal);
		},
	};
}

function errorResult(text: string) {
	return {
		content: [{ type: "text" as const, text }],
		details: {},
	};
}
