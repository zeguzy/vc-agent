## ADDED Requirements

### Requirement: PollManager 生命周期管理
系统 SHALL 提供 `PollManager` 类，管理命名轮询任务的注册、执行、取消。

#### Scenario: 注册轮询任务
- **WHEN** 调用 `manager.register(key, fetch, intervalMs)`
- **THEN** 系统 SHALL 以 `intervalMs` 为间隔周期性调用 `fetch()`
- **AND** 首次调用 SHALL 立即执行（不等第一个间隔）
- **AND** 若 `key` 已注册，SHALL 先取消旧任务再注册新任务

#### Scenario: 取消轮询任务
- **WHEN** 调用 `manager.unregister(key)`
- **THEN** 系统 SHALL 停止该 key 的定时器并清空订阅者列表

#### Scenario: 值变更通知
- **WHEN** `fetch()` 返回值与上一次不同（`===` 比较）
- **THEN** 系统 SHALL 通知该 key 的所有 subscribers，传递新值
- **AND** 若返回值与上一次相同，SHALL NOT 通知 subscribers

#### Scenario: fetch 异常处理
- **WHEN** `fetch()` 抛出异常
- **THEN** 系统 SHALL 静默捕获，保持 `lastValue` 不变，不通知 subscribers
- **AND** 下个周期继续正常执行

#### Scenario: 销毁全部任务
- **WHEN** 调用 `manager.destroy()`
- **THEN** 系统 SHALL 停止所有定时器并清空所有订阅者

### Requirement: usePollState Hook
系统 SHALL 提供 `usePollState<T>(key, manager)` hook，让 React 组件声明式订阅轮询结果。

#### Scenario: 订阅并获取值
- **WHEN** 组件调用 `usePollState("git-branch", manager)`
- **THEN** hook SHALL 订阅 manager 的 "git-branch" key
- **AND** 当该 key 有新值时，组件 SHALL 自动 re-render 获取最新值

#### Scenario: 组件卸载时取消订阅
- **WHEN** 使用 `usePollState` 的组件被卸载
- **THEN** hook 的 cleanup SHALL 取消对该 key 的订阅
- **AND** 不影响该 key 的其他 subscriber

#### Scenario: key 变化时重新订阅
- **WHEN** hook 的 `key` 参数变化
- **THEN** SHALL 取消旧 key 的订阅，订阅新 key
