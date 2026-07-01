import { type CommandContext, commandRegistry } from "../commands/registry.js";
import { writeConfig } from "../config.js";
import { createAssistantMessage, createUserMessage } from "../message.js";
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
		name: "context",
		description: "Toggle context display (compact/full)",
		usage: "/context",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.setContextDisplay((d) => (d === "compact" ? "full" : "compact"));
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
			const lines = todos.map(
				(t) =>
					`  [${t.status === "completed" ? "✓" : t.status === "in_progress" ? "•" : " "}] ${t.content}`,
			);
			ctx.setMessages((prev) => [
				...prev,
				createAssistantMessage(`# Todos (${completed}/${todos.length})\n${lines.join("\n")}`),
			]);
		},
	});

	commandRegistry.register({
		name: "plan",
		description: "Toggle planner mode (read-only exploration)",
		usage: "/plan",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.setAgentMode((prev) => {
				const next = prev === "standard" ? "planner" : "standard";
				ctx.client.setAgentMode(next);
				ctx.setMessages((msgs) => [
					...msgs,
					createAssistantMessage(
						next === "planner"
							? "📋 Planner mode — edit/write tools disabled. Use /plan or Tab to switch back."
							: "▶ Standard mode — all tools available.",
					),
				]);
				return next;
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
		"    Tab            Toggle planner mode (read-only)",
	].join("\n");
}
