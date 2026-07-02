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
	/** Operator 后累积的 motion-count（如 y4h 中的 4），与 count 相乘生效 */
	motionCountStr?: string;
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
	/** 滚动到文档顶/底（G/gg），由 overlay 层执行绝对滚动 + 下一帧光标重定位 */
	scrollEdge?: "top" | "bottom";
	yankText?: string;
	needsRender: boolean;
}
