## Context

当前 team 模式的 member 是一个"空壳 AgentSession"：
- 创建时 `tools: []`，无法执行任何操作
- Leader 通过 `assignTask()` 发任务，底层用 `session.steer()` 或 `session.prompt()` 推送
- Member 完成后触发 `agent_end` → 自动 `completeTask()` → 状态变 idle
- Leader 无法暂停/恢复/取消运行中的 member
- Leader 无法向运行中的 member 发追加指令（只能 steer 追加文本，无结构化通信）
- Member 没有工具，无法读文件、执行命令、写记忆

对比 V1 Worker（`src/teams/worker.ts`）：
- Worker 有完整的工具注入（`resolveTools()` + `deniedToolsFor()`）
- Worker 有权限模型（default/plan 模式控制 edit/write/bash）
- Worker 有 cancel 机制（`session.abort()`）
- 但 Worker 也没有 pause/resume，也没有结构化通信

对比 subagent 工具（`src/tools/subagent.ts`）：
- Subagent 用 `runSubagent()` 创建临时 AgentSession → 执行完销毁
- 有工具、有权限、有结果返回
- 但无状态、无记忆、无持续通信

**核心差异点**：team 模式必须比 subagent 多出三个价值：
1. 持久记忆（已有：.openagent/team/ 文档状态）
2. 主动通信（缺失：需要新增）
3. 生命周期控制（缺失：需要新增）

## Goals / Non-Goals

**Goals:**
- Member 创建时注入基础工具集，使其能真正执行任务
- Leader 可通过 `member-direct` 工具向运行中 member 发结构化消息
- Leader 可 pause/resume/cancel member
- Member 状态机扩展：active → paused → active, active → cancelled

**Non-Goals:**
- Member 之间直接通信（只做 leader↔member）
- 自动调度/负载均衡
- Member 持久化重启
- 工作目录隔离
- 权限细粒度控制（沿用 V1 permissionMode）

## Decisions

### D1: Member 工具集

Member 注入的工具集 = BUILTIN_TOOLS + 团队工具子集：
- 基础：read, bash, grep, find（只读 + 执行）
- 团队：member-read, self-edit, memory-write（读同伴 + 写自己 + 写记忆）
- 不注入：edit, write（由 leader 通过 member-edit 控制）、team-edit/team-read（leader 专属）、question（避免 member 阻塞等用户输入）、subagent（避免 member 嵌套委派）

**理由**：Member 应该能探索代码库和执行命令来完成任务，但不应该修改文件（文件修改由 leader 审核后通过 member-edit 执行）。

### D2: Leader→Member 通信机制

新增 `member-direct` 工具，leader 调用时：
1. 构造结构化消息 `{ kind: "directive" | "context" | "redirect", payload: string }`
2. 通过 `session.steer()` 注入到 member 的上下文流
3. Member 的 LLM 自然消费这条消息作为追加输入

**理由**：`session.steer()` 已经是 Pi SDK 提供的向运行中 session 注入文本的标准方式。不需要新的传输层，只需要在上层加结构化封装。

### D3: Member 生命周期状态机

```
idle ──assignTask──▶ active ──agent_end──▶ idle
                      │                    ▲
                      ├── pause ──▶ paused ── resume ──┘
                      └── cancel ──▶ cancelled (terminal)
```

- `pause`：调用 `session.abort()` 中断当前推理，状态设 paused
- `resume`：调用 `session.prompt(lastTask)` 重新启动，状态设 active
- `cancel`：调用 `session.abort()` + `session.dispose()`，状态设 cancelled（终态）

**理由**：Pi SDK 的 `session.abort()` 可以中断正在进行的 LLM 调用。pause 用 abort 暂停，resume 用 prompt 恢复。这是最简单的实现，不需要 SDK 新增 API。

### D4: Member→Leader 反馈

Member 完成任务时：
1. 结果已通过 `memory-write` 写入自己的记忆文件
2. Leader 通过 `member-read` 读取 member 的产出
3. `member_done` 事件携带 summary（已有）

不需要新的 Member→Leader 通道——文档状态就是通信介质。

## Risks / Trade-offs

- **pause 精度**：`session.abort()` 是粗暴中断，可能丢失 member 正在生成的中间结果。Trade-off：简单实现 vs 精确暂停。选择简单实现，后续可优化。
- **工具泄露**：Member 拥有 bash 工具意味着可以执行任意命令。Trade-off：执行能力 vs 安全性。沿用 V1 的 permissionMode 机制控制。
- **steer 时序**：`session.steer()` 在 member 非流式状态时无效（需用 `prompt`）。`member-direct` 需要判断 member 是否正在流式输出。
- **状态一致性**：pause/resume 期间 TEAM.md 和 member.md 的状态可能不同步。Trade-off：接受短暂不一致，resume 时重新注入上下文。
