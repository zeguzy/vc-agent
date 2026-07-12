import { beforeEach, describe, expect, it, mock } from "bun:test";
import { DiffReviewManager } from "../src/diff-review/manager.js";

// Mock fs operations to avoid touching real disk
const mockWriteFileSync = mock(() => {});
const mockUnlinkSync = mock(() => {});
const mockExistsSync = mock(() => true);

mock.module("node:fs", () => ({
	writeFileSync: mockWriteFileSync,
	unlinkSync: mockUnlinkSync,
	existsSync: mockExistsSync,
}));

describe("DiffReviewManager", () => {
	let manager: DiffReviewManager;

	beforeEach(() => {
		manager = new DiffReviewManager();
		mockWriteFileSync.mockClear();
		mockUnlinkSync.mockClear();
	});

	describe("recordChange", () => {
		it("records a new file change as pending", () => {
			manager.recordChange("/foo/bar.ts", "old content", "new content");
			const change = manager.getChange("/foo/bar.ts");
			expect(change).toBeDefined();
			expect(change!.status).toBe("pending");
			expect(change!.originalContent).toBe("old content");
			expect(change!.currentContent).toBe("new content");
			expect(change!.patch).toContain("bar.ts");
		});

		it("preserves original snapshot on subsequent modifications", () => {
			manager.recordChange("/foo/bar.ts", "original", "modified1");
			manager.recordChange("/foo/bar.ts", "original", "modified2");
			const change = manager.getChange("/foo/bar.ts")!;
			expect(change.originalContent).toBe("original");
			expect(change.currentContent).toBe("modified2");
			expect(change.status).toBe("pending");
		});

		it("records new file with empty originalContent", () => {
			manager.recordChange("/foo/new.ts", "", "new file content");
			const change = manager.getChange("/foo/new.ts")!;
			expect(change.originalContent).toBe("");
			expect(change.status).toBe("pending");
		});

		it("emits change_recorded event", () => {
			const events: string[] = [];
			manager.on((e) => events.push(e.type));
			manager.recordChange("/foo/bar.ts", "old", "new");
			expect(events).toEqual(["change_recorded"]);
		});
	});

	describe("accept", () => {
		it("accepts a pending file change", () => {
			manager.recordChange("/foo/bar.ts", "old", "new");
			const result = manager.accept("/foo/bar.ts");
			expect(result).toBe(true);
			expect(manager.getChange("/foo/bar.ts")!.status).toBe("accepted");
		});

		it("returns false for non-pending file", () => {
			expect(manager.accept("/nonexistent.ts")).toBe(false);
		});

		it("emits change_accepted event", () => {
			manager.recordChange("/foo/bar.ts", "old", "new");
			const events: string[] = [];
			manager.on((e) => events.push(e.type));
			manager.accept("/foo/bar.ts");
			expect(events).toEqual(["change_accepted"]);
		});
	});

	describe("reject", () => {
		it("rejects a pending existing file and restores original content", () => {
			manager.recordChange("/foo/bar.ts", "original content", "modified");
			const result = manager.reject("/foo/bar.ts");
			expect(result).toBe(true);
			expect(manager.getChange("/foo/bar.ts")!.status).toBe("rejected");
			expect(mockWriteFileSync).toHaveBeenCalledWith("/foo/bar.ts", "original content", "utf-8");
		});

		it("rejects a new file and deletes it", () => {
			mockExistsSync.mockReturnValueOnce(true);
			manager.recordChange("/foo/new.ts", "", "new content");
			const result = manager.reject("/foo/new.ts");
			expect(result).toBe(true);
			expect(manager.getChange("/foo/new.ts")!.status).toBe("rejected");
			expect(mockUnlinkSync).toHaveBeenCalledWith("/foo/new.ts");
		});

		it("returns false for non-pending file", () => {
			expect(manager.reject("/nonexistent.ts")).toBe(false);
		});
	});

	describe("acceptAll", () => {
		it("accepts all pending files", () => {
			manager.recordChange("/a.ts", "old a", "new a");
			manager.recordChange("/b.ts", "old b", "new b");
			manager.accept("/a.ts"); // accept one first
			const count = manager.acceptAll();
			expect(count).toBe(1); // only b was still pending
			expect(manager.getChange("/b.ts")!.status).toBe("accepted");
		});

		it("emits all_accepted event when changes exist", () => {
			manager.recordChange("/a.ts", "old", "new");
			const events: string[] = [];
			manager.on((e) => events.push(e.type));
			manager.acceptAll();
			expect(events).toContain("all_accepted");
		});
	});

	describe("rejectAll", () => {
		it("rejects all pending files and restores content", () => {
			manager.recordChange("/a.ts", "old a", "new a");
			manager.recordChange("/b.ts", "old b", "new b");
			const count = manager.rejectAll();
			expect(count).toBe(2);
			expect(manager.getChange("/a.ts")!.status).toBe("rejected");
			expect(manager.getChange("/b.ts")!.status).toBe("rejected");
			expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
		});
	});

	describe("getPendingFiles", () => {
		it("returns only pending files", () => {
			manager.recordChange("/a.ts", "old", "new");
			manager.recordChange("/b.ts", "old", "new");
			manager.accept("/a.ts");
			const pending = manager.getPendingFiles();
			expect(pending).toHaveLength(1);
			expect(pending[0].filePath).toBe("/b.ts");
		});
	});

	describe("pendingCount / hasPending", () => {
		it("tracks pending count correctly", () => {
			expect(manager.pendingCount).toBe(0);
			expect(manager.hasPending).toBe(false);
			manager.recordChange("/a.ts", "old", "new");
			expect(manager.pendingCount).toBe(1);
			expect(manager.hasPending).toBe(true);
			manager.accept("/a.ts");
			expect(manager.pendingCount).toBe(0);
			expect(manager.hasPending).toBe(false);
		});
	});

	describe("clear", () => {
		it("clears all state", () => {
			manager.recordChange("/a.ts", "old", "new");
			manager.clear();
			expect(manager.pendingCount).toBe(0);
			expect(manager.getChange("/a.ts")).toBeUndefined();
		});

		it("emits cleared event", () => {
			const events: string[] = [];
			manager.on((e) => events.push(e.type));
			manager.clear();
			expect(events).toEqual(["cleared"]);
		});
	});

	describe("event subscription", () => {
		it("unsubscribe function removes listener", () => {
			const events: string[] = [];
			const unsub = manager.on((e) => events.push(e.type));
			unsub();
			manager.recordChange("/a.ts", "old", "new");
			expect(events).toHaveLength(0);
		});
	});
});
