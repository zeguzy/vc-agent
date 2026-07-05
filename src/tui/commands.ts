import { buildAgentModeCycle, getBaseMode } from "../agent/session.js";
import { type CommandContext, commandRegistry } from "../commands/registry.js";
import { writeConfig } from "../config.js";
import {
	type CompressNotificationSummary,
	getDcpConfig,
	getDcpState,
	isDcpEnabled,
	setCompressNotifier,
	setDcpRuntimeEnabled,
	triggerDirectCompress,
} from "../dcp/config.js";
import {
	createAssistantMessage,
	createSeparator,
	createUserMessage,
	type Message,
} from "../message.js";
import { modelSetting } from "../settings/definitions.js";
import type { SkillManager } from "../skills/manager.js";
import { extractTodoItems } from "../tools/todo.js";
import { formatError } from "../utils/formatError.js";

export interface SuggestionItem {
	name: string;
	description: string;
	type: "command" | "skill";
}

async function showSessions(ctx: CommandContext): Promise<void> {
	try {
		const sessions = await ctx.client.listSessions();
		ctx.openSessionPicker(sessions);
	} catch (err) {
		ctx.setMessages((prev) => [
			...prev,
			createAssistantMessage(`加载会话列表失败: ${formatError(err)}`),
		]);
	}
}

export function registerBuiltinCommands(): void {
	commandRegistry.register({
		name: "clear",
		description: "Clear conversation history",
		usage: "/clear",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.setMessages([]);
		},
	});

	commandRegistry.register({
		name: "compact",
		description: "Compact context to save tokens",
		usage: "/compact [instructions]",
		handler: (args: string, ctx: CommandContext) => {
			ctx.setMessages((prev) => [...prev, createUserMessage(`/compact ${args}`.trim())]);
			ctx.client.compact(args || undefined).catch((err) => {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(`Compaction failed: ${formatError(err)}`),
				]);
			});
		},
	});

	commandRegistry.register({
		name: "dcp",
		description: "DCP context pruning: status / toggle on|off",
		usage: "/dcp [on|off]",
		handler: (args: string, ctx: CommandContext) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on" || arg === "off") {
				const value = arg === "on";
				setDcpRuntimeEnabled(value);
				const prev = ctx.getConfig();
				const newConfig = {
					...prev,
					contextPruning: { ...prev.contextPruning, enabled: value },
				};
				ctx.setConfig(newConfig);
				try {
					writeConfig(ctx.cwd, newConfig, "project");
				} catch (err) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage(
							`DCP 已${value ? "开启" : "关闭"}（未持久化: ${formatError(err)}）`,
						),
					]);
					return;
				}
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(`DCP 已${value ? "开启" : "关闭"}，立刻生效。`),
				]);
			} else {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(formatDcpStatus(getDcpConfig(), getDcpState())),
				]);
			}
		},
	});

	commandRegistry.register({
		name: "dcp-compress",
		description: "Immediately compress older messages (keeps recent 4)",
		usage: "/dcp-compress [topic]",
		handler: (args: string, ctx: CommandContext) => {
			const topic = args.trim();
			const enabled = isDcpEnabled(getDcpConfig());
			if (!enabled) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage("DCP 当前未开启。先 /dcp on 再用 /dcp-compress。"),
				]);
				return;
			}
			const result = triggerDirectCompress({ keepRecent: 4, topic });
			if (result.error) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(`DCP 压缩未执行: ${result.error}`),
				]);
				return;
			}
			ctx.setMessages((prev) => [
				...prev,
				createAssistantMessage(
					`✓ DCP 已压缩 ${result.compressed} 条消息，节省 ~${result.tokens} tokens。下次对话起生效。`,
				),
			]);
		},
	});

	commandRegistry.register({
		name: "model",
		description: "Switch to next model",
		usage: "/model",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.client
				.cycleModel()
				.then((result) => {
					if (result) {
						ctx.setMessages((prev) => [
							...prev,
							createAssistantMessage(`Switched to ${result.model.name}`),
						]);
						const newConfig = modelSetting.persist(ctx.getConfig(), result.model.id);
						ctx.setConfig(newConfig);
						try {
							writeConfig(ctx.cwd, newConfig, "project");
						} catch (err) {
							ctx.setMessages((prev) => [
								...prev,
								createAssistantMessage(`Applied but not saved: ${formatError(err)}`),
							]);
						}
					}
				})
				.catch((err) => {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage(`切换模型失败: ${formatError(err)}`),
					]);
				});
		},
	});

	commandRegistry.register({
		name: "todos",
		description: "Show current TODO list",
		usage: "/todos",
		handler: (_args: string, ctx: CommandContext) => {
			const todos = extractTodoItems(ctx.messages);
			if (todos.length === 0) {
				ctx.setMessages((prev) => [...prev, createAssistantMessage("No todos.")]);
				return;
			}
			const completed = todos.filter((t) => t.status === "completed").length;
			const cancelled = todos.filter((t) => t.status === "cancelled").length;
			const effective = todos.length - cancelled;
			const lines = todos.map((t) => {
				const mark =
					t.status === "completed"
						? "✓"
						: t.status === "in_progress"
							? "•"
							: t.status === "cancelled"
								? "✗"
								: " ";
				return `  [${mark}] ${t.content}`;
			});
			const progress = `# Todos (${completed}/${effective}${cancelled > 0 ? `, ${cancelled} cancelled` : ""})`;
			ctx.setMessages((prev) => [
				...prev,
				createAssistantMessage(`${progress}\n${lines.join("\n")}`),
			]);
		},
	});

	commandRegistry.register({
		name: "plan",
		description: "Cycle agent mode (standard → planner → orchestrator)",
		usage: "/plan",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.setAgentMode((prev) => {
				const cycle = buildAgentModeCycle(ctx.getConfig());
				const next = cycle[prev] ?? getBaseMode(ctx.getConfig());
				ctx.client.setAgentMode(next);
				return next;
			});
		},
	});

	commandRegistry.register({
		name: "orchestrate",
		description: "Switch to orchestrator mode (proactive subagent delegation)",
		usage: "/orchestrate",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.setAgentMode((prev) => {
				if (prev === "orchestrator") {
					return prev;
				}
				ctx.client.setAgentMode("orchestrator");
				return "orchestrator";
			});
		},
	});

	commandRegistry.register({
		name: "exit",
		description: "Quit the application",
		usage: "/exit",
		handler: () => {
			process.exit(0);
		},
	});

	commandRegistry.register({
		name: "setting",
		description: "Open settings panel",
		usage: "/setting",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.setShowSettings(true);
		},
	});

	commandRegistry.register({
		name: "help",
		description: "Show available commands",
		usage: "/help",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.setMessages((prev) => [...prev, createAssistantMessage(buildHelpText())]);
		},
	});

	commandRegistry.register({
		name: "sessions",
		description: "List sessions for the current directory",
		usage: "/sessions",
		handler: (_args, ctx) => showSessions(ctx),
	});

	commandRegistry.register({
		name: "new",
		description: "Start a new session (hot-swap)",
		usage: "/new",
		handler: async (_args, ctx) => {
			try {
				const { cancelled } = await ctx.client.newSession();
				if (cancelled) {
					ctx.setMessages((prev) => [...prev, createAssistantMessage("已取消新建会话。")]);
				}
			} catch (err) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(`新建会话失败: ${formatError(err)}`),
				]);
			}
		},
	});

	commandRegistry.register({
		name: "name",
		description: "Name the current session",
		usage: "/name [text]",
		handler: (args, ctx) => {
			const text = args.trim();
			if (!text) {
				const current = ctx.client.getSessionName();
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(
						current ? `当前会话名称: ${current}` : "当前会话未命名。用法: /name <text>",
					),
				]);
				return;
			}
			ctx.client.setSessionName(text);
			ctx.setMessages((prev) => [...prev, createAssistantMessage(`已命名当前会话: ${text}`)]);
		},
	});

	commandRegistry.register({
		name: "skills",
		description: "List all loaded skills (auto + dynamic)",
		usage: "/skills",
		handler: (_args: string, ctx: CommandContext) => {
			const skillManager = ctx.client.getSkillManager();
			const result = skillManager.listSkills();
			if (result.skills.length === 0) {
				ctx.setMessages((prev) => [...prev, createAssistantMessage("No skills loaded.")]);
				return;
			}

			const dirs = skillManager.getDefaultDirectories();
			const header = [
				"Loaded skills:",
				`  Global dir: ${dirs.global}`,
				`  Project dir: ${dirs.project}`,
				"",
			];

			const lines: string[] = [];
			for (const s of result.skills) {
				const tag = s.source === "auto" ? "🔄 auto" : "⚡ dynamic";
				const invocation = s.disableModelInvocation ? "  (manual only: /skill:name)" : "";
				lines.push(`  ${tag}  ${s.name} — ${s.description}${invocation}`);
			}

			if (result.diagnostics.length > 0) {
				lines.push("", "Diagnostics:");
				for (const d of result.diagnostics) {
					lines.push(`  ⚠ ${d.message}`);
				}
			}

			ctx.setMessages((prev) => [
				...prev,
				createAssistantMessage([...header, ...lines].join("\n")),
			]);
		},
	});

	commandRegistry.register({
		name: "load-skill",
		description: "Dynamically load a skill from a file or directory",
		usage: "/load-skill <path>",
		handler: async (args: string, ctx: CommandContext) => {
			const path = args.trim();
			if (!path) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(
						"Usage: /load-skill <path>\nProvide a path to a SKILL.md file or a directory containing one.",
					),
				]);
				return;
			}
			try {
				const result = await ctx.client.getSkillManager().loadDynamicSkill(path);
				const skill = result.skill;
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(
						`Loaded skill: ${skill.name} — ${skill.description}\n  Path: ${skill.filePath}` +
							(skill.disableModelInvocation
								? `\n  Invocation: /skill:${skill.name}`
								: "\n  Invocation: auto (injected into system prompt)"),
					),
				]);
			} catch (err) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(`Failed to load skill: ${formatError(err)}`),
				]);
			}
		},
	});

	commandRegistry.register({
		name: "unload-skill",
		description: "Unload a dynamically loaded skill",
		usage: "/unload-skill <name>",
		handler: (args: string, ctx: CommandContext) => {
			const name = args.trim();
			if (!name) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(
						"Usage: /unload-skill <skill-name>\nProvide the name of a dynamically loaded skill to unload.",
					),
				]);
				return;
			}
			const removed = ctx.client.getSkillManager().unloadDynamicSkill(name);
			if (removed) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(`Unloaded dynamic skill: ${name}`),
				]);
			} else {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(
						`Skill "${name}" not found or is not a dynamically loaded skill.\nUse /skills to see all loaded skills.`,
					),
				]);
			}
		},
	});

	commandRegistry.register({
		name: "undo",
		description: "Undo the last conversation turn",
		usage: "/undo",
		handler: async (_args, ctx) => {
			if (ctx.isRunning) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage("Agent 正在运行，请先等待完成或 /abort。"),
				]);
				return;
			}
			try {
				const session = ctx.client.getSession();
				const userMsgs = session.getUserMessagesForForking();
				if (userMsgs.length === 0) {
					ctx.setMessages((prev) => [...prev, createAssistantMessage("没有可撤销的对话。")]);
					return;
				}
				const lastUser = userMsgs[userMsgs.length - 1];
				const parentId = session.sessionManager.getEntry(lastUser.entryId)?.parentId;
				if (!parentId) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage("已是会话开头，无法继续撤销。"),
					]);
					return;
				}
				const result = await session.navigateTree(parentId);
				if (result.cancelled) {
					ctx.setMessages((prev) => [...prev, createAssistantMessage("已取消撤销。")]);
					return;
				}
				ctx.setMessages(ctx.client.getMappedMessages());
				ctx.setInputText(lastUser.text);
			} catch (err) {
				const msg =
					err instanceof Error && err.name === "NotSupportedError"
						? "/undo 仅在本地模式可用。"
						: `撤销失败: ${formatError(err)}`;
				ctx.setMessages((prev) => [...prev, createAssistantMessage(msg)]);
			}
		},
	});

	commandRegistry.register({
		name: "team",
		description: "Team member management: list / remove / pause / resume / cancel",
		usage:
			"/team list | /team remove <name> | /team pause <name> | /team resume <name> | /team cancel <name>",
		handler: (args: string, ctx: CommandContext) => {
			const config = ctx.getConfig();
			if (config.teams?.enabled === false) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage("Teams mode is disabled in config (teams.enabled=false)."),
				]);
				return;
			}

			const parts = args.trim().split(/\s+/);
			const sub = parts[0]?.toLowerCase();

			if (sub === "list") {
				const members = ctx.client.listMembers();
				if (members.length === 0) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage("No team members yet. Use the team tool to create one."),
					]);
					return;
				}
				const lines = members.map((m) => {
					const task = m.currentTaskId ? ` task=${m.currentTaskId}` : "";
					return `  [${m.status}] ${m.name} (${m.role})${task}`;
				});
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(`Members (${members.length}):\n${lines.join("\n")}`),
				]);
				return;
			}

			if (sub === "remove") {
				const name = parts[1];
				if (!name) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage("/team remove <name> — name required"),
					]);
					return;
				}
				ctx.client
					.removeMember(name)
					.then(() => {
						ctx.setMessages((prev) => [
							...prev,
							createAssistantMessage(`Member "${name}" removed and archived.`),
						]);
					})
					.catch((err: Error) => {
						ctx.setMessages((prev) => [
							...prev,
							createAssistantMessage(`Remove failed: ${formatError(err)}`),
						]);
					});
				return;
			}

			if (sub === "pause") {
				const name = parts[1];
				if (!name) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage("/team pause <name> — name required"),
					]);
					return;
				}
				try {
					ctx.client.pauseMember(name);
					ctx.setMessages((prev) => [...prev, createAssistantMessage(`Member "${name}" paused.`)]);
				} catch (err) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage(`Pause failed: ${formatError(err)}`),
					]);
				}
				return;
			}

			if (sub === "resume") {
				const name = parts[1];
				if (!name) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage("/team resume <name> — name required"),
					]);
					return;
				}
				try {
					ctx.client.resumeMember(name);
					ctx.setMessages((prev) => [...prev, createAssistantMessage(`Member "${name}" resumed.`)]);
				} catch (err) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage(`Resume failed: ${formatError(err)}`),
					]);
				}
				return;
			}

			if (sub === "cancel") {
				const name = parts[1];
				if (!name) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage("/team cancel <name> — name required"),
					]);
					return;
				}
				try {
					ctx.client.cancelMember(name);
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage(`Member "${name}" cancelled.`),
					]);
				} catch (err) {
					ctx.setMessages((prev) => [
						...prev,
						createAssistantMessage(`Cancel failed: ${formatError(err)}`),
					]);
				}
				return;
			}

			ctx.setMessages((prev) => [
				...prev,
				createAssistantMessage(
					"/team list | /team remove <name> | /team pause <name> | /team resume <name> | /team cancel <name>",
				),
			]);
		},
	});

	commandRegistry.register({
		name: "workers",
		description: "Show team members panel",
		usage: "/workers",
		handler: (_args: string, ctx: CommandContext) => {
			const config = ctx.getConfig();
			if (config.teams?.enabled === false) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage("Teams mode is disabled in config (teams.enabled=false)."),
				]);
				return;
			}
			const members = ctx.client.listMembers();
			if (members.length === 0) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage("No team members yet. Use the team tool to create one."),
				]);
				return;
			}
			ctx.setShowWorkers(true);
		},
	});
}

/**
 * Match commands for autocomplete.
 * Delegates to the global commandRegistry.
 */
export function matchCommands(input: string): ReturnType<typeof commandRegistry.match> {
	return commandRegistry.match(input);
}

/**
 * Match commands AND loaded skills for autocomplete.
 * Skills appear as /skill:name entries, mixed with regular commands.
 */
export function matchSuggestions(
	input: string,
	skillManager: SkillManager | null,
): SuggestionItem[] {
	const commands = matchCommands(input);
	const items: SuggestionItem[] = commands.map((c) => ({
		name: c.name,
		description: c.description,
		type: "command" as const,
	}));

	if (skillManager) {
		const trimmed = input.replace(/^\//, "");
		const skills = skillManager.listSkills().skills;
		for (const s of skills) {
			const fullName = `skill:${s.name}`;
			if (!trimmed || fullName.startsWith(trimmed)) {
				items.push({ name: fullName, description: s.description, type: "skill" });
			}
		}
	}

	items.sort((a, b) => a.name.localeCompare(b.name));
	return items;
}

/**
 * Build the help text from all registered commands.
 */
export function buildHelpText(): string {
	const commands = commandRegistry.getAll();
	const maxName = Math.max(...commands.map((c) => c.name.length), 0);
	const commandLines = commands
		.map((c) => {
			const name = `/${c.name}`.padEnd(maxName + 1);
			const usage = c.usage ? ` (${c.usage})` : "";
			return `  ${name}  — ${c.description}${usage}`;
		})
		.join("\n");

	return [
		"Available commands:",
		commandLines,
		"",
		"Shortcuts:",
		"  INSERT mode:",
		"    Enter          Send message",
		"    Shift+Enter    Insert newline",
		"    Esc            Enter NORMAL mode",
		"    Ctrl+C         Abort agent · press twice quickly to quit",
		"  NORMAL mode:",
		"    i · a · o      Enter INSERT mode",
		"    j · k          Scroll down / up",
		"    g · G          Scroll to top / bottom",
		"    t              Toggle thinking collapse",
		"    Tab            Cycle agent mode (standard/team/planner/orchestrator)",
	].join("\n");
}

const COMPRESS_NOTIFIER_GUARD = "__vcAgentDcpNotifierRegistered";

type SetMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => void;

export function attachDcpCompressNotifier(setMessages: SetMessages): void {
	const g = globalThis as { [COMPRESS_NOTIFIER_GUARD]?: boolean };
	if (g[COMPRESS_NOTIFIER_GUARD]) return;
	g[COMPRESS_NOTIFIER_GUARD] = true;
	setCompressNotifier((summary) => {
		if (getDcpConfig().pruneNotificationType !== "chat") return;
		setMessages((prev) => [
			...prev,
			createSeparator(),
			createAssistantMessage(formatCompressNotification(summary)),
		]);
	});
}

function formatCompressNotification(s: CompressNotificationSummary): string {
	const topic = s.topic && s.topic.trim().length > 0 ? s.topic.trim() : "(unknown topic)";
	const itemsPart =
		s.toolCount > 0
			? `${s.messageCount} messages and ${s.toolCount} tools compressed`
			: `${s.messageCount} message${s.messageCount === 1 ? "" : "s"} compressed`;
	const lines = [
		`📝 DCP: Compressed ${itemsPart} (saved ~${s.savedTokens.toLocaleString()} tokens)`,
		`→ Topic: ${topic}`,
	];
	if (s.summary && s.summary.trim().length > 0) {
		const preview = s.summary.length > 600 ? `${s.summary.slice(0, 597)}...` : s.summary;
		lines.push(`→ Compression #${s.runId} (~${s.summaryTokens}): ${preview}`);
	}
	return lines.join("\n");
}

function formatDcpStatus(
	config: ReturnType<typeof getDcpConfig>,
	state: ReturnType<typeof getDcpState>,
): string {
	const enabled = isDcpEnabled(config);
	const lines = [`DCP 上下文压缩: ${enabled ? "on ✅" : "off"}`, `模式: ${config.compress.mode}`];
	if (state) {
		const activeBlocks = state.prune.messages.activeBlockIds.size;
		const cumulativeTokens = state.stats.totalPruneTokens + state.stats.pruneTokenCounter;
		lines.push(
			`Active 压缩块: ${activeBlocks}`,
			`累计压缩 token: ${cumulativeTokens.toLocaleString()}`,
		);
	} else {
		lines.push("（DCP extension 尚未激活，无统计数据）");
	}
	lines.push(
		"",
		"用法: /dcp on|off（立刻生效） · /dcp-compress [focus]（手动触发） · /setting 切换",
	);
	return lines.join("\n");
}
