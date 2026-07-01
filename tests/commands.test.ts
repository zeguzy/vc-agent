import { describe, expect, it } from "bun:test";
import { CommandRegistry } from "../src/commands/registry.js";

describe("CommandRegistry", () => {
	it("starts empty", () => {
		const registry = new CommandRegistry();
		expect(registry.size).toBe(0);
		expect(registry.getAll()).toEqual([]);
	});

	it("registers and retrieves a command", () => {
		const registry = new CommandRegistry();
		const handler = () => {};

		registry.register({
			name: "test",
			description: "A test command",
			usage: "/test",
			handler,
		});

		expect(registry.size).toBe(1);
		const cmd = registry.get("test");
		expect(cmd).toBeDefined();
		expect(cmd?.name).toBe("test");
		expect(cmd?.description).toBe("A test command");
		expect(cmd?.handler).toBe(handler);
	});

	it("throws on duplicate registration", () => {
		const registry = new CommandRegistry();
		registry.register({ name: "dup", description: "first", handler: () => {} });
		expect(() => {
			registry.register({ name: "dup", description: "second", handler: () => {} });
		}).toThrow("Command already registered: /dup");
	});

	it("registerOrReplace overwrites existing", () => {
		const registry = new CommandRegistry();
		const h1 = () => {};
		const h2 = () => {};
		registry.register({ name: "x", description: "first", handler: h1 });
		registry.registerOrReplace({ name: "x", description: "second", handler: h2 });
		expect(registry.size).toBe(1);
		expect(registry.get("x")?.handler).toBe(h2);
	});

	it("returns undefined for unregistered command", () => {
		const registry = new CommandRegistry();
		expect(registry.get("nonexistent")).toBeUndefined();
	});

	it("getAll returns commands sorted by name", () => {
		const registry = new CommandRegistry();
		registry.register({ name: "z", description: "last", handler: () => {} });
		registry.register({ name: "a", description: "first", handler: () => {} });
		registry.register({ name: "m", description: "middle", handler: () => {} });

		const all = registry.getAll();
		expect(all.map((c) => c.name)).toEqual(["a", "m", "z"]);
	});

	it("match returns commands with matching prefix", () => {
		const registry = new CommandRegistry();
		registry.register({ name: "clear", description: "", handler: () => {} });
		registry.register({ name: "compact", description: "", handler: () => {} });
		registry.register({ name: "context", description: "", handler: () => {} });
		registry.register({ name: "model", description: "", handler: () => {} });

		expect(registry.match("c").map((c) => c.name)).toEqual(["clear", "compact", "context"]);
		expect(registry.match("co").map((c) => c.name)).toEqual(["compact", "context"]);
		expect(registry.match("com").map((c) => c.name)).toEqual(["compact"]);
		expect(registry.match("x")).toEqual([]);
	});

	it("match with empty input returns all commands", () => {
		const registry = new CommandRegistry();
		registry.register({ name: "a", description: "", handler: () => {} });
		registry.register({ name: "b", description: "", handler: () => {} });
		expect(registry.match("")).toEqual(registry.getAll());
	});

	it("match strips leading slash", () => {
		const registry = new CommandRegistry();
		registry.register({ name: "help", description: "", handler: () => {} });
		expect(registry.match("/help")).toEqual(registry.match("help"));
	});

	it("execute returns true and calls handler for registered command", async () => {
		const registry = new CommandRegistry();
		let called = false;

		registry.register({
			name: "greet",
			description: "",
			handler: (args, _ctx) => {
				called = true;
				expect(args).toBe("world");
			},
		});

		const ctx = {
			client: {} as any,
			messages: [],
			setMessages: (() => {}) as any,
			setIsRunning: (() => {}) as any,
			setContextUsage: (() => {}) as any,
			setThinkingCollapsed: (() => {}) as any,
			setContextDisplay: (() => {}) as any,
		};

		const result = await registry.execute("greet", "world", ctx);
		expect(result).toBe(true);
		expect(called).toBe(true);
	});

	it("execute returns false for unknown command", async () => {
		const registry = new CommandRegistry();
		const ctx = {
			client: {} as any,
			messages: [],
			setMessages: (() => {}) as any,
			setIsRunning: (() => {}) as any,
			setContextUsage: (() => {}) as any,
			setThinkingCollapsed: (() => {}) as any,
			setContextDisplay: (() => {}) as any,
		};
		const result = await registry.execute("nope", "", ctx);
		expect(result).toBe(false);
	});

	it("unregister removes a command", () => {
		const registry = new CommandRegistry();
		registry.register({ name: "temp", description: "", handler: () => {} });
		expect(registry.size).toBe(1);
		expect(registry.unregister("temp")).toBe(true);
		expect(registry.size).toBe(0);
		expect(registry.unregister("temp")).toBe(false);
	});
});
