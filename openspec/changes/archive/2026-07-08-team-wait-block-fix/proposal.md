## Why

`team` 工具的 `wait` 动作（`src/tools/team.ts:handleWait`，L631-647）有 bug：它**同步立即返回**，没有真正阻塞 agent loop。

```
leader turn (streaming=true)
  │
  ├─ team(action="wait", duration=60)
  │    └─ handleWait: setTimeout(60s → wakeUp); return ok()   ← 立即返回！
  │
  ├─ agent loop 收到 ok → 立刻继续当前 turn                     ← bug：没停下来
  │    └─ leader 继续跑 team mission（分配任务、读状态…）
  │
  └─ …60s 后 wakeUp 触发，但 leader 仍在 streaming
       └─ session.steer(msg)                                    ← 次生 bug：走错分支
```

设计意图是「wait 立即返回 → leader 的 LLM 自觉结束本轮 → leader 空闲 → 60s 后 wakeUp 用 `prompt` 重启」。但**依赖 LLM 自觉停止是不可靠的设计**——LLM 看到 "Waiting..." 后照样继续干活，因为工具已经返回了，agent loop 没有挂起点。

附带次生 bug：`wakeUp`（`src/server/index.ts:81-87`）用 `isStreaming` 二分 `steer`/`prompt`。当 leader 在 wait 工具返回后继续 streaming，60s 后 `wakeUp` 命中 `steer` 分支（注入消息），而非预期的 `prompt`（开新 turn），语义全乱。

**根因**：`execute` 虽是 `async`，但 `handleWait` 同步 return，pi-coding-agent 的 agent loop（`agent-loop.js:117` 的 `await executeToolCalls`）本可以 await 工具返回的 pending Promise，当前实现却没利用这个能力。

## What Changes

- **`handleWait` 改为真正阻塞**：返回 N 秒后才 resolve 的 Promise，让 agent loop 挂起在工具调用上（参照同项目 `src/tools/question.ts:59-78` 的 `new Promise` + signal 监听范式）。工具返回时即「时间到了」，agent 自然继续。
- **支持 abort 中断**：监听 execute 传入的 `signal`（AbortSignal），用户中断 / session 切换时 `clearTimeout` 并 reject（与 question.ts 一致）。
- **移除 `wakeUp` 机制**：阻塞返回后不再需要 `setTimeout + wakeUp` 回调。清理 `TeamManagerRef.wakeUp` 字段（`types-v2.ts:259`）和 `server/index.ts:81-87` 的赋值块。grep 确认 wakeUp 仅被 handleWait 自唤起使用，无任何「成员完成时唤醒 leader」的调用方，移除安全。
- **`handleWait` 不再依赖 `teamRef`**：纯 setTimeout 阻塞不需要 team manager 引用。附带修复 headless 模式（`src/headless/runner.ts:35` 未传 teamRef）下 wait 直接走 err 分支的预存在问题。
- **更新工具 description**：`team.ts:177` 的 wait 说明从「Pause for N seconds, then wake up」改为明确「Block the agent for N seconds」，消除歧义。

## Non-goals

- **不实现「成员提前完成时唤醒 leader」**：当前 wakeUp 从未承担此职责（无调用方），本 change 不新增该能力。**wait 语义本次固化为纯定时等待**；若未来需要「成员完成提前唤醒 leader」，应走独立的 event-driven 中断机制（如 TeamManager 在 `member_done` 事件里 abort leader 的 wait signal），而非复活 wakeUp 回调通道。
- **不改 duration 边界**：维持 min 5 / max 300 / default 30 不变。
- **不动 leader 的 system prompt**：`TEAM_ORCHESTRATOR_PROMPT`（context-files.ts:100-133）已说「stop talking, let them work」「Don't check in every 30 seconds」，与阻塞语义天然一致，无需改动。
- **不改其他 team action**：read/create/assign/direct/batch 等行为不变。
- **不引入 fake timer 测试基础设施**：测试用真实小 duration（5s 下限）+ signal abort 验证，不引入 `@sinonjs/fake-timers` 等依赖。

## Capabilities

### Modified Capabilities

- `team-orchestration`: 新增 Requirement 规定 `team` 工具的 `wait` 动作 SHALL 真正阻塞 agent loop（返回 N 秒后 resolve 的 Promise），并 SHALL 在 abort signal 触发时清理定时器。移除 `TeamManagerRef.wakeUp` 字段及其赋值逻辑。

## Impact

- **代码文件**：
  - `src/tools/team.ts` — 重写 `handleWait`（async + Promise + signal），execute 路由改为 `await`，更新 wait 的工具 description
  - `src/teams/types-v2.ts` — `TeamManagerRef` 移除 `wakeUp?: (msg: string) => void` 字段
  - `src/server/index.ts` — 移除 L81-87 的 `opts.teamRef.wakeUp = ...` 赋值块
- **运行时行为**：
  - leader 调用 `wait` 后 agent loop 真正挂起 N 秒，期间不消耗 LLM 调用（工具 Promise pending）
  - 用户 ESC / session 切换触发 abort 时，wait 立即中断（reject 被 execute 的 try/catch 捕获返回 err，agent run 随后终止）
  - headless 模式下 wait 不再返回 "Wake-up callback not available" 错误，正常阻塞
- **依赖**：无新增依赖（AbortSignal/clearTimeout/setTimeout 均为运行时内置）
- **测试**：新增 `tests/team-wait-tool.test.ts` 覆盖阻塞返回 / signal abort 中断 / duration 边界 clamp
- **破坏性变更**：`TeamManagerRef.wakeUp` 字段移除是接口变更，但 grep 确认仅 `server/index.ts`（赋值）和 `team.ts`（读取）两处使用，均在本次改动中清理，无外部消费者
