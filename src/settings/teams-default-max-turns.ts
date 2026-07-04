import type { Setting } from "./types.js";

export const teamsDefaultMaxTurnsSetting: Setting<string> = {
	key: "teams.defaultMaxTurns",
	label: "worker 默认最大轮次",
	category: "teams",
	defaultValue: "8",
	editor: { type: "input", placeholder: "8" },
	read(config) {
		return String(config.teams?.defaultMaxTurns ?? 8);
	},
	renderValue(v) {
		return v;
	},
	apply(_value, _ctx) {},
	persist(config, value) {
		const num = Math.max(1, Math.min(50, Number(value) || 8));
		return { ...config, teams: { ...config.teams, defaultMaxTurns: num } };
	},
};
