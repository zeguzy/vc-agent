import { extname } from "node:path";

export interface LspServerConfig {
	command: string[];
	extensions: string[];
	fileTypes?: string[];
	priority?: number;
}

export interface LspConfig {
	lsp: Record<string, LspServerConfig>;
}

export function getDefaultTsConfig(): LspServerConfig {
	return {
		command: ["typescript-language-server", "--stdio"],
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"],
		priority: 100,
	};
}

export function getExtensions(server: LspServerConfig): string[] {
	return server.fileTypes ?? server.extensions;
}

export function matchesFile(server: LspServerConfig, filePath: string): boolean {
	const exts = getExtensions(server);
	return exts.includes(extname(filePath));
}
