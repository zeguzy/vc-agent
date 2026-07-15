import type { CommandContext } from "../commands/registry.js";
import type { AgentServer } from "../server/index.js";
import type {
	DeliveryMode,
	GoalStatus,
	MemberMessage,
	MemberName,
	MemberState,
	ReadInboxOptions,
	TaskState,
	TaskType,
	TeamEvent,
	TeamMdStructure,
} from "../teams/types-v2.js";
import type {
	AgentClient,
	BtwEnterResult,
	BtwStatusResult,
	ContextUsage,
	CycleModelResult,
	EventHandler,
	ExtendedModelInfo,
	LoadSkillResult,
	ModelInfo,
	NavigateResult,
	NewSessionResult,
	SkillDirectories,
	SkillListResult,
	TeamSummary,
	Unsubscribe,
	UserMessageSummary,
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

	onSessionChange(handler: (sessionId: string) => Promise<void>): void {
		this.server.handleOnSessionChange(handler);
	}

	async setModel(provider: string, id: string): Promise<void> {
		return this.server.handleSetModel(provider, id);
	}

	getAvailableThinkingLevels(): readonly string[] {
		return this.server.handleGetAvailableThinkingLevels();
	}

	setThinkingLevel(level: string): void {
		this.server.handleSetThinkingLevel(level);
	}

	getUserMessagesForForking(): UserMessageSummary[] {
		return this.server.handleGetUserMessagesForForking();
	}

	getEntryParentId(entryId: string): string | undefined {
		return this.server.handleGetEntryParentId(entryId);
	}

	async navigateTree(parentId: string): Promise<NavigateResult> {
		return this.server.handleNavigateTree(parentId);
	}

	async btwEnter(): Promise<BtwEnterResult> {
		return this.server.handleBtwEnter();
	}

	async btwBack(): Promise<void> {
		return this.server.handleBtwBack();
	}

	btwStatus(): BtwStatusResult {
		return this.server.handleBtwStatus();
	}

	listSkills(): SkillListResult {
		return this.server.handleListSkills();
	}

	getSkillDirectories(): SkillDirectories {
		return this.server.handleGetSkillDirectories();
	}

	async loadDynamicSkill(path: string): Promise<LoadSkillResult> {
		return this.server.handleLoadDynamicSkill(path);
	}

	async unloadDynamicSkill(name: string): Promise<boolean> {
		return this.server.handleUnloadDynamicSkill(name);
	}

	setCompactionEnabled(enabled: boolean): void {
		this.server.handleSetCompactionEnabled(enabled);
	}

	listModels(): ExtendedModelInfo[] {
		return this.server.handleListModels();
	}

	findModel(provider: string, id: string): ExtendedModelInfo | undefined {
		return this.server.handleFindModel(provider, id);
	}

	hasAuthProvider(provider: string): boolean {
		return this.server.handleHasAuthProvider(provider);
	}

	setRuntimeApiKey(provider: string, key: string): void {
		this.server.handleSetRuntimeApiKey(provider, key);
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
		type?: TaskType;
	}): Promise<TaskState> {
		return this.server.handleAssignTask(opts);
	}

	async startDiscussion(opts: {
		title: string;
		description: string;
		participants: MemberName[];
		priority?: "high" | "medium" | "low";
	}): Promise<TaskState> {
		return this.server.handleStartDiscussion(opts);
	}

	completeTask(taskId: string): void {
		this.server.handleCompleteTask(taskId);
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

	listGoals(filter?: { status?: GoalStatus }): import("../teams/types-v2.js").Goal[] {
		return this.server.handleListGoals(filter);
	}

	readTeamMd(): TeamMdStructure {
		return this.server.handleReadTeamMd();
	}

	listTeamSummaries(): TeamSummary[] {
		return this.server.handleListTeamSummaries();
	}
}

export function createClient(server: AgentServer): AgentClient {
	return new InProcessClient(server);
}
