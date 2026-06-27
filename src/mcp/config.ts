import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deepMerge } from "../config.js";

/** opencode 格式的 MCP server 定义（mcp.json 中每个 server 的值） */
export interface OpencodeServerDef {
	type: "local" | "remote";
	/** local: 命令数组（首元素为可执行文件，其余为参数） */
	command?: string[];
	/** local: 环境变量 */
	environment?: Record<string, string>;
	/** local: 子进程工作目录 */
	cwd?: string;
	/** remote: server URL */
	url?: string;
	/** remote: 自定义请求头（可注入鉴权 token） */
	headers?: Record<string, string>;
	/** 是否启用，默认 true */
	enabled?: boolean;
	/** 请求超时 ms（语义为单次请求，不映射为连接超时） */
	timeout?: number;
}

/** mcp.json 顶层结构：server 名 → 定义 */
export type McpConfig = Record<string, OpencodeServerDef>;

function readJsonFile(filePath: string): Record<string, unknown> | null {
	if (!existsSync(filePath)) return null;
	try {
		return JSON.parse(readFileSync(filePath, "utf-8"));
	} catch (err) {
		console.error(
			`Warning: Failed to parse mcp config at ${filePath}:`,
			err instanceof Error ? err.message : String(err),
		);
		return null;
	}
}

/**
 * 加载 MCP 配置：全局 ~/.config/openagent/mcp.json 与项目 .openagent/mcp.json
 * 通过 deepMerge 合并（项目覆盖全局）。两文件均无则返回空配置，不报错、不阻塞会话。
 *
 * @param cwd 项目根目录
 * @param globalPath 全局配置路径（可选，测试注入；默认 ~/.config/openagent/mcp.json）
 */
export function loadMcpConfig(
	cwd: string,
	globalPath: string = join(homedir(), ".config", "openagent", "mcp.json"),
): McpConfig {
	const projectPath = join(cwd, ".openagent", "mcp.json");
	const globalRaw = readJsonFile(globalPath);
	const projectRaw = readJsonFile(projectPath);

	if (!globalRaw && !projectRaw) return {};
	if (!globalRaw) return projectRaw as McpConfig;
	if (!projectRaw) return globalRaw as McpConfig;

	return deepMerge(globalRaw as McpConfig, projectRaw as McpConfig);
}
