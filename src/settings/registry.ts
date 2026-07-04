import {
	compactionEnabledSetting,
	modelSetting,
	notificationsBashThresholdSetting,
	notificationsEnabledSetting,
	notificationsSoundSetting,
	thinkingCollapsedSetting,
	thinkingLevelSetting,
	toastDismissSecondsSetting,
} from "./definitions.js";
import { teamsDefaultMaxTurnsSetting } from "./teams-default-max-turns.js";
import { teamsEnabledSetting } from "./teams-enabled.js";
import { teamsMaxWorkersSetting } from "./teams-max-workers.js";
import type { Setting } from "./types.js";

export const settings: Setting<unknown>[] = [
	thinkingCollapsedSetting,
	compactionEnabledSetting,
	modelSetting,
	thinkingLevelSetting,
	notificationsEnabledSetting,
	notificationsSoundSetting,
	notificationsBashThresholdSetting,
	toastDismissSecondsSetting,
	teamsEnabledSetting,
	teamsMaxWorkersSetting,
	teamsDefaultMaxTurnsSetting,
];

export function findSetting(key: string): Setting<unknown> | undefined {
	return settings.find((s) => s.key === key);
}
