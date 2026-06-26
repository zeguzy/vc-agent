import type { Setting } from "./types.js";

export const thinkingCollapsedSetting: Setting<boolean> = {
	key: "thinking.collapsed",
	label: "Fold thinking",
	category: "ui",
	defaultValue: false,
	editor: { type: "toggle" },
	read(config) {
		return config.thinking?.collapsed ?? false;
	},
	renderValue(v) {
		return v ? "folded" : "expanded";
	},
	apply(value, ctx) {
		ctx.setUi.thinkingCollapsed(value);
	},
	persist(config, value) {
		return { ...config, thinking: { ...config.thinking, collapsed: value } };
	},
};
