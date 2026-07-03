// EditConfirmBridge connects the Agent tool layer (edit's customOps.writeFile
// interceptor) to the React TUI layer (DiffConfirmBox). The interceptor stores
// diff data + Promise callbacks on the bridge; DiffConfirmBox calls resolve()
// when the user accepts/rejects (or reject() on abort/session-switch).

export interface EditConfirmData {
	filePath: string;
	patch: string;
}

export type EditConfirmDecision = { kind: "accept" } | { kind: "reject"; feedback: string };

export interface EditConfirmBridge {
	pending: EditConfirmData | null;
	resolve: ((decision: EditConfirmDecision) => void) | null;
	reject: ((error: Error) => void) | null;
	onPending?: (data: EditConfirmData) => void;
}

export function createEditConfirmBridge(): EditConfirmBridge {
	return {
		pending: null,
		resolve: null,
		reject: null,
	};
}

export function clearEditConfirmBridge(bridge: EditConfirmBridge): void {
	if (bridge.reject) {
		bridge.reject(new Error("Edit confirmation cancelled"));
	}
	bridge.pending = null;
	bridge.resolve = null;
	bridge.reject = null;
}
