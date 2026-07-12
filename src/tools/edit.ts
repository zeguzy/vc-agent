import { constants } from "node:fs";
import {
	access as fsAccess,
	readFile as fsReadFile,
	writeFile as fsWriteFile,
} from "node:fs/promises";
import {
	createEditToolDefinition,
	type EditOperations,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

/**
 * Creates the edit tool. Writes changes to disk directly.
 */
export function createEditTool(cwd: string): ToolDefinition {
	const operations: EditOperations = {
		readFile: (absolutePath) => fsReadFile(absolutePath),
		access: (absolutePath) => fsAccess(absolutePath, constants.R_OK | constants.W_OK),
		writeFile: (absolutePath, newContent) => fsWriteFile(absolutePath, newContent, "utf-8"),
	};

	const tool = createEditToolDefinition(cwd, { operations });
	tool.executionMode = "sequential";

	return tool as unknown as ToolDefinition;
}
