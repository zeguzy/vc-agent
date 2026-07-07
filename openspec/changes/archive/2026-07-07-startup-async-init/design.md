## Context

`initServices`（session.ts L206-260）是 session 创建前的服务初始化函数，当前三段串行 await：

```
L229-235: await skillManager.initialize()   → resourceLoader
L237-238: await lspClient.init()            → lspReady (boolean)
L247-248: await mcpManager.initialize()     → void
```

三者无数据依赖（各自的输入只来自 `opts`，不互相消费返回值），但顺序执行。`initServices` 返回 `InitializedServices`，后续 `factory()` 消费这些 services 创建 customTools。

UI 层：`App.tsx` L331-338 在 `useEffect` 里 `pollManager.register("git-dirty", () => getGitDirty(cwd), 3000)`。`PollManager.register` 内部 L48 `run()` **立即同步执行** `fetch()`，`getGitDirty` 用 `execSync("git status --porcelain")` 阻塞事件循环。`PollManager` 的 `fetch: () => T` 签名是同步的，不支持 async 回调。

`loadHistory` 在 `App.tsx` `useState(() => loadHistory())` 同步执行，读 `~/.config/openagent/history` 文件。

## Goals

- initServices 三段并行（耗时 A+B+C → max(A,B,C)）
- git-dirty 不阻塞事件循环（execSync → async spawn）
- loadHistory 不阻塞首帧（useState 空 → useEffect 异步加载）
- PollManager 向后兼容支持 async fetch

## Non-Goals

见 proposal.md Non-goals（不延迟 session、不缓存 skills、不改 Pi SDK/createCliRenderer、不加 spinner UI）。

## Decisions

### D1: initServices 并行化用 Promise.all（非 allSettled）

**决策**：三段改 `Promise.all([skillManager.initialize(), lspClient.init(), mcpManager.initialize()])`。

**Rationale**：
- `lspClient.init()` 返回 boolean + warn，不 throw（session.ts L239-245 容错）
- `mcpManager.initialize()` 内部已用 `Promise.allSettled` 容错（mcp-tool-cache 变更）
- `skillManager.initialize()` 可能 throw（文件读取错误）— 这是合理失败，应中断启动
- `Promise.all` 任一 throw 则整体 reject，符合"skill 加载失败 = 启动失败"语义
- `Promise.allSettled` 需要逐个检查结果，代码复杂度增加而收益不明显

**Alternatives**：
- `Promise.allSettled` + 逐个检查：过度防御，三者中只有 skillManager 会 throw 且 throw 是合理行为
- 保持串行但调整顺序（最快的先）：治标不治本，仍 A+B+C

### D2: PollManager 扩展 async fetch（向后兼容）

**决策**：`fetch: () => T | Promise<T>`，`run` 改 async：

```typescript
// poll/manager.ts
interface PollTask<T> {
    fetch: () => T | Promise<T>;  // ← 放宽签名
    // ...
}

const run = async () => {
    try {
        const value = await fetch();  // ← await 兼容同步和异步
        if (value !== task.lastValue) {
            task.lastValue = value;
            for (const fn of task.subscribers) fn(value);
        }
    } catch {
        // keep lastValue unchanged on error
    }
};
run();  // fire-and-forget（不 await，避免 setInterval 阻塞）
task.timer = setInterval(run, intervalMs);
```

**Rationale**：
- `await syncValue` 对同步返回值是 no-op，现有同步 fetch 不受影响
- `run()` 改 async 后 `run()` 调用不阻塞（返回 Promise，fire-and-forget）
- `setInterval(run, intervalMs)` 传入 async 函数，Node/Bun 会忽略返回的 Promise（run 内部 try/catch 兜底）
- **竞态**：如果一次 fetch 很慢（超过 intervalMs），下一次 run 可能在前一次完成前启动。对于 git-dirty（3s 间隔，execSync 通常 <2s）影响可忽略；可加 `task.running` 标志位防重入（D2.1）

**D2.1（防重入）**：PollTask 加 `running: boolean` 标志，run 开始时检查 `if (task.running) return; task.running = true;`，finally 里 `task.running = false`。

**Alternatives**：
- 不扩展 PollManager，git-dirty 单独异步任务（脱离 poll 机制）：割裂，且后续其他 poll 任务也可能需要 async
- 新建 `AsyncPollManager` 类：重复代码

### D3: getGitDirty 改 async（execSync → Bun.spawn）

**决策**：`getGitDirty` 改用 `Bun.spawn(["git", "status", "--porcelain"], { cwd, stdout: "pipe" })`，读取 stdout，返回 `Promise<string>`。

```typescript
// tui/utils/git.ts
export async function getGitDirty(cwd: string): Promise<string> {
    try {
        const proc = Bun.spawn(["git", "status", "--porcelain"], {
            cwd,
            stdout: "pipe",
            stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        if (exitCode !== 0) return "";
        return stdout.trim();
    } catch {
        return "";
    }
}
```

**Rationale**：
- `Bun.spawn` 不阻塞事件循环，其他 useEffect / 用户输入可并行
- `getGitBranch`（读 `.git/HEAD`）保持同步（<1ms，不需要异步化）
- 首次 poll 时 git-dirty 状态短暂空白（subscribers 未被通知），git-dirty 完成后通知 subscribers 更新 UI

**Alternatives**：
- `child_process.exec`（callback 风格）：不如 Bun.spawn 的 async/await 干净
- `execFileSync` 保持同步但放 setTimeout 延迟：仍阻塞

### D4: loadHistory 异步化（useState 空 + useEffect 加载）

**决策**：

```typescript
// App.tsx（当前）
const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

// 改为
const [history, setHistory] = useState<HistoryEntry[]>([]);
useEffect(() => {
    loadHistory().then(setHistory).catch(() => {});
}, []);
```

**Rationale**：
- `loadHistory` 读单个文件，通常 <100ms，但大历史文件可能更慢
- useState 初始空，首帧渲染立即可完成
- useEffect 异步加载，完成后 setState 触发重渲染
- **竞态**：用户在历史加载完前按上键 → 历史导航返回空（无操作）。可接受（<100ms 窗口）
- 如果 `loadHistory` 是同步函数（readFileSync），需要先改成 async，或用 `Promise.resolve(loadHistory()).then(setHistory)` 把同步调用推到微任务

**Alternatives**：
- 保持同步但限制读取行数：治标
- 用 React.lazy/Suspense：过度设计

## Risks

### R1: Promise.all 任一失败导致启动中断
**风险**：skillManager.initialize throw 时，lspClient/mcpManager 的并行 Promise 仍在跑，但 initServices 整体 reject。
**缓解**：skillManager throw 是合理失败（无 skills 上下文，agent 无法工作）。lspClient/mcpManager 的 Promise 会 unhandled rejection？不会 — Promise.all 在第一个 reject 后不取消其他 Promise，但它们的 reject 会被 Promise.all 的 catch 捕获（Promise.all 的 reject 只取第一个）。其他 Promise 的 resolve/reject 被忽略但不报 unhandled（因为它们被 Promise.all 引用了）。

### R2: PollManager async 竞态（慢 fetch + 快 interval）
**风险**：git-dirty fetch 耗时 >3s（大仓库），下一次 interval 触发时前一次未完成。
**缓解**：D2.1 `running` 标志位防重入。git-dirty 在大仓库通常 <2s，3s interval 足够。

### R3: loadHistory 竞态（用户在加载完前输入）
**风险**：用户启动后立即按上键调历史，历史还没加载。
**缓解**：loadHistory 通常 <100ms，窗口极短。历史导航返回空（无操作），不崩溃。加载完后自动可用。

### R4: Bun.spawn 不可用（非 Bun 运行时）
**风险**：项目指定 Bun 运行时，但如果未来换 Node.js，`Bun.spawn` 不存在。
**缓解**：项目 AGENTS.md 明确「运行时：Bun」，且 package.json scripts 用 `bun run`。可接受。如需兼容，用 `child_process.spawn` + `util.promisify`。
