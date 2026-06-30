# openagent

终端编码助手。完整项目上下文见 `openspec/config.yaml`。

## 技术栈

- 运行时：Bun
- TUI：@opentui/react + @opentui/core（Zig 引擎，内置 ScrollBox/Input/Code 组件）
- Agent：@earendil-works/pi-coding-agent（Agent 循环 + 工具系统 + LLM Provider）
- MCP：@modelcontextprotocol/sdk

## 源码结构

```
src/
├── agent/       Pi SDK 集成（createAgentSession → 事件订阅 → prompt）
├── commands/    自定义命令系统（接口见 registry.ts）
├── lsp/         LSP 集成
├── session/     会话管理（含持久化）
├── skills/      Skill 系统
├── tools/       工具实现
├── tui/         TUI 渲染（React 状态驱动）
├── poll/        轮询
└── utils/
```

## 命令

| 命令 | 作用 |
|---|---|
| `bun run dev` | 启动 TUI |
| `bun run check` | typecheck + lint + test（提交前必过） |
| `bun run test` | bun test |

## 代码风格

见 `biome.json`。核心约定：tab 缩进、双引号、分号、行宽 100。
新代码不要再引入 `any`（含 noExplicitAny 等已降级为 warn 的技术债）。

## 约定

- **包管理器**：Bun，`bun.lock` 是唯一 lockfile；`package-lock.json` 已 gitignore，勿提交
- **测试**：`bun test`，纯函数测试放 `tests/*.test.ts`
- **提交钩子**：lefthook 自动 biome 修复 + typecheck（见 `lefthook.yml`），勿用 `--no-verify` 绕过
- **规格变更**：走 OpenSpec 流程（`openspec/specs/`），用 `/openspec-*` 命令驱动
