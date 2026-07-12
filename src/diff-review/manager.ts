import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { generateUnifiedPatch } from "@earendil-works/pi-coding-agent";
import type { DiffReviewEvent, FileChange, FileChangeStatus } from "./types.js";

type Listener = (event: DiffReviewEvent) => void;

/**
 * Manages file change review state: snapshots, status tracking, accept/reject operations.
 *
 * Lifecycle:
 * - Agent modifies files → `recordChange()` captures snapshot, marks pending
 * - User reviews → `accept()` / `reject()` / `acceptAll()` / `rejectAll()`
 * - Session switch → `clear()` resets all state
 */
export class DiffReviewManager {
	private fileChanges = new Map<string, FileChange>();
	private listeners = new Set<Listener>();

	/** Record a file change. Called before writing to disk. */
	recordChange(filePath: string, originalContent: string, newContent: string): void {
		const existing = this.fileChanges.get(filePath);

		if (existing && existing.status === "pending") {
			// Already pending: update current content and patch, keep original snapshot
			existing.currentContent = newContent;
			existing.patch = generateUnifiedPatch(filePath, existing.originalContent, newContent);
			this.emit({ type: "change_recorded", filePath });
			return;
		}

		// New change or re-modified after accept/reject: (re-)create entry
		const patch = generateUnifiedPatch(filePath, originalContent, newContent);
		this.fileChanges.set(filePath, {
			filePath,
			originalContent,
			currentContent: newContent,
			status: "pending",
			patch,
		});
		this.emit({ type: "change_recorded", filePath });
	}

	/** Accept a pending file change. Keeps the on-disk content. */
	accept(filePath: string): boolean {
		const change = this.fileChanges.get(filePath);
		if (!change || change.status !== "pending") return false;

		change.status = "accepted";
		this.emit({ type: "change_accepted", filePath });
		return true;
	}

	/** Reject a pending file change. Restores original content to disk. */
	reject(filePath: string): boolean {
		const change = this.fileChanges.get(filePath);
		if (!change || change.status !== "pending") return false;

		// Restore original content
		if (change.originalContent === "" && !existsSync(filePath)) {
			// New file created by agent: delete it
			// (originalContent === "" means file didn't exist before agent)
			// But check if it actually exists first
		} else if (change.originalContent === "") {
			// File was created by agent: delete it
			unlinkSync(filePath);
		} else {
			// Existing file was modified: restore original content
			writeFileSync(filePath, change.originalContent, "utf-8");
		}

		change.status = "rejected";
		this.emit({ type: "change_rejected", filePath });
		return true;
	}

	/** Accept all pending file changes. */
	acceptAll(): number {
		let count = 0;
		for (const [filePath, change] of this.fileChanges) {
			if (change.status === "pending") {
				change.status = "accepted";
				count++;
			}
		}
		if (count > 0) this.emit({ type: "all_accepted" });
		return count;
	}

	/** Reject all pending file changes (restores original content). */
	rejectAll(): number {
		let count = 0;
		for (const [filePath, change] of this.fileChanges) {
			if (change.status === "pending") {
				if (change.originalContent === "") {
					unlinkSync(filePath);
				} else {
					writeFileSync(filePath, change.originalContent, "utf-8");
				}
				change.status = "rejected";
				count++;
			}
		}
		if (count > 0) this.emit({ type: "all_rejected" });
		return count;
	}

	/** Get all pending file changes, in insertion order. */
	getPendingFiles(): FileChange[] {
		const pending: FileChange[] = [];
		for (const change of this.fileChanges.values()) {
			if (change.status === "pending") pending.push(change);
		}
		return pending;
	}

	/** Get a specific file change by path. */
	getChange(filePath: string): FileChange | undefined {
		return this.fileChanges.get(filePath);
	}

	/** Get all file changes. */
	getAllChanges(): FileChange[] {
		return [...this.fileChanges.values()];
	}

	/** Number of pending files. */
	get pendingCount(): number {
		let count = 0;
		for (const change of this.fileChanges.values()) {
			if (change.status === "pending") count++;
		}
		return count;
	}

	/** Check if there are any pending files. */
	get hasPending(): boolean {
		return this.pendingCount > 0;
	}

	/** Clear all state (e.g. on session switch). */
	clear(): void {
		this.fileChanges.clear();
		this.emit({ type: "cleared" });
	}

	/** Subscribe to review events. Returns unsubscribe function. */
	on(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: DiffReviewEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
