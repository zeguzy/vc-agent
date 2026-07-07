import { basename, join } from "node:path";
import type {
	AgentSession,
	AgentSessionEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ResourceDiagnostic,
	SessionManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { SubagentServices } from "../agents/types.js";
import type { McpManager } from "../mcp/manager.js";
import {
	resolveMemberSessionPath,
	resolveSessionDir,
	validateMemberSessionPath,
	validateSessionId,
} from "../session/storage.js";
import type { SkillManager } from "../skills/manager.js";
import { AGENT_DIR } from "../teams/worker.js";
import { createMemoryTool } from "../tools/memory.js";
import { createMessageTool } from "../tools/message.js";
import { handleCompactionEnd } from "./auto-memory.js";
import { buildCompactionReinject, buildMemberSystemPrompt, buildTaskLayer } from "./context.js";
import { TeamFiles } from "./files.js";
import { logTeamEvent } from "./logger.js";
import { validateName } from "./memory-types.js";
import { generateMessageId, MemberInbox } from "./messages.js";
import type { ResolvedModel, ResolvedTeamConfig } from "./types.js";
import type {
	DeliveryMode,
	MemberIndexStructure,
	MemberMessage,
	MemberName,
	MemberState,
	MemoryType,
	ReadInboxOptions,
	TaskState,
	TeamDirectoryPaths,
	TeamEvent,
	TeamManagerLike,
	TeamMdStructure,
	TopicFileFrontmatter,
} from "./types-v2.js";
import { BROADCAST_RECIPIENT } from "./types-v2.js";

export const LEADER_NAME = "leader";

export const DEFAULT_MEMBER_TOOLS = ["read", "bash", "grep", "find", "memory", "message"];

/**
 * Tools a member must NEVER receive, even if leader explicitly requests them.
 * - subagent: causes recursive member spawning (infinite loop risk)
 * - team:     members cannot manage the team (privilege escalation)
 * - question: members are non-interactive; would block on user input
 */
const NEVER_MEMBER_TOOLS = new Set(["subagent", "team", "question"]);

export function filterMemberTools(requested?: string[]): string[] {
	const source = requested && requested.length > 0 ? requested : DEFAULT_MEMBER_TOOLS;
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of source) {
		if (NEVER_MEMBER_TOOLS.has(t)) continue;
		if (seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	// Always include memory and message — they're the member's coordination channel.
	if (!out.includes("memory")) out.push("memory");
	if (!out.includes("message")) out.push("message");
	return out;
}

export class TeamManager implements TeamManagerLike {
	private readonly config: ResolvedTeamConfig;
	private readonly services: SubagentServices;
	private readonly cwd: string;
	private readonly files: TeamFiles;
	private readonly members = new Map<MemberName, MemberState>();
	private readonly listeners = new Set<(event: TeamEvent) => void>();
	private readonly sessionUnsubs = new Map<MemberName, () => void>();
	private readonly inboxes = new Map<MemberName, MemberInbox>();
	private readonly sendWindow = new Map<MemberName, number[]>();
	private readonly broadcastWindow = new Map<MemberName, number[]>();
	private readonly pairLastExchange = new Map<string, number[]>();
	private readonly inFlightSteer = new Map<MemberName, number>();
	private disposed = false;
	private isRestoring = false;

	constructor(
		config: ResolvedTeamConfig,
		services: SubagentServices,
		cwd: string,
		teamDir: string,
		private readonly selfMemberName?: MemberName,
		/** Fallback model for members without an explicit model (leader session's model). */
		private readonly defaultParentModel?: ResolvedModel,
		private readonly skillManager?: SkillManager,
		private readonly mcpManager?: McpManager,
	) {
		this.config = config;
		this.services = services;
		this.cwd = cwd;
		this.files = new TeamFiles(teamDir);
		this.files.initTeamDir();
		if (!this.selfMemberName) {
			this.inboxes.set(
				LEADER_NAME,
				new MemberInbox(join(teamDir, "leader"), this.config.messageHistoryLimit),
			);
		}
	}

	/** Maximum concurrent steers per recipient before degrading to persist-only. */
	private static readonly MAX_IN_FLIGHT_STEER = 3;
	/** Per-pair exchange cooldown window (ms). */
	private static readonly PAIR_COOLDOWN_MS = 30_000;
	/** Max pair exchanges within the cooldown window. */
	private static readonly PAIR_MAX_EXCHANGES = 2;
	/** Broadcast rate window (ms). */
	private static readonly BROADCAST_WINDOW_MS = 60_000;
	/** Broadcast max sends within the window. */
	private static readonly BROADCAST_MAX_PER_WINDOW = 1;

	get paths(): TeamDirectoryPaths {
		return this.files.paths;
	}

	// ─── Member Lifecycle ──────────────────────────────────

	async createMember(opts: {
		name: MemberName;
		role: string;
		goal: string;
		constraints?: string;
		model?: string;
		services: SubagentServices;
		parentModel?: import("./types.js").ResolvedModel;
		tools?: string[];
		skills?: string[];
		mcps?: string[];
	}): Promise<MemberState> {
		validateName(opts.name, "member name");
		if (opts.name === LEADER_NAME) {
			throw new Error(`member name "${LEADER_NAME}" is reserved for the leader`);
		}
		if (this.members.has(opts.name)) throw new Error(`member "${opts.name}" already exists`);
		if (this.members.size >= this.config.maxWorkers) {
			throw new Error(`team capacity exhausted: maxWorkers=${this.config.maxWorkers} reached`);
		}

		const constraints = sanitizeConstraints(opts.constraints);
		const assignedTools = filterMemberTools(opts.tools);
		const assignedSkills = (opts.skills ?? []).filter((s) => Boolean(s.trim()));
		const assignedMcps = this.resolveMcps(opts.mcps);

		this.files.initMemberDir(opts.name, opts.role, opts.goal, opts.model, constraints);
		const existingIndex = this.files.readMemberIndex(opts.name);
		if (existingIndex) {
			existingIndex.assignedTools = assignedTools;
			existingIndex.assignedSkills = assignedSkills;
			existingIndex.assignedMcps = assignedMcps;
			this.files.writeMemberIndex(opts.name, existingIndex);
		}

		const memberIndex = this.files.readMemberIndex(opts.name);
		const teamMd = this.files.readTeamMd();

		const systemPrompts = buildMemberSystemPrompt({
			name: opts.name,
			role: opts.role,
			goal: opts.goal,
			constraints,
			memberIndex,
			teamMd,
			selfName: opts.name,
			assignedTools,
			assignedSkills,
			assignedMcps,
		});

		const resourceLoader = this.buildMemberLoader(systemPrompts, assignedSkills);
		const memberCustomTools = this.buildMemberCustomTools(opts.name, assignedMcps);

		const resolvedModel = opts.parentModel ?? this.defaultParentModel;
		const sessionDir = resolveSessionDir();
		const sessionManager = await SessionManager.create(this.cwd, sessionDir);
		const { session } = await createAgentSession({
			cwd: this.cwd,
			agentDir: AGENT_DIR,
			authStorage: this.services.authStorage,
			modelRegistry: this.services.modelRegistry,
			model: resolvedModel,
			settingsManager: this.services.settingsManager,
			tools: assignedTools,
			customTools: memberCustomTools,
			resourceLoader,
			sessionManager,
		});

		const sessionId = session.sessionFile
			? basename(session.sessionFile).replace(/\.jsonl$/, "")
			: undefined;

		const state: MemberState = {
			name: opts.name,
			role: opts.role,
			goal: opts.goal,
			model: opts.model,
			status: "active",
			session,
			sessionId,
			currentTaskId: null,
			lastTaskPrompt: null,
			assignedTools,
			assignedSkills,
			assignedMcps,
		};
		this.members.set(opts.name, state);
		this.inboxes.set(
			opts.name,
			new MemberInbox(this.files.paths.memberTopics(opts.name), this.config.messageHistoryLimit),
		);

		// Subscribe to session events
		const unsub = session.subscribe((event) => this.handleMemberEvent(opts.name, event));
		this.sessionUnsubs.set(opts.name, unsub);

		// Update TEAM.md
		teamMd.members.push({
			name: opts.name,
			role: opts.role,
			status: "active",
			currentTask: "—",
			...(sessionId ? { sessionId } : {}),
		});
		this.files.writeTeamMd(teamMd);

		const initMessage = buildMemberInitMessage(opts.role);
		void session.prompt(initMessage);

		this.emit({ type: "member_created", memberName: opts.name });
		logTeamEvent("member_created", { memberName: opts.name, role: opts.role });

		return state;
	}

	async restoreMembers(opts: {
		services: SubagentServices;
		parentModel?: ResolvedModel;
	}): Promise<void> {
		if (this.isRestoring) return;
		this.isRestoring = true;
		try {
			const teamMd = this.files.readTeamMd();
			if (teamMd.members.length === 0) return;

			const { activeTasks } = teamMd;
			const restoredNames: MemberName[] = [];

			for (const memberRow of teamMd.members) {
				try {
					const memberIndex = this.files.readMemberIndex(memberRow.name);
					const assignedTools = filterMemberTools(memberIndex?.assignedTools);
					const assignedSkills = memberIndex?.assignedSkills ?? [];
					const assignedMcps = this.resolveMcps(memberIndex?.assignedMcps);
					const systemPrompts = buildMemberSystemPrompt({
						name: memberRow.name,
						role: memberRow.role,
						goal: memberIndex?.profile.goal ?? "",
						constraints: memberIndex?.constraints,
						memberIndex,
						teamMd,
						selfName: memberRow.name,
						assignedTools,
						assignedSkills,
						assignedMcps,
					});

					// Resolve SessionManager — open existing or create new
					const sessionDir = resolveSessionDir();
					let sessionManager: SessionManager;

					if (memberRow.sessionId) {
						const resolvedPath = resolveMemberSessionPath(memberRow.sessionId);
						const idValid = validateSessionId(memberRow.sessionId);
						const pathValid = validateMemberSessionPath(resolvedPath);
						if (idValid && pathValid) {
							try {
								sessionManager = SessionManager.open(resolvedPath, sessionDir);
							} catch {
								sessionManager = await SessionManager.create(this.cwd, sessionDir);
							}
						} else {
							sessionManager = await SessionManager.create(this.cwd, sessionDir);
						}
					} else {
						sessionManager = await SessionManager.create(this.cwd, sessionDir);
					}

					const resourceLoader = this.buildMemberLoader(systemPrompts, assignedSkills);
					const memberCustomTools = this.buildMemberCustomTools(memberRow.name, assignedMcps);

					const resolvedModel = opts.parentModel ?? this.defaultParentModel;
					const { session } = await createAgentSession({
						cwd: this.cwd,
						agentDir: AGENT_DIR,
						authStorage: opts.services.authStorage,
						modelRegistry: opts.services.modelRegistry,
						model: resolvedModel,
						settingsManager: opts.services.settingsManager,
						tools: assignedTools,
						customTools: memberCustomTools,
						resourceLoader,
						sessionManager,
					});

					const sessionId = session.sessionFile
						? basename(session.sessionFile).replace(/\.jsonl$/, "")
						: undefined;

					const activeTask = activeTasks.find((t) => t.memberName === memberRow.name && !t.done);
					const currentTaskId = activeTask?.id ?? null;

					const state: MemberState = {
						name: memberRow.name,
						role: memberRow.role,
						goal: memberIndex?.profile.goal ?? "",
						model: memberIndex?.profile.model,
						status: "idle",
						session,
						sessionId,
						currentTaskId,
						lastTaskPrompt: null,
						assignedTools,
						assignedSkills,
						assignedMcps,
					};
					this.members.set(memberRow.name, state);
					this.inboxes.set(
						memberRow.name,
						new MemberInbox(
							this.files.paths.memberTopics(memberRow.name),
							this.config.messageHistoryLimit,
						),
					);

					// Subscribe to session events
					const unsub = session.subscribe((event) => this.handleMemberEvent(memberRow.name, event));
					this.sessionUnsubs.set(memberRow.name, unsub);

					restoredNames.push(memberRow.name);
				} catch (err) {
					console.warn(`[team] failed to restore member "${memberRow.name}": ${err}`);
				}
			}

			// Update TEAM.md — all restored members get status=idle
			if (restoredNames.length > 0) {
				const updatedMd = this.files.readTeamMd();
				for (const member of updatedMd.members) {
					if (restoredNames.includes(member.name)) {
						member.status = "idle";
					}
				}
				this.files.writeTeamMd(updatedMd);

				this.emit({ type: "members_restored", memberNames: restoredNames });
				logTeamEvent("members_restored", { memberNames: restoredNames });
			}
		} finally {
			this.isRestoring = false;
		}
	}

	async removeMember(name: MemberName): Promise<void> {
		const state = this.members.get(name);
		if (!state) throw new Error(`member "${name}" not found`);

		// Unsubscribe + dispose session
		const unsub = this.sessionUnsubs.get(name);
		unsub?.();
		this.sessionUnsubs.delete(name);
		state.session.dispose();

		// Archive files
		this.files.archiveMember(name);

		// Update TEAM.md
		const teamMd = this.files.readTeamMd();
		teamMd.members = teamMd.members.filter((m) => m.name !== name);
		this.files.writeTeamMd(teamMd);

		this.members.delete(name);
		this.inboxes.delete(name);
		this.sendWindow.delete(name);
		this.broadcastWindow.delete(name);
		this.inFlightSteer.delete(name);
		this.emit({ type: "member_removed", memberName: name });
		logTeamEvent("member_removed", { memberName: name });
	}

	getMember(name: MemberName): MemberState | undefined {
		return this.members.get(name);
	}

	listMembers(): MemberState[] {
		return [...this.members.values()];
	}

	getMaxWorkers(): number {
		return this.config.maxWorkers;
	}

	// ─── Task Management ───────────────────────────────────

	assignTask(opts: {
		title: string;
		description: string;
		memberName: MemberName;
		priority?: "high" | "medium" | "low";
	}): TaskState {
		const state = this.members.get(opts.memberName);
		if (!state) throw new Error(`member "${opts.memberName}" not found`);
		if (state.status !== "active" && state.status !== "idle") {
			throw new Error(`member "${opts.memberName}" is ${state.status}, cannot assign task`);
		}

		const teamMd = this.files.readTeamMd();
		const taskId = `T${teamMd.activeTasks.length + 1}`;
		const task: TaskState = {
			id: taskId,
			title: opts.title,
			description: opts.description,
			memberName: opts.memberName,
			priority: opts.priority ?? "medium",
			done: false,
		};

		// Update TEAM.md
		teamMd.activeTasks.push(task);
		// Update member's current task in members table
		const memberRow = teamMd.members.find((m) => m.name === opts.memberName);
		if (memberRow) memberRow.currentTask = opts.title;
		this.files.writeTeamMd(teamMd);

		// Update member .md
		const memberIndex = this.files.readMemberIndex(opts.memberName);
		if (memberIndex) {
			memberIndex.activeContext = `${opts.title}\n${opts.description}`;
			this.files.writeMemberIndex(opts.memberName, memberIndex);
		}

		// Inject L4 via steer/prompt
		const taskPrompt = buildTaskLayer(task);
		if (state.session.isStreaming) {
			state.session.steer(taskPrompt);
		} else {
			void state.session.prompt(taskPrompt);
		}

		state.currentTaskId = taskId;
		state.status = "active";
		state.lastTaskPrompt = taskPrompt;

		this.emit({ type: "task_assigned", taskId, memberName: opts.memberName });
		logTeamEvent("task_assigned", { taskId, memberName: opts.memberName, title: opts.title });

		return task;
	}

	completeTask(taskId: string): void {
		const teamMd = this.files.readTeamMd();
		const task = teamMd.activeTasks.find((t) => t.id === taskId);
		if (!task) return;

		task.done = true;
		// Update member row
		if (task.memberName) {
			const memberRow = teamMd.members.find((m) => m.name === task.memberName);
			if (memberRow) memberRow.currentTask = "—";
		}
		this.files.writeTeamMd(teamMd);

		// Update member state
		if (task.memberName) {
			const state = this.members.get(task.memberName);
			if (state) {
				state.currentTaskId = null;
				state.status = "idle";
			}
		}

		this.emit({ type: "task_completed", taskId, memberName: task.memberName ?? "" });
	}

	listTasks(): TaskState[] {
		return this.files.readTeamMd().activeTasks;
	}

	// ─── Member Lifecycle Control ──────────────────────────

	pauseMember(name: MemberName): void {
		const state = this.members.get(name);
		if (!state) throw new Error(`member "${name}" not found`);
		if (state.status !== "active") return;

		state.session.abort();
		state.status = "paused";

		const teamMd = this.files.readTeamMd();
		const memberRow = teamMd.members.find((m) => m.name === name);
		if (memberRow) memberRow.status = "paused";
		this.files.writeTeamMd(teamMd);

		this.emit({ type: "member_paused", memberName: name });
		logTeamEvent("member_paused", { memberName: name });
	}

	resumeMember(name: MemberName): void {
		const state = this.members.get(name);
		if (state?.status !== "paused") return;

		const memberIndex = this.files.readMemberIndex(name);
		if (!memberIndex) return;
		const teamMd = this.files.readTeamMd();
		const reinject = buildCompactionReinject({
			memberIndex,
			teamMd,
			selfName: name,
		});

		const taskPrompt = state.lastTaskPrompt
			? `[Resuming after pause]\nPrevious task: ${state.lastTaskPrompt}\n\n${reinject}`
			: reinject;

		state.status = "active";
		void state.session.prompt(taskPrompt);

		const memberRow = teamMd.members.find((m) => m.name === name);
		if (memberRow) memberRow.status = "active";
		this.files.writeTeamMd(teamMd);

		this.emit({ type: "member_resumed", memberName: name });
		logTeamEvent("member_resumed", { memberName: name });
	}

	cancelMember(name: MemberName): void {
		const state = this.members.get(name);
		if (!state) throw new Error(`member "${name}" not found`);
		if (state.status !== "active" && state.status !== "paused") return;

		state.session.abort();
		state.session.dispose();
		state.status = "cancelled";

		const unsub = this.sessionUnsubs.get(name);
		unsub?.();
		this.sessionUnsubs.delete(name);
		this.members.delete(name);

		const teamMd = this.files.readTeamMd();
		teamMd.members = teamMd.members.filter((m) => m.name !== name);
		this.files.writeTeamMd(teamMd);

		this.emit({ type: "member_cancelled", memberName: name });
		logTeamEvent("member_cancelled", { memberName: name });
	}

	directMember(
		name: MemberName,
		kind: "directive" | "context" | "redirect",
		payload: string,
	): void {
		const state = this.members.get(name);
		if (!state) throw new Error(`member "${name}" not found`);
		if (state.status !== "active")
			throw new Error(`member "${name}" is ${state.status}, cannot receive directives`);

		const prefix =
			kind === "directive"
				? "[Leader Directive]"
				: kind === "context"
					? "[Leader Context]"
					: "[Leader Redirect]";
		const message = `${prefix} ${payload}`;

		if (state.session.isStreaming) {
			state.session.steer(message);
		} else {
			void state.session.prompt(message);
		}

		logTeamEvent("member_direct", { memberName: name, kind, payload: payload.slice(0, 80) });
	}

	// ─── Member-to-Member Messaging ────────────────────────

	sendMessage(opts: { from: MemberName; to: MemberName; content: string }): {
		message: MemberMessage;
		delivery: DeliveryMode;
	} {
		const { from, to, content } = opts;
		if (!content.trim()) throw new Error("content is required");
		if (from === to) throw new Error("cannot send a message to yourself");
		const recipient = this.members.get(to);
		if (!recipient) throw new Error(`recipient "${to}" not found`);

		this.assertSendRateLimit(from);
		this.assertPairCooldown(from, to);

		const message: MemberMessage = {
			id: generateMessageId(),
			from,
			to,
			content,
			timestamp: Date.now(),
			read: false,
		};

		const delivery = this.deliver(recipient, message);
		this.recordPairExchange(from, to);

		this.emit({
			type: "member_message_sent",
			from,
			to,
			messageId: message.id,
			delivery,
		});
		logTeamEvent("member_message_sent", {
			from,
			to,
			messageId: message.id,
			delivery,
			contentLen: content.length,
		});

		return { message, delivery };
	}

	broadcastMessage(opts: {
		from: MemberName;
		content: string;
	}): Array<{ message: MemberMessage; delivery: DeliveryMode }> {
		const { from, content } = opts;
		if (!content.trim()) throw new Error("content is required");
		this.assertBroadcastRateLimit(from);

		// Snapshot to survive concurrent removeMember
		const recipients = this.listMembers().filter((m) => m.name !== from);

		const results: Array<{ message: MemberMessage; delivery: DeliveryMode }> = [];
		for (const recipient of recipients) {
			try {
				const message: MemberMessage = {
					id: generateMessageId(),
					from,
					to: BROADCAST_RECIPIENT,
					content,
					timestamp: Date.now(),
					read: false,
				};
				const delivery = this.deliver(recipient, message);
				results.push({ message, delivery });
				this.emit({
					type: "member_message_sent",
					from,
					to: BROADCAST_RECIPIENT,
					messageId: message.id,
					delivery,
				});
				logTeamEvent("member_message_sent", {
					from,
					to: BROADCAST_RECIPIENT,
					recipient: recipient.name,
					messageId: message.id,
					delivery,
					contentLen: content.length,
				});
			} catch (err) {
				logTeamEvent("member_message_broadcast_skip", {
					from,
					recipient: recipient.name,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		return results;
	}

	readInbox(name: MemberName, opts?: ReadInboxOptions): MemberMessage[] {
		const inbox = this.inboxes.get(name);
		if (!inbox) throw new Error(`inbox for "${name}" not found`);
		const messages = inbox.read(opts);
		return messages;
	}

	markInboxRead(name: MemberName, ids?: string[]): number {
		const inbox = this.inboxes.get(name);
		if (!inbox) throw new Error(`inbox for "${name}" not found`);
		const count = inbox.markRead(ids);
		if (count > 0) {
			this.emit({ type: "member_message_read", by: name, count });
			logTeamEvent("member_message_read", { by: name, count });
		}
		return count;
	}

	/** Deliver to recipient: persist + (if active and below steer cap) steer into session. */
	private deliver(recipient: MemberState, message: MemberMessage): DeliveryMode {
		const inbox = this.inboxes.get(recipient.name);
		if (!inbox) throw new Error(`inbox for "${recipient.name}" not found`);
		inbox.append(message);

		// cancelled members cannot receive; persist-only for idle/paused/error;
		// active members get steer if below the in-flight cap.
		if (recipient.status === "cancelled") {
			throw new Error(`recipient "${recipient.name}" is cancelled`);
		}
		if (recipient.status !== "active") {
			logTeamEvent("member_message_delivered", {
				to: recipient.name,
				messageId: message.id,
				deliveredVia: "persist-only",
				reason: `status=${recipient.status}`,
			});
			return "persist-only";
		}

		const inFlight = this.inFlightSteer.get(recipient.name) ?? 0;
		if (inFlight >= TeamManager.MAX_IN_FLIGHT_STEER) {
			logTeamEvent("member_message_delivered", {
				to: recipient.name,
				messageId: message.id,
				deliveredVia: "persist-only",
				reason: "steer-cap",
			});
			return "persist-only";
		}

		this.inFlightSteer.set(recipient.name, inFlight + 1);
		const prefix = message.from === "leader" ? "Leader" : `@${message.from}`;
		const note = `[Message from ${prefix}] ${message.content}`;
		const session = recipient.session;
		const decrement = () => {
			const current = this.inFlightSteer.get(recipient.name) ?? 0;
			this.inFlightSteer.set(recipient.name, Math.max(0, current - 1));
		};

		try {
			if (session.isStreaming) {
				const promise = session.steer(note) as unknown as Promise<void> | void;
				if (promise && typeof (promise as Promise<void>).then === "function") {
					(promise as Promise<void>).then(decrement, decrement);
				} else {
					decrement();
				}
			} else {
				const promise = session.prompt(note) as unknown as Promise<void> | void;
				if (promise && typeof (promise as Promise<void>).then === "function") {
					(promise as Promise<void>).then(decrement, decrement);
				} else {
					decrement();
				}
			}
		} catch (err) {
			decrement();
			logTeamEvent("member_message_delivered", {
				to: recipient.name,
				messageId: message.id,
				deliveredVia: "persist-only",
				reason: `steer-error: ${err instanceof Error ? err.message : String(err)}`,
			});
			return "persist-only";
		}

		logTeamEvent("member_message_delivered", {
			to: recipient.name,
			messageId: message.id,
			deliveredVia: "steer",
		});
		return "steer";
	}

	private resolveMcps(requested?: string[]): string[] {
		if (!requested || requested.length === 0) return [];
		if (!this.mcpManager) {
			console.warn(
				`[teams] member requested MCPs ${requested.join(",")} but no McpManager is wired up; ignoring`,
			);
			return [];
		}
		const available = new Set(this.mcpManager.listServerNames());
		const resolved: string[] = [];
		for (const name of requested) {
			if (!name.trim()) continue;
			if (available.has(name)) {
				resolved.push(name);
			} else {
				console.warn(`[teams] MCP server "${name}" not connected; skipping assignment`);
			}
		}
		return resolved;
	}

	private buildMemberLoader(
		systemPrompts: string[],
		assignedSkills: string[],
	): DefaultResourceLoader {
		const wantsSkills = assignedSkills.length > 0 && this.skillManager;
		const skillSet = new Set(assignedSkills);
		return new DefaultResourceLoader({
			cwd: this.cwd,
			agentDir: AGENT_DIR,
			settingsManager: this.services.settingsManager,
			appendSystemPrompt: systemPrompts,
			noExtensions: true,
			noSkills: !wantsSkills,
			noContextFiles: true,
			...(wantsSkills
				? {
						skillsOverride: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => ({
							...base,
							skills: base.skills.filter((s) => skillSet.has(s.name)),
						}),
					}
				: {}),
		});
	}

	private buildMemberCustomTools(memberName: MemberName, assignedMcps: string[]): ToolDefinition[] {
		const tools: ToolDefinition[] = [
			createMemoryTool({ teamRef: { current: this }, selfName: memberName }),
			createMessageTool({ teamRef: { current: this }, selfName: memberName }),
		];
		if (assignedMcps.length > 0 && this.mcpManager) {
			const memberMcp = this.mcpManager.getAuthorizedToolDefinition(assignedMcps);
			if (memberMcp) tools.push(memberMcp);
		}
		return tools;
	}

	private assertSendRateLimit(from: MemberName): void {
		const now = Date.now();
		const window = (this.sendWindow.get(from) ?? []).filter(
			(ts) => now - ts < TeamManager.BROADCAST_WINDOW_MS,
		);
		if (window.length >= this.config.messageRateLimitPerMinute) {
			throw new Error(
				`rate limit: ${from} already sent ${window.length} messages in the last minute`,
			);
		}
		window.push(now);
		this.sendWindow.set(from, window);
	}

	private assertBroadcastRateLimit(from: MemberName): void {
		const now = Date.now();
		const window = (this.broadcastWindow.get(from) ?? []).filter(
			(ts) => now - ts < TeamManager.BROADCAST_WINDOW_MS,
		);
		if (window.length >= TeamManager.BROADCAST_MAX_PER_WINDOW) {
			throw new Error(`broadcast rate limit: ${from} already broadcast in the last minute`);
		}
		window.push(now);
		this.broadcastWindow.set(from, window);
	}

	private assertPairCooldown(a: MemberName, b: MemberName): void {
		const key = pairKey(a, b);
		const now = Date.now();
		const window = (this.pairLastExchange.get(key) ?? []).filter(
			(ts) => now - ts < TeamManager.PAIR_COOLDOWN_MS,
		);
		if (window.length >= TeamManager.PAIR_MAX_EXCHANGES) {
			throw new Error(
				`pair cooldown: wait ~${Math.round((TeamManager.PAIR_COOLDOWN_MS - (now - window[0])) / 1000)}s before messaging @${b} again`,
			);
		}
	}

	private recordPairExchange(a: MemberName, b: MemberName): void {
		const key = pairKey(a, b);
		const now = Date.now();
		const window = (this.pairLastExchange.get(key) ?? []).filter(
			(ts) => now - ts < TeamManager.PAIR_COOLDOWN_MS,
		);
		window.push(now);
		this.pairLastExchange.set(key, window);
	}

	// ─── Memory Operations ─────────────────────────────────

	writeMemory(opts: {
		memberName: MemberName;
		type: MemoryType;
		topic: string;
		content: string;
		shared?: boolean;
	}): void {
		validateName(opts.memberName, "member name");
		validateName(opts.topic, "topic name");

		if (opts.shared && (opts.type === "project" || opts.type === "reference")) {
			// Write to shared/ directory
			const existing = this.files.readSharedTopic(opts.topic);
			this.files
				.writeSharedTopic(opts.topic, opts.type, opts.content, existing ?? undefined)
				.catch((err) => {
					console.error(`[team] failed to write shared topic: ${err}`);
				});

			// Update TEAM.md shared memory index
			const teamMd = this.files.readTeamMd();
			const alreadyListed = teamMd.sharedMemoryIndex.some(
				(s) => s.path === `shared/${opts.topic}.md`,
			);
			if (!alreadyListed) {
				teamMd.sharedMemoryIndex.push({
					path: `shared/${opts.topic}.md`,
					description: `${opts.type}: ${opts.topic}`,
				});
				this.files.writeTeamMd(teamMd);
			}
		} else {
			// Write to member's own directory
			const existing = this.files.readTopicFile(opts.memberName, opts.topic);
			this.files.writeTopicFile(
				opts.memberName,
				opts.topic,
				opts.type,
				opts.content,
				existing ?? undefined,
			);

			// Update member .md memory index
			const memberIndex = this.files.readMemberIndex(opts.memberName);
			if (memberIndex) {
				const alreadyListed = memberIndex.memoryIndex.some((m) => m.file === `${opts.topic}.md`);
				if (!alreadyListed) {
					memberIndex.memoryIndex.push({
						file: `${opts.topic}.md`,
						type: opts.type,
						description: `${opts.type}: ${opts.topic}`,
					});
					this.files.writeMemberIndex(opts.memberName, memberIndex);
				}
			}
		}

		this.emit({
			type: "memory_written",
			memberName: opts.memberName,
			topic: opts.topic,
			memoryType: opts.type,
		});
	}

	readMemberIndex(name: MemberName): MemberIndexStructure | null {
		return this.files.readMemberIndex(name);
	}

	readTopicFile(
		name: MemberName,
		topic: string,
	): (TopicFileFrontmatter & { content: string }) | null {
		return this.files.readTopicFile(name, topic);
	}

	readTeamMd(): TeamMdStructure {
		return this.files.readTeamMd();
	}

	// ─── Identity ──────────────────────────────────────────

	isSelfMember(name: MemberName): boolean {
		return name === this.selfMemberName;
	}

	getSelfMemberName(): MemberName | undefined {
		return this.selfMemberName;
	}

	// ─── Lifecycle ─────────────────────────────────────────

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;

		for (const [name, unsub] of this.sessionUnsubs) {
			unsub();
			const state = this.members.get(name);
			state?.session.dispose();
		}
		this.sessionUnsubs.clear();
		this.members.clear();
		this.inboxes.clear();
		this.sendWindow.clear();
		this.broadcastWindow.clear();
		this.pairLastExchange.clear();
		this.inFlightSteer.clear();
		// Note: .openagent/team/ directory is preserved (memory files are persistent)
	}

	subscribe(listener: (event: TeamEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	// ─── Internal ──────────────────────────────────────────

	private emit(event: TeamEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (err) {
				console.error(`[team] event listener threw: ${err}`);
			}
		}
	}

	private handleMemberEvent(memberName: MemberName, event: AgentSessionEvent): void {
		const state = this.members.get(memberName);
		if (!state) return;

		if (event.type === "agent_end") {
			// Member completed a turn
			const summary = extractLastAssistantText(state.session);
			const cost = 0; // TODO: extract from session usage

			// Complete current task if any
			if (state.currentTaskId) {
				this.completeTask(state.currentTaskId);
			}

			state.status = "idle";
			this.emit({ type: "member_done", memberName, summary: summary ?? "(no output)", cost });
			logTeamEvent("member_done", { memberName, status: "idle" });
		}

		if (event.type === "compaction_end") {
			// Auto-memory: parse compaction summary, write to topic files
			const summary = extractLastAssistantText(state.session) ?? "";
			const updatedIndex = handleCompactionEnd({
				files: this.files,
				memberName,
				compactionSummary: summary,
			});

			// Re-inject L2 + L3 after compaction
			const teamMd = this.files.readTeamMd();
			const reinject = buildCompactionReinject({
				memberIndex: updatedIndex,
				teamMd,
				selfName: memberName,
			});
			state.session.steer(reinject);

			logTeamEvent("member_compaction", { memberName });
		}
	}
}

// ─── Helpers ─────────────────────────────────────────────────

/** ~200 tokens; keeps L1 ≤ ~800 tokens total (design decision 7). */
const CONSTRAINTS_MAX_LEN = 800;

// Strip `## ` lines (would corrupt splitSections of `## Constraints` index
// section) and cap length. Truncate, never reject — leader can edit-member.
function sanitizeConstraints(raw?: string): string | undefined {
	if (!raw) return undefined;
	const stripped = raw
		.split("\n")
		.filter((line) => !line.startsWith("## "))
		.join("\n")
		.trim();
	if (!stripped) return undefined;
	return stripped.length > CONSTRAINTS_MAX_LEN ? stripped.slice(0, CONSTRAINTS_MAX_LEN) : stripped;
}

function buildMemberInitMessage(role: string): string {
	return [
		"[Initialization] You've just been created on this team.",
		`Your role is "${role}". Your goal, constraints, and team context are above.`,
		"",
		"You are now active and ready to receive work. Do not start any task on your own — wait for the leader to assign a task or for a teammate to message you.",
		"",
		"While waiting, you may:",
		'- Read your own memory index with `memory(action="read")` to see what you\'ve learned before.',
		'- Read your inbox with `message(action="read")` to see any messages from teammates.',
		"",
		"Respond minimally now (a short acknowledgment is enough). Save your effort for the actual task.",
	].join("\n");
}

function pairKey(a: MemberName, b: MemberName): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function extractLastAssistantText(session: AgentSession): string | null {
	// Get the last assistant message text from session messages
	const messages = session.messages;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const textParts: string[] = [];
			for (const part of msg.content) {
				if (part.type === "text" && part.text) {
					textParts.push(part.text);
				}
			}
			return textParts.join("\n") || null;
		}
	}
	return null;
}
