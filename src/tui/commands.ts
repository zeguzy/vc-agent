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
