import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffReviewManager } from "../../diff-review/manager.js";
import { useTerminalWidth } from "../hooks/useTerminalWidth.js";
import { pathToFiletype } from "../utils/filetype.js";
import { syntaxStyle } from "../utils/syntax.js";
import { colors } from "../utils/theme.js";

interface DiffReviewViewProps {
	manager: DiffReviewManager;
	onClose: () => void;
}

export function DiffReviewView({ manager, onClose }: DiffReviewViewProps) {
	const [pendingFiles, setPendingFiles] = useState(() => manager.getPendingFiles());
	const [currentIndex, setCurrentIndex] = useState(0);
	const width = useTerminalWidth();

	// Subscribe to manager events to refresh list
	useEffect(() => {
		const unsub = manager.on(() => {
			const updated = manager.getPendingFiles();
			setPendingFiles(updated);
			// If no more pending files, close
			if (updated.length === 0) {
				onClose();
				return;
			}
			// Clamp index
			setCurrentIndex((prev) => Math.min(prev, updated.length - 1));
		});
		return unsub;
	}, [manager, onClose]);

	const current = pendingFiles[currentIndex];

	const handleAccept = useCallback(() => {
		if (!current) return;
		manager.accept(current.filePath);
	}, [manager, current]);

	const handleReject = useCallback(() => {
		if (!current) return;
		manager.reject(current.filePath);
	}, [manager, current]);

	const pendingRef = useRef(pendingFiles);
	pendingRef.current = pendingFiles;
	const currentIndexRef = useRef(currentIndex);
	currentIndexRef.current = currentIndex;

	useKeyboard((key) => {
		const files = pendingRef.current;
		if (files.length === 0) return;

		switch (key.name) {
			case "escape":
				onClose();
				break;
			case "n":
				setCurrentIndex((prev) => (prev + 1) % files.length);
				break;
			case "p":
				setCurrentIndex((prev) => (prev - 1 + files.length) % files.length);
				break;
			case "a":
				if (files[currentIndexRef.current]) {
					manager.accept(files[currentIndexRef.current].filePath);
				}
				break;
			case "r":
				if (files[currentIndexRef.current]) {
					manager.reject(files[currentIndexRef.current].filePath);
				}
				break;
		}
	});

	if (!current) return null;

	const filetype = pathToFiletype(current.filePath);
	const fileName = current.filePath.split("/").pop() || current.filePath;

	return (
		<box flexDirection="column" height="100%" backgroundColor={colors.background}>
			{/* Header */}
			<box
				flexShrink={0}
				flexDirection="row"
				paddingLeft={2}
				paddingRight={2}
				paddingTop={1}
				paddingBottom={0}
			>
				<text fg={colors.warning}>△ Review Changes</text>
				<text fg={colors.textMuted}> </text>
				<text fg={colors.secondary}>
					{currentIndex + 1}/{pendingFiles.length}
				</text>
				<text fg={colors.textMuted}> </text>
				<text fg={colors.text}>{fileName}</text>
			</box>

			{/* Diff content */}
			<scrollbox flexGrow={1} scrollY focused={false} paddingLeft={1} paddingRight={1}>
				<diff
					diff={current.patch}
					filetype={filetype}
					syntaxStyle={syntaxStyle}
					view={width > 120 ? "split" : "unified"}
					showLineNumbers={true}
					width="100%"
					wrapMode="word"
					fg={colors.text}
					addedBg={colors.diffAddedBg}
					removedBg={colors.diffRemovedBg}
					contextBg={colors.diffContextBg}
					addedSignColor={colors.diffAdded}
					removedSignColor={colors.diffRemoved}
					lineNumberFg={colors.diffLineNumber}
					lineNumberBg={colors.diffContextBg}
					addedLineNumberBg={colors.diffAddedLineNumberBg}
					removedLineNumberBg={colors.diffRemovedLineNumberBg}
				/>
			</scrollbox>

			{/* Footer */}
			<box
				flexShrink={0}
				flexDirection="row"
				paddingLeft={2}
				paddingRight={2}
				paddingTop={0}
				paddingBottom={1}
			>
				<text fg={colors.textSubtle}>n/p navigate a accept r reject Esc close</text>
			</box>
		</box>
	);
}
