/**
 * Shared ASTRON LLM provider configuration for E2E tests.
 *
 * Key priority (first found wins):
 *   1. ASTRON_INFINITY_API_KEY  — default (low-tier model, cheaper)
 *   2. ASTRON_API_KEY           — standard key
 *   3. XUNFEI_ASTRON_KEY        — legacy alias
 *
 * To switch keys for a test run:
 *   Default (INFINITY):  RUN_LLM_TESTS=1 bun test tests/team-*-e2e.test.ts
 *   Standard key:        ASTRON_INFINITY_API_KEY= RUN_LLM_TESTS=1 bun test ...
 *   Explicit override:   ASTRON_API_KEY=<key> RUN_LLM_TESTS=1 bun test ...
 */
import type { Config } from "../../src/config.js";

const ASTRON_PROVIDER = "xunfei-astron";
const ASTRON_MODEL_ID = "astron-code-latest";
const ASTRON_BASE_URL = "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2";

export const ASTRON_KEY =
	process.env.ASTRON_INFINITY_API_KEY ??
	process.env.ASTRON_API_KEY ??
	process.env.XUNFEI_ASTRON_KEY ??
	"";

export function buildAstronConfig(): Config {
	if (!ASTRON_KEY) {
		throw new Error("ASTRON_INFINITY_API_KEY or ASTRON_API_KEY env var required for E2E tests");
	}
	return {
		model: `${ASTRON_PROVIDER}:${ASTRON_MODEL_ID}`,
		providers: {
			[ASTRON_PROVIDER]: {
				apiKey: ASTRON_KEY,
				baseUrl: ASTRON_BASE_URL,
				api: "openai-completions",
				models: [{ id: ASTRON_MODEL_ID, name: "Astron Coding", contextWindow: 128000 }],
			},
		},
	};
}
