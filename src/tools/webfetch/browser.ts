import { homedir } from "node:os";
import { join } from "node:path";
import { htmlToMarkdown, stripHtml } from "./html.js";
import type { WebfetchFormat } from "./types.js";

const MAX_OUTPUT_CHARS = 50000;
const BROWSER_PROFILE_DIR = join(homedir(), ".config", "openagent", "browser-profile");

export interface RenderResult {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
}

async function detectLoginPage(page: import("playwright").Page, status: number): Promise<boolean> {
	if (status === 401 || status === 403) return true;
	const finalUrl = page.url();
	if (/\/(login|signin|sign-in|auth|oauth|sso)\b/i.test(finalUrl)) return true;
	try {
		const passwordCount = await page.locator('input[type="password"]').count();
		if (passwordCount > 0) return true;
	} catch {
		// Best-effort check; silently skip on Playwright errors
	}
	return false;
}

function convertBody(body: string, format: WebfetchFormat): string {
	if (format === "markdown") return htmlToMarkdown(body);
	if (format === "text") return stripHtml(body);
	return body;
}

function truncate(body: string): { text: string; truncated: boolean; originalChars: number } {
	const originalChars = body.length;
	if (originalChars > MAX_OUTPUT_CHARS) {
		return {
			text: `${body.slice(0, MAX_OUTPUT_CHARS)}\n\n[... truncated, original ${originalChars} chars]`,
			truncated: true,
			originalChars,
		};
	}
	return { text: body, truncated: false, originalChars };
}

export async function fetchStatic(
	url: string,
	format: WebfetchFormat,
	timeout: number,
	signal: AbortSignal | undefined,
): Promise<RenderResult> {
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
					{ type: "text", text: `${res.status} ${res.statusText || "HTTP error"}: ${url}` },
				],
				details: {},
			};
		}

		const body = convertBody(await res.text(), format);
		const result = truncate(body);
		return {
			content: [{ type: "text", text: result.text }],
			details: {
				url,
				action: "fetch" as const,
				format,
				status: res.status,
				truncated: result.truncated,
				originalChars: result.originalChars,
			},
		};
	} catch (e) {
		if (timedOut) {
			return {
				content: [{ type: "text", text: `Request timed out after ${timeout}s: ${url}` }],
				details: {},
			};
		}
		const msg = e instanceof Error ? e.message : String(e);
		return {
			content: [{ type: "text", text: `Fetch failed: ${msg}` }],
			details: {},
		};
	} finally {
		clearTimeout(timer);
		if (signal) signal.removeEventListener("abort", onOuterAbort);
	}
}

export async function renderWithBrowser(
	url: string,
	format: WebfetchFormat,
	timeout: number,
	signal: AbortSignal | undefined,
	login: boolean,
): Promise<RenderResult> {
	let context: Awaited<
		ReturnType<typeof import("playwright")["chromium"]["launchPersistentContext"]>
	> | null = null;
	try {
		const { chromium } = await import("playwright");
		context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
			headless: !login,
			userAgent: "openagent-webfetch/0.1",
			viewport: { width: 1280, height: 720 },
		});

		const page = context.pages()[0] ?? (await context.newPage());

		if (signal?.aborted) {
			return {
				content: [{ type: "text", text: "Request aborted before navigation." }],
				details: {},
			};
		}

		const response = await page.goto(url, {
			waitUntil: login ? "load" : "networkidle",
			timeout: timeout * 1000,
		});

		if (!response) {
			return {
				content: [{ type: "text", text: `Failed to load page: ${url}` }],
				details: {},
			};
		}

		const status = response.status();
		if (status >= 400) {
			return {
				content: [{ type: "text", text: `${status}: ${url}` }],
				details: {},
			};
		}

		if (login) {
			await waitForBrowserClose(context, page, signal);
			return {
				content: [
					{
						type: "text",
						text: `Login session ended. Session saved to ${BROWSER_PROFILE_DIR}.\nRe-run with action="render" (without login=true) to fetch authenticated content.`,
					},
				],
				details: { url, action: "render" as const, login: true, status },
			};
		}

		const needsLogin = await detectLoginPage(page, status);
		if (needsLogin) {
			return {
				content: [
					{
						type: "text",
						text: `This page appears to require login (status=${status}, url=${page.url()}).\nRe-run with login=true to open a visible browser and authenticate.\nExample: webfetch(url="${url}", action="render", login=true)`,
					},
				],
				details: { url, action: "render" as const, needsLogin: true, status },
			};
		}

		const body = convertBody(await page.content(), format);
		const result = truncate(body);
		return {
			content: [{ type: "text", text: result.text }],
			details: {
				url,
				action: "render" as const,
				format,
				status,
				truncated: result.truncated,
				originalChars: result.originalChars,
			},
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			content: [{ type: "text", text: `Render failed: ${msg}` }],
			details: {},
		};
	} finally {
		await context?.close().catch(() => {});
	}
}

async function waitForBrowserClose(
	context: NonNullable<
		Awaited<ReturnType<typeof import("playwright")["chromium"]["launchPersistentContext"]>>
	>,
	page: import("playwright").Page,
	signal: AbortSignal | undefined,
): Promise<void> {
	await new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (!done) {
				done = true;
				resolve();
			}
		};
		context.on("close", finish);
		page.on("close", finish);
		signal?.addEventListener("abort", finish, { once: true });
		const poll = setInterval(() => {
			try {
				if (context.pages().length === 0) {
					clearInterval(poll);
					finish();
				}
			} catch {
				clearInterval(poll);
				finish();
			}
		}, 500);
	});
}
