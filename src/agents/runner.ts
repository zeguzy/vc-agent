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
	AgentConfig,
	RunSubagentOptions,
	SubagentResult,
	SubagentServices,
	SubagentUsage,
} from "./types.js";

const AGENT_DIR = join(homedir(), ".config", "openagent");

type ResolvedModel = NonNullable<ReturnType<typeof resolveSubagentModel>>;

export interface CreateSubagentSessionOpts {
	agent: AgentConfig;
	cwd: string;
	services: SubagentServices;
	parentModel?: ResolvedModel;
}

/**
 * Create a child AgentSession for a subagent run.
 *
 * Shared between {@link runSubagent} (synchronous path) and the background
 * subagent path in `src/tools/subagent.ts`. Resolves the model and builds the
 * resource loader + tool list, then returns the live session handle. The
 * caller owns the session lifecycle (subscribe, prompt, dispose).
 */
export async function createSubagentSession(
	opts: CreateSubagentSessionOpts,
): Promise<AgentSession> {
	const { agent, cwd, services, parentModel } = opts;

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

	return session;
}

export async function runSubagent(options: RunSubagentOptions): Promise<SubagentResult> {
	const { agent, task, cwd, services, parentModel, signal, onUpdate } = options;

	const session = await createSubagentSession({ agent, cwd, services, parentModel });

	let turns = 0;
	const acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let lastText = "";

	const unsub = session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			turns++;
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

	if (signal) {
		signal.addEventListener("abort", () => session.abort(), { once: true });
	}

	try {
		await session.prompt(task);
	} catch (err) {
		return {
			agent: agent.name,
			description: task,
			output: lastText || "",
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		unsub();
		session.dispose();
	}

	const usage: SubagentUsage = {
		inputTokens: acc.input,
		outputTokens: acc.output,
		cacheReadTokens: acc.cacheRead,
		cacheWriteTokens: acc.cacheWrite,
		cost: acc.cost,
		turns,
	};

	return {
		agent: agent.name,
		description: task,
		output: lastText || "(subagent produced no text output)",
		usage,
	};
}
