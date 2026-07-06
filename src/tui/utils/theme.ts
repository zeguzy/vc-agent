import type { MemberState } from "../../teams/types-v2.js";

export const colors = {
	background: "#000000",
	backgroundPanel: "#1C1C1E",
	backgroundElement: "#2C2C2E",
	backgroundMenu: "#2C2C2E",
	backgroundInput: "#1C1C1E",
	backgroundInset: "#141416",
	backgroundStatus: "#0A0C10",
	backgroundBar: "#101214",

	text: "#EDEDED",
	textMuted: "#878787",
	textSubtle: "#626A76",
	markdownText: "#EDEDED",

	border: "#1F1F1F",
	borderActive: "#454545",
	borderSubtle: "#1A1A1A",
	borderSoft: "#2A2F39",
	borderDim: "#1E222A",
	separator: "#2A2F39",

	primary: "#0A84FF",
	secondary: "#64D2FF",
	accent: "#BF5AF2",

	error: "#FF453A",
	warning: "#FFD60A",
	success: "#30D158",
	info: "#64D2FF",

	syntaxComment: "#878787",
	syntaxKeyword: "#BF5AF2",
	syntaxFunction: "#BF5AF2",
	syntaxVariable: "#64D2FF",
	syntaxString: "#30D158",
	syntaxNumber: "#FFD60A",
	syntaxType: "#64D2FF",
	syntaxOperator: "#BF5AF2",
	syntaxPunctuation: "#EDEDED",

	markdownHeading: "#BF5AF2",
	markdownLink: "#64D2FF",
	markdownLinkText: "#30D158",
	markdownCode: "#30D158",
	markdownEmph: "#FFD60A",
	markdownStrong: "#FF9500",
	markdownBlockQuote: "#FFD60A",
	markdownListItem: "#64D2FF",
	markdownListEnumeration: "#30D158",

	diffAdded: "#30D158",
	diffRemoved: "#FF453A",
	diffAddedBg: "#20303b",
	diffRemovedBg: "#37222c",
	diffContextBg: "#1c1c1e",
	diffLineNumber: "#8f8f8f",
	diffAddedLineNumberBg: "#1b2b34",
	diffRemovedLineNumberBg: "#2d1f26",

	agent: "#0A84FF",
} as const;

export const icons = {
	user: ">",
	toolRunning: "$",
	toolDone: "✓",
	toolError: "✗",
	separator: "─",
	statusDot: "●",
	assistant: "▣",
	folder: "󰝰",
} as const;

export function teamStatusIcon(status: MemberState["status"]): string {
	switch (status) {
		case "active":
			return "◌";
		case "idle":
			return "○";
		case "done":
			return "✓";
		case "error":
			return "✗";
		case "paused":
			return "⏸";
		case "cancelled":
			return "⊘";
	}
}

export function teamStatusColor(status: MemberState["status"]): string {
	switch (status) {
		case "active":
			return colors.warning;
		case "idle":
			return colors.textMuted;
		case "done":
			return colors.success;
		case "error":
			return colors.error;
		case "paused":
			return colors.info;
		case "cancelled":
			return colors.textMuted;
	}
}
