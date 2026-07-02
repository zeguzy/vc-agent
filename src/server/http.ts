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
		const body = await readBody<{ mode: "standard" | "planner" }>(req);
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

	if (method === "GET" && path === "/events") {
		return createSSEResponse(server, req, res);
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

function createSSEResponse(server: AgentServer, req: IncomingMessage, res: ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const unsub = server.handleSubscribe((event) => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	});

	req.on("close", () => {
		unsub();
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
