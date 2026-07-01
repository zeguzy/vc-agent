// LSP protocol types — derived from the LSP specification

// ── Position & Range ──────────────────────────────────────────

export interface Position {
	line: number;
	character: number;
}

export interface Range {
	start: Position;
	end: Position;
}

// ── Location ──────────────────────────────────────────────────

export interface Location {
	uri: string;
	range: Range;
}

export interface LocationLink {
	originSelectionRange?: Range;
	targetUri: string;
	targetRange: Range;
	targetSelectionRange: Range;
}

// ── Diagnostics ───────────────────────────────────────────────

export type DiagnosticSeverity = 1 | 2 | 3 | 4; // error, warning, info, hint

export interface Diagnostic {
	range: Range;
	severity?: DiagnosticSeverity;
	code?: string | number;
	source?: string;
	message: string;
	tags?: number[];
	relatedInformation?: Array<{ location: Location; message: string }>;
}

export interface PublishedDiagnostics {
	diagnostics: Diagnostic[];
	version: number | null;
}

// ── Text Edits ────────────────────────────────────────────────

export interface TextEdit {
	range: Range;
	newText: string;
}

export interface TextDocumentEdit {
	textDocument: { uri: string; version?: number | null };
	edits: TextEdit[];
}

export interface CreateFile {
	kind: "create";
	uri: string;
	options?: { overwrite?: boolean; ignoreIfExists?: boolean };
}

export interface RenameFile {
	kind: "rename";
	oldUri: string;
	newUri: string;
	options?: { overwrite?: boolean; ignoreIfExists?: boolean };
}

export interface DeleteFile {
	kind: "delete";
	uri: string;
	options?: { recursive?: boolean; ignoreIfNotExists?: boolean };
}

export type DocumentChange = TextDocumentEdit | CreateFile | RenameFile | DeleteFile;

export interface WorkspaceEdit {
	changes?: Record<string, TextEdit[]>;
	documentChanges?: DocumentChange[];
}

// ── Code Actions ──────────────────────────────────────────────

export type CodeActionKind =
	| "quickfix"
	| "refactor"
	| "refactor.extract"
	| "refactor.inline"
	| "refactor.rewrite"
	| "source"
	| "source.organizeImports"
	| "source.fixAll"
	| string;

export interface Command {
	title: string;
	command: string;
	arguments?: unknown[];
}

export interface CodeAction {
	title: string;
	kind?: CodeActionKind;
	diagnostics?: Diagnostic[];
	isPreferred?: boolean;
	disabled?: { reason: string };
	edit?: WorkspaceEdit;
	command?: Command;
	data?: unknown;
}

export interface CodeActionContext {
	diagnostics: Diagnostic[];
	only?: CodeActionKind[];
}

// ── Symbols ───────────────────────────────────────────────────

export type SymbolKind =
	| 1
	| 2
	| 3
	| 4
	| 5
	| 6
	| 7
	| 8
	| 9
	| 10
	| 11
	| 12
	| 13
	| 14
	| 15
	| 16
	| 17
	| 18
	| 19
	| 20
	| 21
	| 22
	| 23
	| 24
	| 25
	| 26;

export const SYMBOL_KIND_NAMES: Record<number, string> = {
	1: "File",
	2: "Module",
	3: "Namespace",
	4: "Package",
	5: "Class",
	6: "Method",
	7: "Property",
	8: "Field",
	9: "Constructor",
	10: "Enum",
	11: "Interface",
	12: "Function",
	13: "Variable",
	14: "Constant",
	15: "String",
	16: "Number",
	17: "Boolean",
	18: "Array",
	19: "Object",
	20: "Key",
	21: "Null",
	22: "EnumMember",
	23: "Struct",
	24: "Event",
	25: "Operator",
	26: "TypeParameter",
};

export function symbolKindToIcon(kind: number): string {
	const name = SYMBOL_KIND_NAMES[kind] ?? "Unknown";
	return name[0] ?? "?";
}

export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: SymbolKind;
	tags?: number[];
	deprecated?: boolean;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
}

export interface SymbolInformation {
	name: string;
	kind: SymbolKind;
	tags?: number[];
	deprecated?: boolean;
	location: Location;
	containerName?: string;
}

// ── Hover ─────────────────────────────────────────────────────

export interface MarkupContent {
	kind: "plaintext" | "markdown";
	value: string;
}

export type MarkedString = string | { language: string; value: string };

export interface Hover {
	contents: MarkupContent | MarkedString | MarkedString[];
	range?: Range;
}

// ── Server Capabilities ───────────────────────────────────────

export interface ServerCapabilities {
	renameProvider?: boolean | { prepareProvider?: boolean };
	codeActionProvider?: boolean | { resolveProvider?: boolean };
	hoverProvider?: boolean;
	definitionProvider?: boolean;
	typeDefinitionProvider?: boolean;
	implementationProvider?: boolean;
	referencesProvider?: boolean;
	documentSymbolProvider?: boolean;
	workspaceSymbolProvider?: boolean;
	documentFormattingProvider?: boolean;
	[key: string]: unknown;
}
