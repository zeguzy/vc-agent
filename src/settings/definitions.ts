import { getGlobalRouter } from "../notifications/notifier.js";
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

export const notificationsEnabledSetting: Setting<boolean> = {
	key: "notifications.enabled",
	label: "通知",
	category: "notifications",
	defaultValue: true,
	editor: { type: "toggle" },
	read(config) {
		return config.notifications?.enabled ?? true;
	},
	renderValue(v) {
		return v ? "on" : "off";
	},
	apply(value) {
		getGlobalRouter()?.setEnabled(value);
	},
	persist(config, value) {
		return { ...config, notifications: { ...config.notifications, enabled: value } };
	},
};

export const notificationsSoundSetting: Setting<boolean> = {
	key: "notifications.sound",
	label: "通知声音",
	category: "notifications",
	defaultValue: true,
	editor: { type: "toggle" },
	read(config) {
		return config.notifications?.sound ?? true;
	},
	renderValue(v) {
		return v ? "on" : "off";
	},
	apply(value) {
		getGlobalRouter()?.setSound(value);
	},
	persist(config, value) {
		return { ...config, notifications: { ...config.notifications, sound: value } };
	},
};

export const notificationsBashThresholdSetting: Setting<string> = {
	key: "notifications.bashThresholdSeconds",
	label: "Bash 通知阈值 (秒)",
	category: "notifications",
	defaultValue: "10",
	editor: { type: "input", placeholder: "10" },
	read(config) {
		const ms = config.notifications?.bashThresholdMs;
		if (ms === undefined) return "10";
		return String(Math.round(ms / 1000));
	},
	renderValue(v) {
		return `${v}s`;
	},
	apply(value) {
		const seconds = Number(value) || 10;
		getGlobalRouter()?.setBashThresholdMs(seconds * 1000);
	},
	persist(config, value) {
		const seconds = Number(value) || 10;
		return {
			...config,
			notifications: { ...config.notifications, bashThresholdMs: seconds * 1000 },
		};
	},
};
