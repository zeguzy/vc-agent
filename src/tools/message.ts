import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TeamManagerLike, TeamManagerRef } from "../teams/types-v2.js";

interface MessageToolOptions {
	teamRef: TeamManagerRef;
	/**
	 * Identity of the tool's owner, captured at member-session creation time.
	 * Falls back to manager.getSelfMemberName() for the leader's tool instance
	 * (leader sends as "leader"). This fixes the identity bug where a shared
	 * TeamManager returns the same selfMemberName for every member.
	 */
	selfName?: string;
}

const ActionSchema = Type.Union(
	[
		Type.Literal("send"),
		Type.Literal("broadcast"),
		Type.Literal("read"),
		Type.Literal("mark-read"),
	],
	{
		description:
			"Message action: send=direct to one member, broadcast=all members, read=your inbox, mark-read=mark messages read",
	},
);

const MessageParamsSchema = Type.Object({
	action: ActionSchema,
	to: Type.Optional(Type.String({ description: "Recipient member name (for send)" })),
	content: Type.Optional(
		Type.String({
			description: "Message content (for send/broadcast). Be concise — under 500 chars.",
		}),
	),
	from: Type.Optional(
		Type.String({
			description: "Filter by sender (for read). Omit for all senders.",
		}),
	),
	unreadOnly: Type.Optional(
		Type.Boolean({ description: "Only return unread messages (for read). Default false." }),
	),
	ids: Type.Optional(
		Type.Array(Type.String(), {
			description: "Specific message ids to mark read (for mark-read). Omit to mark all.",
		}),
	),
});

export function createMessageTool(opts: MessageToolOptions): ToolDefinition {
	return {
		name: "message",
		label: "Message",
		description:
			"Talk to your teammates directly. Actions:\n" +
			"- send: Send a message to one teammate. They get it immediately if active, otherwise it lands in their inbox.\n" +
			'  Example: message(action="send", to="alice", content="What auth lib are you using?")\n' +
			"- broadcast: Send a message to everyone except yourself. Use sparingly — one per minute max.\n" +
			'  Example: message(action="broadcast", content="Heads up: I\'m refactoring utils.ts, expect breakage for ~5min")\n' +
			"- read: Read your inbox. Shows messages teammates sent you.\n" +
			'  Example: message(action="read") — all messages\n' +
			'  Example: message(action="read", unreadOnly=true) — only new ones\n' +
			'  Example: message(action="read", from="alice") — from one teammate\n' +
			"- mark-read: Mark messages read so they stop showing as unread.\n" +
			'  Example: message(action="mark-read") — mark all read\n' +
			'  Example: message(action="mark-read", ids=["msg_abc123"]) — specific ones\n' +
			"\nUse messaging for quick coordination: ask a question, share a finding, warn about a conflict. For deep context, write shared memory instead.",
		parameters: MessageParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const manager = opts.teamRef.current;
			if (!manager) return err("Team manager not available yet — try again in a moment.");
			const selfName = opts.selfName ?? manager.getSelfMemberName() ?? "leader";
			const args = params as {
				action: string;
				to?: string;
				content?: string;
				from?: string;
				unreadOnly?: boolean;
				ids?: string[];
			};
			try {
				switch (args.action) {
					case "send":
						return handleSend(manager, selfName, args);
					case "broadcast":
						return handleBroadcast(manager, selfName, args);
					case "read":
						return handleRead(manager, selfName, args);
					case "mark-read":
						return handleMarkRead(manager, selfName, args);
					default:
						return err(`Unknown action: ${args.action}`);
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (isRateLimit(msg)) {
					return ok(`Rate-limited: ${msg}. Wait ~30s before retrying.`);
				}
				return err(msg);
			}
		},
	};
}

function handleSend(
	manager: TeamManagerLike,
	selfName: string,
	args: { to?: string; content?: string },
) {
	const to = args.to;
	const content = args.content;
	if (!to) return err("to is required for send");
	if (!content) return err("content is required for send");
	const result = manager.sendMessage({ from: selfName, to, content });
	return ok(
		`Sent to @${to} [${result.message.id}] delivered=${result.delivery}. ${
			result.delivery === "persist-only"
				? "(They are not active — they will see it in their inbox.)"
				: ""
		}`,
	);
}

function handleBroadcast(manager: TeamManagerLike, selfName: string, args: { content?: string }) {
	const content = args.content;
	if (!content) return err("content is required for broadcast");
	const results = manager.broadcastMessage({ from: selfName, content });
	const steer = results.filter((r) => r.delivery === "steer").length;
	const persist = results.length - steer;
	return ok(
		`Broadcast delivered to ${results.length} member(s): ${steer} immediate, ${persist} in inbox.`,
	);
}

function handleRead(
	manager: TeamManagerLike,
	selfName: string,
	args: { from?: string; unreadOnly?: boolean },
) {
	const messages = manager.readInbox(selfName, {
		from: args.from,
		unreadOnly: args.unreadOnly,
	});
	if (messages.length === 0) {
		return ok(args.unreadOnly ? "No unread messages." : "Inbox is empty.");
	}
	const lines: string[] = [];
	for (const m of messages) {
		const mark = m.read ? " " : "•";
		const fromTag = m.from === "leader" ? "Leader" : `@${m.from}`;
		const time = new Date(m.timestamp).toISOString().slice(11, 19);
		lines.push(`${mark} [${m.id} ${time}] ${fromTag}: ${m.content}`);
	}
	if (args.unreadOnly) {
		lines.push(`\n(${messages.length} unread)`);
	}
	return ok(lines.join("\n"));
}

function handleMarkRead(manager: TeamManagerLike, selfName: string, args: { ids?: string[] }) {
	const count = manager.markInboxRead(selfName, args.ids);
	return ok(`Marked ${count} message(s) read.`);
}

function isRateLimit(msg: string): boolean {
	return (
		msg.startsWith("rate limit") ||
		msg.startsWith("broadcast rate limit") ||
		msg.startsWith("pair cooldown")
	);
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
