import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TeamManagerLike } from "../teams/types-v2.js";

interface MemberDirectToolOptions {
	manager: TeamManagerLike;
}

const MemberDirectParamsSchema = Type.Object({
	name: Type.String({ description: "Member name to direct" }),
	kind: Type.Union([Type.Literal("directive"), Type.Literal("context"), Type.Literal("redirect")], {
		description:
			"Message kind: directive (instruction), context (supplementary info), redirect (change direction)",
	}),
	payload: Type.String({ description: "Message content to send to the member" }),
});

interface MemberDirectParams {
	name: string;
	kind: "directive" | "context" | "redirect";
	payload: string;
}

export function createMemberDirectTool(opts: MemberDirectToolOptions): ToolDefinition {
	return {
		name: "member-direct",
		label: "Member Direct",
		description:
			"Send a structured message to a running team member. Use 'directive' for instructions, 'context' for supplementary info, 'redirect' to change their direction. Member must be active.",
		parameters: MemberDirectParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as MemberDirectParams;
			try {
				opts.manager.directMember(args.name, args.kind, args.payload);
				return {
					content: [
						{ type: "text" as const, text: `Message sent to ${args.name} [${args.kind}].` },
					],
					details: {},
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Error: ${msg}` }],
					details: {},
					isError: true,
				};
			}
		},
	};
}
