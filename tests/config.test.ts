import { describe, expect, it } from "bun:test";
import { deepMerge, defaultConfig } from "../src/config.js";

describe("deepMerge", () => {
	it("recursively merges nested plain objects", () => {
		const global = { a: 1, nested: { x: 1, y: 2 } };
		const project = { nested: { y: 3, z: 4 } };
		expect(deepMerge(global, project)).toEqual({
			a: 1,
			nested: { x: 1, y: 3, z: 4 },
		});
	});

	it("overrides primitives with project values", () => {
		expect(deepMerge({ a: 1, b: 2 }, { b: 99 })).toEqual({ a: 1, b: 99 });
	});

	it("ignores undefined project keys", () => {
		const merged = deepMerge({ a: 1, b: 2 }, { b: undefined });
		// pVal undefined → 保留 global 值
		expect(merged).toEqual({ a: 1, b: 2 });
	});

	it("returns project value as-is when global is not an object", () => {
		expect(deepMerge(null as any, { a: 1 } as any)).toEqual({ a: 1 });
	});

	it("returns global as-is when project is not an object", () => {
		expect(deepMerge({ a: 1 }, null as any)).toEqual({ a: 1 });
	});

	it("replaces arrays positionally (locks current behaviour)", () => {
		// global 数组被浅拷贝，project 的索引覆盖对应位置
		const merged = deepMerge([1, 2, 3] as any, [9] as any);
		expect(merged).toEqual([9, 2, 3]);
	});
});

describe("defaultConfig", () => {
	it("is an empty object by default", () => {
		expect(defaultConfig).toEqual({});
	});
});
