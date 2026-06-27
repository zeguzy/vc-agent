import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptToTransports } from "../../src/mcp/adapter.js";
import type { McpConfig } from "../../src/mcp/config.js";
import { McpManager } from "../../src/mcp/manager.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "echo-server.ts");

describe("McpManager e2e (stdio echo server)", () => {
	it("连接 stdio server，发现 echo tool，callTool 返回回声", async () => {
		const config: McpConfig = {
			echo: { type: "local", command: ["bun", fixturePath] },
		};
		const manager = new McpManager();
		await manager.initialize(adaptToTransports(config));
		try {
			const statuses = manager.getAllStatus();
			expect(statuses).toHaveLength(1);
			expect(statuses[0].name).toBe("echo");
			expect(statuses[0].status).toBe("connected");
			expect(statuses[0].toolCount).toBe(1);

			const tools = manager.listTools();
			expect(tools[0].server).toBe("echo");
			expect(tools[0].name).toBe("echo");

			const result = await manager.callTool("echo", "echo", { text: "hi" });
			expect(result).toEqual([{ type: "text", text: "echo: hi" }]);
		} finally {
			await manager.disconnectAll();
		}
	}, 15000);

	it("连接失败隔离：不存在的命令 → error 状态，不中断 manager", async () => {
		const config: McpConfig = {
			bad: { type: "local", command: ["/nonexistent/definitely-not-here"] },
		};
		const manager = new McpManager();
		await manager.initialize(adaptToTransports(config));
		try {
			const statuses = manager.getAllStatus();
			expect(statuses[0].status).toBe("error");
			expect(statuses[0].error).toBeTruthy();
		} finally {
			await manager.disconnectAll();
		}
	}, 15000);
});
