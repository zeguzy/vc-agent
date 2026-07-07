## Why

启动慢。`initServices`（`src/agent/session.ts` L229-248）三段串行 await（SkillManager.initialize → LspClient.init → McpManager.initialize），三者无数据依赖却顺序执行，耗时 = A + B + C。UI 层首帧渲染后 `getGitDirty` 在 `pollManager.register` 的首次 `run()` 里同步 `execSync("git status --porcelain")`（大仓库 0.5-2s），阻塞事件循环；`loadHistory` 在 `useState` 初始化时同步读文件。

在大型项目 + 多 skills + 多 MCP server 配置下，这些串行点累计拖慢启动可感知速度。

## What Changes

### Capabilities

- **Modified: agent-session** — `initServices` 并行化：Skill/LSP/MCP 三段串行 await 改 `Promise.all`，耗时从 A+B+C 降到 max(A,B,C)
- **Modified: agent-session**（新增 Requirement）— 启动期 UI 层异步化：PollManager 扩展 async fetch 支持，`getGitDirty` 从 execSync 改 async spawn，`loadHistory` 从 useState 同步改 useEffect 异步加载

### Impact

- 启动时间显著降低（三段串行→并行 + UI 层不阻塞事件循环）
- PollManager API 向后兼容（同步 fetch 仍工作，新增 async fetch 支持）
- 首帧渲染后 git-dirty 状态短暂空白，异步加载后更新（<1s）
- 历史输入首帧不可用（按上键无历史），异步加载后可用（<100ms，通常不可感知）

## Non-goals

- **不延迟 session 创建** — session 仍需 resourceLoader + customTools 就绪才创建；启动期跳过 Skill/LSP/MCP（"第三层"）风险太高，留给后续
- **不缓存 skills 内容** — skills 加载结果不做磁盘缓存（类似 MCP 缓存），本次只并行化
- **不改 Pi SDK 内部** — `createAgentSessionRuntime` 的接口不动
- **不改 createCliRenderer** — Zig 引擎初始化不可控
- **不改 config 读取** — readConfig 已是同步快路径
- **不改 LSP 子进程派生方式** — `lspClient.init` 仍派生 tsserver，只并行化不延迟
- **不加 loading spinner UI** — 异步加载期间用现有占位（空数组/默认值），不新增 UI 组件
- **不优化 discoverCommands** — 经查不在启动期调用（App.tsx 只有 `registerBuiltinCommands` 在 useEffect），非瓶颈
