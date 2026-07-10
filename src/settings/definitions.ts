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
		ctx.client.setCompactionEnabled(value);
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
		const colonIdx = trimmed.indexOf(":");
		const model =
			colonIdx > 0
				? ctx.client.findModel(trimmed.slice(0, colonIdx), trimmed.slice(colonIdx + 1))
				: ctx.client.listModels().find((m) => m.id === trimmed);
		if (model) {
			ctx.client.setModel(model.provider, model.id ?? "").catch(() => {});
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
		options: (ctx) => ctx.client.getAvailableThinkingLevels() as readonly string[],
	},
	read(config) {
		return config.thinking?.level ?? "off";
	},
	renderValue(v) {
		return v;
	},
	apply(value, ctx) {
		ctx.client.setThinkingLevel(value);
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

export const toastDismissSecondsSetting: Setting<string> = {
	key: "notifications.toastDismissSeconds",
	label: "提示停留时间 (秒)",
	category: "notifications",
	defaultValue: "4",
	editor: { type: "input", placeholder: "4" },
	read(config) {
		const ms = config.notifications?.toastDismissMs;
		if (ms === undefined) return "4";
		return String(Math.round(ms / 1000));
	},
	renderValue(v) {
		return `${v}s`;
	},
	apply(value, ctx) {
		const seconds = Number(value) || 4;
		ctx.setUi.toastDismissMs(seconds * 1000);
	},
	persist(config, value) {
		const seconds = Number(value) || 4;
		return {
			...config,
			notifications: { ...config.notifications, toastDismissMs: seconds * 1000 },
		};
	},
};
