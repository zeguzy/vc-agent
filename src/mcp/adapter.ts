import type { McpConfig, OpencodeServerDef } from "./config.js";

/** stdio transport 配置（local server） */
export interface StdioTransportConfig {
	type: "stdio";
	command: string;
	args: string[];
	env?: Record<string, string>;
	cwd?: string;
}

/** streamable-http transport 配置（remote server；连接失败由 manager fallback 到 sse） */
export interface HttpTransportConfig {
	type: "streamable-http";
	url: string;
	headers?: Record<string, string>;
}

export type McpTransportConfig = StdioTransportConfig | HttpTransportConfig;

/** openagent 内部 server 配置：adapter 输出，manager 消费 */
export interface McpServerConfig {
	name: string;
	transport: McpTransportConfig;
	enabled: boolean;
	autoReconnect: boolean;
}

/**
 * 把 opencode 格式配置翻译为内部 McpServerConfig[]：
 * - local → stdio（command 数组首元素拆 command + args；environment → env）
 * - remote → streamable-http（url/headers 直传）
 * - enabled 默认 true；autoReconnect 默认 true（opencode 无此字段，openagent 自定）
 * - timeout 不映射（请求超时语义 ≠ 连接超时）
 */
export function adaptToTransports(config: McpConfig): McpServerConfig[] {
	return Object.entries(config).map(([name, def]) => ({
		name,
		transport: adaptTransport(def),
		enabled: def.enabled ?? true,
		autoReconnect: true,
	}));
}

function adaptTransport(def: OpencodeServerDef): McpTransportConfig {
	if (def.type === "local") {
		const command = def.command ?? [];
		const stdio: StdioTransportConfig = {
			type: "stdio",
			command: command[0] ?? "",
			args: command.slice(1),
		};
		if (def.environment) stdio.env = def.environment;
		if (def.cwd) stdio.cwd = def.cwd;
		return stdio;
	}
	const http: HttpTransportConfig = {
		type: "streamable-http",
		url: def.url ?? "",
	};
	if (def.headers) http.headers = def.headers;
	return http;
}
