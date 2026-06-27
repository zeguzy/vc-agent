## Why

openagent 当前在创建 Agent 会话时，通过 `AuthStorage.create()` 和 `ModelRegistry.create(authStorage)` 隐式读取 Pi SDK 的全局默认配置（`~/.pi/agent/auth.json`、`~/.pi/agent/models.json`）。openagent 应完全独立于 Pi 的配置体系，所有配置仅从 openagent 自身的 `config.json` 管理。

## What Changes

- **BREAKING**: `AuthStorage.create()` 改为 `AuthStorage.inMemory()`，不再读取 `~/.pi/agent/auth.json`。Pi 原生 `/login` 的 OAuth 订阅凭据将不再生效；openagent 自己的 `config.providers[name].apiKey` 和环境变量（如 `ANTHROPIC_API_KEY`）照常工作。
- `ModelRegistry.create(authStorage)` 改为 `ModelRegistry.inMemory(authStorage)`，不再读取 `~/.pi/agent/models.json`。自定义 provider/model 仍通过 `registerCustomProvider` 从 openagent 的 `config.providers` 注入。

## Capabilities

### New Capabilities

（无新增能力）

### Modified Capabilities

- `agent-session`: Session 创建流程不再依赖 Pi 全局磁盘配置；凭据只来自 openagent 自身 config 或环境变量。
- `cli-entry`: 帮助文本中建议补充说明，提醒用户凭据配置方式（如有需要后续单独变更处理）。

## Impact

- 受影响文件：`src/agent/session.ts`（仅两行替换）
- 不影响：`src/config.ts`、`src/skills/manager.ts`、`src/tui/`、`src/settings/` — 均已使用 openagent 自有路径或 inMemory 模式
- 凭据迁移：已有 `ANTHROPIC_API_KEY` 等环境变量的用户无影响；之前依赖 Pi `/login` OAuth 的用户需改为设置环境变量或在 openagent config.json 中配置 `providers[name].apiKey`

## Non-goals

- 不删除 openagent 自身对 `config.providers` 的支持
- 不修改 openagent 自身的 config.json 格式
- 不引入新的凭据管理机制
- 不移除 Pi SDK 依赖本身（仍然用它提供的 Agent 循环、工具系统）
