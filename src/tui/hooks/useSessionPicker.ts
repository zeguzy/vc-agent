import { useCallback, useState } from "react";
import type { AgentClient } from "../../client/index.js";
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

export function useSessionPicker(
	client: AgentClient,
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
				await client.switchSession(path);
			} catch (err) {
				setMessages((prev) => [
					...prev,
					createAssistantMessage(`切换会话失败: ${formatError(err)}`),
				]);
			}
		},
		[client, setMessages],
	);

	const handlePickerRename = useCallback(
		(path: string, name: string) => {
			try {
				renameSessionFile(path, name);
				if (path === client.getSessionFile()) {
					client.setSessionName(name);
				}
				setPickerSessions((prev) => prev.map((s) => (s.path === path ? { ...s, name } : s)));
			} catch (err) {
				setMessages((prev) => [...prev, createAssistantMessage(`重命名失败: ${formatError(err)}`)]);
			}
		},
		[client, setMessages],
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
