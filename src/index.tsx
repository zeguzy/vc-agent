#!/usr/bin/env bun
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { type AgentMode, createRuntime, getBaseMode, type SessionMode } from "./agent/session.js";
import { createHttpClient } from "./client/http.js";
import { createClient } from "./client/index.js";
import { readConfig } from "./config.js";
import { HeadlessRunner } from "./headless/runner.js";
import { createHttpServer } from "./server/http.js";
import { createServer } from "./server/index.js";
import type { TeamManagerRef } from "./teams/types-v2.js";
import { createQuestionBridge } from "./tools/question-bridge.js";
import { App } from "./tui/App.js";
import { formatError } from "./utils/formatError.js";

const STARTUP_LOG_DIR = join(homedir(), ".config", "openagent", "logs");
const STARTUP_LOG = join(STARTUP_LOG_DIR, "startup.log");

function appendStartupLog(level: string, args: unknown[]): void {
	try {
		mkdirSync(STARTUP_LOG_DIR, { recursive: true });
		const msg = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
		appendFileSync(STARTUP_LOG, `${new Date().toISOString()} [${level}] ${msg}\n`, "utf-8");
	} catch {
		// logging is non-critical
	}
}

function suppressConsoleToFile(): () => void {
	const origLog = console.log;
	const origWarn = console.warn;
	const origError = console.error;
	let restored = false;
	console.log = (...args: unknown[]) => appendStartupLog("log", args);
	console.warn = (...args: unknown[]) => appendStartupLog("warn", args);
	console.error = (...args: unknown[]) => appendStartupLog("error", args);
	return () => {
		if (restored) return;
		restored = true;
		console.log = origLog;
		console.warn = origWarn;
		console.error = origError;
	};
}

interface ParsedArgs {
	model?: string;
	help: boolean;
	continueSession: boolean;
	resumeList: boolean;
	sessionRef?: string;
	name?: string;
	plan: boolean;
	path?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
	const args: ParsedArgs = { help: false, continueSession: false, resumeList: false, plan: false };
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			args.help = true;
		} else if (arg === "--model" || arg === "-m") {
			args.model = argv[++i];
		} else if (arg.startsWith("--model=")) {
			args.model = arg.slice("--model=".length);
		} else if (arg === "--continue" || arg === "-c") {
			args.continueSession = true;
		} else if (arg === "--resume" || arg === "-r") {
			args.resumeList = true;
		} else if (arg === "--session") {
			args.sessionRef = argv[++i];
		} else if (arg.startsWith("--session=")) {
			args.sessionRef = arg.slice("--session=".length);
		} else if (arg === "--name" || arg === "-n") {
			args.name = argv[++i];
		} else if (arg.startsWith("--name=")) {
			args.name = arg.slice("--name=".length);
		} else if (arg === "--plan") {
			args.plan = true;
		} else if (arg === "--path" || arg === "-p") {
			args.path = argv[++i];
		} else if (arg.startsWith("--path=")) {
			args.path = arg.slice("--path=".length);
		}
	}
	return args;
}

function showHelp(): void {
	console.log(`
openagent — your terminal coding assistant

用法:
  openagent [选项]
  openagent run "<prompt>" [选项]
  openagent serve [--port <port>]
  openagent attach <url>

子命令:
  (无)                    交互式 TUI 模式（默认）
  run "<prompt>"         非交互模式，执行单次 prompt，输出到 stdout
  serve                  启动 HTTP server（REST API + SSE 事件流）
  attach <url>           连接远程 server，以 TUI 模式操作

选项:
  --model, -m <name>      指定 LLM 模型
  -c, --continue          恢复最近的会话
  -r, --resume            启动后打开会话列表
  --session <path|id>     恢复指定会话
  -n, --name <name>       命名当前会话
  --plan                  planner 模式（只读）
  --port <port>           serve 模式端口（默认 4096）
  --path, -p <dir>        指定工作目录
  --help, -h              显示帮助

示例:
  openagent
  openagent run "explain src/index.tsx"
  openagent run -c "next step"
  openagent serve --port 8080
  openagent attach http://localhost:4096
`);
}

function resolveMode(args: ParsedArgs): SessionMode {
	if (args.continueSession) return "continue";
	if (args.sessionRef) return "session";
	return "new";
}

function parseSubcommand(argv: string[]): { sub?: string; rest: string[] } {
	const third = argv[2];
	if (third && !third.startsWith("-") && third !== "") {
		return { sub: third, rest: ["", "", ...argv.slice(3)] };
	}
	return { rest: argv };
}

async function runHeadless(promptText: string, argv: string[]): Promise<void> {
	const args = parseArgs(argv);
	const cwd = args.path ? resolve(args.path) : process.cwd();
	const mode = resolveMode(args);
	const config = readConfig(cwd);
	const agentMode: AgentMode = args.plan ? "planner" : getBaseMode(config);

	const runner = new HeadlessRunner({
		cwd,
		model: args.model,
		mode,
		agentMode,
		sessionRef: args.sessionRef,
		name: args.name,
	});
	const code = await runner.run(promptText);
	process.exit(code);
}

async function runServe(argv: string[]): Promise<void> {
	let port = 4096;
	let pathArg: string | undefined;
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === "--port") {
			port = Number(argv[++i]) || 4096;
		} else if (argv[i]?.startsWith("--port=")) {
			port = Number(argv[i].slice("--port=".length)) || 4096;
		} else if (argv[i] === "--path" || argv[i] === "-p") {
			pathArg = argv[++i];
		} else if (argv[i]?.startsWith("--path=")) {
			pathArg = argv[i].slice("--path=".length);
		}
	}

	const cwd = pathArg ? resolve(pathArg) : process.cwd();
	const config = readConfig(cwd);
	const teamRef: TeamManagerRef = { current: null };
	const { runtime, skillManager, mcpManager } = await createRuntime({
		cwd,
		model: config.model,
		config,
		mode: "new",
		agentMode: getBaseMode(config),
		teamRef,
	});
	const server = createServer({ runtime, skillManager, mcpManager, cwd, teamRef });
	createHttpServer({ server, port });

	console.log(`openagent server: http://localhost:${port}`);
	console.log(`  SSE events:  GET /events`);
	console.log(`  REST API:    POST /prompt, GET /context, GET /messages, ...`);
}

async function runAttach(url: string): Promise<void> {
	const client = createHttpClient(url);

	const renderer = await createCliRenderer({ exitOnCtrlC: false });
	process.on("exit", () => renderer.destroy());

	const root = createRoot(renderer);
	root.render(<App client={client} model="remote" cwd="" />);
}

async function runTui(argv: string[]): Promise<void> {
	const args = parseArgs(argv);

	if (args.help) {
		showHelp();
		process.exit(0);
	}

	// Renderer doesn't own the terminal until createCliRenderer runs, so redirect
	// init-phase console output to the startup log to avoid screen-bottom leaks.
	const restoreConsole = suppressConsoleToFile();
	try {
		const cwd = args.path ? resolve(args.path) : process.cwd();
		const config = readConfig(cwd);
		const model = args.model ?? config.model;
		const mode = resolveMode(args);
		const agentMode: AgentMode = args.plan ? "planner" : getBaseMode(config);

		const questionBridge = createQuestionBridge();
		const teamRef: TeamManagerRef = { current: null };

		let result: Awaited<ReturnType<typeof createRuntime>>;
		try {
			result = await createRuntime({
				cwd,
				model,
				config,
				mode,
				agentMode,
				bridge: questionBridge,
				teamRef,
				...(args.sessionRef ? { sessionRef: args.sessionRef } : {}),
				...(args.name ? { name: args.name } : {}),
			});
		} catch (err) {
			restoreConsole();
			console.error("创建 Agent 会话失败:", formatError(err));
			process.exit(1);
		}

		const { runtime, skillManager, mcpManager } = result;
		const server = createServer({ runtime, skillManager, mcpManager, cwd, teamRef });
		const client = createClient(server);

		const renderer = await createCliRenderer({ exitOnCtrlC: false });
		process.on("exit", () => renderer.destroy());

		const root = createRoot(renderer);
		root.render(
			<App
				client={client}
				model={model || "default"}
				cwd={cwd}
				config={config}
				bridge={questionBridge}
				initialResumeList={args.resumeList}
				initialAgentMode={agentMode}
				mcpManager={mcpManager}
			/>,
		);
	} finally {
		restoreConsole();
	}
}

async function main(): Promise<void> {
	const argv = process.argv;
	const { sub, rest } = parseSubcommand(argv);

	if (argv.includes("--help") || argv.includes("-h")) {
		showHelp();
		process.exit(0);
	}

	switch (sub) {
		case "run": {
			const promptText = rest.slice(2).find((a) => !a.startsWith("-"));
			if (!promptText) {
				console.error('Usage: openagent run "<prompt>"');
				process.exit(1);
			}
			await runHeadless(promptText, rest);
			break;
		}
		case "serve":
			await runServe(rest);
			break;
		case "attach": {
			const url = rest[2];
			if (!url) {
				console.error("Usage: openagent attach <url>");
				process.exit(1);
			}
			await runAttach(url);
			break;
		}
		default:
			await runTui(argv);
	}
}

main().catch((err) => {
	console.error("启动失败:", formatError(err));
	process.exit(1);
});
