## 1. handleWait 重写（核心修复）

- [x] 1.1 重写 `src/tools/team.ts` 的 `handleWait` 函数：签名改为 `async function handleWait(args: { duration?: number }, signal: AbortSignal | undefined)`，内部 `await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, seconds * 1000); if (signal) { signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new Error("Aborted")); }, { once: true }); } })`，返回 `ok(\`Waited ${seconds}s. Checking team status now.\`)`。参照 `src/tools/question.ts:59-78` 的范式
- [x] 1.2 修改 execute 的路由：`case "wait":` 从 `return handleWait(opts.teamRef, args);` 改为 `return await handleWait(args, _signal);`。注意 execute 函数内 `_signal` 参数需取消下划线前缀改名或直接使用（当前签名为 `async execute(_toolCallId, params, _signal, _onUpdate, _ctx)`，改为使用第三个参数 signal）

## 2. 移除 wakeUp 机制

- [x] 2.1 在 `src/teams/types-v2.ts` 的 `TeamManagerRef` 接口移除 `wakeUp?: (msg: string) => void` 字段，简化为 `{ current: TeamManagerLike | null }`
- [x] 2.2 在 `src/server/index.ts` 移除 L81-87 的 `opts.teamRef.wakeUp = (msg: string) => { ... }` 整个赋值块（含 `if (opts.teamRef)` 守卫内只剩 `opts.teamRef.current = this.teamManager;` 一行，保留该行）

## 3. 工具 description 更新

- [x] 3.1 在 `src/tools/team.ts` 的 `createTeamTool` description 字符串中，将 wait 动作的说明（约 L177）从 `"- wait: Pause for N seconds (default 30, max 300), then wake up to check team status. Use this instead of repeatedly calling read while members work."` 改为 `"- wait: Block for N seconds (default 30, max 300), then resume to check team status. Use this instead of repeatedly calling read while members work. The agent loop is suspended during the wait."`

## 4. 测试

- [x] 4.1 新增 `tests/team-wait-tool.test.ts`：测试 `handleWait` 阻塞行为——构造 createTeamTool，调用 execute 传 `{ action: "wait", duration: 5 }`（用最小合法值 5s 加速），计时确认 execute 在 ~5s 后才 resolve（允许 ±500ms 误差），且返回内容含 "Waited 5s"
- [x] 4.2 在 `tests/team-wait-tool.test.ts` 新增 signal abort 测试：构造 `new AbortController()`，调用 execute 后立即 `controller.abort()`，确认 execute 在 < 100ms 内 reject 或返回 error result（被 execute 的 try/catch 捕获），且不等待 5s（验证 clearTimeout 生效）
- [x] 4.3 在 `tests/team-wait-tool.test.ts` 新增 duration clamp 测试：传 `duration: 1`（低于 min 5）确认实际等待 ~5s；传 `duration: 999`（高于 max 300）确认实际等待 ~300s 或在测试中改用 mock 验证 clamp 逻辑（`Math.max(5, Math.min(300, args.duration ?? 30))` 的边界值：传入 1→5, 999→300, undefined→30）
- [x] 4.4 在 `tests/team-wait-tool.test.ts` 新增同轮多工具串行测试（Oracle 评审补充）：验证 wait 阻塞期间同一 execute 批次内后续工具的执行时序——由于 pi-coding-agent 的 executeToolCalls（含 parallel 模式）实测为顺序 await，wait 的阻塞会延迟同批次后续工具。测试应确认这一既有串行行为（非本次引入），防止未来执行模型变更时回归被误归因到 wait 改动

## 5. 全量验证

- [x] 5.1 运行 `bun run check`（typecheck + lint + test），修复任何由本次改动引入的回归（不修复无关的预存在问题）。确认 biome 格式符合（tab/双引号/分号/行宽 100）；确认 `TeamManagerRef` 无 wakeUp 字段残留；确认 `server/index.ts` 无 wakeUp 赋值残留
