import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryType, TeamManagerLike } from "../teams/types-v2.js";

interface MemoryWriteToolOptions {
	manager: TeamManagerLike;
}

const MemoryTypeSchema = Type.Union(
	[
		Type.Literal("user"),
		Type.Literal("feedback"),
		Type.Literal("project"),
		Type.Literal("reference"),
	],
	{
		description:
			"user=your private preferences/habits, feedback=private feedback you received, project=team-shared project knowledge, reference=team-shared reference material",
	},
);

const MemoryWriteParamsSchema = Type.Object({
	type: MemoryTypeSchema,
	topic: Type.String({
		description: "Topic name (kebab-case, e.g. 'preferences', 'code-style', 'api-reference'). Only letters, digits, and hyphens.",
	}),
	content: Type.String({ description: "The memory content to write" }),
	shared: Type.Optional(
		Type.Boolean({
			description: "For project/reference types: write to shared/ directory instead of your own. Default false.",
		}),
	),
	member: Type.Optional(
		Type.String({
			description: "Leader only: write memory for another member (e.g. feedback). Omit to write to yourself.",
		}),
	),
});

export function createMemoryWriteTool(opts: MemoryWriteToolOptions): ToolDefinition {
	return {
		name: "memory-write",
		label: "Memory Write",
		description:
			"Write a memory topic file. Choose the type carefully: 'user' for your private preferences, 'feedback' for private feedback, 'project' for team-shared project knowledge, 'reference' for team-shared references. The content persists across tasks and sessions.",
		parameters: MemoryWriteParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as { type: MemoryType; topic: string; content: string; shared?: boolean; member?: string };
			try {
				const selfName = opts.manager.getSelfMemberName();
				const targetMember = args.member ?? selfName;
				if (!targetMember) {
					return { content: [{ type: "text" as const, text: "Error: no member specified and you are not a team member." }], details: {}, isError: true };
				}

				// Only project/reference can be shared
				const shared = args.shared === true && (args.type === "project" || args.type === "reference");

				opts.manager.writeMemory({
					memberName: targetMember,
					type: args.type as MemoryType,
					topic: args.topic,
					content: args.content,
					shared,
				});

				const location = shared ? "shared/" : `members/${targetMember}/`;
				return {
					content: [{ type: "text" as const, text: `Memory written: ${location}${args.topic}.md [${args.type}]` }],
					details: {},
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], details: {}, isError: true };
			}
		},
	};
}
