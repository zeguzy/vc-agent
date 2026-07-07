import { expect, test } from "bun:test";
import { PollManager } from "../src/poll/manager";

test("PollManager supports async fetch", async () => {
	const pm = new PollManager();
	let resolveFetch: (value: string) => void = () => {};
	const fetch = () =>
		new Promise<string>((resolve) => {
			resolveFetch = resolve;
		});
	const received: string[] = [];

	pm.register("test-async", fetch, 10000);
	const unsub = pm.subscribe("test-async", (value) => {
		received.push(value);
	});

	expect(received).toEqual([]);

	resolveFetch("hello");
	await new Promise((r) => setTimeout(r, 10));

	expect(received).toEqual(["hello"]);
	unsub();
	pm.destroy();
});

test("PollManager reentry guard prevents concurrent fetch", async () => {
	const pm = new PollManager();
	let callCount = 0;
	let resolveFetch: () => void = () => {};

	const fetch = () => {
		callCount++;
		return new Promise<string>((resolve) => {
			resolveFetch = () => resolve("value");
		});
	};

	pm.register("test-reentry", fetch, 50);

	expect(callCount).toBe(1);

	await new Promise((r) => setTimeout(r, 100));

	expect(callCount).toBe(1);

	resolveFetch();
	await new Promise((r) => setTimeout(r, 10));

	await new Promise((r) => setTimeout(r, 100));
	expect(callCount).toBeGreaterThanOrEqual(2);

	pm.destroy();
});

test("PollManager sync fetch still works (backward compat)", () => {
	const pm = new PollManager();
	const received: number[] = [];

	pm.register("test-sync", () => 42, 10000);
	const unsub = pm.subscribe("test-sync", (value) => {
		received.push(value);
	});

	expect(received).toEqual([42]);
	unsub();
	pm.destroy();
});

test("PollManager async fetch error does not crash and recovers", async () => {
	const pm = new PollManager();
	const received: string[] = [];

	pm.subscribe("test-error", (value) => {
		received.push(value);
	});
	pm.register("test-error", () => Promise.reject(new Error("fail")), 10000);

	await new Promise((r) => setTimeout(r, 10));
	expect(received).toEqual([]);

	pm.register("test-error", () => Promise.resolve("ok"), 10000);
	pm.subscribe("test-error", (value) => {
		received.push(value);
	});

	await new Promise((r) => setTimeout(r, 10));
	expect(received).toEqual(["ok"]);
	pm.destroy();
});
