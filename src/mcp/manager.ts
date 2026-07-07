import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { convertMcpResultToAgentResult, createMcpToolDefinition } from "./bridge.js";
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

export class McpManager {
	private connections: McpServerConnection[] = [];
	private _toolDefinition: ToolDefinition | null = null;
	private _disposed = false;

	async initialize(cwd: string): Promise<void> {
		const config = readMcpConfig(cwd);
		const entries = Object.entries(config);

		if (entries.length === 0) {
			return;
		}

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
		}
		const failedCount = results.filter((r) => r.status === "rejected").length;
		if (failedCount > 0) {
			console.error(`[mcp] ${failedCount} server(s) failed to connect (skipped)`);
		}
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

		try {
			const result = await conn.client.callTool({ name: toolName, arguments: args });
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
				await conn.transport.close();
			} catch {
				// Best-effort cleanup
			}
		}
		this.connections = [];
		this._toolDefinition = null;
	}

	private async connectServer(name: string, config: McpServerConfig): Promise<McpServerConnection> {
		if (config.type === "remote") {
			return this.connectRemoteServer(name, config);
		}
		return this.connectLocalServer(name, config);
	}

	private async connectRemoteServer(
		name: string,
		config: McpRemoteServerConfig,
	): Promise<McpServerConnection> {
		const url = new URL(config.url);
		const requestInit: RequestInit = config.headers ? { headers: config.headers } : {};

		// Try StreamableHTTP first, then fallback to SSE for older servers
		try {
			return await this.connectWithTransport(
				name,
				new StreamableHTTPClientTransport(url, { requestInit }),
			);
		} catch (httpErr) {
			console.error(`[mcp] StreamableHTTP failed for "${name}", trying SSE fallback...`);
			// EventSourceInit doesn't have a headers field;
			// inject headers via a custom fetch wrapper instead.
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
		});
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

		return { name, client, transport, tools };
	}
}
