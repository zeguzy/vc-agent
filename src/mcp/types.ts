/** MCP server configuration entry in mcp.json */
export interface McpRemoteServerConfig {
	type: "remote";
	/** Server URL (SSE or StreamableHTTP endpoint) */
	url: string;
}

export interface McpLocalServerConfig {
	type: "local";
	/** Command to spawn the MCP server process */
	command: string[];
	/** Optional environment variables */
	env?: Record<string, string>;
	/** Optional working directory */
	cwd?: string;
}

export type McpServerConfig = McpRemoteServerConfig | McpLocalServerConfig;

/** Top-level mcp.json structure: server name → config */
export type McpJsonConfig = Record<string, McpServerConfig>;

/** Internal state for a connected MCP server */
export interface McpServerConnection {
	/** Server name from config */
	name: string;
	/** The MCP Client instance */
	client: import("@modelcontextprotocol/sdk/client/index.js").Client;
	/** The transport instance (for cleanup) */
	transport: import("@modelcontextprotocol/sdk/shared/transport.js").Transport;
	/** Raw tool list from listTools() */
	tools: import("@modelcontextprotocol/sdk/types.js").Tool[];
}
