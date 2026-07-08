## ADDED Requirements

### Requirement: team 工具 wait 动作真正阻塞 agent loop

`team` 工具的 `wait` 动作（`src/tools/team.ts:handleWait`）SHALL 返回一个在 N 秒后 resolve 的 Promise，使 pi-coding-agent 的 agent loop（`await executeToolCalls`）挂起在工具调用上，而非同步立即返回。`handleWait` SHALL 监听 execute 传入的 `signal`（AbortSignal）：当 signal 触发 abort 时（用户中断、session 切换），SHALL `clearTimeout` 清理定时器并 reject（与 `src/tools/question.ts` 的阻塞范式一致）。

`wait` 动作 SHALL NOT 依赖 `TeamManagerRef.wakeUp` 或任何外部回调机制来恢复 agent——阻塞 Promise resolve 后 agent loop 天然继续。

#### Scenario: wait 阻塞 N 秒后恢复

- **WHEN** leader agent 调用 `team` 工具，参数 `{ action: "wait", duration: 60 }`
- **THEN** `handleWait` SHALL 返回一个 pending Promise，使 agent loop 在 `await executeToolCalls` 处挂起
- **AND** 在 ~60 秒后 Promise SHALL resolve，返回内容含 "Waited 60s"
- **AND** agent loop SHALL 在 Promise resolve 后继续（调用 LLM 处理 tool result）
- **AND** 等待期间 SHALL NOT 消耗 LLM 调用（Promise pending，无 follow-up）

#### Scenario: duration 边界 clamp

- **WHEN** leader 调用 `{ action: "wait", duration: 1 }`（低于 min 5）
- **THEN** 系统 SHALL clamp 到 5 秒（`Math.max(5, ...)`），实际等待 ~5 秒
- **WHEN** leader 调用 `{ action: "wait", duration: 999 }`（高于 max 300）
- **THEN** 系统 SHALL clamp 到 300 秒（`Math.min(300, ...)`）
- **WHEN** leader 调用 `{ action: "wait" }`（未提供 duration）
- **THEN** 系统 SHALL 使用默认值 30 秒

#### Scenario: abort signal 触发时立即中断并清理

- **WHEN** leader 调用 `{ action: "wait", duration: 60 }`，随后用户按 ESC 或 session 切换触发 `signal.abort()`
- **THEN** `handleWait` SHALL `clearTimeout` 清理定时器（不泄漏）
- **AND** SHALL reject（`signal.reason ?? new Error("Aborted")`）
- **AND** reject 被 execute 的 try/catch 捕获，返回 `isError: true` 的结果
- **AND** 中断 SHALL 在 abort 触发后 < 100ms 内完成（不等待原 duration）

#### Scenario: wait 不依赖 wakeUp 回调

- **WHEN** leader 调用 `{ action: "wait" }`
- **THEN** `handleWait` SHALL NOT 读取 `teamRef.wakeUp`
- **AND** SHALL NOT 调用任何外部回调来恢复 agent
- **AND** 恢复机制 SHALL 完全由 Promise resolve 驱动

### Requirement: TeamManagerRef 移除 wakeUp 字段

`TeamManagerRef`（`src/teams/types-v2.ts`）SHALL NOT 包含 `wakeUp` 字段。接口 SHALL 简化为 `{ current: TeamManagerLike | null }`。`src/server/index.ts` SHALL NOT 包含 `teamRef.wakeUp` 赋值逻辑。

#### Scenario: TeamManagerRef 无 wakeUp 字段

- **WHEN** 定义 `TeamManagerRef` 接口
- **THEN** 接口 SHALL 仅包含 `current: TeamManagerLike | null`
- **AND** SHALL NOT 包含 `wakeUp?: (msg: string) => void`

#### Scenario: server 初始化不再赋值 wakeUp

- **WHEN** `AgentServer` 构造函数执行（`src/server/index.ts`）
- **THEN** SHALL 设置 `opts.teamRef.current = this.teamManager`
- **AND** SHALL NOT 设置 `opts.teamRef.wakeUp`
