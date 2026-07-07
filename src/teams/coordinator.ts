import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createAgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { resolveModel } from "../agent/session.js";
import type { SubagentServices } from "../agents/types.js";
import { extractAssistantText } from "../utils/content.js";
import type { ResolvedModel } from "./types.js";
import type { MemberName, TaskState } from "./types-v2.js";

const AGENT_DIR = join(homedir(), ".config", "openagent");

// ─── Coordinator Decision Types ────────────────────────────

export interface CoordinatorContinue {
	action: "continue";
	nextSpeaker: MemberName;
	instruction: string;
	reason: string;
}

export interface CoordinatorComplete {
	action: "complete";
	reason: string;
}

export type CoordinatorDecision = CoordinatorContinue | CoordinatorComplete;

// ─── Coordinator Input ─────────────────────────────────────

export interface CoordinatorInput {
	task: TaskState;
	members: Array<{
		name: MemberName;
		role: string;
		status: string;
		currentTaskId: string | null;
	}>;
	recentMessages: Array<{
		from: MemberName;
		to: MemberName | "broadcast";
		content: string;
		timestamp: number;
	}>;
	round: number;
	maxRounds: number;
}

// ─── Build Coordinator Prompt ──────────────────────────────

export function buildCoordinatorPrompt(input: CoordinatorInput): string {
	const lines: string[] = [];

	lines.push(
		"You are a team discussion coordinator. Evaluate the current state of a team discussion and decide what happens next.",
	);
	lines.push("");
	lines.push("## Current Task");
	lines.push(`Title: ${input.task.title}`);
	lines.push(`Description: ${input.task.description}`);
	lines.push(`Priority: ${input.task.priority}`);
	lines.push("");
	lines.push("## Team Members");
	for (const m of input.members) {
		const taskInfo = m.currentTaskId ? ` (working on ${m.currentTaskId})` : "";
		lines.push(`- ${m.name} (${m.role}) — ${m.status}${taskInfo}`);
	}
	lines.push("");
	lines.push("## Discussion Progress");
	lines.push(`Round: ${input.round} / ${input.maxRounds}`);
	lines.push("");

	if (input.recentMessages.length > 0) {
		lines.push("### Recent Messages (newest last)");
		for (const msg of input.recentMessages.slice(-20)) {
			const time = new Date(msg.timestamp).toISOString().slice(11, 19);
			const to = msg.to === "broadcast" ? "everyone" : msg.to;
			lines.push(`[${time}] ${msg.from} → ${to}: ${msg.content.slice(0, 200)}`);
		}
	} else {
		lines.push("No messages exchanged yet.");
	}

	lines.push("");
	lines.push("## Your Decision");
	lines.push("Based on the discussion so far, decide one of:");
	lines.push("");
	lines.push(
		"1. **continue**: The discussion needs more rounds. Specify who should speak next and what they should address.",
	);
	lines.push(
		"2. **complete**: The discussion has reached a natural conclusion — consensus achieved, all key viewpoints expressed, or the task objective is fulfilled.",
	);
	lines.push("");
	lines.push("Respond with ONLY a JSON object:");
	lines.push("```json");
	lines.push(
		'{ "action": "continue", "nextSpeaker": "<member_name>", "instruction": "<what they should discuss>", "reason": "<why>" }',
	);
	lines.push("```");
	lines.push("or");
	lines.push("```json");
	lines.push('{ "action": "complete", "reason": "<why the discussion is done>" }');
	lines.push("```");
	lines.push("");
	lines.push("Guidelines:");
	lines.push(
		"- If only some members have spoken, continue and pick someone who hasn't contributed yet.",
	);
	lines.push(
		"- If viewpoints are still being exchanged without synthesis, continue and ask someone to summarize or propose a conclusion.",
	);
	lines.push("- If there's clear consensus or all perspectives are on the table, complete.");
	lines.push(
		"- Never let the discussion exceed the max rounds. If round >= maxRounds - 1, strongly prefer complete.",
	);
	lines.push(
		"- Pick the next speaker strategically: who has the most relevant perspective that hasn't been heard yet?",
	);

	return lines.join("\n");
}

// ─── Parse Coordinator Output ──────────────────────────────

export function parseCoordinatorDecision(raw: string): CoordinatorDecision {
	// Extract JSON from the response — may be wrapped in markdown code block
	const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return { action: "complete", reason: "coordinator output could not be parsed" };
	}

	const jsonStr = jsonMatch[1] ?? jsonMatch[0];
	try {
		const parsed = JSON.parse(jsonStr.trim());
		if (parsed.action === "continue" && parsed.nextSpeaker && parsed.instruction) {
			return {
				action: "continue",
				nextSpeaker: parsed.nextSpeaker,
				instruction: parsed.instruction,
				reason: parsed.reason ?? "",
			};
		}
		if (parsed.action === "complete") {
			return { action: "complete", reason: parsed.reason ?? "discussion complete" };
		}
		return { action: "complete", reason: `unexpected coordinator action: ${parsed.action}` };
	} catch {
		return { action: "complete", reason: "coordinator JSON parse failed" };
	}
}

// ─── Run Coordinator Agent ─────────────────────────────────

export async function runCoordinator(opts: {
	input: CoordinatorInput;
	cwd: string;
	services: SubagentServices;
	parentModel?: ResolvedModel;
}): Promise<CoordinatorDecision> {
	const { input, cwd, services, parentModel } = opts;

	const prompt = buildCoordinatorPrompt(input);

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: AGENT_DIR,
		settingsManager: services.settingsManager,
		appendSystemPrompt: [
			"You are a team discussion coordinator. You evaluate discussion progress and decide the next step. You respond ONLY with structured JSON decisions. No conversational filler.",
		],
		noExtensions: true,
		noSkills: true,
		noContextFiles: true,
	});

	const model = parentModel ?? resolveModel(services.modelRegistry);

	const { session } = await createAgentSession({
		cwd,
		agentDir: AGENT_DIR,
		authStorage: services.authStorage,
		modelRegistry: services.modelRegistry,
		model,
		settingsManager: services.settingsManager,
		tools: [],
		resourceLoader,
	});

	let lastText = "";

	const unsub = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			const text = extractAssistantText(event.message.content);
			if (text) lastText = text;
		}
	});

	try {
		await session.prompt(prompt);
	} catch (err) {
		return {
			action: "complete",
			reason: `coordinator error: ${err instanceof Error ? err.message : String(err)}`,
		};
	} finally {
		unsub();
		session.dispose();
	}

	return parseCoordinatorDecision(lastText);
}

// ─── Helper: Collect Recent Messages ───────────────────────

export function collectRecentMessages(
	inboxDir: string,
	memberNames: MemberName[],
	limit = 30,
): Array<{ from: MemberName; to: MemberName | "broadcast"; content: string; timestamp: number }> {
	const allMessages: Array<{
		from: MemberName;
		to: MemberName | "broadcast";
		content: string;
		timestamp: number;
	}> = [];

	for (const name of memberNames) {
		const inboxPath = join(inboxDir, name, "inbox.jsonl");
		if (!existsSync(inboxPath)) continue;
		const lines = readFileSync(inboxPath, "utf-8").trim().split("\n").filter(Boolean);
		for (const line of lines) {
			try {
				const msg = JSON.parse(line);
				allMessages.push({
					from: msg.from,
					to: msg.to === "broadcast" ? "broadcast" : msg.to,
					content: msg.content,
					timestamp: msg.timestamp,
				});
			} catch {}
		}
	}

	const seen = new Set<string>();
	const unique = allMessages.filter((m) => {
		const key = m.from + m.to + m.timestamp;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	unique.sort((a, b) => a.timestamp - b.timestamp);
	return unique.slice(-limit);
}
