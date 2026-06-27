## 1. Config 层 — Compaction 配置字段更新

- [x] 1.1 修改 `src/config.ts`：将 `CompactionConfig` 的 `threshold?: number` 替换为 `reserveTokens?: number` + `keepRecentTokens?: number`
- [x] 1.2 更新 `src/agent/session.ts` 的 `convertConfigToSettings`：将 `config.compaction` 的 `reserveTokens` / `keepRecentTokens` 传入 `settings.compaction` 对象

## 2. Session Events — Compaction 事件订阅 + 上下文用量刷新

- [x] 2.1 修改 `src/tui/hooks/useSessionEvents.ts`：新增 `compaction_start` case — 在消息列表追加 "Compacting context…" 助手消息
- [x] 2.2 修改 `src/tui/hooks/useSessionEvents.ts`：新增 `compaction_end` case — 根据事件字段渲染完成/中止/出错消息，同时调用 `session.getContextUsage()` 刷新
- [x] 2.3 修改 `src/tui/hooks/useSessionEvents.ts`：在 `agent_start` case 中追加 `session.getContextUsage()` 刷新调用
- [x] 2.4 修改 `src/tui/hooks/useSessionEvents.ts`：在 `tool_execution_end` case 中追加 `session.getContextUsage()` 刷新调用

## 3. App 层 — 热切换 contextUsage 初始化

- [x] 3.1 修改 `src/tui/App.tsx`：在 `setRebindSession` 回调的 `setSession` 后，调用 `newSession.getContextUsage()` 初始化 contextUsage state

## 4. 验证

- [x] 4.1 运行 `bun run check` 确保 typecheck + lint + test 全量通过
- [ ] 4.2 运行 `bun run dev` 手动验证：执行 `/compact` 确认消息列表显示压缩进度和结果
- [ ] 4.3 运行 `bun run dev` 手动验证：发起一次 prompt 后观察状态栏上下文用量在回合中持续更新
- [ ] 4.4 运行 `bun run dev` 手动验证：`/sessions` 切换到其他会话后状态栏立即显示上下文用量
