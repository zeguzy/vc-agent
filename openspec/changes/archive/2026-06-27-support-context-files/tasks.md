## 1. 基础设施

- [x] 1.1 `src/config.ts`: Config 接口新增 `instructions?: string[]` 字段
- [x] 1.2 `tests/config.test.ts`: 补充 instructions 字段的 deep merge 测试

## 2. 上下文文件加载核心

- [x] 2.1 新建 `src/context-files.ts`: 实现 `findUp(cwd, filenames)` 向上搜索函数
- [x] 2.2 实现 `resolveInstructions(config, cwd, home)` 解析 instructions 字段（相对路径、~/、glob、URL）
- [x] 2.3 实现 `loadSystemContext(cwd, config)` 组装完整 system prompt
- [x] 2.4 `tests/context-files.test.ts`: 测试 findUp、resolveInstructions、loadSystemContext

## 3. 集成

- [x] 3.1 `src/skills/manager.ts`: `initialize()` 中 systemPrompt 改为调用 `loadSystemContext(cwd, config)`
- [x] 3.2 `src/context-files.ts`: 实现 `resolve(filePath)` 目录层级动态注入方法
- [x] 3.3 验证: `bun run check` 全绿
