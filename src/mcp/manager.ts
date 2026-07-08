import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { convertMcpResultToAgentResult, createMcpToolDefinition } from "./bridge.js";
import {
	type CacheData,
	computeConfigHash,
	readCache,
	resolveCachePath,
	writeCache,
} from "./cache.js";
import { readMcpConfig } from "./config.js";
import type {
	McpLocalServerConfig,
	McpRemoteServerConfig,
	McpServerConfig,
	McpServerConnection,
} from "./types.js";

interface McpToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

const CONNECT_TIMEOUT_MS = 5_000;
const EXECUTE_WAIT_TIMEOUT_MS = 10_000;

export class McpManager {
	private connections: McpServerConnection[] = [];
	private _toolDefinition: ToolDefinition | null = null;
	private _disposed = false;
	private _refreshTask: Promise<void> | null = null;
	private _cacheData: CacheData | null = null;
	private _configHash: string | null = null;

	async initialize(cwd: string): Promise<void> {
		const config = readMcpConfig(cwd);
		const entries = Object.entries(config);

		if (entries.length === 0) {
			return;
		}

		const configHash = computeConfigHash(config);
		this._configHash = configHash;
		const cached = readCache();

		if (cached && cached.configHash === configHash) {
			this.applyCacheHit(cached, entries);
			return;
		}

		await this.fullConnect(entries, configHash);
	}

	getToolDefinitions(): ToolDefinition[] {
		return this._toolDefinition ? [this._toolDefinition] : [];
	}

	getAuthorizedToolDefinition(serverNames: string[]): ToolDefinition | null {
		const allowed = this.connections.filter((c) => serverNames.includes(c.name));
		if (allowed.length === 0) return null;
		return createMcpToolDefinition(allowed, this.executeTool.bind(this));
	}

	listServerNames(): string[] {
		return this.connections.map((c) => c.name);
	}

	getConnectionStatus(): Array<{
		name: string;
		status: string;
		toolCount: number;
		type?: string;
		error?: string;
	}> {
		return this.connections.map((c) => ({
			name: c.name,
			status: c.status,
			toolCount: c.tools.length,
			type: c.type,
			error: c.error,
		}));
	}

	getCacheInfo(): { hash: string | null; path: string; updatedAt: string | null } {
		return {
			hash: this._configHash,
			path: resolveCachePath(),
			updatedAt: this._cacheData?.updatedAt ?? null,
		};
	}

	async refreshTools(serverName?: string): Promise<{ success: number; failed: number }> {
		if (serverName) {
			const conn = this.connections.find((c) => c.name === serverName);
			if (!conn) {
				throw new Error(
					`MCP server "${serverName}" not found. Available: ${this.listServerNames().join(", ")}`,
				);
			}
			try {
				await this.refreshServer(conn);
				return { success: 1, failed: 0 };
			} catch {
				return { success: 0, failed: 1 };
			}
		}

		if (this._refreshTask) {
			await this._refreshTask;
		}

		return this.refreshAll();
	}

	async executeTool(
		serverName: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<McpToolResult> {
		const conn = this.connections.find((c) => c.name === serverName);
		if (!conn) {
			return {
				content: [{ type: "text", text: `MCP server "${serverName}" is not connected` }],
				details: {},
			};
		}

		if (conn.status !== "connected") {
			if (conn.connectionPromise) {
				try {
					await Promise.race([conn.connectionPromise, timeout(EXECUTE_WAIT_TIMEOUT_MS)]);
				} catch {
					return {
						content: [
							{
								type: "text",
								text: `MCP server "${serverName}" connection timed out. Run /mcp refresh ${serverName}`,
							},
						],
						details: {},
					};
				}
			}
		}

		if (conn.status !== "connected" || !conn.client) {
			return {
				content: [
					{
						type: "text",
						text: `MCP server "${serverName}" is not connected (status: ${conn.status}). Run /mcp refresh ${serverName}`,
					},
				],
				details: {},
			};
		}

		const toolExists = conn.tools.some((t) => t.name === toolName);
		if (!toolExists) {
			return {
				content: [
					{
						type: "text",
						text: `MCP tool "${toolName}" not found on server "${serverName}". Run /mcp refresh ${serverName}`,
					},
				],
				details: {},
			};
		}

		const client = conn.client;
		if (!client) {
			return {
				content: [
					{
						type: "text",
						text: `MCP server "${serverName}" has no client. Run /mcp refresh ${serverName}`,
					},
				],
				details: {},
			};
		}

		try {
			const result = await client.callTool({ name: toolName, arguments: args });
			return convertMcpResultToAgentResult(
				result as Parameters<typeof convertMcpResultToAgentResult>[0],
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `MCP tool error (${serverName}_${toolName}): ${msg}` }],
				details: {},
			};
		}
	}

	async dispose(): Promise<void> {
		if (this._disposed) return;
		this._disposed = true;

		for (const conn of this.connections) {
			try {
				if (conn.transport) {
					await conn.transport.close();
				}
			} catch {
				// Best-effort cleanup
			}
		}
		this.connections = [];
		this._toolDefinition = null;
	}

	private applyCacheHit(cached: CacheData, entries: [string, McpServerConfig][]): void {
		this._cacheData = cached;

		const entryMap = new Map(entries);
		for (const server of cached.servers) {
			if (!entryMap.has(server.name)) continue;
			this.connections.push({
				name: server.name,
				client: null,
				transport: null,
				tools: server.tools as import("@modelcontextprotocol/sdk/types.js").Tool[],
				status: "cached",
				type: entryMap.get(server.name)?.type,
			});
		}

		if (this.connections.length > 0) {
			this._toolDefinition = createMcpToolDefinition(this.connections, this.executeTool.bind(this));
			const totalTools = this.connections.reduce((sum, c) => sum + c.tools.length, 0);
			console.error(
				`[mcp] Cache hit (${cached.configHash.slice(0, 8)}): ${this.connections.length} servers, ${totalTools} tools — refreshing in background`,
			);
		}

		this._refreshTask = this.refreshAll()
			.then(() => {})
			.catch((err) => {
				console.error("[mcp] Background refresh failed:", err);
			});
	}

	private async fullConnect(
		entries: [string, McpServerConfig][],
		configHash: string,
	): Promise<void> {
		const results = await Promise.allSettled(
			entries.map(async ([name, serverConfig]) => {
				return this.connectServer(name, serverConfig);
			}),
		);

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.status === "fulfilled") {
				this.connections.push(result.value);
			} else {
				console.error(`[mcp] Failed to connect to "${entries[i][0]}": ${result.reason}`);
			}
		}

		if (this.connections.length > 0) {
			this._toolDefinition = createMcpToolDefinition(this.connections, this.executeTool.bind(this));
			const totalTools = this.connections.reduce((sum, c) => sum + c.tools.length, 0);
			const serverList = this.connections
				.map((c) => `${c.name}(${c.tools.length} tools)`)
				.join(", ");
			console.error(`[mcp] Connected: ${serverList} — ${totalTools} tools total`);

			this.persistCache(configHash);
		}
		const failedCount = results.filter((r) => r.status === "rejected").length;
		if (failedCount > 0) {
			console.error(`[mcp] ${failedCount} server(s) failed to connect (skipped)`);
		}
	}

	private async refreshAll(): Promise<{ success: number; failed: number }> {
		let success = 0;
		let failed = 0;

		const promises = this.connections.map(async (conn) => {
			if (this._disposed) return;
			try {
				await this.refreshServer(conn);
				success++;
			} catch {
				failed++;
			}
		});

		await Promise.all(promises);
		return { success, failed };
	}

	private async refreshServer(conn: McpServerConnection): Promise<void> {
		if (conn.status === "connecting") {
			if (conn.connectionPromise) {
				await conn.connectionPromise;
			}
			return;
		}

		if (conn.status === "connected") {
			if (conn.transport) {
				await conn.transport.close();
			}
		}

		const config = readMcpConfig(process.cwd());
		const serverConfig = config[conn.name];
		if (!serverConfig) {
			throw new Error(`No config for MCP server "${conn.name}"`);
		}

		let resolve!: () => void;
		let reject!: (err: unknown) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});

		conn.status = "connecting";
		conn.connectionPromise = promise;
		conn.error = undefined;

		try {
			const result = await this.connectServer(conn.name, serverConfig);

			conn.client = result.client;
			conn.transport = result.transport;
			conn.tools = result.tools;
			conn.status = "connected";

			this.rebuildToolDefinition();
			this.persistCache(this._configHash ?? computeConfigHash(config));

			resolve();
		} catch (err) {
			conn.status = "failed";
			conn.error = err instanceof Error ? err.message : String(err);
			conn.client = null;
			conn.transport = null;

			reject(err);
		}
	}

	private rebuildToolDefinition(): void {
		if (this._disposed) return;
		if (this.connections.length > 0) {
			this._toolDefinition = createMcpToolDefinition(this.connections, this.executeTool.bind(this));
		}
	}

	private persistCache(configHash: string): void {
		const connectedServers = this.connections.filter(
			(c) => c.status === "connected" || c.status === "cached",
		);
		if (connectedServers.length === 0) return;

		const data: CacheData = {
			configHash,
			updatedAt: new Date().toISOString(),
			servers: connectedServers.map((c) => ({
				name: c.name,
				tools: c.tools.map((t) => ({
					name: t.name,
					description: t.description ?? "",
					inputSchema: (t.inputSchema ?? {}) as object,
				})),
			})),
		};
		this._cacheData = data;
		writeCache(data);
	}

	private async connectServer(name: string, config: McpServerConfig): Promise<McpServerConnection> {
		const conn =
			config.type === "remote"
				? await this.connectRemoteServer(name, config)
				: await this.connectLocalServer(name, config);
		conn.type = config.type;
		return conn;
	}

	private async connectRemoteServer(
		name: string,
		config: McpRemoteServerConfig,
	): Promise<McpServerConnection> {
		const url = new URL(config.url);
		const requestInit: RequestInit = config.headers ? { headers: config.headers } : {};

		try {
			return await this.connectWithTransport(
				name,
				new StreamableHTTPClientTransport(url, { requestInit }),
			);
		} catch (httpErr) {
			console.error(`[mcp] StreamableHTTP failed for "${name}", trying SSE fallback...`);
			const sseOpts: import("@modelcontextprotocol/sdk/client/sse.js").SSEClientTransportOptions =
				{};
			if (config.headers) {
				const extraHeaders = config.headers;
				sseOpts.eventSourceInit = {
					fetch: (input, init) => {
						const merged = new Headers(init?.headers);
						for (const [k, v] of Object.entries(extraHeaders)) {
							if (!merged.has(k)) merged.set(k, v);
						}
						return globalThis.fetch(input, { ...init, headers: merged });
					},
				};
				sseOpts.requestInit = { headers: config.headers };
			}
			try {
				return await this.connectWithTransport(name, new SSEClientTransport(url, sseOpts));
			} catch (sseErr) {
				throw new Error(
					`Both StreamableHTTP and SSE transports failed. HTTP: ${httpErr instanceof Error ? httpErr.message : String(httpErr)}. SSE: ${sseErr instanceof Error ? sseErr.message : String(sseErr)}`,
				);
			}
		}
	}

	private async connectLocalServer(
		name: string,
		config: McpLocalServerConfig,
	): Promise<McpServerConnection> {
		const [command, ...args] = config.command;
		const transport = new StdioClientTransport({
			command,
			args,
			env: config.env,
			cwd: config.cwd,
			stderr: "pipe",
		});
		transport.onerror = (err) => {
			console.error(`[mcp] ${name}: transport error:`, err);
		};
		return this.connectWithTransport(name, transport);
	}

	private async connectWithTransport(
		name: string,
		transport: import("@modelcontextprotocol/sdk/shared/transport.js").Transport,
	): Promise<McpServerConnection> {
		const client = new Client({ name: "openagent", version: "1.0.0" });

		await Promise.race([
			client.connect(transport),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`Connection timeout (${CONNECT_TIMEOUT_MS}ms)`)),
					CONNECT_TIMEOUT_MS,
				),
			),
		]);

		const { tools } = await client.listTools();

		return { name, client, transport, tools, status: "connected" };
	}
}

function timeout(ms: number): Promise<never> {
	return new Promise((_, reject) =>
		setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
	);
}
