import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getNotificationBus } from "../notifications/event-bus.js";
import type { AgentServer } from "./index.js";

export interface HttpServerOptions {
	server: AgentServer;
	port: number;
	/** Optional host to bind (e.g. "127.0.0.1"). When omitted, Node binds to all interfaces (::/0.0.0.0). */
	host?: string;
}

export function createHttpServer(opts: HttpServerOptions) {
	const { server, port, host } = opts;

	const httpServer = createServer(async (req, res) => {
		try {
			await handleRequest(server, req, res);
		} catch (err) {
			sendJson(res, { error: String(err) }, 500);
		}
	});

	httpServer.listen(port, host ?? "127.0.0.1");
	return httpServer;
}

async function handleRequest(server: AgentServer, req: IncomingMessage, res: ServerResponse) {
	const url = new URL(req.url ?? "/", `http://localhost`);
	const path = url.pathname;
	const method = req.method ?? "GET";

	if (method === "POST" && path === "/prompt") {
		const body = await readBody<{ text: string }>(req);
		await server.handlePrompt(body.text);
		return sendJson(res, { ok: true });
	}

	if (method === "POST" && path === "/follow-up") {
		const body = await readBody<{ text: string }>(req);
		await server.handleFollowUp(body.text);
		return sendJson(res, { ok: true });
	}

	if (method === "POST" && path === "/abort") {
		await server.handleAbort();
		return sendJson(res, { ok: true });
	}

	if (method === "POST" && path === "/compact") {
		const body = await readBody<{ instructions?: string }>(req);
		await server.handleCompact(body.instructions);
		return sendJson(res, { ok: true });
	}

	if (method === "POST" && path === "/session/new") {
		const result = await server.handleNewSession();
		return sendJson(res, result);
	}

	if (method === "POST" && path === "/session/switch") {
		const body = await readBody<{ path: string }>(req);
		const result = await server.handleSwitchSession(body.path);
		return sendJson(res, result);
	}

	if (method === "POST" && path === "/session/name") {
		const body = await readBody<{ name: string }>(req);
		server.handleSetSessionName(body.name);
		return sendJson(res, { ok: true });
	}

	if (method === "POST" && path === "/mode") {
		const body = await readBody<{ mode: "standard" | "planner" | "team" | "orchestrator" }>(req);
		server.handleSetAgentMode(body.mode);
		return sendJson(res, { ok: true });
	}

	if (method === "GET" && path === "/session/id") {
		return sendJson(res, { id: server.handleGetSessionId() });
	}

	if (method === "GET" && path === "/session/name") {
		return sendJson(res, { name: server.handleGetSessionName() });
	}

	if (method === "GET" && path === "/session/file") {
		return sendJson(res, { file: server.handleGetSessionFile() });
	}

	if (method === "GET" && path === "/model") {
		return sendJson(res, { model: server.handleGetModel() });
	}

	if (method === "POST" && path === "/model") {
		const body = await readBody<{ provider: string; id: string }>(req);
		await server.handleSetModel(body.provider, body.id);
		return sendJson(res, { ok: true });
	}

	if (method === "GET" && path === "/model/thinking-levels") {
		return sendJson(res, { levels: server.handleGetAvailableThinkingLevels() });
	}

	if (method === "POST" && path === "/model/thinking-level") {
		const body = await readBody<{ level: string }>(req);
		server.handleSetThinkingLevel(body.level);
		return sendJson(res, { ok: true });
	}

	if (method === "GET" && path === "/session/fork-messages") {
		return sendJson(res, { messages: server.handleGetUserMessagesForForking() });
	}

	if (method === "GET" && path.startsWith("/session/entry-parent/")) {
		const entryId = path.slice("/session/entry-parent/".length);
		const parentId = server.handleGetEntryParentId(entryId);
		return sendJson(res, { parentId });
	}

	if (method === "POST" && path === "/session/navigate") {
		const body = await readBody<{ parentId: string }>(req);
		const result = await server.handleNavigateTree(body.parentId);
		return sendJson(res, result);
	}

	if (method === "GET" && path === "/skills") {
		return sendJson(res, server.handleListSkills());
	}

	if (method === "GET" && path === "/skills/directories") {
		return sendJson(res, server.handleGetSkillDirectories());
	}

	if (method === "POST" && path === "/skills/load") {
		const body = await readBody<{ path: string }>(req);
		try {
			const result = await server.handleLoadDynamicSkill(body.path);
			return sendJson(res, result);
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "POST" && path === "/skills/unload") {
		const body = await readBody<{ name: string }>(req);
		const removed = await server.handleUnloadDynamicSkill(body.name);
		return sendJson(res, { removed });
	}

	if (method === "POST" && path === "/settings/compaction") {
		const body = await readBody<{ enabled: boolean }>(req);
		server.handleSetCompactionEnabled(body.enabled);
		return sendJson(res, { ok: true });
	}

	if (method === "GET" && path === "/models") {
		return sendJson(res, { models: server.handleListModels() });
	}

	if (method === "GET" && path.startsWith("/models/")) {
		const rest = path.slice("/models/".length);
		const sepIdx = rest.indexOf("/");
		if (sepIdx > 0) {
			const provider = rest.slice(0, sepIdx);
			const id = rest.slice(sepIdx + 1);
			const model = server.handleFindModel(provider, id);
			if (!model) return sendJson(res, { error: "model not found" }, 404);
			return sendJson(res, { model });
		}
	}

	if (method === "GET" && path.startsWith("/auth/has/")) {
		const provider = path.slice("/auth/has/".length);
		return sendJson(res, { has: server.handleHasAuthProvider(provider) });
	}

	if (method === "POST" && path === "/auth/api-key") {
		const body = await readBody<{ provider: string; key: string }>(req);
		server.handleSetRuntimeApiKey(body.provider, body.key);
		return sendJson(res, { ok: true });
	}

	if (method === "GET" && path === "/context") {
		return sendJson(res, { ...(server.handleGetContextUsage() ?? {}) });
	}

	if (method === "GET" && path === "/messages") {
		return sendJson(res, { messages: server.handleGetMappedMessages() });
	}

	if (method === "GET" && path === "/sessions") {
		const sessions = await server.handleListSessions();
		return sendJson(res, { sessions });
	}

	if (method === "POST" && path === "/team/members") {
		const body = await readBody<{
			name: string;
			role: string;
			goal: string;
			model?: string;
			tools?: string[];
			skills?: string[];
			mcps?: string[];
		}>(req);
		if (!body.name || !body.role || !body.goal) {
			return sendJson(res, { error: "name, role, and goal required" }, 400);
		}
		try {
			const member = await server.handleCreateMember(body);
			return sendJson(res, stripSession(member));
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "GET" && path === "/team/members") {
		return sendJson(res, { members: server.handleListMembers().map(stripSession) });
	}

	if (method === "GET" && path.startsWith("/team/members/")) {
		const name = path.slice("/team/members/".length);
		const member = server.handleGetMember(name);
		if (!member) return sendJson(res, { error: "member not found" }, 404);
		return sendJson(res, { member: stripSession(member) });
	}

	if (method === "DELETE" && path.startsWith("/team/members/")) {
		const name = path.slice("/team/members/".length);
		try {
			await server.handleRemoveMember(name);
			return sendJson(res, { ok: true });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "POST" && path === "/team/tasks") {
		const body = await readBody<{
			title: string;
			description: string;
			memberName: string;
			priority?: "high" | "medium" | "low";
			type?: "execution" | "discussion";
		}>(req);
		if (!body.title || !body.description || !body.memberName) {
			return sendJson(res, { error: "title, description, and memberName required" }, 400);
		}
		if (body.type !== undefined && body.type !== "execution" && body.type !== "discussion") {
			return sendJson(res, { error: "invalid type" }, 400);
		}
		try {
			const task = await server.handleAssignTask(body);
			return sendJson(res, task);
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "GET" && path === "/team/tasks") {
		return sendJson(res, { tasks: server.handleListTasks() });
	}

	if (method === "GET" && path.startsWith("/team/tasks/")) {
		const id = path.slice("/team/tasks/".length);
		const task = server.handleTaskStatus(id);
		if (!task) return sendJson(res, { error: "task not found" }, 404);
		return sendJson(res, { task });
	}

	if (method === "PUT" && path.startsWith("/team/members/") && path.endsWith("/pause")) {
		const name = path.slice("/team/members/".length, -"/pause".length);
		try {
			server.handlePauseMember(name);
			return sendJson(res, { ok: true });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "PUT" && path.startsWith("/team/members/") && path.endsWith("/resume")) {
		const name = path.slice("/team/members/".length, -"/resume".length);
		try {
			server.handleResumeMember(name);
			return sendJson(res, { ok: true });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "PUT" && path.startsWith("/team/members/") && path.endsWith("/cancel")) {
		const name = path.slice("/team/members/".length, -"/cancel".length);
		try {
			server.handleCancelMember(name);
			return sendJson(res, { ok: true });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "POST" && path.startsWith("/team/members/") && path.endsWith("/direct")) {
		const name = path.slice("/team/members/".length, -"/direct".length);
		const body = await readBody<{ kind: "directive" | "context" | "redirect"; payload: string }>(
			req,
		);
		if (!body.kind || !body.payload) {
			return sendJson(res, { error: "kind and payload required" }, 400);
		}
		try {
			server.handleDirectMember(name, body.kind, body.payload);
			return sendJson(res, { ok: true });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "POST" && path === "/team/messages") {
		const body = await readBody<{ from: string; to: string; content: string }>(req);
		if (!body.from || !body.to || !body.content) {
			return sendJson(res, { error: "from, to, and content required" }, 400);
		}
		try {
			const result = server.handleSendMessage(body);
			return sendJson(res, result);
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "POST" && path === "/team/messages/broadcast") {
		const body = await readBody<{ from: string; content: string }>(req);
		if (!body.from || !body.content) {
			return sendJson(res, { error: "from and content required" }, 400);
		}
		try {
			const results = server.handleBroadcastMessage(body);
			return sendJson(res, { results });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "GET" && path === "/team/inbox") {
		const member = url.searchParams.get("member");
		const from = url.searchParams.get("from") ?? undefined;
		const unreadOnly = url.searchParams.get("unreadOnly") === "true";
		const limitRaw = url.searchParams.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
		if (!member) {
			return sendJson(res, { error: "member query parameter required" }, 400);
		}
		try {
			const messages = server.handleReadInbox(member, { from, unreadOnly, limit });
			return sendJson(res, { messages });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "POST" && path === "/team/inbox/read") {
		const body = await readBody<{ member: string; ids?: string[] }>(req);
		if (!body.member) {
			return sendJson(res, { error: "member required" }, 400);
		}
		try {
			const count = server.handleMarkInboxRead(body.member, body.ids);
			return sendJson(res, { count });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "GET" && path === "/team/goals") {
		return sendJson(res, { goals: server.handleListGoals() });
	}

	if (method === "GET" && path === "/team/md") {
		return sendJson(res, server.handleReadTeamMd());
	}

	if (method === "GET" && path === "/team/summaries") {
		return sendJson(res, { summaries: server.handleListTeamSummaries() });
	}

	if (method === "GET" && path === "/events") {
		const streaming = url.searchParams.get("streaming") === "true";
		return createSSEResponse(server, req, res, streaming);
	}

	if (method === "GET" && path === "/sse/notifications") {
		return createNotificationSSEResponse(req, res);
	}

	sendJson(res, { error: "Not found" }, 404);
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.from(chunk as Buffer));
	}
	return JSON.parse(Buffer.concat(chunks).toString()) as T;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
	if (res.headersSent) return;
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function stripSession<T extends { session?: unknown }>(member: T): Omit<T, "session"> {
	const { session: _session, ...rest } = member;
	return rest;
}

function createSSEResponse(
	server: AgentServer,
	req: IncomingMessage,
	res: ServerResponse,
	_streaming = false,
): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const unsub = server.handleSubscribe((event) => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	});

	const teamUnsub = server.handleSubscribeTeam((event) => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	});

	req.on("close", () => {
		unsub();
		teamUnsub();
		res.end();
	});
}

function createNotificationSSEResponse(req: IncomingMessage, res: ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const unsub = getNotificationBus().subscribe((payload) => {
		res.write(`data: ${JSON.stringify(payload)}\n\n`);
	});

	req.on("close", () => {
		unsub();
		res.end();
	});
}
