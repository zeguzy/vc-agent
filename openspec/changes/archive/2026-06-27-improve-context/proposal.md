## Why

当前 openagent 的上下文管理有四个粗糙点——compaction 阈值配置了但没接入、手动压缩没有 UI 反馈、上下文用量仅在 agent_end 更新、热切换会话后状态栏数据空白。这些导致用户对上下文状态感知不足，影响使用体验。

## What Changes

- **Compaction 阈值配置接入**：将 `config.compaction` 扩展为 Pi SDK 原生字段（`reserveTokens`、`keepRecentTokens`），替换从未生效的 `threshold` 字段
- **`/compact` 命令增加 UI 反馈**：订阅 SDK 的 `compaction_start` / `compaction_end` 事件，在消息列表显示压缩进度和结果（摘要内容、token 前后的变化）
- **上下文用量运行时更新**：在 `agent_start` 和 `tool_execution_end` 事件后也刷新 contextUsage，让状态栏在整个回合内持续更新
- **热切换后 contextUsage 立即初始化**：session 切换后立刻调用 `getContextUsage()`，消除状态栏空白期

## Capabilities

### New Capabilities

- `compaction-ui-feedback`: compaction 事件的 TUI 消息渲染和用量刷新

### Modified Capabilities

- `tui-layout`: 状态栏上下文用量指示器的更新时机扩展（agent_start / tool_execution_end 事件触发刷新）
- `tui-messages`: 新增 compaction_start / compaction_end 事件对应的消息渲染
- `agent-session`: 配置层接入 compaction 的 reserveTokens / keepRecentTokens 设置
- `settings`: compaction 设置项从单字段 toggle 扩展为包含 token 参数配置

## Impact

- `src/config.ts` — `CompactionConfig` 接口调整（`threshold` → `reserveTokens` + `keepRecentTokens`）
- `src/agent/session.ts` — `convertConfigToSettings` 扩展 compaction 设置传递
- `src/tui/hooks/useSessionEvents.ts` — 订阅 compaction 事件、扩展 contextUsage 刷新时机
- `src/tui/App.tsx` — `setRebindSession` 回调中初始化 contextUsage
- `src/settings/definitions.ts` — compaction 设置项可能需要扩展
- `src/settings/types.ts` — 如需新增设置编辑器类型

## Non-goals

- 不改动 Pi SDK 内部的 compaction 算法或触发策略
- 不实现 compaction 阈值在 TUI 内的实时可调（仍通过 config 文件配置）
- 不改变 `/context` 命令的现有行为（仅切换 compact/full 显示模式）
- 不实现自动 compaction 的自定义系统提示词
