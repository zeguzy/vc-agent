import type { Setting } from "./types.js";

export const teamsMaxWorkersSetting: Setting<string> = {
	key: "teams.maxWorkers",
	label: "最大并发 worker 数",
	category: "teams",
	defaultValue: "4",
	editor: { type: "input", placeholder: "4" },
	read(config) {
		return String(config.teams?.maxWorkers ?? 4);
	},
	renderValue(v) {
		return v;
	},
	apply(_value, _ctx) {},
	persist(config, value) {
		const num = Math.max(1, Math.min(16, Number(value) || 4));
		return { ...config, teams: { ...config.teams, maxWorkers: num } };
	},
};
