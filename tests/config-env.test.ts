import { describe, expect, it } from "bun:test";
import { resolveEnvVars } from "../src/config.js";

describe("resolveEnvVars", () => {
	it("replaces ENV.VAR_NAME with process.env value", () => {
		process.env.TEST_ENV_VAR = "secret-value";
		expect(resolveEnvVars("ENV.TEST_ENV_VAR")).toBe("secret-value");
		delete process.env.TEST_ENV_VAR;
	});

	it("leaves plain strings unchanged", () => {
		expect(resolveEnvVars("hello world")).toBe("hello world");
		expect(resolveEnvVars("https://api.example.com/v2")).toBe("https://api.example.com/v2");
	});

	it("recursively resolves nested objects", () => {
		process.env.NESTED_KEY = "resolved";
		const input = {
			providers: {
				foo: { apiKey: "ENV.NESTED_KEY", baseUrl: "https://x.com" },
			},
		};
		expect(resolveEnvVars(input)).toEqual({
			providers: {
				foo: { apiKey: "resolved", baseUrl: "https://x.com" },
			},
		});
		delete process.env.NESTED_KEY;
	});

	it("resolves arrays recursively", () => {
		process.env.ARRAY_VAR = "val";
		expect(resolveEnvVars(["ENV.ARRAY_VAR", "plain"])).toEqual(["val", "plain"]);
		delete process.env.ARRAY_VAR;
	});

	it("warns and returns empty string when ENV var not set", () => {
		const warn = console.warn;
		const warns: string[] = [];
		console.warn = (msg: string) => warns.push(msg);
		expect(resolveEnvVars("ENV.DEFINITELY_NOT_SET_X9K2")).toBe("");
		expect(warns[0]).toContain("DEFINITELY_NOT_SET_X9K2");
		console.warn = warn;
	});

	it("passes through non-string primitives", () => {
		expect(resolveEnvVars(42)).toBe(42);
		expect(resolveEnvVars(true)).toBe(true);
		expect(resolveEnvVars(null)).toBe(null);
	});

	it("does not match ENV. prefix when embedded or lowercase", () => {
		expect(resolveEnvVars("Bearer ENV.TOKEN")).toBe("Bearer ENV.TOKEN");
		expect(resolveEnvVars("ENV.lowercase")).toBe("ENV.lowercase");
	});

	it("matches env vars with underscores and digits", () => {
		process.env.MY_VAR_123 = "ok";
		expect(resolveEnvVars("ENV.MY_VAR_123")).toBe("ok");
		delete process.env.MY_VAR_123;
	});

	it("handles empty objects and arrays", () => {
		expect(resolveEnvVars({})).toEqual({});
		expect(resolveEnvVars([])).toEqual([]);
	});
});
