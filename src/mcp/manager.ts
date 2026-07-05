import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { convertMcpResultToAgentResult, convertMcpToolsToPiToolDefs } from "./bridge.js";
import { readMcpConfig } from "./config.js";
import type { McpServerConfig, McpServerConnection } from "./types.js";

interface McpToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

const CONNECT_TIMEOUT_MS = 5_000;

export class McpManager {
	private connections: McpServerConnection[] = [];
	private toolDefinitions: ToolDefinition[] = [];
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

		for (const conn of this.connections) {
			const defs = convertMcpToolsToPiToolDefs(conn.name, conn.tools, this.executeTool.bind(this));
			this.toolDefinitions.push(...defs);
		}

		if (this.connections.length > 0) {
			const totalTools = this.toolDefinitions.length;
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
		return this.toolDefinitions;
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
		this.toolDefinitions = [];
	}

	private async connectServer(name: string, config: McpServerConfig): Promise<McpServerConnection> {
		const client = new Client({ name: "openagent", version: "1.0.0" });
		const transport = this.createTransport(config);

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

	/**
	 * Create the appropriate transport for the server config.
	 * Remote: StreamableHTTP with SSE fallback.
	 * Local: Stdio (spawn process).
	 */
	private createTransport(config: McpServerConfig) {
		if (config.type === "remote") {
			return new StreamableHTTPClientTransport(new URL(config.url));
		}

		const [command, ...args] = config.command;
		return new StdioClientTransport({
			command,
			args,
			env: config.env,
			cwd: config.cwd,
		});
	}
}
