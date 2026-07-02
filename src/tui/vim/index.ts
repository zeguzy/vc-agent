import type { CliRenderer, OptimizedBuffer } from "@opentui/core";
import { clampToNonEmpty } from "./cursor.js";
import { renderAll } from "./overlay.js";
import {
	findFirstContent,
	findFirstNonEmpty,
	findLastContent,
	findLineByPrefix,
	findTextInModel,
	scanBuffer,
} from "./screenModel.js";
import type { Bounds, Position, ScreenCell, VimState } from "./types.js";
import { createInitialState, handleKey } from "./vimState.js";

export interface VimOverlayOptions {
	renderer: CliRenderer;
	getBounds: () => Bounds;
	scrollBy: (delta: number) => void;
	scrollToBottom: () => void;
	scrollToTop: () => void;
	onYank: (text: string) => void;
	getInitialCursorText?: () => string | null;
	getFirstUserMessageText?: () => string | null;
}

export interface VimOverlay {
	postProcess: (buffer: OptimizedBuffer, deltaTime: number) => void;
	handleKey: (key: string) => boolean;
	activate: () => void;
	deactivate: () => void;
	cleanup: () => void;
	getState: () => VimState;
	resetCursor: () => void;
}

export function createVimOverlay(opts: VimOverlayOptions): VimOverlay {
	let state: VimState = createInitialState();
	let active = false;
	let currentModel: ScreenCell[][] | null = null;
	let cursorInitialized = false;
	let pendingEdge: "top" | "bottom" | null = null;

	const postProcess = (buffer: OptimizedBuffer, _dt: number) => {
		if (!active) return;
		const bounds = opts.getBounds();
		currentModel = scanBuffer(buffer, bounds);
		// 视口随滚动/resize 变化，把 cursor 收敛进当前视口范围，防止越界丢失
		if (currentModel.length > 0) {
			const row = Math.max(0, Math.min(state.cursor.row, currentModel.length - 1));
			state.cursor = clampToNonEmpty(currentModel, { row, col: state.cursor.col });
		}
		// G/gg 绝对滚动后，下一帧视口已更新，光标重新定位到新视口底/顶首个内容行
		if (pendingEdge && currentModel.length > 0) {
			let pos: Position | null;
			if (pendingEdge === "bottom") {
				pos = findLastContent(currentModel);
			} else {
				const prefix = opts.getFirstUserMessageText?.() ?? null;
				pos =
					(prefix ? findLineByPrefix(currentModel, prefix) : null) ??
					findFirstContent(currentModel);
			}
			if (pos) state.cursor = pos;
			pendingEdge = null;
		} else if (!cursorInitialized && currentModel.length > 0) {
			const searchText = opts.getInitialCursorText?.() ?? null;
			const pos =
				(searchText ? findTextInModel(currentModel, searchText) : null) ??
				findFirstNonEmpty(currentModel);
			if (pos) {
				state.cursor = pos;
				cursorInitialized = true;
			}
		}
		renderAll(buffer, state, currentModel, bounds);
	};

	const handleKeyFn = (key: string): boolean => {
		if (!active || !currentModel) return false;
		const result = handleKey(key, state, currentModel);
		state = result.state;
		if (result.scrollEdge) {
			// 绝对滚动 + 标记 pendingEdge，待下一帧 postProcess 重定位到新视口；
			// 立即把 cursor 放到当前视口底/顶，避免滚动途中 cursor 越界丢失
			pendingEdge = result.scrollEdge;
			if (result.scrollEdge === "bottom") {
				opts.scrollToBottom();
				const pos = findLastContent(currentModel);
				if (pos) state.cursor = pos;
			} else {
				opts.scrollToTop();
				const pos = findFirstNonEmpty(currentModel);
				if (pos) state.cursor = pos;
			}
		}
		if (result.scrollDelta) {
			opts.scrollBy(result.scrollDelta);
		}
		if (result.yankText) {
			opts.onYank(result.yankText);
		}
		if (result.needsRender) {
			opts.renderer.requestRender();
		}
		return result.needsRender;
	};

	const activate = () => {
		if (active) return;
		active = true;
		cursorInitialized = false;
		pendingEdge = null;
		state = createInitialState();
		opts.renderer.addPostProcessFn(postProcess);
		opts.renderer.requestRender();
	};

	const deactivate = () => {
		if (!active) return;
		active = false;
		opts.renderer.removePostProcessFn(postProcess);
		state = createInitialState();
		currentModel = null;
		pendingEdge = null;
	};

	const cleanup = () => {
		deactivate();
	};

	const resetCursor = () => {
		state.cursor = { row: 0, col: 0 };
		cursorInitialized = false;
	};

	return {
		postProcess,
		handleKey: handleKeyFn,
		activate,
		deactivate,
		cleanup,
		getState: () => state,
		resetCursor,
	};
}
