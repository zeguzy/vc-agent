import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOLS } from "../agent/session.js";
import { extractAssistantText } from "../utils/content.js";
import { buildNoModelError, resolveSubagentModel } from "./model-resolver.js";
import type {
	ContinueSubagentOptions,
	RunSubagentOptions,
	SubagentResult,
	SubagentUsage,
} from "./types.js";

const AGENT_DIR = join(homedir(), ".config", "openagent");

interface UsageAcc {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

function buildUsage(acc: UsageAcc): SubagentUsage {
	return {
		inputTokens: acc.input,
		outputTokens: acc.output,
		cacheReadTokens: acc.cacheRead,
		cacheWriteTokens: acc.cacheWrite,
		cost: acc.cost,
		turns: acc.turns,
	};
}

function subscribeToSession(
	session: AgentSession,
	onUpdate?: (text: string) => void,
): { unsub: () => void; acc: UsageAcc; lastText: string } {
	const acc: UsageAcc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	let lastText = "";

	const unsub = session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			acc.turns++;
			const u = event.message.usage;
			acc.input += u.input;
			acc.output += u.output;
			acc.cacheRead += u.cacheRead;
			acc.cacheWrite += u.cacheWrite;
			acc.cost += u.cost.total;

			const text = extractAssistantText(event.message.content);
			if (text) {
				lastText = text;
				onUpdate?.(text);
			}
		}
	});

	return { unsub, acc, lastText };
}

export async function runSubagent(options: RunSubagentOptions): Promise<SubagentResult> {
	const {
		agent,
		task,
		cwd,
		services,
		parentModel,
		signal,
		onUpdate,
		category,
		runInBackground,
		parentSessionId,
		taskRegistry,
		onBackgroundComplete,
	} = options;

	const model = resolveSubagentModel({
		agent,
		config: services.config,
		modelRegistry: services.modelRegistry,
		parentModel,
	});
	if (!model) throw new Error(buildNoModelError(agent));

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: AGENT_DIR,
		settingsManager: services.settingsManager,
		appendSystemPrompt: [agent.systemPrompt],
		noExtensions: true,
		noSkills: true,
		noContextFiles: true,
	});

	const tools = agent.tools ?? BUILTIN_TOOLS;

	const { session } = await createAgentSession({
		cwd,
		agentDir: AGENT_DIR,
		authStorage: services.authStorage,
		modelRegistry: services.modelRegistry,
		model,
		settingsManager: services.settingsManager,
		tools,
		resourceLoader,
	});

	const { unsub, acc, lastText } = subscribeToSession(session, onUpdate);

	if (signal) {
		signal.addEventListener("abort", () => session.abort(), { once: true });
	}

	// Async mode: register in TaskRegistry, return bg_xxx ID immediately
	if (runInBackground && taskRegistry && parentSessionId) {
		const bgTask = taskRegistry.register({
			sessionId: session.sessionId,
			parentSessionId,
			description: task,
			prompt: task,
			agent: agent.name,
			category,
		});

		// Fire-and-forget: prompt the session without awaiting
		session
			.prompt(task)
			.then(() => {
				const usage = buildUsage(acc);
				const result: SubagentResult = {
					agent: agent.name,
					description: task,
					output: lastText || "(subagent produced no text output)",
					usage,
					sessionId: session.sessionId,
					category,
					backgroundTaskId: bgTask.id,
				};
				taskRegistry.complete(bgTask.id, result.output, usage.cost, usage.turns);
				onBackgroundComplete?.(bgTask.id, result);
			})
			.catch((err) => {
				taskRegistry.fail(bgTask.id, err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				unsub();
				session.dispose();
			});

		return {
			agent: agent.name,
			description: task,
			output: `Background task started: ${bgTask.id}`,
			sessionId: session.sessionId,
			category,
			backgroundTaskId: bgTask.id,
		};
	}

	// Sync mode: await completion
	try {
		await session.prompt(task);
	} catch (err) {
		return {
			agent: agent.name,
			description: task,
			output: lastText || "",
			error: err instanceof Error ? err.message : String(err),
			sessionId: session.sessionId,
			category,
		};
	} finally {
		unsub();
		session.dispose();
	}

	return {
		agent: agent.name,
		description: task,
		output: lastText || "(subagent produced no text output)",
		usage: buildUsage(acc),
		sessionId: session.sessionId,
		category,
	};
}

export async function continueSubagent(options: ContinueSubagentOptions): Promise<SubagentResult> {
	const { sessionId, task, taskRegistry } = options;

	const bgTask = taskRegistry.get(sessionId);
	if (!bgTask) {
		return {
			agent: "",
			description: task,
			output: "",
			error: `Task not found: ${sessionId}`,
		};
	}

	if (bgTask.parentSessionId !== sessionId && bgTask.sessionId !== sessionId) {
		return {
			agent: bgTask.agent,
			description: task,
			output: "",
			error: `Task ${sessionId} does not belong to this session`,
		};
	}

	// For now, return the stored result if completed
	if (bgTask.status === "completed") {
		return {
			agent: bgTask.agent,
			description: bgTask.description,
			output: bgTask.result || "",
			usage:
				bgTask.cost != null
					? {
							inputTokens: 0,
							outputTokens: 0,
							cacheReadTokens: 0,
							cacheWriteTokens: 0,
							cost: bgTask.cost,
							turns: bgTask.turns ?? 0,
						}
					: undefined,
			sessionId: bgTask.sessionId,
			category: bgTask.category,
			backgroundTaskId: bgTask.id,
		};
	}

	if (bgTask.status === "error") {
		return {
			agent: bgTask.agent,
			description: bgTask.description,
			output: "",
			error: bgTask.error || "Unknown error",
			sessionId: bgTask.sessionId,
			category: bgTask.category,
			backgroundTaskId: bgTask.id,
		};
	}

	// Running/pending: return current status
	return {
		agent: bgTask.agent,
		description: bgTask.description,
		output: `Task ${bgTask.id} is still ${bgTask.status}`,
		sessionId: bgTask.sessionId,
		category: bgTask.category,
		backgroundTaskId: bgTask.id,
	};
}
