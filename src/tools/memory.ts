import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryType, TeamManagerLike, TeamManagerRef } from "../teams/types-v2.js";

interface MemoryToolOptions {
	teamRef: TeamManagerRef;
}

const ActionSchema = Type.Union(
	[Type.Literal("write"), Type.Literal("read"), Type.Literal("update-self")],
	{
		description:
			"Memory action: write=save a topic, read=read member index or topic, update-self=update your own index",
	},
);

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

const MemoryParamsSchema = Type.Object({
	action: ActionSchema,
	type: Type.Optional(MemoryTypeSchema),
	topic: Type.Optional(
		Type.String({ description: "Topic name (kebab-case, e.g. 'preferences', 'api-reference')" }),
	),
	content: Type.Optional(Type.String({ description: "Content to write (for write/update-self)" })),
	shared: Type.Optional(
		Type.Boolean({
			description: "For project/reference: write to shared/ directory. Default false.",
		}),
	),
	name: Type.Optional(
		Type.String({
			description:
				"Member name. For read: whose index/topic to read (omit for yourself). For write: write memory for another member (leader only).",
		}),
	),
	section: Type.Optional(Type.Union([Type.Literal("active-context"), Type.Literal("goal")])),
});

export function createMemoryTool(opts: MemoryToolOptions): ToolDefinition {
	return {
		name: "memory",
		label: "Memory",
		description:
			"Persistent memory for you and your team. Actions:\n" +
			'- write: Save a memory topic. Types: "user" (your preferences), "feedback" (feedback you got), "project" (team-shared knowledge), "reference" (team-shared reference material).\n' +
			'  Example: memory(action="write", type="project", topic="api-conventions", content="All endpoints use kebab-case...")\n' +
			"  For project/reference, set shared=true to write to the shared/ directory.\n" +
			"- read: View a member's index (their profile, context, and memory list) or a specific topic.\n" +
			'  Example: memory(action="read", name="sasha") — see Sasha\'s full index\n' +
			'  Example: memory(action="read", name="sasha", topic="preferences") — read one topic\n' +
			"  Omit name to read your own index.\n" +
			"- update-self: Update your own active-context or goal. Keeps your index fresh as you work.\n" +
			'  Example: memory(action="update-self", section="active-context", content="Now investigating the auth flow...")\n' +
			"Memories persist across tasks and sessions. Write what's worth remembering.",
		parameters: MemoryParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const manager = opts.teamRef.current;
			if (!manager) return err("Team manager not available yet — try again in a moment.");
			const args = params as {
				action: string;
				type?: MemoryType;
				topic?: string;
				content?: string;
				shared?: boolean;
				name?: string;
				section?: "active-context" | "goal";
			};
			try {
				switch (args.action) {
					case "write":
						return handleWrite(manager, args);
					case "read":
						return handleRead(manager, args);
					case "update-self":
						return handleUpdateSelf(manager, args);
					default:
						return err(`Unknown action: ${args.action}`);
				}
			} catch (e) {
				return err(e instanceof Error ? e.message : String(e));
			}
		},
	};
}

function handleWrite(manager: TeamManagerLike, args: Record<string, unknown>) {
	const type = args.type as MemoryType | undefined;
	const topic = args.topic as string | undefined;
	const content = args.content as string | undefined;
	if (!type) return err("type is required for write");
	if (!topic) return err("topic is required for write");
	if (!content) return err("content is required for write");

	const selfName = manager.getSelfMemberName();
	const isSharedWrite = args.shared === true && (type === "project" || type === "reference");
	// Leader (no selfMemberName) can write shared memory without specifying a member name.
	// For non-shared writes, a member name is required.
	const targetMember = (args.name as string) || selfName || (isSharedWrite ? "leader" : undefined);
	if (!targetMember) return err("no member specified and you are not a team member");

	manager.writeMemory({
		memberName: targetMember,
		type,
		topic,
		content,
		shared: isSharedWrite,
	});

	const location = isSharedWrite ? "shared/" : `members/${targetMember}/`;
	return ok(`Memory written: ${location}${topic}.md [${type}]`);
}

function handleRead(manager: TeamManagerLike, args: Record<string, unknown>) {
	const name = (args.name as string) || manager.getSelfMemberName();
	if (!name) {
		// Leader (no selfMemberName) without a name arg: show shared memory index
		const teamMd = manager.readTeamMd();
		if (teamMd.sharedMemoryIndex.length === 0) {
			return ok(
				"No shared memories yet. Use memory(action='write', type='project', shared=true, ...) to create one.",
			);
		}
		const lines = ["Shared Memories:"];
		for (const s of teamMd.sharedMemoryIndex) {
			lines.push(`  - ${s.path} — ${s.description}`);
		}
		return ok(lines.join("\n"));
	}

	const selfName = manager.getSelfMemberName();
	if (selfName && args.name && (args.name as string) !== selfName) {
		if (manager.isSelfMember(selfName)) {
			return err("cannot read other member's private memory.");
		}
	}

	const topic = args.topic as string | undefined;
	if (topic) {
		const topicData = manager.readTopicFile(name, topic);
		if (!topicData) return err(`Topic "${topic}" not found for member "${name}".`);
		const header = `[Memory: ${topic} (${topicData.type}) — updated ${topicData.updated}]`;
		return ok(`${header}\n${topicData.content}`);
	}

	const index = manager.readMemberIndex(name);
	if (!index) return err(`Member "${name}" index not found.`);

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
	return ok(lines.join("\n"));
}

function handleUpdateSelf(manager: TeamManagerLike, args: Record<string, unknown>) {
	const section = args.section as "active-context" | "goal" | undefined;
	const content = args.content as string | undefined;
	if (!section) return err("section is required for update-self");
	if (!content) return err("content is required for update-self");

	const selfName = manager.getSelfMemberName();
	if (!selfName) return err("you are not a team member");

	const index = manager.readMemberIndex(selfName);
	if (!index) return err("your index file not found");

	if (section === "active-context") {
		index.activeContext = content;
	} else if (section === "goal") {
		index.profile.goal = content;
	}

	return ok(`Your ${section} updated.`);
}

function ok(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function err(text: string) {
	return {
		content: [{ type: "text" as const, text: `Error: ${text}` }],
		details: {},
		isError: true,
	};
}
