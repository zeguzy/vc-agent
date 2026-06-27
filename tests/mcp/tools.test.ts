import { describe, expect, it, mock } from "bun:test";
import type { McpManager, McpToolInfo } from "../../src/mcp/manager.js";
import { bridgeToToolDefs } from "../../src/mcp/tools.js";

function makeManager(
	tools: McpToolInfo[],
	callTool: (server: string, name: string, args: unknown) => Promise<unknown>,
): McpManager {
	return { listTools: () => tools, callTool } as unknown as McpManager;
}

describe("bridgeToToolDefs", () => {
	it("命名 mcp_<server>_<tool>", () => {
		const m = makeManager(
			[{ server: "github", name: "create_issue", inputSchema: { type: "object", properties: {} } }],
			async () => [],
		);
		expect(bridgeToToolDefs(m).map((d) => d.name)).toEqual(["mcp_github_create_issue"]);
	});

	it("inputSchema 透传为 parameters（Type.Unsafe 保留原 schema）", () => {
		const schema = {
			type: "object",
			properties: { title: { type: "string" } },
			required: ["title"],
		};
		const m = makeManager([{ server: "s", name: "t", inputSchema: schema }], async () => []);
		const def = bridgeToToolDefs(m)[0];
		expect(def.parameters).toMatchObject({
			type: "object",
			properties: { title: { type: "string" } },
		});
	});

	it("execute 转发到 manager.callTool 并返回 text content", async () => {
		const callMock = mock(async (_s: string, _n: string, args: unknown) => [
			{ type: "text", text: `got ${JSON.stringify(args)}` },
		]);
		const m = makeManager([{ server: "s", name: "t", inputSchema: { type: "object" } }], callMock);
		const def = bridgeToToolDefs(m)[0];
		const result = await def.execute("id", { x: 1 }, undefined, undefined, undefined as never);
		expect(callMock).toHaveBeenCalledTimes(1);
		expect(callMock.mock.calls[0][0]).toBe("s");
		expect(callMock.mock.calls[0][1]).toBe("t");
		expect(result.content).toEqual([{ type: "text", text: 'got {"x":1}' }]);
	});

	it("无 description 时 fallback 到 server/name", () => {
		const m = makeManager(
			[{ server: "s", name: "t", inputSchema: { type: "object" } }],
			async () => [],
		);
		expect(bridgeToToolDefs(m)[0].description).toBe("s/t");
	});

	it("image/resource block 降级为文本描述", async () => {
		const m = makeManager(
			[{ server: "s", name: "t", inputSchema: { type: "object" } }],
			async () => [
				{ type: "image", data: "base64...", mimeType: "image/png" },
				{ type: "resource", uri: "file:///x" },
			],
		);
		const def = bridgeToToolDefs(m)[0];
		const result = await def.execute("id", {}, undefined, undefined, undefined as never);
		expect(result.content[0].text).toBe("[image: image/png]");
		expect(result.content[1].text).toContain("resource");
	});
});
