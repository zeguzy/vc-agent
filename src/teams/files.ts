import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import {
	createFrontmatter,
	parseFrontmatter,
	serializeFrontmatter,
	updateFrontmatter,
	validateName,
} from "./memory-types.js";
import type {
	Goal,
	GoalPriority,
	GoalStatus,
	MemberIndexStructure,
	MemberName,
	MemoryType,
	TaskState,
	TeamDirectoryPaths,
	TeamMdStructure,
	TopicFileFrontmatter,
} from "./types-v2.js";

// ─── TeamFiles: File I/O for .openagent/team/ ────────────────

export class TeamFiles {
	readonly paths: TeamDirectoryPaths;

	constructor(teamDir: string) {
		this.paths = {
			teamDir,
			teamMd: join(teamDir, "TEAM.md"),
			membersDir: join(teamDir, "members"),
			sharedDir: join(teamDir, "shared"),
			memberIndex: (name) => join(teamDir, "members", `${name}.md`),
			memberTopics: (name) => join(teamDir, "members", name),
			memberTopic: (name, topic) => join(teamDir, "members", name, `${topic}.md`),
			sharedTopic: (topic) => join(teamDir, "shared", `${topic}.md`),
			archivedMember: (name) => join(teamDir, "members", "_archived", name),
		};
	}

	// ─── Initialization ─────────────────────────────────────

	initTeamDir(): void {
		try {
			if (!existsSync(this.paths.teamDir)) mkdirSync(this.paths.teamDir, { recursive: true });
			if (!existsSync(this.paths.membersDir)) mkdirSync(this.paths.membersDir, { recursive: true });
			if (!existsSync(this.paths.sharedDir)) mkdirSync(this.paths.sharedDir, { recursive: true });
			const archivedDir = join(this.paths.membersDir, "_archived");
			if (!existsSync(archivedDir)) mkdirSync(archivedDir, { recursive: true });
			if (!existsSync(this.paths.teamMd)) this.writeTeamMd(this.emptyTeamMd());
		} catch (err) {
			// Silently skip if filesystem is read-only (e.g. test environments with cwd="/test")
			if (
				!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EROFS")
			) {
				throw err;
			}
		}
	}

	// ─── TEAM.md ───────────────────────────────────────────

	readTeamMd(): TeamMdStructure {
		const raw = this.readFile(this.paths.teamMd);
		if (raw === null) return this.emptyTeamMd();
		return parseTeamMd(raw);
	}

	writeTeamMd(data: TeamMdStructure): void {
		this.atomicWrite(this.paths.teamMd, serializeTeamMd(data));
	}

	// ─── Member Index ──────────────────────────────────────

	readMemberIndex(name: MemberName): MemberIndexStructure | null {
		validateName(name, "member name");
		const raw = this.readFile(this.paths.memberIndex(name));
		if (raw === null) return null;
		return parseMemberIndex(raw);
	}

	writeMemberIndex(name: MemberName, data: MemberIndexStructure): void {
		validateName(name, "member name");
		this.atomicWrite(this.paths.memberIndex(name), serializeMemberIndex(data));
	}

	/** Create member directory + initial index. */
	initMemberDir(
		name: MemberName,
		role: string,
		goal: string,
		model?: string,
		constraints?: string,
	): void {
		validateName(name, "member name");
		const topicsDir = this.paths.memberTopics(name);
		if (!existsSync(topicsDir)) mkdirSync(topicsDir, { recursive: true });
		if (!existsSync(this.paths.memberIndex(name))) {
			this.writeMemberIndex(name, {
				profile: { role, goal, model },
				constraints: constraints || undefined,
				activeContext: "",
				memoryIndex: [],
				recentActivity: [],
			});
		}
	}

	// ─── Topic Files ───────────────────────────────────────

	readTopicFile(
		name: MemberName,
		topic: string,
	): (TopicFileFrontmatter & { content: string }) | null {
		validateName(name, "member name");
		validateName(topic, "topic name");
		const path = this.paths.memberTopic(name, topic);
		const raw = this.readFile(path);
		if (raw === null) return null;
		const parsed = parseFrontmatter(raw);
		if (parsed === null) {
			// Broken frontmatter — default to user type
			return {
				type: "user",
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				tokens: 0,
				content: raw,
			};
		}
		return { ...parsed.frontmatter, content: parsed.body };
	}

	writeTopicFile(
		name: MemberName,
		topic: string,
		type: MemoryType,
		content: string,
		existingFm?: TopicFileFrontmatter,
	): void {
		validateName(name, "member name");
		validateName(topic, "topic name");
		const fm = existingFm
			? updateFrontmatter(existingFm, content)
			: createFrontmatter(type, content);
		const raw = serializeFrontmatter(fm, content);
		const path = this.paths.memberTopic(name, topic);
		this.atomicWrite(path, raw);
	}

	readSharedTopic(topic: string): (TopicFileFrontmatter & { content: string }) | null {
		validateName(topic, "topic name");
		const path = this.paths.sharedTopic(topic);
		const raw = this.readFile(path);
		if (raw === null) return null;
		const parsed = parseFrontmatter(raw);
		if (parsed === null) {
			return {
				type: "project",
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				tokens: 0,
				content: raw,
			};
		}
		return { ...parsed.frontmatter, content: parsed.body };
	}

	async writeSharedTopic(
		topic: string,
		type: MemoryType,
		content: string,
		existingFm?: TopicFileFrontmatter,
	): Promise<void> {
		validateName(topic, "topic name");
		const fm = existingFm
			? updateFrontmatter(existingFm, content)
			: createFrontmatter(type, content);
		const raw = serializeFrontmatter(fm, content);
		const path = this.paths.sharedTopic(topic);
		// proper-lockfile requires the target file to exist before locking — a
		// first-time write would otherwise fail with ENOENT (lstat on the
		// not-yet-created file). Create an empty file atomically (O_EXCL|O_CREAT
		// via 'wx'); a concurrent writer racing to create is harmless since only
		// one 'wx' wins and the loser's EEXIST is swallowed.
		if (!existsSync(path)) {
			try {
				writeFileSync(path, "", { flag: "wx" });
			} catch {
				// Race lost or already exists — proceed to lock.
			}
		}
		const release = await lockfile.lock(path, { retries: 3 });
		try {
			this.atomicWrite(path, raw);
		} finally {
			await release();
		}
	}

	listTopicFiles(name: MemberName): string[] {
		validateName(name, "member name");
		const dir = this.paths.memberTopics(name);
		if (!existsSync(dir)) return [];
		return readdirSync(dir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => f.slice(0, -3));
	}

	listSharedTopics(): string[] {
		if (!existsSync(this.paths.sharedDir)) return [];
		return readdirSync(this.paths.sharedDir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => f.slice(0, -3));
	}

	// ─── Archive ───────────────────────────────────────────

	archiveMember(name: MemberName): void {
		validateName(name, "member name");
		const src = this.paths.memberTopics(name);
		const dst = this.paths.archivedMember(name);
		if (existsSync(src) && !existsSync(dst)) {
			mkdirSync(join(this.paths.membersDir, "_archived"), { recursive: true });
			renameSync(src, dst);
		}
		// Remove index file
		const idx = this.paths.memberIndex(name);
		if (existsSync(idx)) unlinkSync(idx);
	}

	// ─── Internal ──────────────────────────────────────────

	private readFile(path: string): string | null {
		if (!existsSync(path)) return null;
		try {
			return readFileSync(path, "utf-8");
		} catch {
			return null;
		}
	}

	/** Atomic write: write to temp file then rename. */
	private atomicWrite(target: string, content: string): void {
		const tmp = `${target}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		writeFileSync(tmp, content, "utf-8");
		renameSync(tmp, target);
	}

	private emptyTeamMd(): TeamMdStructure {
		return {
			mission: "",
			goals: [],
			members: [],
			activeTasks: [],
			importantNotes: "",
			sharedMemoryIndex: [],
		};
	}
}

// ─── TEAM.md Parsing ────────────────────────────────────────

function parseTeamMd(raw: string): TeamMdStructure {
	const sections = splitSections(raw);
	return {
		mission: sections.get("Mission") ?? "",
		goals: parseGoals(sections.get("Goals") ?? ""),
		members: parseMembersTable(sections.get("Members") ?? ""),
		activeTasks: parseActiveTasks(sections.get("Active Tasks") ?? ""),
		importantNotes: sections.get("Important Notes") ?? "",
		sharedMemoryIndex: parseSharedIndex(sections.get("Shared Memory Index") ?? ""),
	};
}

function serializeTeamMd(data: TeamMdStructure): string {
	const lines: string[] = ["# Team", "", "## Mission", data.mission];

	lines.push("", "## Goals");
	const goalsText = serializeGoals(data.goals);
	if (goalsText) lines.push(goalsText);

	lines.push("", "## Members");
	if (data.members.length === 0) {
		lines.push("| Name | Role | Status | Current Task | Session |");
		lines.push("|------|------|--------|--------------|---------|");
	} else {
		lines.push("| Name | Role | Status | Current Task | Session |");
		lines.push("|------|------|--------|--------------|---------|");
		for (const m of data.members) {
			lines.push(
				`| ${m.name} | ${m.role} | ${m.status} | ${m.currentTask} | ${m.sessionId ?? ""} |`,
			);
		}
	}
	lines.push("", "## Active Tasks");
	for (const t of data.activeTasks) {
		const check = t.done ? "x" : " ";
		const assignee = t.memberName ? ` → @${t.memberName}` : "";
		const participants = t.participants ? ` [participants: ${t.participants.join(", ")}]` : "";
		lines.push(`- [${check}] ${t.id}: ${t.title}${participants}${assignee}`);
	}
	lines.push("", "## Important Notes", data.importantNotes, "", "## Shared Memory Index");
	for (const s of data.sharedMemoryIndex) {
		lines.push(`- \`${s.path}\` — ${s.description}`);
	}
	return lines.join("\n");
}

function parseMembersTable(raw: string): TeamMdStructure["members"] {
	const lines = raw.split("\n").filter((l) => l.startsWith("|") && !l.includes("------"));
	// Skip header row
	return lines.slice(1).map((l) => {
		const cells = l
			.split("|")
			.filter(Boolean)
			.map((c) => c.trim());
		const sessionId = cells[4] ?? "";
		return {
			name: cells[0] ?? "",
			role: cells[1] ?? "",
			status: cells[2] ?? "",
			currentTask: cells[3] ?? "",
			...(sessionId ? { sessionId } : {}),
		};
	});
}

function parseActiveTasks(raw: string): TaskState[] {
	return raw
		.split("\n")
		.filter((l) => l.startsWith("- ["))
		.map((l, i) => {
			const done = l[3] === "x";
			const rest = l.slice(6); // after "- [x] " or "- [ ] "
			const idMatch = rest.match(/^(\S+?):\s*/);
			const id = idMatch ? idMatch[1] : `T${i + 1}`;
			const afterId = idMatch ? rest.slice(idMatch[0].length) : rest;
			const assigneeMatch = afterId.match(/\s*→\s*@(\S+)/);
			const memberName = assigneeMatch ? assigneeMatch[1] : null;
			const title = assigneeMatch
				? afterId.slice(0, -assigneeMatch[0].length).trim()
				: afterId.trim();
			const participantsMatch = title.match(/\s*\[participants:\s*([^\]]+)\]/);
			const participants = participantsMatch
				? participantsMatch[1].split(",").map((s) => s.trim())
				: undefined;
			const cleanTitle = participantsMatch
				? title.slice(0, -participantsMatch[0].length).trim()
				: title;
			const isDiscussion = Boolean(participants);
			return {
				id,
				title: cleanTitle,
				description: "",
				memberName,
				priority: "medium" as const,
				type: (isDiscussion ? "discussion" : "execution") as TaskState["type"],
				done,
				...(participants ? { participants } : {}),
			};
		});
}

export function parseGoals(raw: string): Goal[] {
	const goals: Goal[] = [];
	const stack: { goal: Goal; depth: number }[] = [];
	let lastGoal: Goal | null = null;

	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;

		const goalMatch = line.match(/^(\s*)- \[(\w+)\] (\S+): (.+)$/);
		if (goalMatch) {
			const indent = goalMatch[1].length;
			const depth = Math.floor(indent / 2);
			const status = goalMatch[2] as GoalStatus;
			const id = goalMatch[3];
			const rest = goalMatch[4];

			const priorityMatch = rest.match(/\[(high|medium|low)\]/);
			const priority = (priorityMatch?.[1] ?? "medium") as GoalPriority;
			const assigneeMatch = rest.match(/@(\S+)/);
			const assignee = assigneeMatch ? assigneeMatch[1] : null;
			const taskIdsMatch = rest.match(/→\s*(\S+)/);
			const taskIds = taskIdsMatch ? taskIdsMatch[1].split(",").filter(Boolean) : [];

			let title = rest;
			if (priorityMatch) title = title.replace(priorityMatch[0], "").trim();
			if (assigneeMatch) title = title.replace(assigneeMatch[0], "").trim();
			if (taskIdsMatch) title = title.replace(taskIdsMatch[0], "").trim();

			while (stack.length > depth) stack.pop();
			const parentGoalId = stack.length > 0 ? stack[stack.length - 1].goal.id : null;

			const now = new Date().toISOString();
			const goal: Goal = {
				id,
				title,
				description: "",
				status,
				priority,
				parentGoalId,
				taskIds,
				assignee,
				successCriteria: "",
				blockers: "",
				createdAt: now,
				updatedAt: now,
			};

			goals.push(goal);
			stack.push({ goal, depth });
			lastGoal = goal;
			continue;
		}

		const descMatch = line.match(/^\s+Description: (.+)$/);
		if (descMatch && lastGoal) {
			lastGoal.description = descMatch[1].trim();
			continue;
		}

		const successMatch = line.match(/^\s+Success: (.+)$/);
		if (successMatch && lastGoal) {
			lastGoal.successCriteria = successMatch[1].trim();
			continue;
		}

		const blockedMatch = line.match(/^\s+Blocked: (.+)$/);
		if (blockedMatch && lastGoal) {
			lastGoal.blockers = blockedMatch[1].trim();
			continue;
		}
	}

	return goals;
}

export function serializeGoals(goals: Goal[]): string {
	if (goals.length === 0) return "";

	const byParent = new Map<string | null, Goal[]>();
	for (const g of goals) {
		const parent = g.parentGoalId;
		if (!byParent.has(parent)) byParent.set(parent, []);
		byParent.get(parent)!.push(g);
	}

	const lines: string[] = [];
	function serializeLevel(parentId: string | null, depth: number): void {
		const children = byParent.get(parentId) ?? [];
		for (const g of children) {
			const indent = "  ".repeat(depth);
			const priority = `[${g.priority}]`;
			const assignee = g.assignee ? ` @${g.assignee}` : "";
			const taskLinks = g.taskIds.length > 0 ? ` → ${g.taskIds.join(",")}` : "";
			lines.push(`${indent}- [${g.status}] ${g.id}: ${g.title} ${priority}${assignee}${taskLinks}`.trimEnd());
			if (g.description) {
				lines.push(`${indent}  Description: ${g.description}`);
			}
			if (g.successCriteria) {
				lines.push(`${indent}  Success: ${g.successCriteria}`);
			}
			if (g.blockers) {
				lines.push(`${indent}  Blocked: ${g.blockers}`);
			}
			serializeLevel(g.id, depth + 1);
		}
	}

	serializeLevel(null, 0);
	return lines.join("\n");
}

function parseSharedIndex(raw: string): TeamMdStructure["sharedMemoryIndex"] {
	return raw
		.split("\n")
		.filter((l) => l.startsWith("- "))
		.map((l) => {
			const pathMatch = l.match(/`([^`]+)`/);
			const descMatch = l.match(/—\s*(.+)$/);
			return {
				path: pathMatch?.[1] ?? "",
				description: descMatch?.[1]?.trim() ?? "",
			};
		});
}

// ─── Member Index Parsing ───────────────────────────────────

function parseMemberIndex(raw: string): MemberIndexStructure {
	const sections = splitSections(raw);
	const profileRaw = sections.get("Profile") ?? "";
	const role = extractField(profileRaw, "Role");
	const goal = extractField(profileRaw, "Goal");
	const model = extractField(profileRaw, "Model");
	const constraintsRaw = sections.get("Constraints") ?? "";
	const constraints = constraintsRaw.trim() || undefined;

	const assignedTools = parseListField(sections.get("Assigned Tools") ?? "");
	const assignedSkills = parseListField(sections.get("Assigned Skills") ?? "");
	const assignedMcps = parseListField(sections.get("Assigned MCPs") ?? "");

	return {
		profile: { role, goal, model: model || undefined },
		constraints,
		activeContext: sections.get("Active Context") ?? "",
		memoryIndex: parseMemoryIndexLines(sections.get("Memory Index") ?? ""),
		recentActivity: parseRecentActivityLines(sections.get("Recent Activity") ?? ""),
		...(assignedTools.length > 0 ? { assignedTools } : {}),
		...(assignedSkills.length > 0 ? { assignedSkills } : {}),
		...(assignedMcps.length > 0 ? { assignedMcps } : {}),
	};
}

function serializeMemberIndex(data: MemberIndexStructure): string {
	const lines: string[] = [
		`# ${data.profile.role}`, // placeholder, caller should set name
		"",
		"## Profile",
		`- Role: ${data.profile.role}`,
		`- Goal: ${data.profile.goal}`,
	];
	if (data.profile.model) lines.push(`- Model: ${data.profile.model}`);
	if (data.constraints) {
		lines.push("", "## Constraints", data.constraints);
	}
	if (data.assignedTools && data.assignedTools.length > 0) {
		lines.push("", "## Assigned Tools", `- ${data.assignedTools.join(", ")}`);
	}
	if (data.assignedSkills && data.assignedSkills.length > 0) {
		lines.push("", "## Assigned Skills", `- ${data.assignedSkills.join(", ")}`);
	}
	if (data.assignedMcps && data.assignedMcps.length > 0) {
		lines.push("", "## Assigned MCPs", `- ${data.assignedMcps.join(", ")}`);
	}
	lines.push("", "## Active Context", data.activeContext, "", "## Memory Index");
	for (const m of data.memoryIndex) {
		lines.push(`- \`${m.file}\` [${m.type}] — ${m.description}`);
	}
	lines.push("", "## Recent Activity");
	for (const a of data.recentActivity) {
		lines.push(`- ${a.date}: ${a.entry}`);
	}
	return lines.join("\n");
}

function parseListField(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	return trimmed
		.split("\n")
		.filter((l) => l.startsWith("- "))
		.flatMap((l) => l.slice(2).split(","))
		.map((s) => s.trim())
		.filter(Boolean);
}

function parseMemoryIndexLines(raw: string): MemberIndexStructure["memoryIndex"] {
	return raw
		.split("\n")
		.filter((l) => l.startsWith("- "))
		.map((l) => {
			const fileMatch = l.match(/`([^`]+)`/);
			const typeMatch = l.match(/\[(\w+)\]/);
			const descMatch = l.match(/—\s*(.+)$/);
			return {
				file: fileMatch?.[1] ?? "",
				type: (typeMatch?.[1] as MemoryType) ?? "user",
				description: descMatch?.[1]?.trim() ?? "",
			};
		});
}

function parseRecentActivityLines(raw: string): MemberIndexStructure["recentActivity"] {
	return raw
		.split("\n")
		.filter((l) => l.startsWith("- "))
		.map((l) => {
			const rest = l.slice(2); // after "- "
			const dateMatch = rest.match(/^(\S+?):\s*/);
			return {
				date: dateMatch?.[1] ?? "",
				entry: dateMatch ? rest.slice(dateMatch[0].length) : rest,
			};
		});
}

// ─── Shared Utilities ───────────────────────────────────────

function splitSections(raw: string): Map<string, string> {
	const map = new Map<string, string>();
	const lines = raw.split("\n");
	let currentHeader = "";
	let currentLines: string[] = [];

	for (const line of lines) {
		if (line.startsWith("## ")) {
			if (currentHeader) map.set(currentHeader, currentLines.join("\n"));
			currentHeader = line.slice(3).trim();
			currentLines = [];
		} else {
			currentLines.push(line);
		}
	}
	if (currentHeader) map.set(currentHeader, currentLines.join("\n"));
	return map;
}

function extractField(raw: string, key: string): string {
	const line = raw.split("\n").find((l) => l.includes(`${key}:`));
	if (!line) return "";
	const idx = line.indexOf(`${key}:`);
	return line.slice(idx + key.length + 1).trim();
}
