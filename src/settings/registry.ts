import {
	compactionEnabledSetting,
	contextModeSetting,
	modelSetting,
	notificationsBashThresholdSetting,
	notificationsEnabledSetting,
	notificationsSoundSetting,
	thinkingCollapsedSetting,
	thinkingLevelSetting,
	toastDismissSecondsSetting,
} from "./definitions.js";
import type { Setting } from "./types.js";

export const settings: Setting<unknown>[] = [
	thinkingCollapsedSetting,
	contextModeSetting,
	compactionEnabledSetting,
	modelSetting,
	thinkingLevelSetting,
	notificationsEnabledSetting,
	notificationsSoundSetting,
	notificationsBashThresholdSetting,
	toastDismissSecondsSetting,
];

export function findSetting(key: string): Setting<unknown> | undefined {
	return settings.find((s) => s.key === key);
}
