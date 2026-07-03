import { memo } from "react";
import { useTerminalWidth } from "../hooks/useTerminalWidth.js";
import { pathToFiletype } from "../utils/filetype.js";
import { syntaxStyle } from "../utils/syntax.js";
import { colors } from "../utils/theme.js";

interface EditDiffViewProps {
	patch: string;
	filePath: string;
}

export const EditDiffView = memo(function EditDiffView({ patch, filePath }: EditDiffViewProps) {
	const filetype = pathToFiletype(filePath);
	const width = useTerminalWidth();
	return (
		<diff
			diff={patch}
			filetype={filetype}
			syntaxStyle={syntaxStyle}
			view={width > 120 ? "split" : "unified"}
			showLineNumbers={true}
			fg={colors.text}
			addedSignColor={colors.diffAdded}
			removedSignColor={colors.diffRemoved}
			addedBg={colors.diffAddedBg}
			removedBg={colors.diffRemovedBg}
			contextBg={colors.diffContextBg}
			flexShrink={0}
		/>
	);
});
