#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createRuntime, type RuntimeResult, type SessionMode } from "./agent/session.js";
import { loadConfig } from "./config.js";
import { App } from "./tui/App.js";

interface ParsedArgs {
	model?: string;
	help: boolean;
	continueSession: boolean;
	resumeList: boolean;
	sessionRef?: string;
	name?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
	const args: ParsedArgs = { help: false, continueSession: false, resumeList: false };
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
		}
	}
	return args;
}

function showHelp(): void {
	console.log(`
openagent — your terminal coding assistant

用法:
  openagent [选项]

选项:
  --model, -m <name>      指定 LLM 模型 (如: claude-sonnet-4-20250514)
  -c, --continue          恢复当前目录最近的会话
  -r, --resume            启动后打开会话列表选择恢复
  --session <path|id>     恢复指定会话文件路径或会话 id
  -n, --name <name>       启动时为当前会话命名
  --help, -h              显示帮助信息

配置:
  全局配置: ~/.config/openagent/config.json
  项目配置: .openagent/config.json
  会话存储: ~/.config/openagent/sessions/

示例:
  openagent
  openagent -c
  openagent -r
  openagent --session abc123
  openagent -n "我的任务"
  openagent --model claude-sonnet-4-20250514
`);
}

function resolveMode(args: ParsedArgs): SessionMode {
	if (args.continueSession) return "continue";
	if (args.sessionRef) return "session";
	return "new";
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);

	if (args.help) {
		showHelp();
		process.exit(0);
	}

	const cwd = process.cwd();
	const config = loadConfig(cwd);
	const model = args.model ?? config.model;
	const mode = resolveMode(args);

	let result: RuntimeResult;
	try {
		result = await createRuntime({
			cwd,
			model,
			config,
			mode,
			...(args.sessionRef ? { sessionRef: args.sessionRef } : {}),
			...(args.name ? { name: args.name } : {}),
		});
	} catch (err) {
		console.error("创建 Agent 会话失败:", err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	const { runtime, skillManager } = result;

	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
	});

	const root = createRoot(renderer);
	root.render(
		<App
			runtime={runtime}
			skillManager={skillManager}
			model={model || "default"}
			cwd={cwd}
			config={config}
			initialResumeList={args.resumeList}
		/>,
	);
}

main().catch((err) => {
	console.error("启动失败:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
