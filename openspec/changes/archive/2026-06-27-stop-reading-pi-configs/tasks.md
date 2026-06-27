## 1. 核心修改

- [x] 1.1 `src/agent/session.ts:25`：`AuthStorage.create()` 替换为 `AuthStorage.inMemory()`
- [x] 1.2 `src/agent/session.ts:26`：`ModelRegistry.create(authStorage)` 替换为 `ModelRegistry.inMemory(authStorage)`

## 2. 验证

- [x] 2.1 运行 `bun run check`（typecheck + lint + test）全部通过
- [x] 2.2 手动启动验证：`bun run dev` 能正常创建会话，不报 `~/.pi/agent/` 相关错误
