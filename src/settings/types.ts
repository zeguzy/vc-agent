import type {
	AgentSession,
	AuthStorage,
	ModelRegistry,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Config } from "../config.js";

export type SettingCategory = "ui" | "session" | "notifications" | "teams";

export interface SettingContext {
	session: AgentSession;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
	setUi: {
		thinkingCollapsed(v: boolean): void;
		toastDismissMs(v: number): void;
	};
	cwd: string;
}

export type SettingEditor<T> =
	| { type: "toggle" }
	| { type: "select"; options: readonly T[] }
	| { type: "selectDynamic"; options: (ctx: SettingContext) => readonly T[] }
	| { type: "input"; placeholder?: string }
	| { type: "modelPicker" };

export interface Setting<T> {
	key: string;
	label: string;
	category: SettingCategory;
	scope?: "global";
	defaultValue: T;
	editor: SettingEditor<T>;
	read(config: Config): T;
	renderValue(v: T): string;
	apply(value: T, ctx: SettingContext): void;
	persist(config: Config, value: T): Config;
}
