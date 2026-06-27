import { describe, expect, it, mock } from "bun:test";
import { PollManager } from "../src/poll/manager.js";

describe("PollManager", () => {
	it("registers and immediately calls fetch", () => {
		const manager = new PollManager();
		const fetch = mock(() => "value");
		manager.register("test", fetch, 1000);
		expect(fetch).toHaveBeenCalledTimes(1);
		manager.destroy();
	});

	it("notifies subscriber when value changes", () => {
		const manager = new PollManager();
		let calls = 0;
		let lastValue: string | undefined;
		const fn = (v: string) => {
			calls++;
			lastValue = v;
		};
		manager.subscribe("test", fn);
		manager.register("test", () => "new-value", 1000);
		expect(calls).toBe(1);
		expect(lastValue).toBe("new-value");
		manager.destroy();
	});

	it("does not notify when value is unchanged", () => {
		const manager = new PollManager();
		let calls = 0;
		manager.register("test", () => "same", 50);
		manager.subscribe("test", () => {
			calls++;
		});
		// subscribe immediately pushes current value (1 call), subsequent identical
		// polls should NOT trigger additional notifications
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(calls).toBe(1);
				manager.destroy();
				resolve();
			}, 150);
		});
	});

	it("handles fetch errors silently", () => {
		const manager = new PollManager();
		const errorCaught = false;
		manager.register(
			"test",
			() => {
				throw new Error("fail");
			},
			1000,
		);
		expect(errorCaught).toBe(false);
		manager.destroy();
	});

	it("unregister stops the timer", () => {
		const manager = new PollManager();
		const fetch = mock(() => "value");
		manager.register("test", fetch, 50);
		manager.unregister("test");
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				// fetch should only have been called once (the immediate call)
				expect(fetch).toHaveBeenCalledTimes(1);
				manager.destroy();
				resolve();
			}, 150);
		});
	});

	it("re-registering same key replaces old task", () => {
		const manager = new PollManager();
		const fetch1 = mock(() => "a");
		const fetch2 = mock(() => "b");
		manager.register("test", fetch1, 1000);
		manager.register("test", fetch2, 1000);
		expect(fetch1).toHaveBeenCalledTimes(1);
		expect(fetch2).toHaveBeenCalledTimes(1);
		manager.destroy();
	});

	it("subscribe returns unsubscribe function", () => {
		const manager = new PollManager();
		let calls = 0;
		const unsub = manager.subscribe("test", () => {
			calls++;
		});
		manager.register("test", () => "initial", 1000);
		expect(calls).toBe(1);
		unsub();
		manager.unregister("test");
		manager.register("test", () => "second", 1000);
		expect(calls).toBe(1); // still 1, unsubscribed
		manager.destroy();
	});

	it("destroy clears all tasks", () => {
		const manager = new PollManager();
		const fetch1 = mock(() => "a");
		const fetch2 = mock(() => "b");
		manager.register("a", fetch1, 50);
		manager.register("b", fetch2, 50);
		manager.destroy();
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				const countAfter = fetch1.mock.calls.length + fetch2.mock.calls.length;
				expect(countAfter).toBe(2); // only immediate calls
				resolve();
			}, 150);
		});
	});
});
