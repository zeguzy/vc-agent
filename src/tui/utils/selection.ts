import type { ScrollBoxRenderable } from "@opentui/core";
import { copyToClipboard } from "./clipboard.js";

/**
 * OpenTUI 应用层 selection 复制 helper。
 *
 * 工作流程（移植自 opencode Selection.copy）：
 * 1. 从 renderer.getSelection() 取当前 selection 对象
 * 2. 调 selection.getSelectedText() 拿到选中文字
 * 3. 双写剪贴板（OSC 52 + 平台命令）
 * 4. 清空 selection（renderer.clearSelection()）
 *
 * @param renderer OpenTUI renderer（含 getSelection/clearSelection API）
 * @param onCopied 复制成功回调（用于显示 toast/StatusBar 反馈）
 * @returns true 有 selection 且已触发复制，false 无 selection（调用方应让事件透传）
 */
export function copySelection(
	renderer: {
		getSelection: () => { getSelectedText: () => string } | null;
		clearSelection: () => void;
	} | null,
	onCopied?: () => void,
): boolean {
	if (!renderer) return false;
	const sel = renderer.getSelection();
	const text = sel?.getSelectedText();
	if (!text) return false;

	copyToClipboard(text)
		.then(() => onCopied?.())
		.catch(() => {});

	renderer.clearSelection();
	return true;
}

// Re-export for typing convenience（与 ScrollBoxRenderable / Renderer 兼容）
export type SelectionCapableRenderer = Parameters<typeof copySelection>[0];
export type { ScrollBoxRenderable };
