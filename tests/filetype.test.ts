import { expect, test } from "bun:test";
import { pathToFiletype } from "../src/tui/utils/filetype";

test("已知扩展名映射", () => {
	expect(pathToFiletype("foo.ts")).toBe("typescript");
	expect(pathToFiletype("foo.tsx")).toBe("typescript");
	expect(pathToFiletype("foo.mts")).toBe("typescript");
	expect(pathToFiletype("foo.js")).toBe("javascript");
	expect(pathToFiletype("foo.mjs")).toBe("javascript");
	expect(pathToFiletype("foo.py")).toBe("python");
	expect(pathToFiletype("foo.go")).toBe("go");
	expect(pathToFiletype("foo.rs")).toBe("rust");
	expect(pathToFiletype("foo.java")).toBe("java");
	expect(pathToFiletype("foo.md")).toBe("markdown");
	expect(pathToFiletype("foo.json")).toBe("json");
	expect(pathToFiletype("foo.sh")).toBe("bash");
	expect(pathToFiletype("foo.cpp")).toBe("cpp");
	expect(pathToFiletype("foo.yml")).toBe("yaml");
});

test("未知扩展名返回 undefined", () => {
	expect(pathToFiletype("foo.xyz")).toBeUndefined();
	expect(pathToFiletype("foo.unknownext")).toBeUndefined();
});

test("无扩展名返回 undefined", () => {
	expect(pathToFiletype("README")).toBeUndefined();
	expect(pathToFiletype("Makefile")).toBeUndefined();
});

test("大小写不敏感", () => {
	expect(pathToFiletype("Foo.TS")).toBe("typescript");
	expect(pathToFiletype("Foo.Tsx")).toBe("typescript");
	expect(pathToFiletype("PATH/TO/FILE.PY")).toBe("python");
});

test("Dockerfile 特判", () => {
	expect(pathToFiletype("Dockerfile")).toBe("dockerfile");
	expect(pathToFiletype("dockerfile")).toBe("dockerfile");
	expect(pathToFiletype("DOCKERFILE")).toBe("dockerfile");
	expect(pathToFiletype("apps/web/Dockerfile")).toBe("dockerfile");
	expect(pathToFiletype("apps/web/dockerfile")).toBe("dockerfile");
});

test("带路径分隔符", () => {
	expect(pathToFiletype("src/components/Button.tsx")).toBe("typescript");
	expect(pathToFiletype("C:\\dev\\foo.py")).toBe("python");
	expect(pathToFiletype("./relative/path.go")).toBe("go");
});
