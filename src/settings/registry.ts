import { compactionEnabledSetting } from "./compaction-enabled.js";
import { contextModeSetting } from "./context-mode.js";
import { modelSetting } from "./model.js";
import { thinkingCollapsedSetting } from "./thinking-collapsed.js";
import { thinkingLevelSetting } from "./thinking-level.js";
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
