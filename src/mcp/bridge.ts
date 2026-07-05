import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Type } from "typebox";

/**
 * Convert MCP tools from a single server to Pi SDK ToolDefinition[].
 * Tool names are prefixed with `<serverName>_` to avoid cross-server collisions.
 */
export function convertMcpToolsToPiToolDefs(
	serverName: string,
	tools: Tool[],
	executeFn: (
		serverName: string,
		toolName: string,
		args: Record<string, unknown>,
	) => Promise<McpToolResult>,
): ToolDefinition[] {
	return tools.map((tool) => {
		const prefixedName = `${serverName}_${tool.name}`;
		// Wrap MCP JSON Schema with TypeBox Unsafe to avoid recursive conversion
		const parameters = Type.Unsafe<Record<string, unknown>>(
			tool.inputSchema ?? { type: "object", properties: {} },
		);

		return {
			name: prefixedName,
			label: tool.name,
			description: tool.description ?? `MCP tool: ${tool.name} (from ${serverName})`,
			parameters,
			async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
				return executeFn(serverName, tool.name, params as Record<string, unknown>);
			},
		} as ToolDefinition;
	});
}

/** MCP callTool() result content item */
type McpContentItem =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType?: string }
	| { type: "audio"; data: string; mimeType?: string }
	| { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
	| { type: "resource_link"; uri: string; name: string; description?: string };

/** Shape of the AgentToolResult we return (avoids importing the generic type) */
interface McpToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

/**
 * Convert MCP callTool() result to Pi SDK AgentToolResult.
 * Handles all MCP content types: text, image, audio, resource, resource_link.
 * Non-text content is serialized to a descriptive text representation.
 */
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
