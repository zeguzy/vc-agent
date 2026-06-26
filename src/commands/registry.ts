import type { AgentSession } from "../agent/session.js";
import type { Config } from "../config.js";
import type { SkillManager } from "../skills/manager.js";

/**
 * Context passed to every command handler.
 * Provides access to the session, skill system, and UI state.
 */
export interface CommandContext {
	session: AgentSession;
	skillManager: SkillManager;
	messages: import("../store.js").Message[];
	setMessages: (
		updater:
			| import("../store.js").Message[]
			| ((prev: import("../store.js").Message[]) => import("../store.js").Message[]),
	) => void;
	setIsRunning: (running: boolean) => void;
	setContextUsage: (usage: {
		tokens: number | null;
		window: number | null;
		percent: number | null;
	}) => void;
	setThinkingCollapsed: (collapsed: boolean) => void;
	setContextDisplay: (
		display: "compact" | "full" | ((prev: "compact" | "full") => "compact" | "full"),
	) => void;
	cwd: string;
	setShowSettings: (v: boolean) => void;
	getConfig: () => Config;
	setConfig: (updater: Config | ((prev: Config) => Config)) => void;
}

/**
 * A registered slash command with name, description, usage, and handler.
 */
export interface Command {
	/** Command name (without the leading /, e.g. "clear") */
	name: string;
	/** Short description shown in /help */
	description: string;
	/** Usage syntax shown in /help (e.g. "/compact [instructions]") */
	usage?: string;
	/** Execute the command. Return a promise if async. */
	handler: (args: string, ctx: CommandContext) => void | Promise<void>;
}

/**
 * CommandRegistry — a pluggable registry for slash commands.
 *
 * Commands can be registered by:
 * - Built-in system commands (defined at startup)
 * - Skills that define custom commands
 * - Dynamic runtime registration
 */
export class CommandRegistry {
	private _commands = new Map<string, Command>();

	/**
	 * Register a command. Throws if a command with the same name already exists.
	 */
	register(cmd: Command): void {
		if (this._commands.has(cmd.name)) {
			throw new Error(`Command already registered: /${cmd.name}`);
		}
		this._commands.set(cmd.name, cmd);
	}

	/**
	 * Register a command, silently replacing any existing command with the same name.
	 */
	registerOrReplace(cmd: Command): void {
		this._commands.set(cmd.name, cmd);
	}

	/**
	 * Get a command by name.
	 */
	get(name: string): Command | undefined {
		return this._commands.get(name);
	}

	/**
	 * Get all registered commands, sorted by name.
	 */
	getAll(): Command[] {
		return [...this._commands.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Fuzzy-prefix-match commands against the input (without leading /).
	 * Used by the autocomplete system in InputBox.
	 */
	match(input: string): Command[] {
		const trimmed = input.replace(/^\//, "");
		if (!trimmed) return this.getAll();
		return this.getAll().filter((cmd) => cmd.name.startsWith(trimmed));
	}

	/**
	 * Execute a command by name. Returns true if the command was found and executed,
	 * false if no command with that name exists.
	 */
	async execute(name: string, args: string, ctx: CommandContext): Promise<boolean> {
		const cmd = this._commands.get(name);
		if (!cmd) return false;
		await cmd.handler(args, ctx);
		return true;
	}

	/**
	 * Remove a command by name. Returns true if it existed.
	 */
	unregister(name: string): boolean {
		return this._commands.delete(name);
	}

	/**
	 * Get the number of registered commands.
	 */
	get size(): number {
		return this._commands.size;
	}
}

/**
 * Global singleton registry instance.
 * Import this to register commands from any module.
 */
export const commandRegistry = new CommandRegistry();
