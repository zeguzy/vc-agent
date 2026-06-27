import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { HttpTransportConfig, McpServerConfig, McpTransportConfig } from "./adapter.js";

const CLIENT_INFO = { name: "openagent", version: "0.1.0" };
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;

/**
 * 线性退避：第 attempt 次（0-based）重连的延迟 = base * (attempt + 1)。
 * 达 max 次返回 null（停止重连）。纯函数，便于单测。
 */
export function nextReconnectDelay(
	attempt: number,
	base: number = RECONNECT_BASE_MS,
	max: number = MAX_RECONNECT_ATTEMPTS,
): number | null {
	if (attempt < 0) return null;
	if (attempt >= max) return null;
	return base * (attempt + 1);
}

/** 已发现的 MCP tool（来源 server + MCP tool 元信息） */
export interface McpToolInfo {
	server: string;
	name: string;
	description?: string;
	/** MCP inputSchema（JSON Schema），直传给 Pi ToolDefinition.parameters */
	inputSchema: unknown;
}

export type McpConnectionStatus = "connected" | "connecting" | "error" | "disconnected";

/** 单个 server 的连接状态（供 /mcp 面板展示） */
export interface McpServerStatus {
	name: string;
	transport: string;
	status: McpConnectionStatus;
	toolCount: number;
	error?: string;
}

interface ManagedConnection {
	config: McpServerConfig;
	client: Client;
	tools: McpToolInfo[];
	status: McpConnectionStatus;
	error?: string;
	reconnectAttempts: number;
}

/**
 * McpManager — 基于 @modelcontextprotocol/sdk 自管的 MCP 连接与工具管理。
 *
 * 覆盖 stdio/SSE/HTTP 三 transport：local→stdio，remote→streamable-http（失败回退 sse）。
 * 单个 server 连接失败隔离（不中断其他 server 或会话创建）。
 * 退避重连策略由纯函数 nextReconnectDelay 决定。
 */
export class McpManager {
	private readonly connections = new Map<string, ManagedConnection>();
	private destroyed = false;

	/** 连接所有 enabled server 并发现 tools。单 server 失败被隔离。 */
	async initialize(configs: McpServerConfig[]): Promise<void> {
		await Promise.all(
			configs.filter((c) => c.enabled).map((c) => this.connectOne(c).catch(() => {})),
		);
	}

	/** 所有 server 的连接状态（供 /mcp 面板）。 */
	getAllStatus(): McpServerStatus[] {
		return [...this.connections.values()].map((c) => ({
			name: c.config.name,
			transport: c.config.transport.type,
			status: c.status,
			toolCount: c.tools.length,
			...(c.error ? { error: c.error } : {}),
		}));
	}

	/** 所有已连接 server 暴露的 tools（供 tools 桥接）。 */
	listTools(): McpToolInfo[] {
		return [...this.connections.values()].flatMap((c) => (c.status === "connected" ? c.tools : []));
	}

	/** 调用某 server 的某 tool（供 ToolDefinition.execute 转发）。 */
	async callTool(
		server: string,
		name: string,
		args: Record<string, unknown> | undefined,
	): Promise<unknown> {
		const conn = this.connections.get(server);
		if (conn?.status !== "connected") {
			throw new Error(`MCP server "${server}" not connected`);
		}
		const result = await conn.client.callTool({ name, arguments: args });
		return result.content;
	}

	/** 手动重连指定 server（面板操作）。disconnectAll 后不再重连。 */
	async reconnect(name: string): Promise<void> {
		if (this.destroyed) return;
		const conn = this.connections.get(name);
		if (!conn) return;
		await this.doConnect(conn);
	}

	/** 关闭所有连接，释放资源（会话结束/退出时调用）。 */
	async disconnectAll(): Promise<void> {
		this.destroyed = true;
		await Promise.all(
			[...this.connections.values()].map(async (conn) => {
				try {
					await conn.client.close();
				} catch {
					conn.error = "close failed during shutdown";
				}
				conn.status = "disconnected";
			}),
		);
	}

	private async connectOne(config: McpServerConfig): Promise<void> {
		const conn: ManagedConnection = {
			config,
			client: new Client(CLIENT_INFO),
			tools: [],
			status: "connecting",
			reconnectAttempts: 0,
		};
		this.connections.set(config.name, conn);
		await this.doConnect(conn);
	}

	private async doConnect(conn: ManagedConnection): Promise<void> {
		conn.status = "connecting";
		try {
			await conn.client.connect(this.createTransport(conn.config.transport));
			conn.tools = await this.discoverTools(conn.config.name, conn.client);
			conn.status = "connected";
			conn.error = undefined;
			conn.reconnectAttempts = 0;
		} catch (err) {
			// remote streamable-http 失败 → 回退 sse 重试一次（复刻 opencode 协商）
			if (conn.config.transport.type === "streamable-http") {
				try {
					await conn.client.connect(this.createSseTransport(conn.config.transport));
					conn.tools = await this.discoverTools(conn.config.name, conn.client);
					conn.status = "connected";
					conn.error = undefined;
					return;
				} catch (sseErr) {
					conn.status = "error";
					conn.error = this.fmtErr(sseErr);
					return;
				}
			}
			conn.status = "error";
			conn.error = this.fmtErr(err);
		}
	}

	private createTransport(t: McpTransportConfig) {
		if (t.type === "stdio") {
			return new StdioClientTransport({
				command: t.command,
				args: t.args,
				...(t.env ? { env: t.env } : {}),
			});
		}
		return new StreamableHTTPClientTransport(new URL(t.url), {
			...(t.headers ? { requestInit: { headers: t.headers } } : {}),
		});
	}

	private createSseTransport(t: HttpTransportConfig) {
		return new SSEClientTransport(new URL(t.url), {
			...(t.headers ? { requestInit: { headers: t.headers } } : {}),
		});
	}

	private async discoverTools(server: string, client: Client): Promise<McpToolInfo[]> {
		try {
			const result = await client.listTools();
			return (result.tools ?? []).map((tool) => ({
				server,
				name: tool.name,
				...(tool.description ? { description: tool.description } : {}),
				inputSchema: tool.inputSchema,
			}));
		} catch {
			// 连接成功但 listTools 失败：视为无工具，不报错
			return [];
		}
	}

	private fmtErr(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}
