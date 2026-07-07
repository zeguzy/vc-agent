## Tasks

### 1. PollManager 扩展 async fetch 支持

- [x] 1.1 修改 `src/poll/manager.ts`：`PollTask.fetch` 类型从 `() => T` 改为 `() => T | Promise<T>`，`run` 改 async（`await fetch()`），调用方式 fire-and-forget（`run()` 不 await）
- [x] 1.2 PollTask 加 `running: boolean` 防重入标志：`run` 开始时 `if (task.running) return; task.running = true`，finally 里 `task.running = false`

### 2. getGitDirty 异步化

- [x] 2.1 修改 `src/tui/utils/git.ts` `getGitDirty`：`execSync("git status --porcelain")` 改 `Bun.spawn(["git","status","--porcelain"], {cwd, stdout:"pipe"})`，async 函数返回 `Promise<string>`
- [x] 2.2 保持 `getGitBranch` 同步（读 `.git/HEAD`，<1ms）

### 3. initServices 并行化

- [x] 3.1 修改 `src/agent/session.ts` `initServices`（L229-248）：三段串行 await 改 `Promise.all([skillManager.initialize(...), (async () => { const c = new LspClient(); await c.init(); return c; })(), mcpManager.initialize(opts.cwd)])`
- [x] 3.2 解构 Promise.all 结果，保持 `InitializedServices` 返回结构不变

### 4. loadHistory 异步化

- [x] 4.1 修改 `src/tui/App.tsx`：`useState(() => loadHistory())` 改 `useState<HistoryEntry[]>([])`
- [x] 4.2 新增 `useEffect(() => { loadHistory().then(setHistory).catch(() => {}) }, [])` 异步加载（若 loadHistory 是同步函数，用 `Promise.resolve(loadHistory()).then(setHistory)` 推到微任务）

### 5. 测试与验证

- [x] 5.1 为 PollManager async fetch 新增测试（`tests/poll-async.test.ts`）：注册 async fetch、验证 subscriber 收到值、验证防重入标志
- [x] 5.2 运行 `bun run check`（typecheck + lint + test）确认全绿
- [x] 5.3 手动启动 `bun run dev` 确认首帧渲染速度提升、git-dirty 状态异步更新、历史导航加载后可用
