/**
 * Shared test helper: start a real AgentServer in-process with environment isolation.
 *
 * Used by acceptance-smoke.test.ts and team-e2e-llm.test.ts to avoid copy-paste drift.
 *
 * Three isolations enforced:
 *   1. Temporary HOME under os.tmpdir() — prevents polluting user's ~/.config/openagent/
 *   2. Caller binds 127.0.0.1 — prevents exposing server to network (Node default binds ::/0.0.0.0)
 *   3. Never call /prompt — POST /prompt blocks until full agent turn, consuming LLM tokens
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRuntime, type RuntimeResult } from "../../src/agent/session.js";
import type { AgentServer } from "../../src/server/index.js";

export interface RealServerResult {
	server: AgentServer;
	runtime: RuntimeResult["runtime"];
	skillManager: RuntimeResult["skillManager"];
	restoreHome: () => void;
}

export interface CreateRealServerOptions {
	cwd?: string;
}

export async function createRealServer(opts?: CreateRealServerOptions): Promise<RealServerResult> {
	const cwd = opts?.cwd ?? process.cwd();

	const originalHome = process.env.HOME;
	const isolatedHome = join(
		tmpdir(),
		`openagent-test-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
	);
	mkdirSync(join(isolatedHome, ".config", "openagent"), { recursive: true });
	process.env.HOME = isolatedHome;

	try {
		const { runtime, skillManager } = await createRuntime({
			cwd,
			mode: "new",
		});

		const { createServer } = await import("../../src/server/index.js");
		const server = createServer({ runtime, skillManager, cwd });

		return {
			server,
			runtime,
			skillManager,
			restoreHome: () => {
				process.env.HOME = originalHome;
			},
		};
	} catch (err) {
		process.env.HOME = originalHome;
		throw err;
	}
}
