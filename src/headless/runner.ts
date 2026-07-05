import type { AgentSessionEvent } from "../agent/session.js";
import { type AgentMode, createRuntime, type SessionMode } from "../agent/session.js";
import type { AgentClient } from "../client/index.js";
import { createClient } from "../client/index.js";
import { readConfig } from "../config.js";
import { createServer } from "../server/index.js";
import type { TeamEvent } from "../teams/types-v2.js";
import { formatError } from "../utils/formatError.js";

export interface HeadlessOptions {
	cwd: string;
	model?: string;
	mode: SessionMode;
	agentMode: AgentMode;
	sessionRef?: string;
	name?: string;
}

export class HeadlessRunner {
	private client: AgentClient | null = null;

	constructor(private readonly opts: HeadlessOptions) {}

	private async setup(): Promise<AgentClient> {
		const config = readConfig(this.opts.cwd);
		const { runtime, skillManager, mcpManager } = await createRuntime({
			cwd: this.opts.cwd,
			model: this.opts.model ?? config.model,
			config,
			mode: this.opts.mode,
			agentMode: this.opts.agentMode,
			...(this.opts.sessionRef ? { sessionRef: this.opts.sessionRef } : {}),
			...(this.opts.name ? { name: this.opts.name } : {}),
		});
		const server = createServer({ runtime, skillManager, mcpManager, cwd: this.opts.cwd });
		this.client = createClient(server);
		return this.client;
	}

	async run(promptText: string): Promise<number> {
		let client: AgentClient;
		try {
			client = await this.setup();
		} catch (err) {
			process.stderr.write(`Setup failed: ${formatError(err)}\n`);
			return 1;
		}

		return new Promise((resolve) => {
			let exited = false;
			const exit = (code: number) => {
				if (exited) return;
				exited = true;
				resolve(code);
			};

			let writtenLen = 0;

			const extractText = (msg: unknown): string => {
				const m = msg as {
					role?: string;
					content?: string | Array<{ type: string; text?: string }>;
				};
				if (m?.role !== "assistant") return "";
				if (typeof m.content === "string") return m.content;
				return m.content?.find((c) => c.type === "text")?.text ?? "";
			};

			client.subscribe((event: AgentSessionEvent) => {
				switch (event.type) {
					case "message_start": {
						const text = extractText(event.message);
						if (text) {
							process.stdout.write(text);
							writtenLen = text.length;
						}
						break;
					}
					case "message_update": {
						const text = extractText(event.message);
						if (text.length > writtenLen) {
							process.stdout.write(text.slice(writtenLen));
							writtenLen = text.length;
						}
						break;
					}
					case "message_end": {
						const text = extractText(event.message);
						if (text || writtenLen > 0) process.stdout.write("\n");
						writtenLen = 0;
						break;
					}
					case "tool_execution_end": {
						if (event.isError) {
							process.stderr.write(`[tool error: ${event.toolName}]\n`);
						}
						break;
					}
					case "compaction_start": {
						process.stderr.write("[compacting context…]\n");
						break;
					}
					case "agent_end": {
						exit(0);
						break;
					}
				}
			});

			client.subscribeTeam((event: TeamEvent) => {
				if (event.type === "member_done") {
					process.stderr.write(`[member ${event.memberName}] finished\n`);
				}
				if (event.type === "member_error") {
					process.stderr.write(`[member ${event.memberName}] error: ${event.error}\n`);
				}
				if (event.type === "member_paused") {
					process.stderr.write(`[member ${event.memberName}] paused\n`);
				}
				if (event.type === "member_resumed") {
					process.stderr.write(`[member ${event.memberName}] resumed\n`);
				}
				if (event.type === "member_cancelled") {
					process.stderr.write(`[member ${event.memberName}] cancelled\n`);
				}
			});

			client.prompt(promptText).catch((err) => {
				process.stderr.write(`Error: ${formatError(err)}\n`);
				exit(1);
			});
		});
	}
}
