export interface Position {
	row: number;
	col: number;
}

export interface ScreenCell {
	char: string;
	isEmpty: boolean;
	isContinuation?: boolean;
}

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type VimMode = "normal" | "visual";

export interface PendingMotion {
	type: "findChar" | "tillChar" | "easymotion" | "gotoLine" | "yank";
	backward?: boolean;
	count?: number;
}

export interface EasymotionState {
	char: string;
	labels: Map<string, Position>;
	typed: string;
}

export interface VimState {
	mode: VimMode;
	cursor: Position;
	pending: PendingMotion | null;
	easymotion: EasymotionState | null;
	visualAnchor: Position | null;
	countStr: string | null;
}

export interface HandleResult {
	state: VimState;
	scrollDelta?: number;
	yankText?: string;
	needsRender: boolean;
}
