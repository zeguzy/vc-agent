import type { AuthStorage, ModelRegistry, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionRuntime } from "../agent/session.js";
import type { CommandContext } from "../commands/registry.js";
import type { AgentServer } from "../server/index.js";
import type { SkillManager } from "../skills/manager.js";
import type {
	AgentClientEvent,
	MemberId,
	TeamMember,
	TeamMessage,
	TeamTask,
	WorkerId,
	WorkerSnapshot,
	WorkerStatus,
} from "../teams/types.js";
import type {
	AgentClient,
	ContextUsage,
	CycleModelResult,
	EventHandler,
	ModelInfo,
	NewSessionResult,
	Unsubscribe,
} from "./types.js";

export class InProcessClient implements AgentClient {
	constructor(private readonly server: AgentServer) {}

	async prompt(text: string): Promise<void> {
		return this.server.handlePrompt(text);
	}

	async followUp(text: string): Promise<void> {
		return this.server.handleFollowUp(text);
	}

	async abort(): Promise<void> {
		return this.server.handleAbort();
	}

	async compact(instructions?: string): Promise<unknown> {
		return this.server.handleCompact(instructions);
	}

	async newSession(): Promise<NewSessionResult> {
		return this.server.handleNewSession();
	}

	async switchSession(path: string): Promise<NewSessionResult> {
		return this.server.handleSwitchSession(path);
	}

	setSessionName(name: string): void {
		this.server.handleSetSessionName(name);
	}

	getSessionName(): string | undefined {
		return this.server.handleGetSessionName();
	}

	getSessionId(): string {
		return this.server.handleGetSessionId();
	}

	getSessionFile(): string | undefined {
		return this.server.handleGetSessionFile();
	}

	getModel(): ModelInfo | undefined {
		return this.server.handleGetModel();
	}

	getContextUsage(): ContextUsage | undefined {
		return this.server.handleGetContextUsage();
	}

	getMappedMessages() {
		return this.server.handleGetMappedMessages();
	}

	async cycleModel(): Promise<CycleModelResult | undefined> {
		return this.server.handleCycleModel();
	}

	setActiveToolsByName(tools: string[]): void {
		this.server.handleSetActiveToolsByName(tools);
	}

	setAgentMode(mode: import("./types.js").AgentMode): void {
		this.server.handleSetAgentMode(mode);
	}

	async listSessions(): Promise<import("../session/list.js").SessionInfo[]> {
		return this.server.handleListSessions();
	}

	subscribe(handler: EventHandler): Unsubscribe {
		return this.server.handleSubscribe(handler);
	}

	onSessionChange(handler: (session: AgentSession) => Promise<void>): void {
		this.server.handleOnSessionChange(handler);
	}

	getSettingsManager(): SettingsManager {
		return this.server.handleGetSettingsManager();
	}

	getModelRegistry(): ModelRegistry {
		return this.server.handleGetModelRegistry();
	}

	getAuthStorage(): AuthStorage {
		return this.server.handleGetAuthStorage();
	}

	getSkillManager(): SkillManager {
		return this.server.handleGetSkillManager();
	}

	getSession(): AgentSession {
		return this.server.handleGetSession();
	}

	getRuntime(): AgentSessionRuntime {
		return this.server.handleGetRuntime();
	}

	async executeCommand(name: string, args: string, ctx: CommandContext): Promise<boolean> {
		return this.server.handleExecuteCommand(name, args, ctx);
	}

	listWorkers(): WorkerSnapshot[] {
		return this.server.handleListWorkers();
	}

	getWorker(id: WorkerId): WorkerSnapshot | undefined {
		return this.server.handleGetWorker(id);
	}

	async spawnWorker(
		agent: string,
		task: string,
	): Promise<{ workerId: WorkerId; status: WorkerStatus }> {
		return this.server.handleSpawnWorker(agent, task);
	}

	async cancelWorker(workerId: WorkerId): Promise<void> {
		return this.server.handleCancelWorker(workerId);
	}

	async cancelAllWorkers(): Promise<void> {
		return this.server.handleCancelAllWorkers();
	}

	subscribeTeam(handler: (event: AgentClientEvent) => void): Unsubscribe {
		return this.server.handleSubscribeTeam(handler);
	}

	// V2 Team methods
	async createMember(opts: {
		name: string;
		role: string;
		goal: string;
		model?: string;
		tools?: string[];
		systemPrompt?: string;
	}): Promise<TeamMember> {
		return this.server.handleCreateMember(opts);
	}

	async removeMember(id: MemberId): Promise<void> {
		return this.server.handleRemoveMember(id);
	}

	getMember(id: MemberId): TeamMember | undefined {
		return this.server.handleGetMember(id);
	}

	listMembers(): TeamMember[] {
		return this.server.handleListMembers();
	}

	async assignTask(opts: {
		title: string;
		description: string;
		memberId: MemberId;
		priority?: "high" | "medium" | "low";
	}): Promise<TeamTask> {
		return this.server.handleAssignTask(opts);
	}

	listTasks(): TeamTask[] {
		return this.server.handleListTasks();
	}

	taskStatus(taskId: string): TeamTask | undefined {
		return this.server.handleTaskStatus(taskId);
	}

	async sendMessage(from: MemberId, to: MemberId | "team", content: string): Promise<void> {
		return this.server.handleSendMessage(from, to, content);
	}

	readInbox(memberId?: MemberId): TeamMessage[] {
		return this.server.handleReadInbox(memberId);
	}
}

export function createClient(server: AgentServer): AgentClient {
	return new InProcessClient(server);
}
