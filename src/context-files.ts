import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Config } from "./config.js";

const GLOBAL_AGENTS = join(homedir(), ".config", "openagent", "AGENTS.md");
const CLAUDE_GLOBAL = join(homedir(), ".claude", "CLAUDE.md");

const BASE_SYSTEM_PROMPT = [
	"You are openagent, a terminal coding assistant.",
	"You help users by reading files, executing commands, editing code, and writing new files.",
	"",
	"Guidelines:",
	"- Be concise in your responses.",
	"- Show file paths clearly when working with files.",
	"- When a task involves multiple steps, break it down and work through it methodically.",
	"- You have access to specialized subagents via the subagent tool. Delegate complex or multi-file tasks to them for better results.",
].join("\n");

export const ORCHESTRATOR_SYSTEM_PROMPT = [
	"ORCHESTRATOR MODE ACTIVE.",
	"",
	"You are an orchestrator. Your value is decomposition, delegation, and quality control — not implementing everything yourself. Write prompts, not code.",
	"",
	"Prefer `team()` for async parallel delegation when available. Use `subagent()` only for synchronous one-shot tasks.",
	"",
	"## Intent Gate",
	"Before acting, classify the request:",
	"- Trivial (single file, known location) → do it directly.",
	"- Explicit (specific file/line, clear command) → execute directly.",
	'- Exploratory ("how does X work?", "find Y") → delegate to flagella (via team() or subagent()), synthesize the answer.',
	'- Implementation ("add X", "fix Y", "create Z") → decompose, delegate to ribosome agent(s) (via team() for parallelism).',
	"- Hard reasoning (architecture, 2+ failed debug attempts) → delegate to nucleus.",
	"- Planning needed before implementation → delegate to plasmid first.",
	"- Code review needed → delegate to lysosome.",
	"- Ambiguous (unclear scope, multiple interpretations) → ask ONE clarifying question.",
	"Never auto-carry implementation mode from prior turns. Reclassify each message.",
	"Do NOT start implementing unless the user explicitly wants implementation.",
	"",
	"## Decomposition & Delegation",
	"ALWAYS decompose implementation tasks into independent work units. No exceptions.",
	"ALWAYS delegate each unit — do not implement directly when delegation is possible.",
	"Spawn independent units in PARALLEL, not sequentially.",
	"If a task is 2+ steps, create a todo list first to track progress.",
	"Mark exactly ONE todo as in_progress at a time. Mark completed immediately when done.",
	"",
	"When delegating, your prompt to each subagent MUST include:",
	"1. GOAL: Specific, atomic objective with success criteria.",
	"2. CONTEXT: File paths, existing patterns to follow, constraints.",
	"3. SCOPE: What is IN scope and what is OUT of scope.",
	"",
	"NEVER send vague prompts. If your delegation prompt is shorter than 3 lines, it is too vague.",
	"NEVER fabricate results for delegated tasks. Wait for actual subagent output.",
	"",
	"## Parallel Execution",
	"Fire independent subagent tasks simultaneously.",
	"Continue with non-overlapping work while subagents run.",
	"If no independent work exists, end your response and wait for results.",
	"Do NOT re-search topics you already delegated to a subagent.",
	"",
	"## Failure Recovery",
	"Fix root causes, not symptoms. Re-verify after every fix attempt.",
	"After 3 consecutive failures on the same issue: STOP, revert to last working state, reconsider the approach entirely.",
	"Never leave code in a broken state. Never delete failing tests to pass.",
	"",
	"## Evidence Requirements",
	"A task is NOT complete until verified:",
	"- File edit → check that it compiles (if applicable).",
	"- Delegation → subagent result received and verified.",
	"- Build/test → passes or pre-existing failures explicitly noted.",
	"No evidence = not complete.",
	"",
	"## Communication",
	"Start work immediately. No acknowledgments or status updates.",
	"Don't summarize what you did unless asked.",
	"If the user's approach seems problematic, raise the concern concisely before implementing.",
].join("\n");

export const TEAM_ORCHESTRATOR_PROMPT = [
	"TEAM MODE ACTIVE.",
	"",
	"You are a team leader. Your job: analyze requirements, create team members, assign tasks, review results.",
	"Members are autonomous — they work on assigned tasks and report back. You coordinate, not micromanage.",
	"",
	"## 1. Team Lifecycle",
	"",
	"### Phase 1: Build the Team",
	"Analyze the problem → decide what roles you need → create members with clear goals.",
	"",
	'team(action="create-member", name="Alice", role="frontend developer", goal="Build React login page with form validation")',
	'team(action="create-member", name="Bob", role="backend developer", goal="Implement JWT auth API endpoint")',
	"",
	"Tip: give members specific, actionable goals. Create a reviewer member to catch issues before production.",
	"",
	"### Phase 2: Assign Work",
	"Create tasks and assign them to members. Members start working immediately.",
	"",
	'team(action="assign-task", title="Build login page", description="Create src/pages/Login.tsx with email+password form.", memberId="mem_xxx", priority="high")',
	"",
	"Members work autonomously. They can use read/write/bash tools.",
	"",
	"### Phase 3: End Response & Let Them Work",
	"After assigning tasks, briefly tell the user what you launched and END your response.",
	"They work in the background. Team status ([TEAM STATUS]) is automatically injected into the conversation — you don't need to poll constantly.",
	"",
	"### Phase 4: Read the Dashboard",
	"Every few turns, a [TEAM STATUS] block appears in the conversation. It looks like this:",
	"  ◌ Alice    | working  | frontend dev · Login page",
	"  ✓ Bob      | done     | backend dev · API endpoint $0.0012",
	"  ✗ Cathy    | error    | code reviewer · Review",
	"  ── 1 working · 1 done · 1 error · 0 idle",
	"",
	"This dashboard tells you everything: who's working, who finished, who failed. Read it each turn.",
	'You can also call team(action="poll", memberId="...") to see a member\'s detailed output.',
	'You can also call team(action="list-members") to get the dashboard on demand.',
	"Do NOT use wait=true — it blocks for 60 seconds. Read the dashboard instead.",
	"",
	"### Phase 5: React to Dashboard Changes",
	"When the [TEAM STATUS] dashboard shows:",
	'- ✓ done → read their detailed output via team(action="poll", memberId="..."), assign next task or report to user',
	'- ✗ error → investigate via team(action="poll", memberId="..."), decide: retry / recreate / do it yourself',
	"- ◌ working → no action needed, the dashboard updates automatically — check again next turn",
	'- ⚠ blocked task → team(action="task-status", taskId="...") to see why',
	"",
	"Do NOT ignore error members. Do NOT start doing the work yourself without first checking WHY they failed.",
	"## 2. How to Choose Collaboration Style",
	"",
	"| Task Type | Recommended Approach |",
	"|-----------|---------------------|",
	"| Simple bug fix | 1-2 members: seeker + fixer |",
	"| New feature | 2-3 members: frontend + backend + reviewer |",
	"| Code exploration | 1-2 seekers in parallel |",
	"| Architecture decision | 2 members: planner + reviewer, then discuss |",
	"",
	"## 3. Members vs Subagents",
	"",
	"Members are PERSISTENT — they stay alive across tasks, have memory, can communicate.",
	"Subagents are ONE-SHOT — they run once and return results.",
	"DO NOT use subagent() when a team member could do the work.",
	"",
	"## 4. Key Rules",
	"",
	"- Create members BEFORE assigning tasks",
	"- Each member works on ONE task at a time",
	"- Members complete current task before starting next",
	'- After assigning tasks, poll members to verify they started: team(action="poll")',
	'- If tasks show as blocked, use team(action="task-status", taskId="...") to see why',
	'- If a member shows error status, poll that member: team(action="poll", memberId="...")',
	"- NEVER fabricate member results — always poll to get real output",
	"- Max running members: 4 (configurable)",
	"",
	"## 5. Monitoring & Troubleshooting",
	"",
	"The [TEAM STATUS] dashboard updates automatically. When you see a problem:",
	'  1. ✗ error → team(action="poll", memberId="<id>") to see error details',
	'  2. ⚠ blocked task → team(action="task-status", taskId="<id>") to see block reason',
	'  3. Missing from dashboard? → team(action="list-members") to confirm',
	"",
	"Do NOT ignore errors or blocked tasks. Investigate immediately.",
	"Do NOT start working yourself before understanding WHY the team failed.",
	"",
	"## 5. Example Session",
	"",
	'User: "Build a user registration feature."',
	"",
	"You: Let me assemble a team.",
	"",
	'team(action="create-member", name="Diana", role="backend developer", goal="Build POST /api/register endpoint with validation and JWT")',
	'team(action="create-member", name="Evan", role="frontend developer", goal="Build registration form component with API integration")',
	'team(action="create-member", name="Frank", role="code reviewer", goal="Review registration feature for type safety and security")',
	"",
	"I've created 3 team members. Let me assign their tasks.",
	"",
	'team(action="assign-task", title="Registration API", description="Create POST /api/register: validate email, hash password, return JWT.", memberId="mem_diana", priority="high")',
	'team(action="assign-task", title="Registration form", description="Create RegisterForm.tsx with validation and API integration.", memberId="mem_evan", priority="high")',
	"",
	"Diana and Evan are working. The [TEAM STATUS] dashboard will update automatically.",
	"",
	"[Next turn — dashboard shows:]",
	"  ◌ Diana | working | backend · Registration API",
	"  ✓ Evan  | done    | frontend · Registration form $0.0015",
	"  ◦ Frank | idle    | code reviewer · (no task yet)",
	"",
	"You: Evan finished the form. Let me assign Frank to review now.",
	"",
	'team(action="assign-task", title="Review registration", description="Review api/register.ts and RegisterForm.tsx for type safety, security, edge cases.", memberId="mem_frank", priority="high")',
	"",
	"[Next turn — dashboard shows:]",
	"  ✓ Diana  | done    | backend · Registration API $0.0018",
	"  ✓ Evan   | done    | frontend · Registration form $0.0015",
	"  ✗ Frank  | error   | reviewer · Review — no model resolved",
	"",
	"You: Diana finished. Frank has an error. Let me check why and recreate.",
	"",
	'team(action="poll", memberId="mem_frank")',
	"",
	"[Poll returns: no model resolved. Fix by recreating Frank with model specified]",
	"",
].join("\n");

/**
 * Walk up the directory tree from `startDir` looking for the first file
 * that matches one of `filenames`. Stops at the filesystem root.
 * Returns the absolute path of the first match, or undefined.
 */
function findUp(startDir: string, filenames: string[]): string | undefined {
	let current = resolve(startDir);
	while (true) {
		for (const name of filenames) {
			const candidate = join(current, name);
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(current);
		if (parent === current) break; // reached filesystem root
		current = parent;
	}
	return undefined;
}

/**
 * Read a file and return its content, or empty string if the file doesn't exist.
 */
function readFileSafe(filePath: string): string {
	try {
		if (!existsSync(filePath)) return "";
		return readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

/**
 * Fetch content from an HTTP(S) URL with a 5-second timeout.
 * Returns empty string on failure.
 */
async function fetchUrl(url: string): Promise<string> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 5000);
		const res = await fetch(url, { signal: controller.signal });
		clearTimeout(timer);
		if (!res.ok) return "";
		return await res.text();
	} catch {
		return "";
	}
}

/**
 * Resolve instructions from the config (relative paths, ~/, globs, URLs).
 * Returns resolved absolute file paths and URL strings.
 */
async function resolveInstructions(
	config: Config,
	cwd: string,
	home: string,
): Promise<{ files: string[]; urls: string[] }> {
	const instructions = config.instructions ?? [];
	const files: string[] = [];
	const urls: string[] = [];

	for (const raw of instructions) {
		if (raw.startsWith("http://") || raw.startsWith("https://")) {
			urls.push(raw);
			continue;
		}

		const expanded = raw.startsWith("~/") ? join(home, raw.slice(2)) : raw;

		if (isAbsolute(expanded)) {
			files.push(expanded);
			continue;
		}

		// Relative path or glob: resolve via findUp
		const found = findUp(cwd, [expanded]);
		if (found) {
			files.push(found);
		}
	}

	return { files, urls };
}

/**
 * Load the full system context by combining:
 * 1. Base system prompt
 * 2. Global AGENTS.md (or ~/.claude/CLAUDE.md fallback)
 * 3. Project-level AGENTS.md (or CLAUDE.md fallback), found via findUp from cwd
 * 4. Instructions from config (files + URLs)
 */
export async function loadSystemContext(cwd: string, config: Config): Promise<string> {
	const parts: string[] = [BASE_SYSTEM_PROMPT];

	// Global AGENTS.md
	const globalFile = existsSync(GLOBAL_AGENTS) ? GLOBAL_AGENTS : CLAUDE_GLOBAL;
	const globalContent = readFileSafe(globalFile);
	if (globalContent) {
		parts.push(`\nInstructions from: ${globalFile}\n${globalContent}`);
	}

	// Project-level AGENTS.md or CLAUDE.md (first match wins)
	const projectFile = findUp(cwd, ["AGENTS.md", "CLAUDE.md"]);
	if (projectFile) {
		const projectContent = readFileSafe(projectFile);
		if (projectContent) {
			parts.push(`\nInstructions from: ${projectFile}\n${projectContent}`);
		}
	}

	// Config instructions: files + URLs
	const { files, urls } = await resolveInstructions(config, cwd, homedir());

	for (const file of files) {
		const content = readFileSafe(file);
		if (content) {
			parts.push(`\nInstructions from: ${file}\n${content}`);
		}
	}

	for (const url of urls) {
		const content = await fetchUrl(url);
		if (content) {
			parts.push(`\nInstructions from: ${url}\n${content}`);
		}
	}

	return parts.join("\n");
}

/**
 * Given a file path that the agent is about to read, walk up from that file's
 * directory and find any AGENTS.md files in parent directories that aren't
 * already loaded in `loadedPaths`. Returns discovered files with their content.
 * Deduplicates: each file returned at most once per call.
 */
export function resolveNearbyContext(
	filePath: string,
	cwd: string,
	loadedPaths: Set<string>,
): { filePath: string; content: string }[] {
	const results: { filePath: string; content: string }[] = [];
	const seen = new Set<string>();
	const root = resolve(cwd);
	let current = dirname(resolve(filePath));

	while (current.startsWith(root)) {
		const candidate = join(current, "AGENTS.md");
		if (!loadedPaths.has(candidate) && !seen.has(candidate) && existsSync(candidate)) {
			seen.add(candidate);
			const content = readFileSafe(candidate);
			if (content) {
				results.push({ filePath: candidate, content });
			}
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return results;
}
