import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatError } from "../utils/formatError.js";
import { formatDiagnostics, formatLocations, type LspClient } from "./lspClient.js";

interface ToolDefOptions {
	client: LspClient;
}

export function createLspToolDefinitions(opts: ToolDefOptions): ToolDefinition[] {
	const { client } = opts;
	return [
		createDiagnosticsTool(client),
		createGotoDefinitionTool(client),
		createFindReferencesTool(client),
	];
}

function createDiagnosticsTool(client: LspClient): ToolDefinition {
	return {
		name: "lsp_diagnostics",
		label: "LSP Diagnostics",
		description:
			"Get errors, warnings, and hints from the TypeScript language server for a file BEFORE running build. " +
			"Use this to check for type errors, unused variables, and other static analysis issues.",
		promptSnippet: "lsp_diagnostics — check TypeScript errors before build",
		promptGuidelines: [
			"Call lsp_diagnostics after writing or editing TypeScript files to catch errors early.",
			"Use severity filter to focus on errors only when there are too many warnings.",
		],
		parameters: Type.Object({
			filePath: Type.String({ description: "Absolute path to the source file" }),
			severity: Type.Optional(
				Type.String({
					description:
						'Filter by severity: "error" | "warning" | "information" | "hint" | "all" (default: "all")',
				}),
			),
		}),
		execute: async (_toolCallId, params) => {
			const p = params as { filePath: string; severity?: string };
			if (!client.isReady()) {
				const err = client.getInitError();
				return notReadyResult("lsp_diagnostics", err);
			}
			try {
				await client.openFile(p.filePath);
				const diagnostics = await client.getDiagnostics(p.filePath);
				const text = formatDiagnostics(diagnostics, p.severity);
				return { content: [{ type: "text" as const, text }], details: undefined };
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `LSP error: ${formatError(err)}`,
						},
					],
					details: undefined,
				};
			}
		},
	};
}

function createGotoDefinitionTool(client: LspClient): ToolDefinition {
	return {
		name: "lsp_goto_definition",
		label: "LSP Goto Definition",
		description:
			"Jump to the definition of a symbol at the given position. " +
			"Returns the file path, line, and character of the definition location.",
		promptSnippet: "lsp_goto_definition — jump to symbol definition",
		promptGuidelines: [
			"Use lsp_goto_definition to find where a symbol is defined before editing it.",
		],
		parameters: Type.Object({
			filePath: Type.String({ description: "Absolute path to the source file" }),
			line: Type.Number({ description: "Line number (1-based)" }),
			character: Type.Number({ description: "Column position (0-based)" }),
		}),
		execute: async (_toolCallId, params) => {
			const p = params as { filePath: string; line: number; character: number };
			if (!client.isReady()) {
				const err = client.getInitError();
				return notReadyResult("lsp_goto_definition", err);
			}
			try {
				const locs = await client.gotoDefinition(p.filePath, p.line, p.character);
				if (locs.length === 0) {
					return {
						content: [{ type: "text" as const, text: "No definition found" }],
						details: undefined,
					};
				}
				const text = formatLocations(locs);
				return { content: [{ type: "text" as const, text }], details: undefined };
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `LSP error: ${formatError(err)}`,
						},
					],
					details: undefined,
				};
			}
		},
	};
}

function createFindReferencesTool(client: LspClient): ToolDefinition {
	return {
		name: "lsp_find_references",
		label: "LSP Find References",
		description:
			"Find all usages/references of a symbol across the workspace. " +
			"Returns a list of file paths, lines, and characters for each reference.",
		promptSnippet: "lsp_find_references — find all usages of a symbol",
		promptGuidelines: [
			"Use lsp_find_references before renaming or removing a symbol to assess impact.",
		],
		parameters: Type.Object({
			filePath: Type.String({ description: "Absolute path to the source file" }),
			line: Type.Number({ description: "Line number (1-based)" }),
			character: Type.Number({ description: "Column position (0-based)" }),
			includeDeclaration: Type.Optional(
				Type.Boolean({ description: "Include the declaration itself (default: true)" }),
			),
		}),
		execute: async (_toolCallId, params) => {
			const p = params as {
				filePath: string;
				line: number;
				character: number;
				includeDeclaration?: boolean;
			};
			if (!client.isReady()) {
				const err = client.getInitError();
				return notReadyResult("lsp_find_references", err);
			}
			try {
				const locs = await client.findReferences(
					p.filePath,
					p.line,
					p.character,
					p.includeDeclaration ?? true,
				);
				if (locs.length === 0) {
					return {
						content: [{ type: "text" as const, text: "No references found" }],
						details: undefined,
					};
				}
				const text = formatLocations(locs);
				return { content: [{ type: "text" as const, text }], details: undefined };
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `LSP error: ${formatError(err)}`,
						},
					],
					details: undefined,
				};
			}
		},
	};
}

function notReadyResult(
	toolName: string,
	err: string | null,
): { content: { type: "text"; text: string }[]; details: undefined } {
	const reason = err ?? "Language server not started";
	return {
		content: [
			{
				type: "text" as const,
				text: [
					`${toolName}: Language server is not available.`,
					`Reason: ${reason}`,
					"",
					"Install typescript-language-server: npm i -g typescript-language-server",
					"Or configure in .openagent/lsp.json",
				].join("\n"),
			},
		],
		details: undefined,
	};
}
