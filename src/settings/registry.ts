import {
	compactionEnabledSetting,
	contextModeSetting,
	modelSetting,
	thinkingCollapsedSetting,
	thinkingLevelSetting,
} from "./definitions.js";
import type { Setting } from "./types.js";

export const settings: Setting<unknown>[] = [
	thinkingCollapsedSetting,
	contextModeSetting,
	compactionEnabledSetting,
	modelSetting,
	thinkingLevelSetting,
];

export function findSetting(key: string): Setting<unknown> | undefined {
	return settings.find((s) => s.key === key);
}
