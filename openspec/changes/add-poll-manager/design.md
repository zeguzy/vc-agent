## Context

openagent 的 TUI 中有多处依赖外部状态（git 分支、文件系统状态等），目前都在 React 渲染时同步读取。这导致两个问题：
1. 外部变更不自动反映到 UI
2. 同步 I/O 在渲染路径中阻塞帧

需要一个轻量轮询层来解耦"数据获取"和"渲染"。

## Goals / Non-Goals

**Goals:**
- 提供 `PollManager` 类，支持注册/取消命名轮询任务
- 提供 `usePollState` hook，组件声明式订阅轮询结果
- 用 git 分支名作为第一个消费者验证机制可用

**Non-Goals:**
- 不做增量 diff（每次全量返回，组件自行比较）
- 不做错误重试策略
- 不做全局单例

## Decisions

### D1: PollManager 实例化位置

**选择**: App 组件内 `useRef(new PollManager())`，通过 props 向下传递。

**理由**: App 是唯一生命周期与进程一致且不会被卸载的组件。避免全局单例（难测试），也避免放在更底层（会被卸载丢失任务）。

**替代方案**: 全局单例 `export const pollManager = new PollManager()`。更简单但测试时需要 mock/reset。

### D2: 组件订阅方式

**选择**: `usePollState(key, manager)` hook，内部用 `useState` + `useEffect` 订阅 manager 的事件。

```typescript
function usePollState<T>(key: string, manager: PollManager): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => manager.subscribe(key, setValue), [key, manager]);
  return value;
}
```

**理由**: 标准 React hooks 模式，组件卸载时 effect cleanup 自动取消订阅。无需额外抽象。

### D3: PollManager 数据结构

**选择**: 内部用 `Map<key, { fetch, interval, timer, subscribers }>` 管理任务。

```
PollManager
  ┌─ Map<key, Task>
  │    ├─ key: "git-branch"
  │    │   ├─ fetch: () => string
  │    │   ├─ interval: 3000
  │    │   ├─ timer: ReturnType<setInterval>
  │    │   ├─ lastValue: string
  │    │   └─ subscribers: Set<(v) => void>
  │    └─ key: "another-poll"
  │        └─ ...
```

**理由**: 每个 key 独立 timer、独立 subscriber 集合，注册/取消 O(1)。

### D4: 值变更检测

**选择**: 用 `===` 浅比较。每次 fetch 后与 `lastValue` 比较，相同则跳过通知。

**理由**: 避免无变化的轮询触发不必要的 React re-render。对于字符串/数字类型够用，引用类型由 fetch 函数负责返回稳定引用。

## Risks / Trade-offs

- **[R1] 轮询间隔过短可能造成 I/O 压力** → git 分支读 `.git/HEAD` 是纯文件读取，3 秒间隔安全。未来加文件系统监控（fs.watch）可替代轮询，但那是另一个 change。
- **[R2] fetch 函数抛异常会导致静默失败** → catch 后保持 lastValue 不变，不通知 subscribers。

```
数据流:

App
 │  pollManager = useRef(new PollManager())
 │
 ├─► pollManager.register("git-branch", () => getGitBranch(cwd), 3000)
 │        │
 │        ▼  每 3 秒
 │     fetch() → ".git/HEAD" → "main"
 │        │
 │        ▼  lastValue !== newValue?
 │     notify subscribers
 │
 ▼
InputBox
 │  branch = usePollState("git-branch", pollManager)
 │  // "main" → re-render 显示 "~/code/vc-agent:main"
```
