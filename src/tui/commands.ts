import { type CommandContext, commandRegistry } from "../commands/registry.js";
import { writeConfig } from "../config.js";
import { listSessions } from "../session/list.js";
import { modelSetting } from "../settings/model.js";
import { createAssistantMessage, createUserMessage } from "../store.js";

/**
 * Register all built-in slash commands into the global CommandRegistry.
 */
async function showSessions(ctx: CommandContext): Promise<void> {
	try {
		const sessions = await listSessions(ctx.cwd);
		ctx.openSessionPicker(sessions);
	} catch (err) {
		ctx.setMessages((prev) => [
			...prev,
			createAssistantMessage(
				`加载会话列表失败: ${err instanceof Error ? err.message : String(err)}`,
			),
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
			ctx.session.compact(args || undefined).catch((err) => {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(
						`Compaction failed: ${err instanceof Error ? err.message : String(err)}`,
					),
				]);
			});
		},
	});

	commandRegistry.register({
		name: "model",
		description: "Switch to next model",
		usage: "/model",
		handler: (_args: string, ctx: CommandContext) => {
			ctx.session
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
								createAssistantMessage(
									`Applied but not saved: ${err instanceof Error ? err.message : String(err)}`,
								),
							]);
						}
					}
				})
				.catch(() => {});
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

	// --- Session management commands ---

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
				const { cancelled } = await ctx.runtime.newSession();
				if (cancelled) {
					ctx.setMessages((prev) => [...prev, createAssistantMessage("已取消新建会话。")]);
				}
			} catch (err) {
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(
						`新建会话失败: ${err instanceof Error ? err.message : String(err)}`,
					),
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
				const current = ctx.runtime.session.sessionName;
				ctx.setMessages((prev) => [
					...prev,
					createAssistantMessage(
						current ? `当前会话名称: ${current}` : "当前会话未命名。用法: /name <text>",
					),
				]);
				return;
			}
			ctx.runtime.session.setSessionName(text);
			ctx.setMessages((prev) => [...prev, createAssistantMessage(`已命名当前会话: ${text}`)]);
		},
	});

	// --- Skill management commands ---

	commandRegistry.register({
		name: "skills",
		description: "List all loaded skills (auto + dynamic)",
		usage: "/skills",
		handler: (_args: string, ctx: CommandContext) => {
			const result = ctx.skillManager.listSkills();
			if (result.skills.length === 0) {
				ctx.setMessages((prev) => [...prev, createAssistantMessage("No skills loaded.")]);
				return;
			}

			const dirs = ctx.skillManager.getDefaultDirectories();
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
				const result = await ctx.skillManager.loadDynamicSkill(path);
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
					createAssistantMessage(
						`Failed to load skill: ${err instanceof Error ? err.message : String(err)}`,
					),
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
			const removed = ctx.skillManager.unloadDynamicSkill(name);
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
}

/**
 * Match commands for autocomplete.
 * Delegates to the global commandRegistry.
 */
export function matchCommands(input: string): ReturnType<typeof commandRegistry.match> {
	return commandRegistry.match(input);
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
	].join("\n");
}
