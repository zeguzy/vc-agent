export type Mode = "insert" | "normal";

export interface KeyPattern {
	name: string;
	ctrl?: boolean;
	shift?: boolean;
}

export interface KeyBinding {
	mode: Mode | "*";
	key: KeyPattern | "*";
	action: string;
	desc: string;
}

export const keymap: readonly KeyBinding[] = [
	{ mode: "*", key: { name: "c", ctrl: true }, action: "ctrlC", desc: "Abort / double to exit" },
	{ mode: "insert", key: { name: "escape" }, action: "toNormal", desc: "Enter normal mode" },
	{ mode: "normal", key: { name: "i" }, action: "toInsert", desc: "Insert mode" },
	{ mode: "normal", key: { name: "a" }, action: "toInsert", desc: "Insert mode" },
	{ mode: "normal", key: { name: "o" }, action: "toInsert", desc: "Insert mode" },
	{
		mode: "normal",
		key: { name: "g", shift: true },
		action: "scrollBottom",
		desc: "Jump to bottom",
	},
	{ mode: "normal", key: { name: "g" }, action: "scrollTop", desc: "Jump to top" },
	{ mode: "normal", key: { name: "j" }, action: "scrollDown", desc: "Scroll down" },
	{ mode: "normal", key: { name: "k" }, action: "scrollUp", desc: "Scroll up" },
	{
		mode: "normal",
		key: { name: "h", shift: true },
		action: "toggleThinking",
		desc: "Toggle thinking",
	},
	{
		mode: "normal",
		key: { name: "tab" },
		action: "toggleAgentMode",
		desc: "Cycle agent mode (standard/team/planner/orchestrator)",
	},
] as const;

export function matchKey(
	key: { name: string; ctrl?: boolean; shift?: boolean },
	pattern: KeyPattern,
): boolean {
	return (
		key.name === pattern.name && !!key.ctrl === !!pattern.ctrl && !!key.shift === !!pattern.shift
	);
}

export function resolveKey(
	mode: Mode,
	key: { name: string; ctrl?: boolean; shift?: boolean },
): string | null {
	for (const binding of keymap) {
		if (binding.mode !== "*" && binding.mode !== mode) continue;
		if (binding.key === "*") return binding.action;
		if (matchKey(key, binding.key)) return binding.action;
	}
	return null;
}
