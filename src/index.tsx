#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createSession, type SessionResult } from "./agent/session.js";
import { loadConfig } from "./config.js";
import { App } from "./tui/App.js";

interface ParsedArgs {
	model?: string;
	help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
	const args: ParsedArgs = { help: false };
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			args.help = true;
		} else if (arg === "--model" || arg === "-m") {
			args.model = argv[++i];
		} else if (arg.startsWith("--model=")) {
			args.model = arg.slice("--model=".length);
		}
	}
	return args;
}

function showHelp(): void {
	console.log(`
openagent — 基于 Pi SDK 的全屏 TUI 代码 Agent

用法:
  openagent [选项]

选项:
  --model, -m <name>    指定 LLM 模型 (如: claude-sonnet-4-20250514)
  --help, -h           显示帮助信息

配置:
  全局配置: ~/.config/openagent/config.json
  项目配置: .openagent/config.json

示例:
  openagent
  openagent --model claude-sonnet-4-20250514
`);
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

	let sessionResult: SessionResult;
	try {
		sessionResult = await createSession({ cwd, model, config });
	} catch (err) {
		console.error("创建 Agent 会话失败:", err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	const { session, skillManager } = sessionResult;

	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
	});

	const root = createRoot(renderer);
	root.render(
		<App
			session={session}
			skillManager={skillManager}
			model={model || "default"}
			cwd={cwd}
			config={config}
		/>,
	);
}

main().catch((err) => {
	console.error("启动失败:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
