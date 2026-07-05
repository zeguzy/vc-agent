import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TeamManagerLike } from "../teams/types-v2.js";

interface MemberReadToolOptions {
	manager: TeamManagerLike;
}

const MemberReadParamsSchema = Type.Object({
	name: Type.Optional(Type.String({ description: "Member name. Omit to read your own index." })),
	topic: Type.Optional(Type.String({ description: "Topic file name to read (e.g. 'preferences'). Omit for index only." })),
});

export function createMemberReadTool(opts: MemberReadToolOptions): ToolDefinition {
	return {
		name: "member-read",
		label: "Member Read",
		description:
			"Read a member's memory index or a specific topic file. Without 'name', reads your own index. With 'topic', reads that specific memory file. Leader can read any member; members can only read themselves.",
		parameters: MemberReadParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as { name?: string; topic?: string };
			try {
				const targetName = args.name ?? opts.manager.getSelfMemberName();
				if (!targetName) {
					return { content: [{ type: "text" as const, text: "Error: no member name specified and you are not a member." }], details: {}, isError: true };
				}

				// Permission check: members can only read themselves
				const selfName = opts.manager.getSelfMemberName();
				if (selfName && args.name && args.name !== selfName) {
					if (opts.manager.isSelfMember(selfName)) {
						return { content: [{ type: "text" as const, text: "Error: cannot read other member's private memory." }], details: {}, isError: true };
					}
				}

				if (args.topic) {
					const topicData = opts.manager.readTopicFile(targetName, args.topic);
					if (!topicData) {
						return { content: [{ type: "text" as const, text: `Topic "${args.topic}" not found for member "${targetName}".` }], details: {}, isError: true };
					}
					const header = `[Memory: ${args.topic} (${topicData.type}) — updated ${topicData.updated}]`;
					return { content: [{ type: "text" as const, text: `${header}\n${topicData.content}` }], details: {} };
				}

				const index = opts.manager.readMemberIndex(targetName);
				if (!index) {
					return { content: [{ type: "text" as const, text: `Member "${targetName}" index not found.` }], details: {}, isError: true };
				}

				const lines: string[] = [];
				lines.push(`Profile: ${index.profile.role} | Goal: ${index.profile.goal}`);
				if (index.profile.model) lines.push(`Model: ${index.profile.model}`);
				if (index.activeContext) lines.push(`\nActive Context: ${index.activeContext}`);
				if (index.memoryIndex.length > 0) {
					lines.push("\nMemories:");
					for (const m of index.memoryIndex) {
						lines.push(`  - ${m.file} [${m.type}] — ${m.description}`);
					}
				}
				if (index.recentActivity.length > 0) {
					lines.push("\nRecent:");
					for (const a of index.recentActivity.slice(-5)) {
						lines.push(`  - ${a.date}: ${a.entry}`);
					}
				}
				return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], details: {}, isError: true };
			}
		},
	};
}
