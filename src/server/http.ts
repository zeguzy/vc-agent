import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getNotificationBus } from "../notifications/event-bus.js";
import type { AgentServer } from "./index.js";

export interface HttpServerOptions {
	server: AgentServer;
	port: number;
}

export function createHttpServer(opts: HttpServerOptions) {
	const { server, port } = opts;

	const httpServer = createServer(async (req, res) => {
		try {
			await handleRequest(server, req, res);
		} catch (err) {
			sendJson(res, { error: String(err) }, 500);
		}
	});

	httpServer.listen(port);
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

	if (method === "POST" && path === "/team/spawn") {
		const body = await readBody<{ agent: string; task: string }>(req);
		if (!body.agent || !body.task) {
			return sendJson(res, { error: "agent and task required" }, 400);
		}
		try {
			const result = await server.handleSpawnWorker(body.agent, body.task);
			return sendJson(res, result);
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "POST" && path.startsWith("/team/cancel/")) {
		const workerId = path.slice("/team/cancel/".length);
		if (!workerId) {
			await server.handleCancelAllWorkers();
			return sendJson(res, { ok: true });
		}
		await server.handleCancelWorker(workerId);
		return sendJson(res, { ok: true });
	}

	if (method === "POST" && path === "/team/cancel") {
		await server.handleCancelAllWorkers();
		return sendJson(res, { ok: true });
	}

	if (method === "GET" && path === "/team/workers") {
		return sendJson(res, { workers: server.handleListWorkers() });
	}

	if (method === "GET" && path === "/team/worker") {
		const id = url.searchParams.get("id");
		if (!id) return sendJson(res, { error: "?id= required" }, 400);
		const worker = server.handleGetWorker(id);
		if (!worker) return sendJson(res, { error: "worker not found" }, 404);
		return sendJson(res, { worker });
	}

	// ── V2 Team Member/Task/Message routes ──

	if (method === "POST" && path === "/team/members") {
		const body = await readBody<{
			name: string;
			role: string;
			goal: string;
			model?: string;
			tools?: string[];
			systemPrompt?: string;
		}>(req);
		if (!body.name || !body.role || !body.goal) {
			return sendJson(res, { error: "name, role, and goal required" }, 400);
		}
		try {
			const member = await server.handleCreateMember(body);
			return sendJson(res, member);
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "GET" && path === "/team/members") {
		return sendJson(res, { members: server.handleListMembers() });
	}

	if (method === "GET" && path.startsWith("/team/members/")) {
		const id = path.slice("/team/members/".length);
		const member = server.handleGetMember(id);
		if (!member) return sendJson(res, { error: "member not found" }, 404);
		return sendJson(res, { member });
	}

	if (method === "DELETE" && path.startsWith("/team/members/")) {
		const id = path.slice("/team/members/".length);
		try {
			await server.handleRemoveMember(id);
			return sendJson(res, { ok: true });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "POST" && path === "/team/tasks") {
		const body = await readBody<{
			title: string;
			description: string;
			memberId: string;
			priority?: "high" | "medium" | "low";
		}>(req);
		if (!body.title || !body.description || !body.memberId) {
			return sendJson(res, { error: "title, description, and memberId required" }, 400);
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

	if (method === "POST" && path === "/team/messages") {
		const body = await readBody<{ from: string; to: string; content: string }>(req);
		if (!body.from || !body.to || !body.content) {
			return sendJson(res, { error: "from, to, and content required" }, 400);
		}
		try {
			await server.handleSendMessage(body.from, body.to, body.content);
			return sendJson(res, { ok: true });
		} catch (err) {
			return sendJson(res, { error: String(err) }, 400);
		}
	}

	if (method === "GET" && path === "/team/inbox") {
		const memberId = url.searchParams.get("memberId") ?? undefined;
		return sendJson(res, { messages: server.handleReadInbox(memberId) });
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
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function createSSEResponse(
	server: AgentServer,
	req: IncomingMessage,
	res: ServerResponse,
	streaming = false,
): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const unsub = server.handleSubscribe((event) => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	});

	const streamTeamKinds = new Set(["message_end", "agent_end", "error"]);
	const teamUnsub = server.handleSubscribeTeam((event) => {
		if (event.type === "team_worker_event") {
			if (!streaming && !streamTeamKinds.has(event.kind)) return;
		}
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
