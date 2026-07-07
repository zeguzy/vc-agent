export interface McpRemoteServerConfig {
	type: "remote";
	url: string;
	headers?: Record<string, string>;
}

export interface McpLocalServerConfig {
	type: "local";
	command: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export type McpServerConfig = McpRemoteServerConfig | McpLocalServerConfig;

export type McpJsonConfig = Record<string, McpServerConfig>;

export type ConnectionStatus = "cached" | "connecting" | "connected" | "failed";

/** Internal state for a connected MCP server */
export interface McpServerConnection {
	name: string;
	client: import("@modelcontextprotocol/sdk/client/index.js").Client | null;
	transport: import("@modelcontextprotocol/sdk/shared/transport.js").Transport | null;
	tools: import("@modelcontextprotocol/sdk/types.js").Tool[];
	status: ConnectionStatus;
	connectionPromise?: Promise<void>;
	error?: string;
}
