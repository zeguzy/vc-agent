import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatError } from "../utils/formatError.js";
import {
	formatCodeActions,
	formatDiagnostics,
	formatDocumentSymbols,
	formatHover,
	formatLocations,
	formatWorkspaceEditPreview,
	formatWorkspaceSymbols,
	type LspClient,
} from "./lspClient.js";
import type { CodeAction, CodeActionContext, Diagnostic } from "./types.js";

const LSP_ACTIONS = [
	"diagnostics",
	"definition",
	"type_definition",
	"implementation",
	"references",
	"hover",
	"document_symbols",
	"workspace_symbols",
	"code_actions",
	"rename",
	"prepare_rename",
	"status",
	"reload",
	"request",
] as const;

type LspAction = (typeof LSP_ACTIONS)[number];

interface LspToolOptions {
	client: LspClient;
}

export function createLspToolDefinitions(opts: LspToolOptions): ToolDefinition[] {
	return [createUnifiedLspTool(opts.client)];
}

function resolveCharacter(
	client: LspClient,
	filePath: string,
	line: number,
	symbol: string | undefined,
	character: number | undefined,
): number {
	if (character !== undefined) return character;
	if (symbol) return client.resolveSymbolColumn(filePath, line, symbol);
	return 0;
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

function textResult(text: string): {
	content: { type: "text"; text: string }[];
	details: undefined;
} {
	return { content: [{ type: "text" as const, text }], details: undefined };
}

function errorResult(err: unknown): {
	content: { type: "text"; text: string }[];
	details: undefined;
} {
	return textResult(`LSP error: ${formatError(err)}`);
}

function createUnifiedLspTool(client: LspClient): ToolDefinition {
	return {
		name: "lsp",
		label: "LSP",
		description:
			"Language Server Protocol tool for code intelligence. Supports 14 actions:\n" +
			"- diagnostics: get errors/warnings for a file or directory\n" +
			"- definition / type_definition / implementation: jump to symbol targets\n" +
			"- references: find all usages of a symbol\n" +
			"- hover: get type/signature info for a symbol\n" +
			"- document_symbols / workspace_symbols: list symbols\n" +
			"- code_actions: get or apply quick fixes and refactors\n" +
			"- rename / prepare_rename: rename a symbol across the workspace\n" +
			"- status: show server capabilities and connection state\n" +
			"- reload: re-open a file to refresh diagnostics\n" +
			"- request: send a raw LSP JSON-RPC request\n\n" +
			"IMPORTANT: Use 'lsp' for ALL symbol-aware operations (rename, find references, goto definition).\n" +
			"NEVER use text-based search-and-replace when LSP rename is available.\n" +
			"Prefer lsp code_actions for import fixes and quick fixes over manual editing.",
		promptSnippet:
			"lsp — unified LSP tool (diagnostics, navigation, symbols, rename, code actions)",
		promptGuidelines: [
			"Use action=diagnostics to check TypeScript errors BEFORE and AFTER editing files.",
			"Use action=definition / references / hover to understand code before modifying it.",
			"Use action=rename with apply=true for symbol renames — NEVER use text-based find-and-replace for renaming.",
			"Use action=code_actions to apply quick fixes (missing imports, type fixes, etc.).",
			"When providing a position, prefer 'symbol' over 'character' for better accuracy.",
			"Use action=workspace_symbols to find symbols across the entire project.",
		],
		parameters: Type.Object({
			action: Type.Union(
				LSP_ACTIONS.map((a) => Type.Literal(a)),
				{ description: "The LSP operation to perform" },
			),
			file: Type.Optional(
				Type.String({
					description: "Absolute path to the source file (required for most actions)",
				}),
			),
			line: Type.Optional(
				Type.Number({ description: "Line number (1-based). Required for position-based actions." }),
			),
			symbol: Type.Optional(
				Type.String({
					description:
						"Symbol name on the given line. Used to resolve the character position if 'character' is not provided. Preferred over manual 'character'.",
				}),
			),
			character: Type.Optional(
				Type.Number({
					description: "Column position (0-based). If omitted, resolved from 'symbol'.",
				}),
			),
			query: Type.Optional(
				Type.String({ description: "Search query for workspace_symbols action" }),
			),
			new_name: Type.Optional(Type.String({ description: "New name for rename action" })),
			apply: Type.Optional(
				Type.Boolean({
					description:
						"For rename/code_actions: if true, apply the edit to disk. If false (default), return a preview.",
				}),
			),
			index: Type.Optional(
				Type.Number({
					description:
						"For code_actions: index of the action to apply (from the list). If omitted, lists all available actions.",
				}),
			),
			severity: Type.Optional(
				Type.String({
					description:
						'For diagnostics: filter by "error" | "warning" | "information" | "hint" | "all"',
				}),
			),
			payload: Type.Optional(
				Type.Object(
					{
						method: Type.String({ description: "LSP method name (e.g., textDocument/completion)" }),
						params: Type.Optional(Type.Unknown({ description: "LSP request parameters" })),
					},
					{ description: "For request action: raw LSP method and params" },
				),
			),
		}),
		execute: async (_toolCallId, params) => {
			const p = params as {
				action: LspAction;
				file?: string;
				line?: number;
				symbol?: string;
				character?: number;
				query?: string;
				new_name?: string;
				apply?: boolean;
				index?: number;
				severity?: string;
				payload?: { method: string; params?: unknown };
			};

			if (!client.isReady()) {
				return notReadyResult("lsp", client.getInitError());
			}

			try {
				return await dispatchAction(client, p);
			} catch (err) {
				return errorResult(err);
			}
		},
	};
}

async function dispatchAction(
	client: LspClient,
	p: {
		action: LspAction;
		file?: string;
		line?: number;
		symbol?: string;
		character?: number;
		query?: string;
		new_name?: string;
		apply?: boolean;
		index?: number;
		severity?: string;
		payload?: { method: string; params?: unknown };
	},
): Promise<{ content: { type: "text"; text: string }[]; details: undefined }> {
	switch (p.action) {
		case "diagnostics":
			return handleDiagnostics(client, p);
		case "definition":
			return handleNavigation(client, "definition", p);
		case "type_definition":
			return handleNavigation(client, "type_definition", p);
		case "implementation":
			return handleNavigation(client, "implementation", p);
		case "references":
			return handleReferences(client, p);
		case "hover":
			return handleHover(client, p);
		case "document_symbols":
			return handleDocumentSymbols(client, p);
		case "workspace_symbols":
			return handleWorkspaceSymbols(client, p);
		case "code_actions":
			return handleCodeActions(client, p);
		case "rename":
			return handleRename(client, p);
		case "prepare_rename":
			return handlePrepareRename(client, p);
		case "status":
			return handleStatus(client);
		case "reload":
			return handleReload(client, p);
		case "request":
			return handleRawRequest(client, p);
	}
}

async function handleDiagnostics(client: LspClient, p: { file?: string; severity?: string }) {
	if (!p.file) return textResult("Error: 'file' is required for diagnostics");
	await client.openFile(p.file);
	const diagnostics = await client.getDiagnostics(p.file);
	return textResult(formatDiagnostics(diagnostics, p.severity));
}

async function handleNavigation(
	client: LspClient,
	kind: "definition" | "type_definition" | "implementation",
	p: { file?: string; line?: number; symbol?: string; character?: number },
) {
	if (!p.file || !p.line) {
		return textResult(`Error: 'file' and 'line' are required for ${kind}`);
	}
	const char = resolveCharacter(client, p.file, p.line, p.symbol, p.character);
	let locs: {
		uri: string;
		range: { start: { line: number; character: number }; end: { line: number; character: number } };
	}[];
	if (kind === "definition") locs = await client.gotoDefinition(p.file, p.line, char);
	else if (kind === "type_definition") locs = await client.gotoTypeDefinition(p.file, p.line, char);
	else locs = await client.gotoImplementation(p.file, p.line, char);

	if (locs.length === 0) return textResult(`No ${kind.replace("_", " ")} found`);
	return textResult(formatLocations(locs));
}

async function handleReferences(
	client: LspClient,
	p: { file?: string; line?: number; symbol?: string; character?: number },
) {
	if (!p.file || !p.line) {
		return textResult("Error: 'file' and 'line' are required for references");
	}
	const char = resolveCharacter(client, p.file, p.line, p.symbol, p.character);

	const locs = await retryReferences(client, p.file, p.line, char);
	if (locs.length === 0) return textResult("No references found");
	return textResult(formatLocations(locs));
}

async function retryReferences(
	client: LspClient,
	filePath: string,
	line: number,
	character: number,
	maxRetries = 3,
) {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const locs = await client.findReferences(filePath, line, character);
		if (attempt === 0 && locs.length > 1) return locs;
		if (attempt === 0 && locs.length === 0) {
			await new Promise((r) => setTimeout(r, 250));
			continue;
		}
		if (locs.length > 1 || attempt === maxRetries - 1) return locs;
		await new Promise((r) => setTimeout(r, 250));
	}
	return client.findReferences(filePath, line, character);
}

async function handleHover(
	client: LspClient,
	p: { file?: string; line?: number; symbol?: string; character?: number },
) {
	if (!p.file || !p.line) {
		return textResult("Error: 'file' and 'line' are required for hover");
	}
	const char = resolveCharacter(client, p.file, p.line, p.symbol, p.character);
	const hover = await client.hover(p.file, p.line, char);
	if (!hover) return textResult("No hover information");
	return textResult(formatHover(hover));
}

async function handleDocumentSymbols(client: LspClient, p: { file?: string }) {
	if (!p.file) return textResult("Error: 'file' is required for document_symbols");
	const symbols = await client.documentSymbol(p.file);
	return textResult(formatDocumentSymbols(symbols));
}

async function handleWorkspaceSymbols(client: LspClient, p: { query?: string }) {
	const query = p.query ?? "";
	const symbols = await client.workspaceSymbol(query);
	return textResult(formatWorkspaceSymbols(symbols));
}

async function handleCodeActions(
	client: LspClient,
	p: {
		file?: string;
		line?: number;
		symbol?: string;
		character?: number;
		apply?: boolean;
		index?: number;
	},
) {
	if (!p.file || !p.line) {
		return textResult("Error: 'file' and 'line' are required for code_actions");
	}
	const char = resolveCharacter(client, p.file, p.line, p.symbol, p.character);
	const range = {
		start: { line: p.line - 1, character: char },
		end: { line: p.line - 1, character: char + (p.symbol?.length ?? 1) },
	};
	const diagnostics = await client.getDiagnostics(p.file);
	const context: CodeActionContext = { diagnostics: diagnostics as Diagnostic[] };
	const actions = await client.codeAction(p.file, range, context);

	if (actions.length === 0) return textResult("No code actions available");

	if (p.index !== undefined) {
		const action = actions[p.index];
		if (!action) return textResult(`Error: No code action at index ${p.index}`);
		let resolved = action;
		if (!resolved.edit) {
			resolved = await client.resolveCodeAction(action);
		}
		if (!resolved.edit) {
			return textResult(`Code action "${action.title}" has no edit to apply`);
		}
		if (p.apply) {
			const changed = client.applyWorkspaceEdit(resolved.edit);
			return textResult(
				`Applied "${action.title}" — modified ${changed.length} file(s):\n${changed.map((f) => `  ${f}`).join("\n")}`,
			);
		}
		return textResult(
			`Preview of "${action.title}":\n${formatWorkspaceEditPreview(resolved.edit)}`,
		);
	}

	return textResult(formatCodeActions(actions as CodeAction[]));
}

async function handleRename(
	client: LspClient,
	p: {
		file?: string;
		line?: number;
		symbol?: string;
		character?: number;
		new_name?: string;
		apply?: boolean;
	},
) {
	if (!p.file || !p.line || !p.new_name) {
		return textResult("Error: 'file', 'line', and 'new_name' are required for rename");
	}
	const char = resolveCharacter(client, p.file, p.line, p.symbol, p.character);
	const edit = await client.rename(p.file, p.line, char, p.new_name);
	if (!edit) return textResult("Rename not available at this position");

	if (p.apply) {
		const changed = client.applyWorkspaceEdit(edit);
		return textResult(
			`Renamed to "${p.new_name}" — modified ${changed.length} file(s):\n${changed.map((f) => `  ${f}`).join("\n")}`,
		);
	}
	return textResult(`Preview of rename to "${p.new_name}":\n${formatWorkspaceEditPreview(edit)}`);
}

async function handlePrepareRename(
	client: LspClient,
	p: { file?: string; line?: number; symbol?: string; character?: number },
) {
	if (!p.file || !p.line) {
		return textResult("Error: 'file' and 'line' are required for prepare_rename");
	}
	const char = resolveCharacter(client, p.file, p.line, p.symbol, p.character);
	const range = await client.prepareRename(p.file, p.line, char);
	if (!range) return textResult("Rename is not available at this position");
	const line = range.start.line + 1;
	const char2 = range.start.character;
	return textResult(`Rename available at [${line}:${char2}]`);
}

async function handleStatus(client: LspClient) {
	const caps = client.getCapabilities();
	const lines: string[] = [
		`LSP Server Status`,
		`  Ready: ${client.isReady()}`,
		`  Server: typescript-language-server`,
		"",
		"Capabilities:",
	];

	if (caps) {
		const capList: Array<[string, string]> = [
			["definition", caps.definitionProvider ? "✓" : "✗"],
			["type definition", caps.typeDefinitionProvider ? "✓" : "✗"],
			["implementation", caps.implementationProvider ? "✓" : "✗"],
			["references", caps.referencesProvider ? "✓" : "✗"],
			["hover", caps.hoverProvider ? "✓" : "✗"],
			["document symbols", caps.documentSymbolProvider ? "✓" : "✗"],
			["workspace symbols", caps.workspaceSymbolProvider ? "✓" : "✗"],
			["rename", caps.renameProvider ? "✓" : "✗"],
			["code actions", caps.codeActionProvider ? "✓" : "✗"],
		];
		for (const [name, status] of capList) {
			lines.push(`  ${status} ${name}`);
		}
	} else {
		lines.push("  (not available)");
	}

	return textResult(lines.join("\n"));
}

async function handleReload(client: LspClient, p: { file?: string }) {
	if (!p.file) return textResult("Error: 'file' is required for reload");
	await client.didSave(p.file);
	await client.openFile(p.file);
	const diagnostics = await client.getDiagnostics(p.file);
	return textResult(formatDiagnostics(diagnostics));
}

async function handleRawRequest(
	client: LspClient,
	p: { payload?: { method: string; params?: unknown } },
) {
	if (!p.payload?.method) {
		return textResult("Error: 'payload.method' is required for request action");
	}
	const result = await client.rawRequest(p.payload.method, p.payload.params);
	return textResult(JSON.stringify(result, null, 2));
}

export { LSP_ACTIONS };
