import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createAgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { SubagentServices } from "../agents/types.js";
import { AGENT_DIR } from "../teams/worker.js";
import { createMemberReadTool } from "../tools/member-read.js";
import { createMemoryWriteTool } from "../tools/memory-write.js";
import { createSelfEditTool } from "../tools/self-edit.js";
import { handleCompactionEnd } from "./auto-memory.js";
import { buildCompactionReinject, buildMemberSystemPrompt, buildTaskLayer } from "./context.js";
import { TeamFiles } from "./files.js";
import { logTeamEvent } from "./logger.js";
import { validateName } from "./memory-types.js";
import type { ResolvedTeamConfig } from "./types.js";
import type {
	MemberIndexStructure,
	MemberName,
	MemberState,
	MemoryType,
	TaskState,
	TeamDirectoryPaths,
	TeamEvent,
	TeamManagerLike,
	TeamMdStructure,
	TopicFileFrontmatter,
} from "./types-v2.js";

export class TeamManager implements TeamManagerLike {
	private readonly config: ResolvedTeamConfig;
	private readonly services: SubagentServices;
	private readonly cwd: string;
	private readonly files: TeamFiles;
	private readonly members = new Map<MemberName, MemberState>();
	private readonly listeners = new Set<(event: TeamEvent) => void>();
	private readonly sessionUnsubs = new Map<MemberName, () => void>();
	private disposed = false;

	constructor(
		config: ResolvedTeamConfig,
		services: SubagentServices,
		cwd: string,
		private readonly selfMemberName?: MemberName,
	) {
		this.config = config;
		this.services = services;
		this.cwd = cwd;
		this.files = new TeamFiles(cwd);
		this.files.initTeamDir();
	}

	get paths(): TeamDirectoryPaths {
		return this.files.paths;
	}

	// ─── Member Lifecycle ──────────────────────────────────

	async createMember(opts: {
		name: MemberName;
		role: string;
		goal: string;
		model?: string;
		services: SubagentServices;
		parentModel?: import("./types.js").ResolvedModel;
	}): Promise<MemberState> {
		validateName(opts.name, "member name");
		if (this.members.has(opts.name)) throw new Error(`member "${opts.name}" already exists`);
		if (this.members.size >= this.config.maxWorkers) {
			throw new Error(`team capacity exhausted: maxWorkers=${this.config.maxWorkers} reached`);
		}

		// Create member directory + index
		this.files.initMemberDir(opts.name, opts.role, opts.goal, opts.model);

		// Read current state for context injection
		const memberIndex = this.files.readMemberIndex(opts.name);
		const teamMd = this.files.readTeamMd();

		// Build L1 + L2 + L3 system prompts
		const systemPrompts = buildMemberSystemPrompt({
			role: opts.role,
			goal: opts.goal,
			memberIndex,
			teamMd,
			selfName: opts.name,
		});

		// Create Agent Session
		const resourceLoader = new DefaultResourceLoader({
			cwd: this.cwd,
			agentDir: AGENT_DIR,
			settingsManager: this.services.settingsManager,
			appendSystemPrompt: systemPrompts,
			noExtensions: true,
			noSkills: true,
			noContextFiles: true,
		});

		const resolvedModel = opts.parentModel ?? undefined;
		const memberToolNames = ["read", "bash", "grep", "find"];
		const { session } = await createAgentSession({
			cwd: this.cwd,
			agentDir: AGENT_DIR,
			authStorage: this.services.authStorage,
			modelRegistry: this.services.modelRegistry,
			model: resolvedModel,
			settingsManager: this.services.settingsManager,
			tools: memberToolNames,
			customTools: [
				createMemberReadTool({ manager: this }),
				createSelfEditTool({ manager: this }),
				createMemoryWriteTool({ manager: this }),
			],
			resourceLoader,
		});

		// Build member state
		const state: MemberState = {
			name: opts.name,
			role: opts.role,
			goal: opts.goal,
			model: opts.model,
			status: "active",
			session,
			currentTaskId: null,
			lastTaskPrompt: null,
		};
		this.members.set(opts.name, state);

		// Subscribe to session events
		const unsub = session.subscribe((event) => this.handleMemberEvent(opts.name, event));
		this.sessionUnsubs.set(opts.name, unsub);

		// Update TEAM.md
		teamMd.members.push({
			name: opts.name,
			role: opts.role,
			status: "active",
			currentTask: "—",
		});
		this.files.writeTeamMd(teamMd);

		this.emit({ type: "member_created", memberName: opts.name });
		logTeamEvent("member_created", { memberName: opts.name, role: opts.role });

		return state;
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
		this.emit({ type: "member_removed", memberName: name });
		logTeamEvent("member_removed", { memberName: name });
	}

	getMember(name: MemberName): MemberState | undefined {
		return this.members.get(name);
	}

	listMembers(): MemberState[] {
		return [...this.members.values()];
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
