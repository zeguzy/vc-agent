## Why

当前 InputBox 的 git 分支名在 JSX 渲染时一次性同步读取 `.git/HEAD`，组件不重新渲染就不会更新。外部 `git checkout` 后 UI 保持旧分支名直到下一次渲染触发。需要一个通用的定时轮询机制来解决这类"外部状态不同步"问题，git 分支是第一个用例。

## What Changes

- **新增 `PollManager` 类**：管理命名轮询任务（fetch 函数 + 间隔），App 层创建单例，通过 props 传递
- **新增 `usePollState` hook**：组件订阅 PollManager 的某个 key，值变化时自动 re-render
- **InputBox 接入**：git 分支名改为通过 PollManager 轮询（每 3 秒），替换现有的同步读取

## Capabilities

### New Capabilities

- `poll-manager`: 通用轮询管理器，支持注册/取消/暂停命名轮询任务，组件通过 hook 订阅最新值

### Modified Capabilities

- `tui-layout`: InputBox 状态行的 git 分支名获取方式从同步读取改为 PollManager 轮询

## Impact

- `src/poll/manager.ts` — 新增 PollManager 类
- `src/poll/usePollState.ts` — 新增 usePollState hook
- `src/tui/App.tsx` — 创建 PollManager 实例，传给 InputBox
- `src/tui/components/InputBox.tsx` — 用 usePollState 替换 getGitBranch 同步读取

## Non-goals

- 不实现轮询间隔的动态调整
- 不实现轮询失败重试策略（本轮失败下轮继续）
- 不实现跨组件轮询结果缓存共享策略（每次 fetch 独立执行）
- 不把 PollManager 做成全局单例（保持 App 层注入，可测试）
