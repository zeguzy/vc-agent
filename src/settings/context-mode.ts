import type { Setting } from "./types.js";

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
