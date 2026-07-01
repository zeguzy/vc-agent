import { type ChildProcess, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { formatError } from "../utils/formatError.js";
import type {
	CodeAction,
	CodeActionContext,
	Command,
	Diagnostic,
	DocumentChange,
	DocumentSymbol,
	Hover,
	Location,
	LocationLink,
	Position,
	Range,
	ServerCapabilities,
	SymbolInformation,
	WorkspaceEdit,
} from "./types.js";
import { SYMBOL_KIND_NAMES } from "./types.js";

// ── JSON-RPC types ────────────────────────────────────────────

type JsonRpcId = number | string;

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: JsonRpcId;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: JsonRpcId;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ── Backward-compatible type aliases ──────────────────────────

export type LspDiagnostic = Diagnostic;
export type LspLocation = Location;

const SEVERITY_LABEL: Record<number, string> = {
	1: "error",
	2: "warning",
	3: "information",
	4: "hint",
};

// ── LspClient ─────────────────────────────────────────────────

export class LspClient {
	private process: ChildProcess | null = null;
	private nextId = 1;
	private pending = new Map<
		JsonRpcId,
		{ resolve: (v: unknown) => void; reject: (e: Error) => void }
	>();
	private diagnostics = new Map<string, Diagnostic[]>();
	private diagnosticVersions = new Map<string, number | null>();
	private capabilities: ServerCapabilities | null = null;
	private initialized = false;
	private rootUri: string;
	private serverCommand: string[];
	private initError: string | null = null;
	private openFiles = new Set<string>();

	constructor(cwd: string, serverCommand?: string[]) {
		this.rootUri = `file://${cwd}`;
		this.serverCommand = serverCommand ?? ["typescript-language-server", "--stdio"];
	}

	async init(): Promise<boolean> {
		try {
			const [bin, ...args] = this.serverCommand;
			this.process = spawn(bin, args, {
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env },
			});

			this.process.on("error", (err) => {
				this.initError = `Failed to start ${this.serverCommand[0]}: ${err.message}`;
			});

			this.process.on("exit", (code) => {
				if (!this.initialized && code !== 0) {
					this.initError = `${this.serverCommand[0]} exited with code ${code}`;
				}
			});

			let outBuffer = "";
			this.process.stdout?.on("data", (chunk: Buffer) => {
				outBuffer += chunk.toString("utf-8");
				while (true) {
					const headerEnd = outBuffer.indexOf("\r\n\r\n");
					if (headerEnd === -1) break;

					const header = outBuffer.slice(0, headerEnd);
					const contentLenMatch = header.match(/Content-Length: (\d+)/i);
					if (!contentLenMatch) {
						outBuffer = outBuffer.slice(headerEnd + 4);
						continue;
					}

					const contentLength = Number.parseInt(contentLenMatch[1], 10);
					const bodyStart = headerEnd + 4;
					if (outBuffer.length < bodyStart + contentLength) break;

					const body = outBuffer.slice(bodyStart, bodyStart + contentLength);
					outBuffer = outBuffer.slice(bodyStart + contentLength);

					try {
						const msg: JsonRpcMessage = JSON.parse(body);
						this.handleMessage(msg);
					} catch {
						// Skip malformed messages
					}
				}
			});

			this.process.stderr?.on("data", () => {});

			const result = (await this.request("initialize", {
				processId: process.pid,
				rootUri: this.rootUri,
				capabilities: {
					textDocument: {
						synchronization: {
							didOpen: true,
							didChange: true,
							willSave: false,
							willSaveWaitUntil: false,
							didSave: true,
						},
						hover: { contentFormat: ["markdown", "plaintext"] },
						completion: { completionItem: { snippetSupport: false } },
						definition: { linkSupport: true },
						typeDefinition: { linkSupport: true },
						implementation: { linkSupport: true },
						references: {},
						rename: { prepareSupport: true },
						codeAction: {
							codeActionLiteralSupport: {
								codeActionKind: {
									valueSet: [
										"quickfix",
										"refactor",
										"refactor.extract",
										"refactor.inline",
										"source.organizeImports",
									],
								},
							},
						},
						diagnostic: { dynamicRegistration: true },
					},
					workspace: {
						symbol: {},
						workspaceEdit: {
							documentChanges: true,
							resourceOperations: ["create", "rename", "delete"],
						},
					},
				},
			})) as { capabilities?: ServerCapabilities } | null;

			if (!result) {
				this.initError = "Initialize handshake failed";
				return false;
			}

			this.capabilities = result.capabilities ?? null;

			this.sendNotification("initialized", {});
			this.initialized = true;
			return true;
		} catch (err) {
			this.initError = formatError(err);
			return false;
		}
	}

	getInitError(): string | null {
		return this.initError;
	}

	isReady(): boolean {
		return this.initialized;
	}

	getCapabilities(): ServerCapabilities | null {
		return this.capabilities;
	}

	hasCapability(name: keyof ServerCapabilities): boolean {
		const cap = this.capabilities?.[name];
		return cap === true || (typeof cap === "object" && cap !== null);
	}

	// ── File management ─────────────────────────────────────

	async openFile(filePath: string): Promise<void> {
		const uri = this.filePathToUri(filePath);
		if (this.openFiles.has(uri)) return;
		let text = "";
		try {
			text = readFileSync(this.uriToFilePath(uri), "utf-8");
		} catch {
			// File might not exist yet
		}
		const ext = filePath.split(".").pop() ?? "typescript";
		const languageId =
			ext === "ts" || ext === "mts" || ext === "cts"
				? "typescript"
				: ext === "tsx"
					? "typescriptreact"
					: ext === "js" || ext === "mjs" || ext === "cjs"
						? "javascript"
						: ext === "jsx"
							? "javascriptreact"
							: "typescript";
		this.sendNotification("textDocument/didOpen", {
			textDocument: { uri, languageId, version: 1, text },
		});
		this.openFiles.add(uri);
	}

	async didSave(filePath: string): Promise<void> {
		const uri = this.filePathToUri(filePath);
		let text = "";
		try {
			text = readFileSync(this.uriToFilePath(uri), "utf-8");
		} catch {
			// ignore
		}
		this.sendNotification("textDocument/didSave", {
			textDocument: { uri },
			text,
		});
	}

	// ── Diagnostics ─────────────────────────────────────────

	async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
		const uri = this.filePathToUri(filePath);
		await this.sleep(300);
		return this.diagnostics.get(uri) ?? [];
	}

	async getDiagnosticsForGlob(
		filePath: string,
		signal?: AbortSignal,
	): Promise<Map<string, Diagnostic[]>> {
		await this.openFile(filePath);
		await this.waitForDiagnostics(filePath, signal);
		return new Map(this.diagnostics);
	}

	async waitForDiagnostics(filePath: string, signal?: AbortSignal, maxWait = 5000): Promise<void> {
		const uri = this.filePathToUri(filePath);
		const start = Date.now();
		while (Date.now() - start < maxWait) {
			if (signal?.aborted) return;
			if (this.diagnostics.has(uri)) return;
			await this.sleep(100);
		}
	}

	// ── Navigation ──────────────────────────────────────────

	async gotoDefinition(filePath: string, line: number, character: number): Promise<Location[]> {
		return this.locationRequest("textDocument/definition", filePath, line, character);
	}

	async gotoTypeDefinition(filePath: string, line: number, character: number): Promise<Location[]> {
		return this.locationRequest("textDocument/typeDefinition", filePath, line, character);
	}

	async gotoImplementation(filePath: string, line: number, character: number): Promise<Location[]> {
		return this.locationRequest("textDocument/implementation", filePath, line, character);
	}

	async findReferences(
		filePath: string,
		line: number,
		character: number,
		includeDeclaration = true,
	): Promise<Location[]> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request("textDocument/references", {
			textDocument: { uri },
			position: this.toLspPosition(line, character),
			context: { includeDeclaration },
		});
		if (!result) return [];
		return Array.isArray(result) ? (result as Location[]) : [result as Location];
	}

	async hover(filePath: string, line: number, character: number): Promise<Hover | null> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request("textDocument/hover", {
			textDocument: { uri },
			position: this.toLspPosition(line, character),
		});
		return (result as Hover | null) ?? null;
	}

	// ── Symbols ─────────────────────────────────────────────

	async documentSymbol(filePath: string): Promise<DocumentSymbol[]> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request("textDocument/documentSymbol", {
			textDocument: { uri },
		});
		if (!result) return [];
		return result as DocumentSymbol[];
	}

	async workspaceSymbol(query: string): Promise<SymbolInformation[]> {
		const result = await this.request("workspace/symbol", { query });
		if (!result) return [];
		return result as SymbolInformation[];
	}

	// ── Rename ──────────────────────────────────────────────

	async prepareRename(filePath: string, line: number, character: number): Promise<Range | null> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request("textDocument/prepareRename", {
			textDocument: { uri },
			position: this.toLspPosition(line, character),
		});
		if (!result) return null;
		return result as Range;
	}

	async rename(
		filePath: string,
		line: number,
		character: number,
		newName: string,
	): Promise<WorkspaceEdit | null> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request("textDocument/rename", {
			textDocument: { uri },
			position: this.toLspPosition(line, character),
			newName,
		});
		return (result as WorkspaceEdit | null) ?? null;
	}

	// ── Code Actions ────────────────────────────────────────

	async codeAction(
		filePath: string,
		range: Range,
		context: CodeActionContext,
	): Promise<CodeAction[]> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request("textDocument/codeAction", {
			textDocument: { uri },
			range,
			context,
		});
		if (!result) return [];
		return (result as (CodeAction | Command)[]).filter(
			(item): item is CodeAction => "edit" in item || "kind" in item,
		);
	}

	async resolveCodeAction(action: CodeAction): Promise<CodeAction> {
		const result = await this.request("codeAction/resolve", action);
		return (result as CodeAction) ?? action;
	}

	// ── Raw LSP request ─────────────────────────────────────

	async rawRequest(method: string, params: unknown): Promise<unknown> {
		return this.request(method, params);
	}

	// ── Symbol column resolution ────────────────────────────

	resolveSymbolColumn(filePath: string, line: number, symbol: string): number {
		try {
			const content = readFileSync(filePath, "utf-8");
			const lines = content.split("\n");
			const lineText = lines[line - 1] ?? "";
			const col = lineText.indexOf(symbol);
			return col === -1 ? 0 : col;
		} catch {
			return 0;
		}
	}

	// ── WorkspaceEdit application ───────────────────────────

	applyWorkspaceEdit(edit: WorkspaceEdit): string[] {
		const changed: string[] = [];

		if (edit.documentChanges) {
			for (const change of edit.documentChanges) {
				if (this.applyDocumentChange(change)) {
					if ("textDocument" in change) {
						changed.push(this.uriToFilePath(change.textDocument.uri));
					} else if ("uri" in change) {
						changed.push(this.uriToFilePath(change.uri));
					}
				}
			}
		} else if (edit.changes) {
			for (const [uri, edits] of Object.entries(edit.changes)) {
				const filePath = this.uriToFilePath(uri);
				this.applyTextEdits(filePath, edits);
				changed.push(filePath);
			}
		}

		for (const f of changed) {
			this.openFiles.delete(this.filePathToUri(f));
		}
		return changed;
	}

	// ── Lifecycle ───────────────────────────────────────────

	async shutdown(): Promise<void> {
		if (!this.process) return;
		try {
			this.sendRequest("shutdown", {});
			this.sendNotification("exit", {});
			this.process.kill();
		} catch {
			this.process.kill("SIGKILL");
		}
		this.initialized = false;
	}

	// ── Helpers ─────────────────────────────────────────────

	private async ensureFileOpen(filePath: string): Promise<void> {
		await this.openFile(filePath);
		await this.sleep(200);
	}

	private toLspPosition(line: number, character: number): Position {
		return { line: line - 1, character };
	}

	private async locationRequest(
		method: string,
		filePath: string,
		line: number,
		character: number,
	): Promise<Location[]> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request(method, {
			textDocument: { uri },
			position: this.toLspPosition(line, character),
		});
		if (!result) return [];
		return this.normalizeLocationResult(result);
	}

	private normalizeLocationResult(result: unknown): Location[] {
		if (Array.isArray(result)) {
			return result.map((r) =>
				"targetUri" in r ? this.locationLinkToLocation(r as LocationLink) : (r as Location),
			);
		}
		if (result && typeof result === "object") {
			if ("targetUri" in result) {
				return [this.locationLinkToLocation(result as LocationLink)];
			}
			return [result as Location];
		}
		return [];
	}

	private locationLinkToLocation(link: LocationLink): Location {
		return {
			uri: link.targetUri,
			range: link.targetSelectionRange ?? link.targetRange,
		};
	}

	private applyDocumentChange(change: DocumentChange): boolean {
		if ("textDocument" in change) {
			const filePath = this.uriToFilePath(change.textDocument.uri);
			this.applyTextEdits(filePath, change.edits);
			return true;
		}
		if (change.kind === "create") {
			const filePath = this.uriToFilePath(change.uri);
			const dir = dirname(filePath);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			if (!existsSync(filePath) || change.options?.overwrite) {
				writeFileSync(filePath, "", "utf-8");
			}
			return true;
		}
		if (change.kind === "rename") {
			const oldPath = this.uriToFilePath(change.oldUri);
			const newPath = this.uriToFilePath(change.newUri);
			renameSync(oldPath, newPath);
			return true;
		}
		if (change.kind === "delete") {
			const filePath = this.uriToFilePath(change.uri);
			unlinkSync(filePath);
			return true;
		}
		return false;
	}

	private applyTextEdits(filePath: string, edits: { range: Range; newText: string }[]): void {
		let content = "";
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			// File might not exist
		}
		const lines = content.split("\n");
		const sorted = [...edits].sort((a, b) => {
			const lineDiff = b.range.start.line - a.range.start.line;
			if (lineDiff !== 0) return lineDiff;
			return b.range.start.character - a.range.start.character;
		});
		for (const edit of sorted) {
			const startLine = edit.range.start.line;
			const startCol = edit.range.start.character;
			const endLine = edit.range.end.line;
			const endCol = edit.range.end.character;

			const targetLines = lines.slice(startLine, endLine + 1);
			const lineBefore = (targetLines[0] ?? "").slice(0, startCol);
			const lineAfter = (targetLines[targetLines.length - 1] ?? "").slice(endCol);
			const newLines = (lineBefore + edit.newText + lineAfter).split("\n");

			lines.splice(startLine, targetLines.length, ...newLines);
		}
		writeFileSync(filePath, lines.join("\n"), "utf-8");
	}

	private filePathToUri(filePath: string): string {
		const abs = filePath.startsWith("/") ? filePath : join("/", filePath);
		return `file://${abs}`;
	}

	private uriToFilePath(uri: string): string {
		return uri.replace(/^file:\/\//, "");
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// ── JSON-RPC ────────────────────────────────────────────

	private sendRequest(method: string, params?: unknown): void {
		if (!this.process?.stdin) return;
		const id = this.nextId++;
		const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
		this.write(msg);
	}

	private sendNotification(method: string, params?: unknown): void {
		if (!this.process?.stdin) return;
		const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
		this.write(msg);
	}

	private async request(method: string, params?: unknown): Promise<unknown> {
		if (!this.process?.stdin) throw new Error("LSP server not running");
		const id = this.nextId++;
		const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.write(msg);
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`LSP request ${method} timed out`));
				}
			}, 15000);
		});
	}

	private write(msg: JsonRpcMessage): void {
		const body = JSON.stringify(msg);
		const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
		this.process?.stdin?.write(header + body);
	}

	private handleMessage(msg: JsonRpcMessage): void {
		if ("id" in msg && "result" in msg) {
			const pending = this.pending.get(msg.id);
			if (pending) {
				this.pending.delete(msg.id);
				if (msg.error) {
					pending.reject(new Error(msg.error.message));
				} else {
					pending.resolve(msg.result);
				}
			}
		} else if ("method" in msg) {
			this.handleNotification(msg as JsonRpcNotification);
		}
	}

	private handleNotification(notif: JsonRpcNotification): void {
		if (notif.method === "textDocument/publishDiagnostics") {
			const params = notif.params as {
				uri: string;
				diagnostics: Diagnostic[];
				version?: number | null;
			};
			if (params) {
				this.diagnostics.set(params.uri, params.diagnostics ?? []);
				this.diagnosticVersions.set(params.uri, params.version ?? null);
			}
		}
	}
}

// ── Formatters ────────────────────────────────────────────────

export function formatDiagnostics(
	diagnostics: Diagnostic[],
	severity?: string,
	maxItems = 50,
): string {
	let items = diagnostics;
	if (severity && severity !== "all") {
		const sevMap: Record<string, number> = { error: 1, warning: 2, information: 3, hint: 4 };
		const target = sevMap[severity];
		if (target !== undefined) {
			items = items.filter((d) => d.severity === target);
		}
	}

	if (items.length === 0) return "No diagnostics found";

	const lines: string[] = [];
	const display = items.slice(0, maxItems);
	for (const d of display) {
		const sev = SEVERITY_LABEL[d.severity ?? 3];
		const line = d.range.start.line + 1;
		const char = d.range.start.character;
		lines.push(`${sev} [${line}:${char}]: ${d.message}`);
	}

	if (items.length > maxItems) {
		lines.push(`Found ${items.length} diagnostics (showing first ${maxItems})`);
	}

	return lines.join("\n");
}

export function formatLocation(loc: Location): string {
	const path = loc.uri.replace(/^file:\/\//, "");
	const line = loc.range.start.line + 1;
	const char = loc.range.start.character;
	return `${path}:${line}:${char}`;
}

export function formatLocations(locs: Location[], maxItems = 100): string {
	if (locs.length === 0) return "";

	const display = locs.slice(0, maxItems);
	const lines = display.map(formatLocation);

	if (locs.length > maxItems) {
		lines.push(`Found ${locs.length} locations (showing first ${maxItems})`);
	}

	return lines.join("\n");
}

export function formatHover(hover: Hover): string {
	if (!hover) return "No hover information";
	const contents = hover.contents;
	if (typeof contents === "string") return contents;
	if (Array.isArray(contents)) {
		return contents
			.map((c) => (typeof c === "string" ? c : `\`\`\`${c.language}\n${c.value}\n\`\`\``))
			.join("\n\n");
	}
	if (typeof contents === "object" && "kind" in contents) {
		return contents.value;
	}
	return "No hover information";
}

export function formatDocumentSymbols(symbols: DocumentSymbol[], maxItems = 100): string {
	if (symbols.length === 0) return "No symbols found";

	const lines: string[] = [];
	const flatten = (syms: DocumentSymbol[], depth: number): void => {
		for (const s of syms.slice(0, maxItems)) {
			const icon = SYMBOL_KIND_NAMES[s.kind] ?? "?";
			const indent = "  ".repeat(depth);
			const line = s.range.start.line + 1;
			lines.push(`${indent}${icon} ${s.name} [${line}]${s.detail ? ` — ${s.detail}` : ""}`);
			if (s.children && s.children.length > 0) {
				flatten(s.children, depth + 1);
			}
		}
	};

	flatten(symbols, 0);
	return lines.join("\n");
}

export function formatWorkspaceSymbols(symbols: SymbolInformation[], maxItems = 50): string {
	if (symbols.length === 0) return "No symbols found";

	const lines: string[] = [];
	for (const s of symbols.slice(0, maxItems)) {
		const icon = SYMBOL_KIND_NAMES[s.kind] ?? "?";
		const path = s.location.uri.replace(/^file:\/\//, "");
		const line = s.location.range.start.line + 1;
		lines.push(`${icon} ${s.name} — ${path}:${line}`);
	}

	if (symbols.length > maxItems) {
		lines.push(`Found ${symbols.length} symbols (showing first ${maxItems})`);
	}

	return lines.join("\n");
}

export function formatCodeActions(actions: CodeAction[]): string {
	if (actions.length === 0) return "No code actions available";

	const lines: string[] = [];
	for (let i = 0; i < actions.length; i++) {
		const a = actions[i];
		const kind = a.kind ? ` (${a.kind})` : "";
		const disabled = a.disabled ? ` [disabled: ${a.disabled.reason}]` : "";
		lines.push(`[${i}] ${a.title}${kind}${disabled}`);
	}
	return lines.join("\n");
}

export function formatWorkspaceEditPreview(edit: WorkspaceEdit): string {
	const lines: string[] = [];
	const changes = edit.changes ?? {};
	const docChanges = edit.documentChanges ?? [];

	if (Object.keys(changes).length > 0) {
		for (const [uri, edits] of Object.entries(changes)) {
			const path = uri.replace(/^file:\/\//, "");
			lines.push(`📄 ${path}:`);
			for (const e of edits) {
				const line = e.range.start.line + 1;
				lines.push(`  [${line}] ${e.newText.split("\n")[0]}${e.newText.includes("\n") ? "…" : ""}`);
			}
		}
	}

	if (docChanges.length > 0) {
		for (const change of docChanges) {
			if ("textDocument" in change) {
				const path = change.textDocument.uri.replace(/^file:\/\//, "");
				lines.push(`📄 ${path}:`);
				for (const e of change.edits) {
					const line = e.range.start.line + 1;
					lines.push(
						`  [${line}] ${e.newText.split("\n")[0]}${e.newText.includes("\n") ? "…" : ""}`,
					);
				}
			} else if ("kind" in change) {
				if (change.kind === "create") {
					lines.push(`✨ create: ${change.uri.replace(/^file:\/\//, "")}`);
				} else if (change.kind === "rename") {
					lines.push(
						`✏️  rename: ${change.oldUri.replace(/^file:\/\//, "")} → ${change.newUri.replace(/^file:\/\//, "")}`,
					);
				} else if (change.kind === "delete") {
					lines.push(`🗑️  delete: ${change.uri.replace(/^file:\/\//, "")}`);
				}
			}
		}
	}

	return lines.join("\n") || "No changes";
}
