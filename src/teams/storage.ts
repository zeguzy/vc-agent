/**
 * Team state persistence — file-backed storage for team members, tasks, and inbox.
 *
 * Directory layout (under ~/.config/openagent/teams/{sessionId}/):
 *   config.json           — team config + member list (status, stats)
 *   tasks/{taskId}.json   — individual task (status, result, assignment)
 *   inbox/{memberId}.json — per-member inbox (append-only message array)
 *
 * Design follows Claude Code's agent-teams filesystem approach:
 * every state mutation writes through to disk, so the filesystem is the
 * source of truth. On startup, TeamStorage.load() restores prior state.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemberId, TeamMember, TeamMessage, TeamTask } from "./types.js";

export interface TeamConfigOnDisk {
	sessionId: string;
	cwd: string;
	createdAt: string;
	members: TeamMember[];
}

export interface TaskOnDisk extends TeamTask {
	updatedAt: string;
}

export interface MessageOnDisk extends TeamMessage {}

function teamDirRoot(home: string = homedir()): string {
	return join(home, ".config", "openagent", "teams");
}

function sessionTeamDir(sessionId: string): string {
	return join(teamDirRoot(), sessionId);
}

function configPath(sessionId: string): string {
	return join(sessionTeamDir(sessionId), "config.json");
}

function tasksDir(sessionId: string): string {
	return join(sessionTeamDir(sessionId), "tasks");
}

function inboxDir(sessionId: string): string {
	return join(sessionTeamDir(sessionId), "inbox");
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJson<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return null;
	}
}

function writeJson(path: string, data: unknown): void {
	try {
		writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
	} catch {
		// Persist failure is non-critical — in-memory state is still valid
	}
}

export class TeamStorage {
	private readonly sessionId: string;
	private initialized = false;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	init(cwd: string, existingMembers?: TeamMember[]): void {
		if (this.initialized) return;
		this.initialized = true;

		const dir = sessionTeamDir(this.sessionId);
		ensureDir(dir);
		ensureDir(tasksDir(this.sessionId));
		ensureDir(inboxDir(this.sessionId));

		if (!existsSync(configPath(this.sessionId))) {
			const config: TeamConfigOnDisk = {
				sessionId: this.sessionId,
				cwd,
				createdAt: new Date().toISOString(),
				members: existingMembers ?? [],
			};
			writeJson(configPath(this.sessionId), config);
		}
	}

	saveMembers(members: TeamMember[]): void {
		if (!this.initialized) return;
		const config = readJson<TeamConfigOnDisk>(configPath(this.sessionId));
		if (config) {
			config.members = members;
			writeJson(configPath(this.sessionId), config);
		}
	}

	saveMember(member: TeamMember): void {
		if (!this.initialized) return;
		const config = readJson<TeamConfigOnDisk>(configPath(this.sessionId));
		if (config) {
			const idx = config.members.findIndex((m) => m.id === member.id);
			if (idx >= 0) {
				config.members[idx] = member;
			} else {
				config.members.push(member);
			}
			writeJson(configPath(this.sessionId), config);
		}
	}

	deleteMember(memberId: MemberId): void {
		if (!this.initialized) return;
		const config = readJson<TeamConfigOnDisk>(configPath(this.sessionId));
		if (config) {
			config.members = config.members.filter((m) => m.id !== memberId);
			writeJson(configPath(this.sessionId), config);
		}
		// Also remove inbox file
		const inboxFile = join(inboxDir(this.sessionId), `${memberId}.json`);
		try {
			if (existsSync(inboxFile)) rmSync(inboxFile);
		} catch {
			// Non-critical
		}
	}

	saveTask(task: TeamTask): void {
		if (!this.initialized) return;
		const taskOnDisk: TaskOnDisk = { ...task, updatedAt: new Date().toISOString() };
		const path = join(tasksDir(this.sessionId), `${task.id}.json`);
		writeJson(path, taskOnDisk);
	}

	deleteTask(taskId: string): void {
		if (!this.initialized) return;
		const path = join(tasksDir(this.sessionId), `${taskId}.json`);
		try {
			if (existsSync(path)) rmSync(path);
		} catch {
			// Non-critical
		}
	}

	appendMessage(msg: TeamMessage): void {
		if (!this.initialized) return;
		// Write to recipient's inbox
		const recipients = msg.to === "team" ? [] : [msg.to];
		// Also write to sender's outbox (same file for self-messages)
		const allTargets = new Set([...recipients, msg.from]);
		for (const targetId of allTargets) {
			const inboxFile = join(inboxDir(this.sessionId), `${targetId}.json`);
			ensureDir(inboxDir(this.sessionId));
			const messages: MessageOnDisk[] = readJson<MessageOnDisk[]>(inboxFile) ?? [];
			messages.push(msg);
			writeJson(inboxFile, messages);
		}
	}

	load(): {
		members: TeamMember[];
		tasks: TeamTask[];
		messages: TeamMessage[];
		cwd: string;
	} | null {
		const config = readJson<TeamConfigOnDisk>(configPath(this.sessionId));
		if (!config) return null;

		// Load tasks
		const tasks: TeamTask[] = [];
		const tDir = tasksDir(this.sessionId);
		if (existsSync(tDir)) {
			for (const file of readdirSync(tDir)) {
				if (!file.endsWith(".json")) continue;
				const task = readJson<TaskOnDisk>(join(tDir, file));
				if (task) {
					const { updatedAt, ...rest } = task;
					tasks.push(rest);
				}
			}
		}

		// Load all inbox messages (deduplicated)
		const msgMap = new Map<string, TeamMessage>();
		const iDir = inboxDir(this.sessionId);
		if (existsSync(iDir)) {
			for (const file of readdirSync(iDir)) {
				if (!file.endsWith(".json")) continue;
				const msgs = readJson<MessageOnDisk[]>(join(iDir, file));
				if (msgs) {
					for (const m of msgs) {
						if (!msgMap.has(m.id)) msgMap.set(m.id, m);
					}
				}
			}
		}
		const messages = [...msgMap.values()].sort((a, b) => a.timestamp - b.timestamp);

		return {
			members: config.members,
			tasks,
			messages,
			cwd: config.cwd,
		};
	}

	destroy(): void {
		try {
			const dir = sessionTeamDir(this.sessionId);
			if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
		} catch {
			// Non-critical
		}
	}
}
