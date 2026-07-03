/**
 * 扩展名 → tree-sitter 语言名映射。
 *
 * 供 `<diff filetype>` / `<code filetype>` 使用，驱动语法高亮。
 * 未知扩展名返回 undefined，调用方不传 filetype，组件退化为纯文本。
 */
const EXT_TO_FILETYPE: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	mts: "typescript",
	cts: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	pyb: "python",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	rb: "ruby",
	pp: "ruby",
	md: "markdown",
	markdown: "markdown",
	json: "json",
	jsonc: "json",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	cs: "c_sharp",
	swift: "swift",
	dart: "dart",
	lua: "lua",
	php: "php",
	sql: "sql",
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	xml: "xml",
	dockerfile: "dockerfile",
};

/**
 * 从文件路径推断 tree-sitter 语言名。
 *
 * 大小写不敏感；无扩展名或未知扩展名返回 undefined。
 */
export function pathToFiletype(path: string): string | undefined {
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const basename = slash >= 0 ? path.slice(slash + 1) : path;
	if (basename.toLowerCase() === "dockerfile") return "dockerfile";
	const dot = basename.lastIndexOf(".");
	if (dot < 0) return undefined;
	const ext = basename.slice(dot + 1).toLowerCase();
	return EXT_TO_FILETYPE[ext];
}
