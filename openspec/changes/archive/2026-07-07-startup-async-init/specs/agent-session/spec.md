## ADDED Requirements

### Requirement: 启动初始化并行与 UI 异步化

系统 SHALL 在启动期最大化并行化服务初始化，并将阻塞事件循环的 UI 层操作改为异步，以降低首帧可感知延迟。

#### Scenario: initServices 三服务并行初始化

- **WHEN** `initServices(opts)` 被调用（createRuntime 或 createSession 路径）
- **THEN** SkillManager.initialize、LspClient.init、McpManager.initialize SHALL 通过 `Promise.all` 并行执行
- **AND** 三者的输入仅来自 `opts`（cwd/config/settingsManager/appendSystemPrompt），无互相依赖
- **AND** 总耗时 SHALL 约等于三者中耗时最长者（max(A,B,C)），而非三者之和
- **AND** 若任一 throw（如 SkillManager 文件读取失败），整体 SHALL reject 并中断启动（合理失败语义）

#### Scenario: PollManager 支持异步 fetch

- **WHEN** `PollManager.register(key, fetch, intervalMs)` 的 `fetch` 返回 `Promise<T>`
- **THEN** `run()` SHALL `await fetch()`，兼容同步和异步返回值
- **AND** 同步 fetch（返回 T）SHALL 仍正常工作（`await syncValue` 为 no-op）
- **AND** `run()` SHALL fire-and-forget 调用（不阻塞 setInterval 调度）
- **AND** PollTask SHALL 持有 `running: boolean` 标志，防止慢 fetch 期间重入

#### Scenario: git-dirty 异步获取不阻塞事件循环

- **WHEN** App.tsx `useEffect` 注册 `pollManager.register("git-dirty", () => getGitDirty(cwd), 3000)`
- **THEN** `getGitDirty` SHALL 使用 `Bun.spawn`（非阻塞）替代 `execSync`（阻塞）
- **AND** 首次 `run()` SHALL 立即返回（不等待 git 进程），事件循环保持响应
- **AND** git 进程完成后 SHALL 通过 subscriber 回调更新状态栏
- **AND** `getGitBranch`（读 `.git/HEAD`）SHALL 保持同步（<1ms，无需异步化）

#### Scenario: loadHistory 异步加载不阻塞首帧

- **WHEN** App 组件首次渲染
- **THEN** `history` state SHALL 初始为空数组（`useState<HistoryEntry[]>([])`）
- **AND** `loadHistory` SHALL 在 `useEffect` 中异步执行，完成后 `setHistory` 触发重渲染
- **AND** 首帧渲染 SHALL 不等待历史文件读取
- **AND** 历史加载完成前用户按上键调历史 SHALL 无操作（不崩溃），加载完后自动可用
