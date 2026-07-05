import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TeamManagerLike } from "../teams/types-v2.js";

interface MemberEditToolOptions {
	manager: TeamManagerLike;
}

const MemberEditParamsSchema = Type.Object({
	name: Type.String({ description: "Member name to edit" }),
	section: Type.Union(
		[
			Type.Literal("profile"),
			Type.Literal("active-context"),
			Type.Literal("goal"),
		],
		{ description: "Which section to update" },
	),
	content: Type.String({ description: "New content for the section" }),
});

interface MemberEditParams {
	name: string;
	section: "profile" | "active-context" | "goal";
	content: string;
}

export function createMemberEditTool(opts: MemberEditToolOptions): ToolDefinition {
	return {
		name: "member-edit",
		label: "Member Edit",
		description:
			"Edit a member's index file. Only the leader can use this. Use 'profile' to update role info, 'active-context' to set their current context, 'goal' to update their goal.",
		parameters: MemberEditParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as MemberEditParams;
			try {
				const index = opts.manager.readMemberIndex(args.name);
				if (!index) {
					return { content: [{ type: "text" as const, text: `Member "${args.name}" not found.` }], details: {}, isError: true };
				}

				if (args.section === "profile") {
					index.profile.role = args.content;
				} else if (args.section === "active-context") {
					index.activeContext = args.content;
				} else if (args.section === "goal") {
					index.profile.goal = args.content;
				}

				return { content: [{ type: "text" as const, text: `Member "${args.name}" ${args.section} updated.` }], details: {} };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], details: {}, isError: true };
			}
		},
	};
}
