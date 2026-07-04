import type { Setting } from "./types.js";

export const teamsEnabledSetting: Setting<boolean> = {
	key: "teams.enabled",
	label: "Teams 模式",
	category: "teams",
	defaultValue: true,
	editor: { type: "toggle" },
	read(config) {
		return config.teams?.enabled ?? true;
	},
	renderValue(v) {
		return v ? "on" : "off";
	},
	apply(_value, _ctx) {},
	persist(config, value) {
		return { ...config, teams: { ...config.teams, enabled: value } };
	},
};
