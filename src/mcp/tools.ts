import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { McpManager, McpToolInfo } from "./manager.js";

/** MCP callTool 返回的 content block 结构子集（text/image/resource 等） */
interface McpContentBlock {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

/**
 * 把 manager 已发现的 MCP tools 桥接为 Pi ToolDefinition[]。
 * - 命名 mcp_<server>_<tool>（避免与内置 read/bash/edit/write 冲突）
 * - MCP inputSchema（JSON Schema）经 Type.Unsafe 转为 TypeBox TSchema 作为 parameters
 * - execute 转发到 manager.callTool，结果 content 转为 Pi AgentToolResult
 */
export function bridgeToToolDefs(manager: McpManager): ToolDefinition[] {
	return manager.listTools().map((tool) => createToolDef(manager, tool));
}

function createToolDef(manager: McpManager, tool: McpToolInfo): ToolDefinition {
	const fullName = `mcp_${tool.server}_${tool.name}`;
	return {
		name: fullName,
		label: fullName,
		description: tool.description ?? `${tool.server}/${tool.name}`,
		parameters: Type.Unsafe((tool.inputSchema as object) ?? { type: "object" }),
		execute: async (_toolCallId, params) => {
			const content = await manager.callTool(
				tool.server,
				tool.name,
				params as Record<string, unknown> | undefined,
			);
			return {
				content: toPiContent(content),
				details: { server: tool.server, tool: tool.name },
			};
		},
	};
}

/** MCP content blocks → Pi TextContent[]（image/resource 降级为文本描述，MVP 文本优先） */
function toPiContent(mcpContent: unknown): { type: "text"; text: string }[] {
	const blocks = Array.isArray(mcpContent) ? (mcpContent as McpContentBlock[]) : [];
	return blocks.map((b) => ({
		type: "text" as const,
		text:
			b.type === "text"
				? (b.text ?? "")
				: b.type === "image"
					? `[image: ${b.mimeType ?? "unknown"}]`
					: JSON.stringify(b),
	}));
}
