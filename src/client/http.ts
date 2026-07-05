import type { AgentSessionEvent } from "../agent/session.js";
import type { CommandContext } from "../commands/registry.js";
import type { Message } from "../message.js";
import type { SessionInfo } from "../session/list.js";
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
	AgentMode,
	ContextUsage,
	CycleModelResult,
	EventHandler,
	ModelInfo,
	NewSessionResult,
	Unsubscribe,
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

	onSessionChange(
		_handler: (session: import("../agent/session.js").AgentSession) => Promise<void>,
	): void {}

	getSettingsManager(): import("@earendil-works/pi-coding-agent").SettingsManager {
		throw new NotSupportedError("getSettingsManager");
	}
	getModelRegistry(): import("@earendil-works/pi-coding-agent").ModelRegistry {
		throw new NotSupportedError("getModelRegistry");
	}
	getAuthStorage(): import("@earendil-works/pi-coding-agent").AuthStorage {
		throw new NotSupportedError("getAuthStorage");
	}
	getSkillManager(): import("../skills/manager.js").SkillManager {
		throw new NotSupportedError("getSkillManager");
	}
	getSession(): import("../agent/session.js").AgentSession {
		throw new NotSupportedError("getSession");
	}
	getRuntime(): import("../agent/session.js").AgentSessionRuntime {
		throw new NotSupportedError("getRuntime");
	}

	async executeCommand(_name: string, _args: string, _ctx: CommandContext): Promise<boolean> {
		throw new NotSupportedError("executeCommand");
	}

	listWorkers(): WorkerSnapshot[] {
		throw new NotSupportedError("listWorkers");
	}

	getWorker(_id: WorkerId): WorkerSnapshot | undefined {
		throw new NotSupportedError("getWorker");
	}

	async spawnWorker(
		_agent: string,
		_task: string,
	): Promise<{ workerId: WorkerId; status: WorkerStatus }> {
		throw new NotSupportedError("spawnWorker");
	}

	async cancelWorker(_workerId: WorkerId): Promise<void> {
		throw new NotSupportedError("cancelWorker");
	}

	async cancelAllWorkers(): Promise<void> {
		throw new NotSupportedError("cancelAllWorkers");
	}

	subscribeTeam(_handler: (event: AgentClientEvent) => void): Unsubscribe {
		throw new NotSupportedError("subscribeTeam");
	}

	// V2 Team methods (not supported over HTTP)
	async createMember(opts: Parameters<AgentClient["createMember"]>[0]): Promise<TeamMember> {
		const res = await this.postJson("/team/members", opts);
		return res as TeamMember;
	}

	async removeMember(id: MemberId): Promise<void> {
		await fetch(`${this.baseUrl}/team/members/${id}`, { method: "DELETE" });
	}

	getMember(_id: MemberId): TeamMember | undefined {
		throw new NotSupportedError("getMember (sync) — use fetchMember() instead");
	}

	listMembers(): TeamMember[] {
		throw new NotSupportedError("listMembers (sync) — use fetchMembers() instead");
	}

	async assignTask(opts: Parameters<AgentClient["assignTask"]>[0]): Promise<TeamTask> {
		const res = await this.postJson("/team/tasks", opts);
		return res as TeamTask;
	}

	listTasks(): TeamTask[] {
		throw new NotSupportedError("listTasks (sync) — use fetchTasks() instead");
	}

	taskStatus(_taskId: string): TeamTask | undefined {
		throw new NotSupportedError("taskStatus (sync) — use fetchTaskStatus() instead");
	}

	async sendMessage(from: MemberId, to: MemberId | "team", content: string): Promise<void> {
		await this.postJson("/team/messages", { from, to, content });
	}

	readInbox(_memberId?: MemberId): TeamMessage[] {
		throw new NotSupportedError("readInbox (sync) — use fetchInbox() instead");
	}

	async fetchMember(id: MemberId): Promise<TeamMember | undefined> {
		const res = await fetch(`${this.baseUrl}/team/members/${id}`);
		if (res.status === 404) return undefined;
		const data = await res.json();
		return (data as { member: TeamMember }).member;
	}

	async fetchMembers(): Promise<TeamMember[]> {
		const data = await this.getJson<{ members: TeamMember[] }>("/team/members");
		return data.members;
	}

	async fetchTasks(): Promise<TeamTask[]> {
		const data = await this.getJson<{ tasks: TeamTask[] }>("/team/tasks");
		return data.tasks;
	}

	async fetchTaskStatus(taskId: string): Promise<TeamTask | undefined> {
		const res = await fetch(`${this.baseUrl}/team/tasks/${taskId}`);
		if (res.status === 404) return undefined;
		const data = await res.json();
		return (data as { task: TeamTask }).task;
	}

	async fetchInbox(memberId?: MemberId): Promise<TeamMessage[]> {
		const path = memberId ? `/team/inbox?memberId=${memberId}` : "/team/inbox";
		const data = await this.getJson<{ messages: TeamMessage[] }>(path);
		return data.messages;
	}
}

export function createHttpClient(baseUrl: string): AgentClient {
	return new HttpClient(baseUrl);
}
