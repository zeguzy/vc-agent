import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemberMessage, ReadInboxOptions } from "./types-v2.js";

const MSG_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function generateMessageId(): string {
	const rand = new Uint8Array(8);
	(globalThis.crypto as Crypto).getRandomValues(rand);
	let suffix = "";
	for (const b of rand) suffix += MSG_ALPHABET[b % 32];
	return `msg_${suffix}`;
}

/**
 * Per-member JSONL inbox store. All operations are synchronous fs calls; safe
 * under Node's single-threaded event loop (no awaits between read+rewrite in
 * markRead, so no interleaving).
 */
export class MemberInbox {
	private readonly filePath: string;
	private readonly historyLimit: number;

	constructor(memberTopicsDir: string, historyLimit: number) {
		this.filePath = join(memberTopicsDir, "inbox.jsonl");
		this.historyLimit = historyLimit;
	}

	append(message: MemberMessage): void {
		try {
			if (!existsSync(this.filePath)) {
				mkdirSync(join(this.filePath, ".."), { recursive: true });
			}
			const existing = this.readAllRaw();
			existing.push(message);
			const trimmed = existing.slice(-this.historyLimit);
			const lines = trimmed.map((m) => JSON.stringify(m)).join("\n");
			writeFileSync(this.filePath, `${lines}\n`, "utf-8");
		} catch (err) {
			if (isReadOnlyError(err)) return;
			throw err;
		}
	}

	read(opts?: ReadInboxOptions): MemberMessage[] {
		const all = this.readAllRaw();
		let filtered = all;
		if (opts?.from) filtered = filtered.filter((m) => m.from === opts.from);
		if (opts?.unreadOnly) filtered = filtered.filter((m) => !m.read);
		const limit = opts?.limit ?? 50;
		return filtered.slice(-limit);
	}

	markRead(ids?: string[]): number {
		try {
			const all = this.readAllRaw();
			const idSet = ids ? new Set(ids) : null;
			let marked = 0;
			const updated = all.map((m) => {
				if (m.read) return m;
				if (idSet && !idSet.has(m.id)) return m;
				marked++;
				return { ...m, read: true };
			});
			if (marked === 0) return 0;
			const lines = updated.map((m) => JSON.stringify(m)).join("\n");
			const tmp = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
			writeFileSync(tmp, `${lines}\n`, "utf-8");
			renameSync(tmp, this.filePath);
			return marked;
		} catch (err) {
			if (isReadOnlyError(err)) return 0;
			throw err;
		}
	}

	private readAllRaw(): MemberMessage[] {
		if (!existsSync(this.filePath)) return [];
		try {
			const raw = readFileSync(this.filePath, "utf-8");
			return raw
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					try {
						return JSON.parse(line) as MemberMessage;
					} catch {
						return null;
					}
				})
				.filter((m): m is MemberMessage => m !== null);
		} catch {
			return [];
		}
	}
}

function isReadOnlyError(err: unknown): boolean {
	return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EROFS";
}
