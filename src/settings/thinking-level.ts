import type { Setting } from "./types.js";

export const thinkingLevelSetting: Setting<string> = {
	key: "thinking.level",
	label: "Thinking level",
	category: "session",
	defaultValue: "off",
	editor: {
		type: "selectDynamic",
		options: (ctx) => ctx.session.getAvailableThinkingLevels() as readonly string[],
	},
	read(config) {
		return config.thinking?.level ?? "off";
	},
	renderValue(v) {
		return v;
	},
	apply(value, ctx) {
		ctx.session.setThinkingLevel(value as never);
	},
	persist(config, value) {
		return { ...config, thinking: { ...config.thinking, level: value } };
	},
};
