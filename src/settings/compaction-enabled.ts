import type { Setting } from "./types.js";

export const compactionEnabledSetting: Setting<boolean> = {
	key: "compaction.enabled",
	label: "Auto-compaction",
	category: "session",
	defaultValue: true,
	editor: { type: "toggle" },
	read(config) {
		return config.compaction?.enabled ?? true;
	},
	renderValue(v) {
		return v ? "on" : "off";
	},
	apply(value, ctx) {
		ctx.settingsManager.setCompactionEnabled(value);
	},
	persist(config, value) {
		return { ...config, compaction: { ...config.compaction, enabled: value } };
	},
};
