import { constants } from "node:fs";
import {
	access as fsAccess,
	readFile as fsReadFile,
	writeFile as fsWriteFile,
} from "node:fs/promises";
import {
	createEditToolDefinition,
	type EditOperations,
	generateUnifiedPatch,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { DiffReviewManager } from "../diff-review/manager.js";
import { getGlobalRouter } from "../notifications/notifier.js";
import {
	clearEditConfirmBridge,
	type EditConfirmBridge,
	type EditConfirmDecision,
} from "./edit-confirm-bridge.js";

/**
 * Creates the edit tool with optional diff review support.
 *
 * When `reviewManager` is provided: writes to disk immediately and records
 * the change in DiffReviewManager for post-hoc review (non-blocking).
 * The user reviews all changes after the agent turn completes.
 *
 * When `bridge` is provided (legacy): blocks on each write for per-call
 * confirmation via EditConfirmBridge / DiffConfirmBox.
 *
 * When neither is provided: writes to disk directly (non-interactive mode).
 */
export function createEditTool(
	cwd: string,
	options?: { bridge?: EditConfirmBridge; reviewManager?: DiffReviewManager },
): ToolDefinition {
	const { bridge, reviewManager } = options ?? {};

	const operations: EditOperations = {
		readFile: (absolutePath) => fsReadFile(absolutePath),
		access: (absolutePath) => fsAccess(absolutePath, constants.R_OK | constants.W_OK),
		writeFile: async (absolutePath, newContent) => {
			// 读旧内容（此时磁盘仍是旧内容，SDK execute 还没写盘）
			let oldContent = "";
			try {
				oldContent = await fsReadFile(absolutePath, "utf-8");
			} catch {
				// File might not exist (new file creation)
			}

			// 写盘（所有模式都先写盘）
			await fsWriteFile(absolutePath, newContent, "utf-8");

			// 事后审查模式：记录变更到 DiffReviewManager
			if (reviewManager) {
				reviewManager.recordChange(absolutePath, oldContent, newContent);
				return;
			}

			// 逐次审批模式（legacy）：阻塞等待用户确认
			if (bridge) {
				const patch = generateUnifiedPatch(absolutePath, oldContent, newContent);

				const decision = await new Promise<EditConfirmDecision>((resolve, reject) => {
					bridge.pending = { filePath: absolutePath, patch };
					bridge.resolve = resolve;
					bridge.reject = reject;
					bridge.onPending?.(bridge.pending);
					getGlobalRouter()?.notifyNeedsInput();
				});

				bridge.pending = null;
				bridge.resolve = null;
				bridge.reject = null;

				if (decision.kind === "reject") {
					// 恢复原始内容（因为已经写盘了，需要回滚）
					await fsWriteFile(absolutePath, oldContent, "utf-8");
					throw new Error(decision.feedback || "用户拒绝了 edit 调用");
				}
			}
		},
	};

	const tool = createEditToolDefinition(cwd, { operations });

	// 包装 execute 注册 abort 监听（仅 legacy bridge 模式需要）
	if (bridge) {
		const originalExecute = tool.execute;
		tool.execute = async (toolCallId, params, signal, onUpdate, ctx) => {
			const onAbort = () => clearEditConfirmBridge(bridge);
			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}
			try {
				return await originalExecute(toolCallId, params, signal, onUpdate, ctx);
			} finally {
				if (signal) {
					signal.removeEventListener("abort", onAbort);
				}
			}
		};
	}

	tool.executionMode = "sequential";

	return tool as unknown as ToolDefinition;
}
