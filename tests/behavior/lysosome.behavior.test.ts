import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_AGENTS } from "../../src/agents/defaults.js";
import { runSubagent } from "../../src/agents/runner.js";
import type { SubagentServices } from "../../src/agents/types.js";
import {
	BEHAVIOR_ENABLED,
	initXunfeiServices,
	resolveXunfeiModel,
	withResolvedModel,
	XUNFEI_KEY,
} from "./helpers.js";

const tmpDir = join(import.meta.dirname, ".tmp-lysosome-behavior");

describe.skipIf(!BEHAVIOR_ENABLED || !XUNFEI_KEY)("lysosome behavior (real xunfei astron)", () => {
	let services: SubagentServices;
	let parentModel: ReturnType<SubagentServices["modelRegistry"]["getAll"]>[number];
	const rawLysosome = BUILTIN_AGENTS.find((a) => a.name === "lysosome");
	if (!rawLysosome) throw new Error("lysosome agent not found");
	const lysosome = withResolvedModel(rawLysosome);

	beforeAll(() => {
		services = initXunfeiServices(XUNFEI_KEY!);
		const resolved = resolveXunfeiModel(services);
		if (!resolved) throw new Error("failed to resolve xunfei astron-code-latest from registry");
		parentModel = resolved;
		mkdirSync(tmpDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reviews code with `as any` and flags the issue (not APPROVE)", async () => {
		const file = join(tmpDir, "bad.ts");
		writeFileSync(
			file,
			['const data = JSON.parse("{}") as any;', "console.log(data.nonexistent.method());", ""].join(
				"\n",
			),
		);

		const result = await runSubagent({
			agent: lysosome,
			task: `Review ${file} for type safety and correctness issues. Run any available verification commands.`,
			cwd: tmpDir,
			services,
			parentModel,
		});

		expect(result.error).toBeUndefined();
		const out = result.output;
		expect(out).not.toContain("APPROVE");
		expect(out).not.toContain("REQUEST_CHANGES");
		expect(out.toLowerCase()).toMatch(/as any|type safety|type-safe/i);
		if (/VERDICT:/i.test(out)) {
			expect(out).toMatch(/VERDICT:\s*FAIL/i);
			expect(out).not.toMatch(/VERDICT:\s*PASS/i);
		}
	}, 120000);

	it("runs actual verification commands on clean code (not just reading)", async () => {
		const file = join(tmpDir, "clean.ts");
		writeFileSync(file, 'const greeting: string = "hello";\nconsole.log(greeting);\n');

		const result = await runSubagent({
			agent: lysosome,
			task: `Review ${file}. The code is trivial and correct. Run any available verification.`,
			cwd: tmpDir,
			services,
			parentModel,
		});

		expect(result.error).toBeUndefined();
		const out = result.output;
		expect(out).not.toContain("APPROVE");
		expect(out.toLowerCase()).toMatch(/tsc|biome|test|lint|tsx|bun|node/i);
		if (/VERDICT:\s*PASS/i.test(out)) {
			expect(out).toMatch(/Evidence/i);
		}
	}, 120000);

	it("does analysis without APPROVE when tooling unavailable", async () => {
		const file = join(tmpDir, "no-tool.ts");
		writeFileSync(file, "const x = 42;\nconsole.log(x);\n");

		const result = await runSubagent({
			agent: lysosome,
			task: `Review ${file}. Note: this project has no tsc, biome, or test runner configured. Verify what you can.`,
			cwd: tmpDir,
			services,
			parentModel,
		});

		expect(result.error).toBeUndefined();
		const out = result.output;
		expect(out).not.toContain("APPROVE");
		expect(out).not.toContain("REQUEST_CHANGES");
		expect(out.length).toBeGreaterThan(50);
	}, 120000);

	it("flags multiple issue types in complex code (as any + null deref + empty catch + injection)", async () => {
		const file = join(tmpDir, "complex.ts");
		writeFileSync(
			file,
			[
				'import { execSync } from "node:child_process";',
				"",
				'const config = JSON.parse("{}") as any;',
				"",
				"function getUser(id: string) {",
				"	const user = config.users[id];",
				"	return user.name;",
				"}",
				"",
				"function runCommand(input: string) {",
				"	try {",
				"		execSync(`echo ${input}`);",
				"	} catch (e) {}",
				"}",
				"",
				'const data: any = fetch("https://api.example.com");',
				"console.log(data.json());",
				"",
				"export { getUser, runCommand };",
				"",
			].join("\n"),
		);

		const result = await runSubagent({
			agent: lysosome,
			task: `Review ${file} thoroughly. Identify every type safety, correctness, security, and error handling issue. Run any available verification.`,
			cwd: tmpDir,
			services,
			parentModel,
		});

		expect(result.error).toBeUndefined();
		const out = result.output;
		expect(out).not.toContain("APPROVE");

		const lower = out.toLowerCase();
		const issues = {
			typeAny: /as any|: any|implicit any|type-safe|type safety/.test(lower),
			nullDeref: /null|undefined|optional chaining|\?\.|may be undefined|dereference/.test(lower),
			emptyCatch: /catch|swallow|silently|ignor/.test(lower),
			injection: /inject|exec|command|untrusted|input|sanitiz|escape/.test(lower),
		};

		const identifiedCount = Object.values(issues).filter(Boolean).length;
		expect(identifiedCount).toBeGreaterThanOrEqual(3);

		if (/VERDICT:/i.test(out)) {
			expect(out).toMatch(/VERDICT:\s*FAIL/i);
		}
	}, 120000);
});
