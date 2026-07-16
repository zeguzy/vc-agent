import type { AgentSessionEvent } from "../agent/session.js";
import type { ActiveJob } from "../background/types.js";
import type { CommandContext } from "../commands/registry.js";
import type { Message } from "../message.js";
import type { SessionInfo } from "../session/list.js";
import type {
	DeliveryMode,
	Goal,
	GoalStatus,
	MemberMessage,
	MemberName,
	MemberState,
	ReadInboxOptions,
	TaskState,
	TeamEvent,
	TeamMdStructure,
} from "../teams/types-v2.js";
import type {
	AgentClient,
	AgentMode,
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

class NotSupportedError extends Error {
	constructor(method: string) {
		super(`Method '${method}' not supported in HTTP client mode`);
		this.name = "NotSupportedError";
	}
}

interface RemoteCache {
	sessionId: string;
	sessionName: string | undefined;
	sessionFile: string | undefined;
	model: ModelInfo | undefined;
	contextUsage: ContextUsage | undefined;
	messages: Message[];
}

export class HttpClient implements AgentClient {
	private readonly baseUrl: string;
	private cache: RemoteCache = {
		sessionId: "",
		sessionName: undefined,
		sessionFile: undefined,
		model: undefined,
		contextUsage: undefined,
		messages: [],
	};

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
	}

	async init(): Promise<void> {
		const [id, name, file, model, ctx, msgs] = await Promise.all([
			this.getJson<{ id: string }>("/session/id"),
			this.getJson<{ name?: string }>("/session/name"),
			this.getJson<{ file?: string }>("/session/file"),
			this.getJson<{ model?: ModelInfo }>("/model"),
			this.getJson<ContextUsage>("/context"),
			this.getJson<{ messages: Message[] }>("/messages"),
		]);
		this.cache = {
			sessionId: id.id,
			sessionName: name.name,
			sessionFile: file.file,
			model: model.model,
			contextUsage: ctx.tokens != null ? ctx : undefined,
			messages: msgs.messages ?? [],
		};
	}

	private async postJson(path: string, body?: unknown): Promise<unknown> {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : "{}",
		});
		return res.json();
	}

	private async getJson<T>(path: string): Promise<T> {
		const res = await fetch(`${this.baseUrl}${path}`);
		return (await res.json()) as T;
	}

	async prompt(text: string): Promise<void> {
		await this.postJson("/prompt", { text });
	}

	async followUp(text: string): Promise<void> {
		await this.postJson("/follow-up", { text });
	}

	async abort(): Promise<void> {
		await this.postJson("/abort");
	}

	async compact(instructions?: string): Promise<unknown> {
		return this.postJson("/compact", instructions ? { instructions } : {});
	}

	async newSession(): Promise<NewSessionResult> {
		return this.postJson("/session/new") as Promise<NewSessionResult>;
	}

	async switchSession(path: string): Promise<NewSessionResult> {
		return this.postJson("/session/switch", { path }) as Promise<NewSessionResult>;
	}

	setSessionName(name: string): void {
		this.postJson("/session/name", { name });
		this.cache.sessionName = name;
	}

	getSessionName(): string | undefined {
		return this.cache.sessionName;
	}

	getSessionId(): string {
		return this.cache.sessionId;
	}

	getSessionFile(): string | undefined {
		return this.cache.sessionFile;
	}

	getModel(): ModelInfo | undefined {
		return this.cache.model;
	}

	getContextUsage(): ContextUsage | undefined {
		return this.cache.contextUsage;
	}

	getMappedMessages(): Message[] {
		return this.cache.messages;
	}

	async cycleModel(): Promise<CycleModelResult | undefined> {
		throw new NotSupportedError("cycleModel");
	}

	setActiveToolsByName(_tools: string[]): void {
		throw new NotSupportedError("setActiveToolsByName");
	}

	setAgentMode(mode: AgentMode): void {
		this.postJson("/mode", { mode });
	}

	async listSessions(): Promise<SessionInfo[]> {
		const data = await this.getJson<{ sessions: SessionInfo[] }>("/sessions");
		return data.sessions ?? [];
	}

	subscribe(handler: EventHandler): Unsubscribe {
		let closed = false;
		const controller = new AbortController();

		(async () => {
			try {
				const res = await fetch(`${this.baseUrl}/events`, {
					signal: controller.signal,
					headers: { Accept: "text/event-stream" },
				});
				if (!res.body) return;
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				while (!closed) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						const data = line.replace(/^data: /, "").trim();
						if (!data) continue;
						try {
							handler(JSON.parse(data) as AgentSessionEvent);
						} catch {
							// skip malformed SSE data
						}
					}
				}
			} catch {
				// connection closed or aborted
			}
		})();

		return () => {
			closed = true;
			controller.abort();
		};
	}

	onSessionChange(_handler: (sessionId: string) => Promise<void>): void {}

	async setModel(provider: string, id: string): Promise<void> {
		await this.postJson("/model", { provider, id });
	}

	getAvailableThinkingLevels(): readonly string[] {
		throw new NotSupportedError(
			"getAvailableThinkingLevels (sync) — use fetchThinkingLevels() instead",
		);
	}

	async fetchThinkingLevels(): Promise<readonly string[]> {
		const data = await this.getJson<{ levels: string[] }>("/model/thinking-levels");
		return data.levels ?? [];
	}

	setThinkingLevel(level: string): void {
		this.postJson("/model/thinking-level", { level });
	}

	getUserMessagesForForking(): UserMessageSummary[] {
		throw new NotSupportedError(
			"getUserMessagesForForking (sync) — use fetchUserMessagesForForking() instead",
		);
	}

	async fetchUserMessagesForForking(): Promise<UserMessageSummary[]> {
		const data = await this.getJson<{ messages: UserMessageSummary[] }>("/session/fork-messages");
		return data.messages ?? [];
	}

	getEntryParentId(_entryId: string): string | undefined {
		throw new NotSupportedError("getEntryParentId (sync) — use fetchEntryParentId() instead");
	}

	async fetchEntryParentId(entryId: string): Promise<string | undefined> {
		const data = await this.getJson<{ parentId?: string }>(`/session/entry-parent/${entryId}`);
		return data.parentId;
	}

	async navigateTree(parentId: string): Promise<NavigateResult> {
		return this.postJson("/session/navigate", { parentId }) as Promise<NavigateResult>;
	}

	async btwEnter(): Promise<BtwEnterResult> {
		return this.postJson("/btw/enter") as Promise<BtwEnterResult>;
	}

	async btwBack(): Promise<void> {
		await this.postJson("/btw/back");
	}

	btwStatus(): BtwStatusResult {
		throw new NotSupportedError("btwStatus (sync) — use fetchBtwStatus() instead");
	}

	btwSidePrompt(_text: string): void {
		throw new NotSupportedError("btwSidePrompt — InProcessClient only");
	}

	getBtwSideSession(): import("@earendil-works/pi-coding-agent").AgentSession | null {
		throw new NotSupportedError("getBtwSideSession — InProcessClient only");
	}

	async fetchBtwStatus(): Promise<BtwStatusResult> {
		return this.getJson<BtwStatusResult>("/btw/status");
	}

	listSkills(): SkillListResult {
		throw new NotSupportedError("listSkills (sync) — use fetchSkills() instead");
	}

	async fetchSkills(): Promise<SkillListResult> {
		return this.getJson<SkillListResult>("/skills");
	}

	getSkillDirectories(): SkillDirectories {
		throw new NotSupportedError("getSkillDirectories (sync) — use fetchSkillDirectories() instead");
	}

	async fetchSkillDirectories(): Promise<SkillDirectories> {
		return this.getJson<SkillDirectories>("/skills/directories");
	}

	async loadDynamicSkill(path: string): Promise<LoadSkillResult> {
		return this.postJson("/skills/load", { path }) as Promise<LoadSkillResult>;
	}

	async unloadDynamicSkill(name: string): Promise<boolean> {
		const res = (await this.postJson("/skills/unload", { name })) as { removed: boolean };
		return res.removed;
	}

	setCompactionEnabled(enabled: boolean): void {
		this.postJson("/settings/compaction", { enabled });
	}

	listModels(): ExtendedModelInfo[] {
		throw new NotSupportedError("listModels (sync) — use fetchModels() instead");
	}

	async fetchModels(): Promise<ExtendedModelInfo[]> {
		const data = await this.getJson<{ models: ExtendedModelInfo[] }>("/models");
		return data.models ?? [];
	}

	findModel(_provider: string, _id: string): ExtendedModelInfo | undefined {
		throw new NotSupportedError("findModel (sync) — use fetchModel() instead");
	}

	async fetchModel(provider: string, id: string): Promise<ExtendedModelInfo | undefined> {
		const res = await fetch(`${this.baseUrl}/models/${provider}/${id}`);
		if (res.status === 404) return undefined;
		const data = await res.json();
		return (data as { model: ExtendedModelInfo }).model;
	}

	hasAuthProvider(_provider: string): boolean {
		throw new NotSupportedError("hasAuthProvider (sync) — use fetchHasAuthProvider() instead");
	}

	async fetchHasAuthProvider(provider: string): Promise<boolean> {
		const data = await this.getJson<{ has: boolean }>(`/auth/has/${provider}`);
		return data.has;
	}

	setRuntimeApiKey(provider: string, key: string): void {
		this.postJson("/auth/api-key", { provider, key });
	}

	async executeCommand(_name: string, _args: string, _ctx: CommandContext): Promise<boolean> {
		throw new NotSupportedError("executeCommand");
	}

	subscribeTeam(_handler: (event: TeamEvent) => void): Unsubscribe {
		throw new NotSupportedError("subscribeTeam");
	}

	async createMember(opts: Parameters<AgentClient["createMember"]>[0]): Promise<MemberState> {
		const res = await this.postJson("/team/members", opts);
		return res as MemberState;
	}

	async removeMember(name: MemberName): Promise<void> {
		await fetch(`${this.baseUrl}/team/members/${name}`, { method: "DELETE" });
	}

	getMember(_name: MemberName): MemberState | undefined {
		throw new NotSupportedError("getMember (sync) — use fetchMember() instead");
	}

	listMembers(): MemberState[] {
		throw new NotSupportedError("listMembers (sync) — use fetchMembers() instead");
	}

	async assignTask(opts: Parameters<AgentClient["assignTask"]>[0]): Promise<TaskState> {
		const res = await this.postJson("/team/tasks", opts);
		return res as TaskState;
	}

	async startDiscussion(opts: Parameters<AgentClient["startDiscussion"]>[0]): Promise<TaskState> {
		const res = await this.postJson("/team/discussions", opts);
		return res as TaskState;
	}

	completeTask(_taskId: string): void {
		throw new NotSupportedError("completeTask (sync) — use fetchTasks() to verify");
	}

	listTasks(): TaskState[] {
		throw new NotSupportedError("listTasks (sync) — use fetchTasks() instead");
	}

	taskStatus(_taskId: string): TaskState | undefined {
		throw new NotSupportedError("taskStatus (sync) — use fetchTaskStatus() instead");
	}

	async fetchMember(name: MemberName): Promise<MemberState | undefined> {
		const res = await fetch(`${this.baseUrl}/team/members/${name}`);
		if (res.status === 404) return undefined;
		const data = await res.json();
		return (data as { member: MemberState }).member;
	}

	async fetchMembers(): Promise<MemberState[]> {
		const data = await this.getJson<{ members: MemberState[] }>("/team/members");
		return data.members;
	}

	async fetchTasks(): Promise<TaskState[]> {
		const data = await this.getJson<{ tasks: TaskState[] }>("/team/tasks");
		return data.tasks;
	}

	async fetchTaskStatus(taskId: string): Promise<TaskState | undefined> {
		const res = await fetch(`${this.baseUrl}/team/tasks/${taskId}`);
		if (res.status === 404) return undefined;
		const data = await res.json();
		return (data as { task: TaskState }).task;
	}

	pauseMember(_name: MemberName): void {
		throw new NotSupportedError(
			"pauseMember (sync) — use HTTP PUT /team/members/:name/pause instead",
		);
	}

	resumeMember(_name: MemberName): void {
		throw new NotSupportedError(
			"resumeMember (sync) — use HTTP PUT /team/members/:name/resume instead",
		);
	}

	cancelMember(_name: MemberName): void {
		throw new NotSupportedError(
			"cancelMember (sync) — use HTTP PUT /team/members/:name/cancel instead",
		);
	}

	directMember(
		_name: MemberName,
		_kind: "directive" | "context" | "redirect",
		_payload: string,
	): void {
		throw new NotSupportedError(
			"directMember (sync) — use HTTP POST /team/members/:name/direct instead",
		);
	}

	async sendMessage(opts: {
		from: MemberName;
		to: MemberName;
		content: string;
	}): Promise<{ message: MemberMessage; delivery: DeliveryMode }> {
		const res = await this.postJson("/team/messages", opts);
		return res as { message: MemberMessage; delivery: DeliveryMode };
	}

	async broadcastMessage(opts: {
		from: MemberName;
		content: string;
	}): Promise<Array<{ message: MemberMessage; delivery: DeliveryMode }>> {
		const res = (await this.postJson("/team/messages/broadcast", opts)) as {
			results: Array<{ message: MemberMessage; delivery: DeliveryMode }>;
		};
		return res.results ?? [];
	}

	readInbox(_name: MemberName, _opts?: ReadInboxOptions): MemberMessage[] {
		throw new NotSupportedError("readInbox (sync) — use fetchInbox() instead");
	}

	markInboxRead(_name: MemberName, _ids?: string[]): number {
		throw new NotSupportedError(
			"markInboxRead (sync) — use async HTTP POST /team/inbox/read instead",
		);
	}

	async fetchInbox(name: MemberName, opts?: ReadInboxOptions): Promise<MemberMessage[]> {
		const params = new URLSearchParams({ member: name });
		if (opts?.from) params.set("from", opts.from);
		if (opts?.unreadOnly) params.set("unreadOnly", "true");
		if (opts?.limit) params.set("limit", String(opts.limit));
		const data = await this.getJson<{ messages: MemberMessage[] }>(`/team/inbox?${params}`);
		return data.messages ?? [];
	}

	async fetchInboxReadCount(name: MemberName, ids?: string[]): Promise<number> {
		const res = (await this.postJson("/team/inbox/read", { member: name, ids })) as {
			count: number;
		};
		return res.count ?? 0;
	}

	listGoals(_filter?: { status?: GoalStatus }): Goal[] {
		throw new NotSupportedError("listGoals (sync) — use fetchGoals() instead");
	}

	async fetchGoals(filter?: { status?: GoalStatus }): Promise<Goal[]> {
		const params = new URLSearchParams();
		if (filter?.status) params.set("status", filter.status);
		const data = await this.getJson<{ goals: Goal[] }>(`/team/goals?${params}`);
		return data.goals ?? [];
	}

	readTeamMd(): TeamMdStructure {
		throw new NotSupportedError("readTeamMd (sync) — use fetchTeamMd() instead");
	}

	async fetchTeamMd(): Promise<TeamMdStructure> {
		return this.getJson<TeamMdStructure>("/team/md");
	}

	listTeamSummaries(): TeamSummary[] {
		throw new NotSupportedError("listTeamSummaries (sync) — use fetchTeamSummaries() instead");
	}

	async fetchTeamSummaries(): Promise<TeamSummary[]> {
		const data = await this.getJson<{ summaries: TeamSummary[] }>("/team/summaries");
		return data.summaries ?? [];
	}

	async fetchBackgroundJobs(): Promise<ActiveJob[]> {
		const data = await this.getJson<{ jobs: ActiveJob[] }>("/background/jobs");
		return data.jobs ?? [];
	}

	async fetchBackgroundJob(id: string): Promise<ActiveJob | undefined> {
		const res = await fetch(`${this.baseUrl}/background/jobs/${encodeURIComponent(id)}`);
		if (res.status === 404) return undefined;
		const data = (await res.json()) as { job?: ActiveJob };
		return data.job;
	}

	async cancelBackgroundJob(id: string): Promise<ActiveJob | undefined> {
		const res = await fetch(`${this.baseUrl}/background/jobs/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
		if (res.status === 404) return undefined;
		const data = (await res.json()) as { job?: ActiveJob };
		return data.job;
	}

	async promoteBackgroundJob(id: string): Promise<ActiveJob | undefined> {
		const data = (await this.postJson(`/background/jobs/${encodeURIComponent(id)}/promote`)) as {
			job?: ActiveJob;
		};
		return data.job;
	}

	listBackgroundJobs(): ActiveJob[] {
		throw new NotSupportedError("listBackgroundJobs (sync) — use fetchBackgroundJobs() instead");
	}

	getBackgroundJob(_id: string): ActiveJob | undefined {
		throw new NotSupportedError("getBackgroundJob (sync) — use fetchBackgroundJob() instead");
	}
}

export function createHttpClient(baseUrl: string): AgentClient {
	return new HttpClient(baseUrl);
}
