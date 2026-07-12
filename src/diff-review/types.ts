export type FileChangeStatus = "pending" | "accepted" | "rejected";

export interface FileChange {
	filePath: string;
	/** File content before the first agent modification (snapshot) */
	originalContent: string;
	/** Current file content on disk (updated on each modification) */
	currentContent: string;
	status: FileChangeStatus;
	/** Unified diff patch string (originalContent → currentContent) */
	patch: string;
}

export type DiffReviewEventType =
	| "change_recorded"
	| "change_accepted"
	| "change_rejected"
	| "all_accepted"
	| "all_rejected"
	| "cleared";

export interface DiffReviewEvent {
	type: DiffReviewEventType;
	filePath?: string;
}
