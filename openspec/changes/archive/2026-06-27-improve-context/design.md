## Context

当前 openagent 的上下文管理依赖 Pi SDK，但集成层存在四个体验缺陷：

1. **Compaction 配置不完整**：`Config.compaction` 只有 `enabled` + `threshold`，后者从未接入 SDK（SDK 用 `reserveTokens`/`keepRecentTokens`），导致 compaction 行为完全依赖 SDK 默认值
2. **手动压缩无反馈**：`/compact` 触发 `session.compact()` 后，用户看不到开始/完成状态，也不知道释放了多少 token
3. **上下文用量更新保守**：仅在 `agent_end` 事件刷新一次，整个回合中状态栏数据冻结
4. **热切换空白期**：session 切换后 contextUsage 保持 null 直到第一个回合结束

## Goals / Non-Goals

**Goals:**
- 接通用 compaction 配置到 SDK 的 `reserveTokens` / `keepRecentTokens` 字段
- `/compact` 命令提供完整 UI 反馈（开始 → 进度 → 结果摘要）
- 上下文用量在 `agent_start` / `tool_execution_end` 事件时刷新
- session 热切换后立即初始化 contextUsage

**Non-Goals:**
- 不实现 compaction 设置项的 TUI 内可调（仍通过 config 文件）
- 不改变 compaction 的底层逻辑或决策策略
- 不实现实时 token 计数（SDK 只在特定时机更新估算值）

## Decisions

### D1: Config 字段映射

**选择**: 将 `CompactionConfig` 从 `{ enabled, threshold }` 改为 `{ enabled, reserveTokens, keepRecentTokens }`。

**理由**: Pi SDK 的 `CompactionSettings` 只有 `enabled` / `reserveTokens` / `keepRecentTokens` 三个字段。`threshold` 从定义起就从未生效（MVP 跳过），替换为 SDK 原生字段名可消除语义翻译层。

**替代方案**: 保留 `threshold` 并做百分比→token 转换。但 `threshold` 语义模糊（触发百分比 vs 预留百分比），且每个模型的 contextWindow 不同，百分比映射需额外查 model 信息，不如直接用 SDK 原语。

### D2: Compaction 事件渲染

**选择**: 在 `useSessionEvents` 中新增 `compaction_start` / `compaction_end` case，分别产生助手消息。

- `compaction_start`: 显示 "Compacting context…" 消息
- `compaction_end`: 显示 "Context compacted: N tokens → M tokens. Summary: …" 消息，同时刷新 contextUsage

**替代方案**: 用 StatusBar 专用通知区。但消息流方式更标准、用户可见性更高，且消息列表天然支持滚动回顾。

### D3: 上下文用量更新时机

**选择**: 在现有的 `agent_start` / `tool_execution_end` / `agent_end` 三个事件触发时都调用 `session.getContextUsage()` 刷新。

**理由**: `getContextUsage()` 是纯读取操作、无副作用，SDK 内部维护估算值，多调用几次不影响性能。`agent_start` 时刷新覆盖回合开始状态，`tool_execution_end` 覆盖工具执行后的增量变化。

**风险**: `getContextUsage()` 在 compaction 刚完成后返回 `{ tokens: null, percent: null }`。状态栏需优雅处理 null → 显示 `◌ ?` 或类似占位符。现有 StatusBar 已有 `contextPercent === null` 的分支（显示 `?`），直接复用。

### D4: 热切换后初始化

**选择**: 在 `setRebindSession` 回调中，`setSession(newSession)` 后立即调用 `newSession.getContextUsage()` 初始化状态。

**理由**: 一行代码改动，消除空白期。新 session 可能是恢复的历史会话，SDK 已重建上下文，此时调用 `getContextUsage()` 返回历史最后一轮的估算值。

### D5: reserveTokens / keepRecentTokens 默认值

**选择**: 不给 openagent 强制默认值，透传 SDK 的 `DEFAULT_COMPACTION_SETTINGS`（`reserveTokens: 4096`, `keepRecentTokens: 8192`）。只在用户显式配置时覆盖。

**理由**: 避免 openagent 与 Pi SDK 的默认值漂移。用户需要定制时通过 config.json 覆盖即可。

## Risks / Trade-offs

- **[R1] Config 字段重命名破坏兼容** → `threshold` 从未生效（MVP 跳过），无人依赖。直接替换无迁移成本。
- **[R2] compaction 事件可能不触发** → SDK 的 compaction 靠内部条件判断触发，手动 compaction 总是触发事件。仅订阅事件、不主动触发，风险在 SDK 侧。
- **[R3] 错误时 contextUsage 为 null** → 重用现有 StatusBar 的 `?` 占位符处理。

```
数据流 (compaction):

用户输入 /compact
        │
        ▼
session.compact(args) ──► Pi SDK 内部
        │                    │
        │              compaction_start 事件
        │                    │
        │              ◄──── useSessionEvents
        │                    │
        │              setMessages([..., "Compacting…"])
        │                    │
        │              compaction_end 事件
        │              { result: CompactionResult }
        │                    │
        │              ◄──── useSessionEvents
        │                    │
        │              setMessages([..., "Compacted: N→M tokens"])
        │              setContextUsage(…)
        │
        ▼
   返回 Promise<CompactionResult>
```

```
数据流 (运行时 contextUsage 更新):

agent_start  ──► getContextUsage() ──► setContextUsage(...)
tool_execution_end ──► getContextUsage() ──► setContextUsage(...)
agent_end    ──► getContextUsage() ──► setContextUsage(...)
                       │
                       ▼
                  StatusBar 重渲染
```
