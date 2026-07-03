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
 * Crée l'outil d'édition (approche par intercepteur).
 *
 * Réutilise `createEditToolDefinition` du SDK, en injectant l'interception via `operations.writeFile` :
 * Après que le SDK execute termine access/readFile/match/apply, il appelle `ops.writeFile`
 * (edit.js:208, await nu sans try/catch). L'intercepteur calcule ici un patch unifié →
 * attend la confirmation de l'utilisateur via EditConfirmBridge → accept écrit sur disque / reject lève
 * une erreur qui se propage comme résultat d'outil isError.
 *
 * - Quand `bridge` est undefined (mode non-interactif headless/serve), writeFile bascule en écriture directe.
 * - Définit `executionMode: "sequential"` pour éviter que des lots parallèles écrasent le slot unique du bridge, causant des deadlocks.
 * - Enveloppe execute pour enregistrer un listener signal.abort (customOps.writeFile n'a pas accès à signal, donc cela doit être géré au niveau execute).
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
