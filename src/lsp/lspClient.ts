import { type ChildProcess, spawn } from "child_process";
import { join } from "path";

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

// ── LSP types ─────────────────────────────────────────────────

export interface LspDiagnostic {
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	severity?: 1 /* Error */ | 2 /* Warning */ | 3 /* Information */ | 4 /* Hint */;
	message: string;
	source?: string;
}

export interface LspLocation {
	uri: string;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
}

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
	private diagnostics = new Map<string, LspDiagnostic[]>();
	private initialized = false;
	private rootUri: string;
	private serverCommand: string[];
	private initError: string | null = null;

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

			// Read JSON-RPC messages from stdout (LSP header/body protocol)
			let outBuffer = "";
			this.process.stdout!.on("data", (chunk: Buffer) => {
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

			// Handle stderr
			this.process.stderr?.on("data", () => {
				// typescript-language-server logs to stderr, ignore
			});

			// Initialize handshake
			const result = await this.request("initialize", {
				processId: process.pid,
				rootUri: this.rootUri,
				capabilities: {
					textDocument: {
						diagnostic: { dynamicRegistration: true },
					},
				},
			});

			if (!result) {
				this.initError = "Initialize handshake failed";
				return false;
			}

			this.sendNotification("initialized", {});
			this.initialized = true;
			return true;
		} catch (err) {
			this.initError = err instanceof Error ? err.message : String(err);
			return false;
		}
	}

	getInitError(): string | null {
		return this.initError;
	}

	isReady(): boolean {
		return this.initialized;
	}

	// ── Public API ──────────────────────────────────────────

	async openFile(filePath: string): Promise<void> {
		const uri = this.filePathToUri(filePath);
		this.sendNotification("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: "typescript",
				version: 1,
				text: "", // LSP server will read from disk or use project knowledge
			},
		});
	}

	async getDiagnostics(filePath: string): Promise<LspDiagnostic[]> {
		// Wait briefly for diagnostics to arrive after didOpen
		const uri = this.filePathToUri(filePath);
		await this.sleep(300);
		return this.diagnostics.get(uri) ?? [];
	}

	async gotoDefinition(filePath: string, line: number, character: number): Promise<LspLocation[]> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request("textDocument/definition", {
			textDocument: { uri },
			position: { line: line - 1, character },
		});
		if (!result) return [];
		return Array.isArray(result) ? (result as LspLocation[]) : [result as LspLocation];
	}

	async findReferences(
		filePath: string,
		line: number,
		character: number,
		includeDeclaration = true,
	): Promise<LspLocation[]> {
		const uri = this.filePathToUri(filePath);
		await this.ensureFileOpen(filePath);
		const result = await this.request("textDocument/references", {
			textDocument: { uri },
			position: { line: line - 1, character },
			context: { includeDeclaration },
		});
		if (!result) return [];
		return result as LspLocation[];
	}

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

	private filePathToUri(filePath: string): string {
		const abs = filePath.startsWith("/") ? filePath : join("/", filePath);
		return `file://${abs}`;
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
			// Timeout after 15s
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
			// Response
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
			// Notification
			this.handleNotification(msg as JsonRpcNotification);
		}
	}

	private handleNotification(notif: JsonRpcNotification): void {
		if (notif.method === "textDocument/publishDiagnostics") {
			const params = notif.params as {
				uri: string;
				diagnostics: LspDiagnostic[];
			};
			if (params) {
				this.diagnostics.set(params.uri, params.diagnostics ?? []);
			}
		}
	}
}

// ── Formatters ────────────────────────────────────────────────

export function formatDiagnostics(
	diagnostics: LspDiagnostic[],
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

export function formatLocation(loc: LspLocation): string {
	const path = loc.uri.replace(/^file:\/\//, "");
	const line = loc.range.start.line + 1;
	const char = loc.range.start.character;
	return `${path}:${line}:${char}`;
}

export function formatLocations(locs: LspLocation[], maxItems = 100): string {
	if (locs.length === 0) return "";

	const display = locs.slice(0, maxItems);
	const lines = display.map(formatLocation);

	if (locs.length > maxItems) {
		lines.push(`Found ${locs.length} locations (showing first ${maxItems})`);
	}

	return lines.join("\n");
}
