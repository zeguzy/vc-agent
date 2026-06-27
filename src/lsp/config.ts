export interface LspServerConfig {
	command: string[];
	extensions: string[];
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
