import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TeamManagerLike } from "../teams/types-v2.js";

interface SelfEditToolOptions {
	manager: TeamManagerLike;
}

const SelfEditParamsSchema = Type.Object({
	section: Type.Union(
		[
			Type.Literal("active-context"),
			Type.Literal("goal"),
		],
		{ description: "Which section of your index to update" },
	),
	content: Type.String({ description: "New content for the section" }),
});

export function createSelfEditTool(opts: SelfEditToolOptions): ToolDefinition {
	return {
		name: "self-edit",
		label: "Self Edit",
		description:
			"Edit your own member index file. Use 'active-context' to update what you're currently working on, or 'goal' to refine your goal. This is how you maintain your own persistent context.",
		parameters: SelfEditParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as { section: "active-context" | "goal"; content: string };
			try {
				const selfName = opts.manager.getSelfMemberName();
				if (!selfName) {
					return { content: [{ type: "text" as const, text: "Error: you are not a team member." }], details: {}, isError: true };
				}

				const index = opts.manager.readMemberIndex(selfName);
				if (!index) {
					return { content: [{ type: "text" as const, text: "Error: your index file not found." }], details: {}, isError: true };
				}

				if (args.section === "active-context") {
					index.activeContext = args.content;
				} else if (args.section === "goal") {
					index.profile.goal = args.content;
				}

				return { content: [{ type: "text" as const, text: `Your ${args.section} updated.` }], details: {} };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], details: {}, isError: true };
			}
		},
	};
}
