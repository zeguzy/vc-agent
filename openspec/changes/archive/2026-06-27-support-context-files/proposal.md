## Why

openagent 当前将 system prompt 硬编码在 `src/skills/manager.ts` 中，完全忽略 `AGENTS.md`、`CLAUDE.md` 等 opencode 生态的标准上下文文件。用户无法按项目、按目录定制 agent 行为，也无法复用已有的 opencode 项目配置。对标 opencode 的 instruction 加载机制，这是最大的功能缺口。

## What Changes

- 启动时自动发现并加载项目级 `AGENTS.md`（从 cwd 向上遍历，含全局 `~/.config/openagent/AGENTS.md`）
- 兼容 `CLAUDE.md` 作为 fallback（无 `AGENTS.md` 时使用）
- `config.json` 新增 `instructions` 字段，支持文件路径、glob、`~/` 展开和 HTTP(S) URL
- 按目录层级动态注入 `AGENTS.md`：读取文件时自动带上其父目录链上的 `AGENTS.md`
- 将上述内容合并到 Pi SDK 的 system prompt 中，替换当前硬编码

## Capabilities

### New Capabilities

- `context-files`: 上下文文件的发现、加载与注入——包括 AGENTS.md/CLAUDE.md 搜索、instructions 字段解析、目录层级动态注入

### Modified Capabilities

- `agent-session`: SkillManager 初始化时不再使用硬编码 system prompt，改为从 context-files 模块加载内容后构建 system prompt

## Impact

- `src/config.ts` — Config 接口新增 `instructions?: string[]` 字段
- `src/skills/manager.ts` — `initialize()` 的 systemPrompt 由硬编码改为调用 context-files 加载器组装
- 新增 `src/context-files.ts` — 纯函数模块：AGENTS.md 向上搜索、CLAUDE.md fallback、instructions 解析、目录层级遍历
- 对现有 CLI 参数、TUI 组件、session 持久化无影响

## Non-goals

- 不支持 `.cursorrules`、`.windsurfrules` 等其他 IDE 的规则文件格式
- 不支持 `opencode.json` 的直接读取（使用自有的 `config.json`）
- 不做 context compaction 或 token 预算管理（由 Pi SDK 处理）
- 不引入新的 CLI flag 或 TUI 设置项（MVP 仅通过文件配置）
