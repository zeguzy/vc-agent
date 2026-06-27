## 1. PollManager 核心实现

- [x] 1.1 创建 `src/poll/manager.ts`：实现 `PollManager` 类（`register`、`unregister`、`subscribe`、`destroy`）
- [x] 1.2 创建 `tests/poll.test.ts`：PollManager 纯逻辑测试（注册/取消/值变更通知/异常处理/销毁）

## 2. usePollState Hook

- [x] 2.1 创建 `src/poll/usePollState.ts`：实现 `usePollState<T>(key, manager)` hook（订阅 + 值管理 + cleanup）

## 3. InputBox 接入

- [x] 3.1 修改 `src/tui/App.tsx`：创建 PollManager ref，注册 "git-branch" 轮询任务，通过 props 传递
- [x] 3.2 修改 `src/tui/components/InputBox.tsx`：用 `usePollState("git-branch", pollManager)` 替换 `getGitBranch(cwd)` 同步读取

## 4. 验证

- [x] 4.1 运行 `bun run check` 确保 typecheck + lint + test 全量通过（181 pass, 0 fail）
- [ ] 4.2 运行 `bun run dev` 手动验证：外部 `git checkout` 后 3 秒内状态行分支名自动更新
