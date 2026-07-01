// QuestionBridge connects the Agent tool layer to the React TUI layer.
// The tool's execute() stores question data + Promise callbacks on the bridge;
// QuestionBox calls resolve() when the user answers (or reject() on abort).

export interface QuestionItem {
	question: string;
	header: string;
	options: { label: string; description: string }[];
	multiple?: boolean;
}

export interface QuestionData {
	questions: QuestionItem[];
}

export interface QuestionBridge {
	pending: QuestionData | null;
	resolve: ((answers: string[][]) => void) | null;
	reject: ((error: Error) => void) | null;
}

export function createQuestionBridge(): QuestionBridge {
	return {
		pending: null,
		resolve: null,
		reject: null,
	};
}

export function clearBridge(bridge: QuestionBridge): void {
	if (bridge.reject) {
		bridge.reject(new Error("Question cancelled"));
	}
	bridge.pending = null;
	bridge.resolve = null;
	bridge.reject = null;
}
