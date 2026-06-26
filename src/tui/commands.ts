export interface SlashCommand {
	name: string
	description: string
	usage?: string
}

export const slashCommands: SlashCommand[] = [
	{ name: "clear", description: "Clear conversation history", usage: "/clear" },
	{ name: "compact", description: "Compact context to save tokens", usage: "/compact [instructions]" },
	{ name: "model", description: "Switch to next model", usage: "/model" },
	{ name: "thinking", description: "Cycle thinking level", usage: "/thinking" },
	{ name: "context", description: "Toggle context display (compact/full)", usage: "/context" },
	{ name: "exit", description: "Quit the application", usage: "/exit" },
	{ name: "help", description: "Show available commands", usage: "/help" },
]

export function matchCommands(input: string): SlashCommand[] {
	const trimmed = input.replace(/^\//, "")
	if (!trimmed) return slashCommands
	return slashCommands.filter((cmd) => cmd.name.startsWith(trimmed))
}

export function buildHelpText(): string {
	const maxName = Math.max(...slashCommands.map((c) => c.name.length))
	const commandLines = slashCommands
		.map((c) => `  /${c.name.padEnd(maxName)}  — ${c.description}`)
		.join("\n")
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
	].join("\n")
}
