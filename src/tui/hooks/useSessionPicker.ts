import { useCallback, useState } from "react";
import type { AgentSessionRuntime } from "../../agent/session.js";
import { createAssistantMessage } from "../../message.js";
import { renameSessionFile, type SessionInfo } from "../../session/list.js";
import { formatError } from "../../utils/formatError.js";

interface SessionPickerState {
	showSessionPicker: boolean;
	pickerSessions: SessionInfo[];
	openSessionPicker: (sessions: SessionInfo[]) => void;
	closeSessionPicker: () => void;
	handlePickerSelect: (path: string) => Promise<void>;
	handlePickerRename: (path: string, name: string) => void;
}

/**
 * Manages the session picker overlay state and callbacks.
 *
 * Handles session list display, selection (hot-switch via runtime.switchSession),
 * rename, and close. Errors from switch/rename are displayed via setMessages.
 */
export function useSessionPicker(
	runtime: AgentSessionRuntime,
	setMessages: (
		updater:
			| import("../../message.js").Message[]
			| ((prev: import("../../message.js").Message[]) => import("../../message.js").Message[]),
	) => void,
): SessionPickerState {
	const [showSessionPicker, setShowSessionPicker] = useState(false);
	const [pickerSessions, setPickerSessions] = useState<SessionInfo[]>([]);

	const openSessionPicker = useCallback((sessions: SessionInfo[]) => {
		setPickerSessions(sessions);
		setShowSessionPicker(true);
	}, []);

	const closeSessionPicker = useCallback(() => setShowSessionPicker(false), []);

	const handlePickerSelect = useCallback(
		async (path: string) => {
			setShowSessionPicker(false);
			try {
				await runtime.switchSession(path);
			} catch (err) {
				setMessages((prev) => [
					...prev,
					createAssistantMessage(`切换会话失败: ${formatError(err)}`),
				]);
			}
		},
		[runtime, setMessages],
	);

	const handlePickerRename = useCallback(
		(path: string, name: string) => {
			try {
				renameSessionFile(path, name);
				if (path === runtime.session.sessionFile) {
					runtime.session.setSessionName(name);
				}
				setPickerSessions((prev) => prev.map((s) => (s.path === path ? { ...s, name } : s)));
			} catch (err) {
				setMessages((prev) => [...prev, createAssistantMessage(`重命名失败: ${formatError(err)}`)]);
			}
		},
		[runtime, setMessages],
	);

	return {
		showSessionPicker,
		pickerSessions,
		openSessionPicker,
		closeSessionPicker,
		handlePickerSelect,
		handlePickerRename,
	};
}
