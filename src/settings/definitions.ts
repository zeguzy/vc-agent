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

export const contextModeSetting: Setting<"compact" | "full"> = {
	key: "display.contextMode",
	label: "Context display",
	category: "ui",
	defaultValue: "compact",
	editor: { type: "select", options: ["compact", "full"] },
	read(config) {
		return config.display?.contextMode ?? "compact";
	},
	renderValue(v) {
		return v;
	},
	apply(value, ctx) {
		ctx.setUi.contextDisplay(value);
	},
	persist(config, value) {
		return { ...config, display: { ...config.display, contextMode: value } };
	},
};

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

export const modelSetting: Setting<string> = {
	key: "model",
	label: "Model",
	category: "session",
	defaultValue: "",
	editor: { type: "modelPicker" },
	read(config) {
		return config.model ?? "";
	},
	renderValue(v) {
		return v || "(default)";
	},
	apply(value, ctx) {
		const trimmed = value.trim();
		if (!trimmed) return;
		const registry = ctx.modelRegistry;
		const model = trimmed.includes(":")
			? registry.find(trimmed.split(":", 2)[0], trimmed.split(":", 2)[1])
			: registry.getAll().find((m) => m.id === trimmed);
		if (model) {
			ctx.session.setModel(model).catch(() => {});
		}
	},
	persist(config, value) {
		return { ...config, model: value };
	},
};

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
