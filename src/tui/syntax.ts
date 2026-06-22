import { SyntaxStyle } from "@opentui/core"
import { colors } from "./theme.js"

export const syntaxStyle = SyntaxStyle.fromStyles({
	comment: { fg: colors.syntaxComment },
	keyword: { fg: colors.syntaxKeyword, bold: true },
	string: { fg: colors.syntaxString },
	variable: { fg: colors.syntaxVariable },
	number: { fg: colors.syntaxNumber },
	type: { fg: colors.syntaxType },
	function: { fg: colors.syntaxFunction },
	operator: { fg: colors.syntaxOperator },
})
