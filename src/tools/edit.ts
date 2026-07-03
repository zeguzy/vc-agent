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
import { getGlobalRouter } from "../notifications/notifier.js";
import {
	clearEditConfirmBridge,
	type EditConfirmBridge,
	type EditConfirmDecision,
} from "./edit-confirm-bridge.js";

/**
 * 创建 edit 工具（拦截器方案）。
 *
 * 复用 SDK 的 `createEditToolDefinition`，通过 `operations.writeFile` 注入拦截：
 * SDK execute 完成 access/readFile/匹配/应用后调用 `ops.writeFile`（edit.js:208 裸 await
 * 无 try/catch），拦截器在此算 unified patch → 经 EditConfirmBridge 等待用户确认 →
 * accept 真写盘 / reject throw 传播为 isError 工具结果。
 *
 * - `bridge` 为 undefined（headless/serve 非交互模式）时，writeFile 降级为直写。
 * - 设 `executionMode: "sequential"` 防并行 batch 覆盖 bridge 单槽导致死锁。
 * - 包装 execute 注册 signal.abort 监听（customOps.writeFile 拿不到 signal，需在 execute 层处理）。
 */
export function createEditTool(cwd: string, bridge?: EditConfirmBridge): ToolDefinition {
	const operations: EditOperations = {
		readFile: (absolutePath) => fsReadFile(absolutePath),
		access: (absolutePath) => fsAccess(absolutePath, constants.R_OK | constants.W_OK),
		writeFile: async (absolutePath, newContent) => {
			// 非交互模式降级：无 bridge 直接写盘（与 SDK 默认 operations.writeFile 行为一致）
			if (!bridge) {
				return fsWriteFile(absolutePath, newContent, "utf-8");
			}

			// 读旧内容算 unified patch（此时磁盘仍是旧内容，SDK execute 还没写盘）
			const oldContent = await fsReadFile(absolutePath, "utf-8");
			const patch = generateUnifiedPatch(absolutePath, oldContent, newContent);

			// 经 bridge 等待用户确认（execute 随之阻塞）
			const decision = await new Promise<EditConfirmDecision>((resolve, reject) => {
				bridge.pending = { filePath: absolutePath, patch };
				bridge.resolve = resolve;
				bridge.reject = reject;
				bridge.onPending?.(bridge.pending);
				getGlobalRouter()?.notifyNeedsInput();
			});

			// 清空 bridge（无论 accept/reject）
			bridge.pending = null;
			bridge.resolve = null;
			bridge.reject = null;

			if (decision.kind === "reject") {
				// throw 经 SDK execute（writeFile 裸 await 无 try/catch）传播为 isError 工具结果
				throw new Error(decision.feedback || "用户拒绝了 edit 调用");
			}

			// accept：真写盘（SDK execute 随后继续算 diff 并返回 details.patch）
			await fsWriteFile(absolutePath, newContent, "utf-8");
		},
	};

	const tool = createEditToolDefinition(cwd, { operations });

	// 包装 execute 注册 abort 监听：abort 时 clearEditConfirmBridge reject customWriteFile 的 await
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
