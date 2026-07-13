import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createAgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { resolveModel } from "../agent/session.js";
import type { SubagentServices } from "../agents/types.js";
import { extractAssistantText } from "../utils/content.js";
import type { ResolvedModel } from "./types.js";
import type { MemberName, TaskState } from "./types-v2.js";

const AGENT_DIR = join(homedir(), ".config", "openagent");

// ─── Legacy Coordinator Types (kept for backward compat) ────

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

// ─── Discussion Supervisor Types ───────────────────────────

export interface AgendaItem {
	id: string;
	title: string;
	description: string;
	status: "pending" | "in_progress" | "covered" | "skipped";
}

export interface DiscussionPlan {
	topic: string;
	agenda: AgendaItem[];
	scope: string;
	offTopicSignals: string;
}

export interface SupervisorContinue {
	action: "continue";
	nextSpeaker: MemberName;
	instruction: string;
	reason: string;
	agendaUpdates?: Partial<AgendaItem>[];
}

export interface SupervisorRedirect {
	action: "redirect";
	nextSpeaker: MemberName;
	instruction: string;
	reason: string;
	targetAgendaId: string;
	agendaUpdates?: Partial<AgendaItem>[];
}

export interface SupervisorSummarize {
	action: "summarize";
	nextSpeaker: MemberName;
	instruction: string;
	reason: string;
	targetAgendaId: string;
	agendaUpdates?: Partial<AgendaItem>[];
}

export interface SupervisorComplete {
	action: "complete";
	reason: string;
	conclusion: string;
	agendaUpdates?: Partial<AgendaItem>[];
}

export type SupervisorDecision =
	| SupervisorContinue
	| SupervisorRedirect
	| SupervisorSummarize
	| SupervisorComplete;

// ─── Build Legacy Coordinator Prompt ──────────────────────

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

// ─── Build Supervisor Prompt ───────────────────────────────

export function buildSupervisorPrompt(opts: {
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
	plan: DiscussionPlan;
}): string {
	const { task, members, recentMessages, round, maxRounds, plan } = opts;
	const lines: string[] = [];

	lines.push(
		"You are a discussion supervisor. Your job is to keep the discussion ON TOPIC and ensure all agenda items are covered.",
	);
	lines.push("");
	lines.push("## Discussion Plan");
	lines.push(`Topic: ${plan.topic}`);
	lines.push(`Scope: ${plan.scope}`);
	lines.push("");
	lines.push("### Agenda");
	for (const item of plan.agenda) {
		const statusIcon =
			item.status === "covered"
				? "✓"
				: item.status === "in_progress"
					? "→"
					: item.status === "skipped"
						? "⊘"
						: "○";
		lines.push(`- [${statusIcon}] ${item.id}: ${item.title} — ${item.status}`);
		if (item.description) lines.push(`  ${item.description}`);
	}
	lines.push("");

	if (plan.offTopicSignals) {
		lines.push("### Off-Topic Signals");
		lines.push(plan.offTopicSignals);
		lines.push("");
	}

	lines.push("## Current Task");
	lines.push(`Title: ${task.title}`);
	lines.push(`Description: ${task.description}`);
	lines.push("");
	lines.push("## Team Members");
	for (const m of members) {
		const taskInfo = m.currentTaskId ? ` (working on ${m.currentTaskId})` : "";
		lines.push(`- ${m.name} (${m.role}) — ${m.status}${taskInfo}`);
	}
	lines.push("");
	lines.push("## Discussion Progress");
	lines.push(`Round: ${round} / ${maxRounds}`);
	lines.push("");

	if (recentMessages.length > 0) {
		lines.push("### Recent Messages (newest last)");
		for (const msg of recentMessages.slice(-20)) {
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
		"1. **continue**: Discussion needs more rounds. Specify who should speak next and what they should address.",
	);
	lines.push(
		"2. **redirect**: Discussion has drifted off-topic. Force the next speaker back to a specific agenda item.",
	);
	lines.push(
		"3. **summarize**: Ask someone to synthesize what's been covered on a specific agenda item.",
	);
	lines.push(
		"4. **complete**: All agenda items covered, or max rounds reached, or clear consensus achieved.",
	);
	lines.push("");
	lines.push("Respond with ONLY a JSON object:");
	lines.push("```json");
	lines.push(
		'{ "action": "continue", "nextSpeaker": "<name>", "instruction": "<what to discuss>", "reason": "<why>", "agendaUpdates": [{ "id": "<id>", "status": "in_progress" }] }',
	);
	lines.push("```");
	lines.push("```json");
	lines.push(
		'{ "action": "redirect", "nextSpeaker": "<name>", "instruction": "<return to topic>", "reason": "<why off-topic>", "targetAgendaId": "<id>", "agendaUpdates": [{ "id": "<id>", "status": "in_progress" }] }',
	);
	lines.push("```");
	lines.push("```json");
	lines.push(
		'{ "action": "summarize", "nextSpeaker": "<name>", "instruction": "<summarize agenda item>", "reason": "<why>", "targetAgendaId": "<id>", "agendaUpdates": [] }',
	);
	lines.push("```");
	lines.push("```json");
	lines.push(
		'{ "action": "complete", "reason": "<why done>", "conclusion": "<3-5 sentence summary of the discussion outcome and key decisions>", "agendaUpdates": [] }',
	);
	lines.push("```");
	lines.push("");
	lines.push("Guidelines:");
	lines.push(
		"- Check if recent messages are within scope. If they drift outside the scope, issue a **redirect**.",
	);
	lines.push(
		"- If only some members have spoken, continue and pick someone who hasn't contributed yet.",
	);
	lines.push(
		"- If an agenda item has been discussed enough, update its status to 'covered' via agendaUpdates.",
	);
	lines.push(
		"- If viewpoints are still being exchanged without synthesis, use **summarize** to ask someone to synthesize.",
	);
	lines.push(
		"- If all agenda items are 'covered' or 'skipped', or there's clear consensus, **complete**.",
		"- When you choose **complete**, you MUST provide a `conclusion`: a 3-5 sentence summary of the discussion outcome, key decisions, and any unresolved points. This conclusion is sent directly to the team leader.",
	);
	lines.push(
		"- Never let the discussion exceed the max rounds. If round >= maxRounds - 1, strongly prefer complete.",
	);
	lines.push(
		"- Pick the next speaker strategically: who has the most relevant perspective that hasn't been heard yet?",
	);

	return lines.join("\n");
}

// ─── Parse Legacy Coordinator Output ──────────────────────

export function parseCoordinatorDecision(raw: string): CoordinatorDecision {
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

// ─── Parse Supervisor Output ───────────────────────────────

export function parseSupervisorDecision(raw: string): SupervisorDecision {
	const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return {
			action: "complete",
			reason: "supervisor output could not be parsed",
			conclusion: "(supervisor output could not be parsed)",
		};
	}

	const jsonStr = jsonMatch[1] ?? jsonMatch[0];
	try {
		const parsed = JSON.parse(jsonStr.trim());
		const agendaUpdates = Array.isArray(parsed.agendaUpdates) ? parsed.agendaUpdates : undefined;

		if (parsed.action === "continue" && parsed.nextSpeaker && parsed.instruction) {
			return {
				action: "continue",
				nextSpeaker: parsed.nextSpeaker,
				instruction: parsed.instruction,
				reason: parsed.reason ?? "",
				agendaUpdates,
			};
		}
		if (
			parsed.action === "redirect" &&
			parsed.nextSpeaker &&
			parsed.instruction &&
			parsed.targetAgendaId
		) {
			return {
				action: "redirect",
				nextSpeaker: parsed.nextSpeaker,
				instruction: parsed.instruction,
				reason: parsed.reason ?? "",
				targetAgendaId: parsed.targetAgendaId,
				agendaUpdates,
			};
		}
		if (
			parsed.action === "summarize" &&
			parsed.nextSpeaker &&
			parsed.instruction &&
			parsed.targetAgendaId
		) {
			return {
				action: "summarize",
				nextSpeaker: parsed.nextSpeaker,
				instruction: parsed.instruction,
				reason: parsed.reason ?? "",
				targetAgendaId: parsed.targetAgendaId,
				agendaUpdates,
			};
		}
		if (parsed.action === "complete") {
			return {
				action: "complete",
				reason: parsed.reason ?? "discussion complete",
				conclusion: parsed.conclusion ?? `(no conclusion provided; reason: ${parsed.reason ?? "unknown"})`,
				agendaUpdates,
			};
		}
		return {
			action: "complete",
			reason: `unexpected supervisor action: ${parsed.action}`,
			conclusion: `(supervisor returned unexpected action: ${parsed.action})`,
		};
	} catch {
		return { action: "complete", reason: "supervisor JSON parse failed", conclusion: "(supervisor output could not be parsed)" };
	}
}

// ─── Run Legacy Coordinator Agent ─────────────────────────

const COORDINATOR_TIMEOUT_MS = 90_000;

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

	let session: AgentSession | null = null;
	let lastText = "";

	try {
		const created = await createAgentSession({
			cwd,
			agentDir: AGENT_DIR,
			authStorage: services.authStorage,
			modelRegistry: services.modelRegistry,
			model,
			settingsManager: services.settingsManager,
			tools: [],
			resourceLoader,
		});
		session = created.session;

		const unsub = session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "message_end" && event.message.role === "assistant") {
				const text = extractAssistantText(event.message.content);
				if (text) lastText = text;
			}
		});

		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				session.prompt(prompt),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("coordinator prompt timeout")),
						COORDINATOR_TIMEOUT_MS,
					);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
			unsub();
		}
	} catch (err) {
		return {
			action: "complete",
			reason: `coordinator error: ${err instanceof Error ? err.message : String(err)}`,
		};
	} finally {
		session?.dispose();
	}

	return parseCoordinatorDecision(lastText);
}

// ─── DiscussionSupervisor Class ────────────────────────────

const SUPERVISOR_TIMEOUT_MS = 90_000;

export class DiscussionSupervisor {
	private session: AgentSession | null = null;
	private plan: DiscussionPlan;
	private round = 0;
	private initialized = false;
	private readonly maxRounds: number;
	private readonly cwd: string;
	private readonly services: SubagentServices;
	private readonly parentModel: ResolvedModel | undefined;
	private lastText = "";

	constructor(opts: {
		task: TaskState;
		members: Array<{
			name: MemberName;
			role: string;
			status: string;
			currentTaskId: string | null;
		}>;
		maxRounds?: number;
		plan?: DiscussionPlan;
		cwd: string;
		services: SubagentServices;
		parentModel?: ResolvedModel;
	}) {
		this.plan = opts.plan ?? DiscussionSupervisor.generateDefaultPlan(opts.task);
		this.maxRounds = opts.maxRounds ?? 10;
		this.cwd = opts.cwd;
		this.services = opts.services;
		this.parentModel = opts.parentModel;
	}

	async evaluate(opts: {
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
	}): Promise<SupervisorDecision> {
		this.round++;

		const prompt = buildSupervisorPrompt({
			task: opts.task,
			members: opts.members,
			recentMessages: opts.recentMessages,
			round: this.round,
			maxRounds: this.maxRounds,
			plan: this.plan,
		});

		try {
			if (!this.session) {
				await this.createSession();
			}

			const session = this.session;
			if (!session) throw new Error("supervisor session not available");

			this.lastText = "";
			const unsub = session.subscribe((event: AgentSessionEvent) => {
				if (event.type === "message_end" && event.message.role === "assistant") {
					const text = extractAssistantText(event.message.content);
					if (text) this.lastText = text;
				}
			});

			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					session.prompt(prompt),
					new Promise<never>((_, reject) => {
						timer = setTimeout(
							() => reject(new Error("supervisor prompt timeout")),
							SUPERVISOR_TIMEOUT_MS,
						);
					}),
				]);
				this.initialized = true;
			} finally {
				if (timer) clearTimeout(timer);
				unsub();
			}
		} catch (err) {
			return {
				action: "complete",
				reason: `supervisor error: ${err instanceof Error ? err.message : String(err)}`,
				conclusion: `(discussion ended due to supervisor error: ${err instanceof Error ? err.message : String(err)})`,
			};
		}

		const decision = parseSupervisorDecision(this.lastText);
		this.applyAgendaUpdates(decision);
		return decision;
	}

	getPlan(): DiscussionPlan {
		return this.plan;
	}

	getRound(): number {
		return this.round;
	}

	dispose(): void {
		try {
			this.session?.dispose();
		} catch {}
		this.session = null;
	}

	private async createSession(): Promise<void> {
		const resourceLoader = new DefaultResourceLoader({
			cwd: this.cwd,
			agentDir: AGENT_DIR,
			settingsManager: this.services.settingsManager,
			appendSystemPrompt: [
				"You are a discussion supervisor. You evaluate discussion progress, detect off-topic drift, and decide the next step. You respond ONLY with structured JSON decisions. No conversational filler.",
			],
			noExtensions: true,
			noSkills: true,
			noContextFiles: true,
		});

		const model = this.parentModel ?? resolveModel(this.services.modelRegistry);

		const created = await createAgentSession({
			cwd: this.cwd,
			agentDir: AGENT_DIR,
			authStorage: this.services.authStorage,
			modelRegistry: this.services.modelRegistry,
			model,
			settingsManager: this.services.settingsManager,
			tools: [],
			resourceLoader,
		});
		this.session = created.session;
	}

	private applyAgendaUpdates(decision: SupervisorDecision): void {
		const updates =
			"agendaUpdates" in decision
				? (decision as { agendaUpdates?: Partial<AgendaItem>[] }).agendaUpdates
				: undefined;
		if (!updates) return;

		for (const update of updates) {
			if (!update.id) continue;
			const item = this.plan.agenda.find((a) => a.id === update.id);
			if (!item) continue;
			if (update.status !== undefined) item.status = update.status;
			if (update.title !== undefined) item.title = update.title;
			if (update.description !== undefined) item.description = update.description;
		}
	}

	private static generateDefaultPlan(task: TaskState): DiscussionPlan {
		const agenda: AgendaItem[] = [
			{
				id: "A1",
				title: task.title,
				description: task.description,
				status: "pending",
			},
		];

		return {
			topic: task.title,
			agenda,
			scope: task.description || task.title,
			offTopicSignals:
				"Discussing implementation details when only architecture decisions are needed; going deep on one topic while others remain uncovered; repeating points already made without adding new information",
		};
	}
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
