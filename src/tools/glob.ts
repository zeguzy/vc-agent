import { createFindToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";

// Alias of find: LLMs trained on Claude Code expect a "glob" tool and hallucinate calls to it.
export function createGlobToolDefinition(cwd: string) {
	const findDef = createFindToolDefinition(cwd);
	return defineTool({ ...findDef, name: "glob", label: "glob" });
}
