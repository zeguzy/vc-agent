import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { McpServerConnection } from "./types.js";

interface McpToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

export function createMcpToolDefinition(
	connections: McpServerConnection[],
	executeFn: (
		serverName: string,
		toolName: string,
		args: Record<string, unknown>,
	) => Promise<McpToolResult>,
): ToolDefinition {
	const catalog = buildToolCatalog(connections);
	const description = formatToolDescription(catalog);

	return {
		name: "mcp",
		label: "mcp",
		description,
		parameters: Type.Unsafe<Record<string, unknown>>({
			type: "object",
			properties: {
				server_name: {
					type: "string",
					enum: catalog.map((s) => s.serverName),
					description: "MCP server name",
				},
				tool_name: {
					type: "string",
					description: "Tool name to call on the server",
				},
				arguments: {
					type: "object",
					description: "Arguments to pass to the tool",
					additionalProperties: true,
				},
			},
			required: ["server_name", "tool_name"],
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const {
				server_name,
				tool_name,
				arguments: args,
			} = params as {
				server_name: string;
				tool_name: string;
				arguments?: Record<string, unknown>;
			};
			return executeFn(server_name, tool_name, args ?? {});
		},
	} as ToolDefinition;
}

interface ToolCatalogEntry {
	serverName: string;
	tools: Array<{ name: string; description?: string }>;
}

function buildToolCatalog(connections: McpServerConnection[]): ToolCatalogEntry[] {
	return connections.map((conn) => ({
		serverName: conn.name,
		tools: conn.tools.map((t) => ({ name: t.name, description: t.description })),
	}));
}

function formatToolDescription(catalog: ToolCatalogEntry[]): string {
	const serverLines = catalog.map((s) => {
		const toolLines = s.tools
			.map((t) => `  - ${t.name}${t.description ? `: ${t.description}` : ""}`)
			.join("\n");
		return `${s.serverName}:\n${toolLines}`;
	});
	return [
		"Call a tool on a connected MCP server.",
		"Available servers and tools:",
		...serverLines,
	].join("\n\n");
}

type McpContentItem =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType?: string }
	| { type: "audio"; data: string; mimeType?: string }
	| { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
	| { type: "resource_link"; uri: string; name: string; description?: string };

export function convertMcpResultToAgentResult(result: {
	content?: McpContentItem[];
	isError?: boolean;
}): McpToolResult {
	if (!result.content || result.content.length === 0) {
		return {
			content: [
				{ type: "text", text: result.isError ? "MCP tool error (no content)" : "(no output)" },
			],
			details: {},
		};
	}

	const textParts = result.content.map((item) => {
		switch (item.type) {
			case "text":
				return item.text;
			case "image":
				return `[image: ${item.mimeType ?? "unknown"}, ${item.data.length} bytes base64]`;
			case "audio":
				return `[audio: ${item.mimeType ?? "unknown"}, ${item.data.length} bytes base64]`;
			case "resource": {
				const r = item.resource;
				if (r.text) return r.text;
				if (r.blob) return `[resource blob: ${r.uri}, ${r.mimeType ?? "unknown"}]`;
				return `[resource: ${r.uri}]`;
			}
			case "resource_link":
				return `[resource link: ${item.name} — ${item.uri}${item.description ? ` (${item.description})` : ""}]`;
			default:
				return `[unknown content type]`;
		}
	});

	return {
		content: [{ type: "text", text: textParts.join("\n") }],
		details: {},
	};
}
