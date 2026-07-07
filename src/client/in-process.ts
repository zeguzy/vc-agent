import type { AuthStorage, ModelRegistry, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionRuntime } from "../agent/session.js";
import type { CommandContext } from "../commands/registry.js";
import type { AgentServer } from "../server/index.js";
import type { SkillManager } from "../skills/manager.js";
import type {
	DeliveryMode,
	MemberMessage,
	MemberName,
	MemberState,
	ReadInboxOptions,
	TaskState,
	TeamEvent,
} from "../teams/types-v2.js";
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

	subscribeTeam(handler: (event: TeamEvent) => void): Unsubscribe {
		return this.server.handleSubscribeTeam(handler);
	}

	async createMember(opts: {
		name: MemberName;
		role: string;
		goal: string;
		constraints?: string;
		model?: string;
	}): Promise<MemberState> {
		return this.server.handleCreateMember(opts);
	}

	async removeMember(name: MemberName): Promise<void> {
		return this.server.handleRemoveMember(name);
	}

	getMember(name: MemberName): MemberState | undefined {
		return this.server.handleGetMember(name);
	}

	listMembers(): MemberState[] {
		return this.server.handleListMembers();
	}

	async assignTask(opts: {
		title: string;
		description: string;
		memberName: MemberName;
		priority?: "high" | "medium" | "low";
	}): Promise<TaskState> {
		return this.server.handleAssignTask(opts);
	}

	listTasks(): TaskState[] {
		return this.server.handleListTasks();
	}

	taskStatus(taskId: string): TaskState | undefined {
		return this.server.handleTaskStatus(taskId);
	}

	pauseMember(name: MemberName): void {
		this.server.handlePauseMember(name);
	}

	resumeMember(name: MemberName): void {
		this.server.handleResumeMember(name);
	}

	cancelMember(name: MemberName): void {
		this.server.handleCancelMember(name);
	}

	directMember(
		name: MemberName,
		kind: "directive" | "context" | "redirect",
		payload: string,
	): void {
		this.server.handleDirectMember(name, kind, payload);
	}

	async sendMessage(opts: {
		from: MemberName;
		to: MemberName;
		content: string;
	}): Promise<{ message: MemberMessage; delivery: DeliveryMode }> {
		return this.server.handleSendMessage(opts);
	}

	async broadcastMessage(opts: {
		from: MemberName;
		content: string;
	}): Promise<Array<{ message: MemberMessage; delivery: DeliveryMode }>> {
		return this.server.handleBroadcastMessage(opts);
	}

	readInbox(name: MemberName, opts?: ReadInboxOptions): MemberMessage[] {
		return this.server.handleReadInbox(name, opts);
	}

	markInboxRead(name: MemberName, ids?: string[]): number {
		return this.server.handleMarkInboxRead(name, ids);
	}
}

export function createClient(server: AgentServer): AgentClient {
	return new InProcessClient(server);
}
