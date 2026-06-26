import type { Setting } from "./types.js";

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
