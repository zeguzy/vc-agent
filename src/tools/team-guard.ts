import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

const TEAM_DIR = ".openagent/team/";
const GUARD_MSG =
	'Use the "team" tool to manage .openagent/team/ files. Direct file access is not allowed in team mode.';

function isTeamPath(target: string): boolean {
	return target.includes(TEAM_DIR);
}

export function createTeamGuardedBashTool(cwd: string): ToolDefinition {
	const base = createBashToolDefinition(cwd);
	const origExecute = base.execute;

	return {
		name: "bash",
		label: base.label ?? "Bash",
		description: base.description,
		parameters: base.parameters,
		promptSnippet: base.promptSnippet,
		promptGuidelines: base.promptGuidelines,
		renderShell: base.renderShell,
		prepareArguments: base.prepareArguments,
		executionMode: base.executionMode,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const args = params as { command?: string };
			if (args.command && isTeamPath(args.command)) {
				return {
					content: [{ type: "text" as const, text: GUARD_MSG }],
					details: {},
					isError: true,
				};
			}
			return origExecute.call(base, toolCallId, params as never, signal, onUpdate, ctx);
		},
	} as ToolDefinition;
}

export function createTeamGuardedWriteTool(cwd: string): ToolDefinition {
	const base = createWriteToolDefinition(cwd);
	const origExecute = base.execute;

	return {
		name: "write",
		label: base.label ?? "Write",
		description: base.description,
		parameters: base.parameters,
		promptSnippet: base.promptSnippet,
		promptGuidelines: base.promptGuidelines,
		renderShell: base.renderShell,
		prepareArguments: base.prepareArguments,
		executionMode: base.executionMode,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const args = params as { file_path?: string };
			if (args.file_path && isTeamPath(args.file_path)) {
				return {
					content: [{ type: "text" as const, text: GUARD_MSG }],
					details: {},
					isError: true,
				};
			}
			return origExecute.call(base, toolCallId, params as never, signal, onUpdate, ctx);
		},
	} as ToolDefinition;
}
