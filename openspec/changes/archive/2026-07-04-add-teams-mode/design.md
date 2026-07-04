## Context

openagent 已具备完整的同步 `subagent` 委派能力（`src/tools/subagent.ts` 支持 single/parallel/chain、`src/agents/runner.ts:runSubagent` 每个 worker 用独立 `createAgentSession`、`src/agents/discover.ts` 已支持 markdown + YAML frontmatter 的 agent 定义），以及 orchestrator system prompt（`src/context-files.ts:20`）。但这套设计的核心约束是：**`runSubagent` 是同步阻塞调用**——父 agent 在工具执行期间一直阻塞、`onUpdate` 回调聚合的 worker 流式文本只在工具结果里以单字符串返回、TUI 无法独立渲染每个 worker 的实时输出。

然而 `AgentSessionRuntime` 只持有单个 active session，`AgentServer` 单点订阅一个 session 事件总线，`MessageRole` 也只有 user/assistant/tool/separator——这些是 V1 teams 模式必须突破的三个关键缺口。

外部参考 Claude Code Subagents（独立 context、tool allowlist、summary 回传、可选 worktree 隔离）+ Roo Code Boomerang（严格上下文隔离、显式 new_task/attempt_completion 传递）+ Amp Subagents（Oracle/Librarian 等专业 agent）。明确**不抄** Claude Code Agent Teams 的 mailbox P2P（task 状态滞后问题官方未解决）。

## Goals / Non-Goals

**Goals:**

- 把同步委派升级为**异步 worker pool**：主 agent spawn → 继续推进其他事 → poll 回收
- 每个 worker 独立 context、独立事件流、可独立 cancel / dispose
- 主 agent 通过 `team` 工具与现有 `subagent` 工具并存（同步入口不动，新增异步入口）
- per-agent 工具收口：新增 `disallowedTools` / `maxTurns` / `background` / `permissionMode` 字段
- TUI 在主消息流内**独立流式渲染**每个 worker 的实时输出 + 选择器聚焦查看历史
- 进程退出 / cancel_all / 单 worker 失败均不泄漏孤儿 session；并发与 maxTurns 是硬上限
- 三种运行模式（TUI / headless / HTTP serve+attach）统一通过 `AgentServer` 路由 worker 事件

**Non-Goals:**

- worker 间 mailbox / P2P 直接通信
- 共享 task list / 任务依赖图
- git worktree 隔离
- per-agent MCP server
- split-pane / tmux 多终端展示
- worker 持久化与 resume（dispose 即清）
- 嵌套 team / 单 worker resume
- **V1 不保留任何 V2 占位代码**——所有 V2 能力（mailbox / 共享 task list / git worktree 隔离 / per-agent MCP / `team.broadcast` action / `Ctrl+T` toss message / 嵌套 team / worker resume 等）从 V1 代码中**移除**，仅在 V2 提案中重新设计。`Config.teams.isolation` 字段保留但仅作 `reserved` 提示位，V1 视同 `"none"`

## Decisions

### D1：复用 `createAgentSession` 而非自建轻量 agent loop

worker 通过 `createAgentSession()` 直接拉起 SDK 会话，**不**自建工具调度循环、**不**复用 `createRuntime()`（后者负责单 session 持久化、SkillManager 全量加载、LspClient 状态等主会话职责）。

**理由**：
- 现有 `src/agents/runner.ts:runSubagent` 已验证"独立 `createAgentSession` + `DefaultResourceLoader({ noSkills:true, noContextFiles:true })`"模式工作正常，可抽出工厂复用
- worker 不持久化、不进 `SessionManager`，避免与主会话历史污染
- LLM Provider / Model / Auth 复用主会话 `services.modelRegistry` + `authStorage`，零额外配置

**worker customTools 策略（V1 决策）**：worker 直接沿用 `runSubagent` 的工具装配路径——`tools: agent.tools ?? BUILTIN_TOOLS`（应用 deny 后 allow），**不注入需要 bridge 的 customTools**：
- `edit` / `write`：被 D5 默认 deny，且即便 agent 显式声明允许，也不复用主 session `EditConfirmBridge`（直接 fsWriteFile 无确认；headless 模式行为一致，不分叉）
- `question`：worker 内不注册该工具——worker 是后台无人值守执行，**不存在接受输入的 UI 通道**；调用者得到回执 `Error("question tool unavailable in worker context")`，主 agent 看 poll 时识别该 error 自行变现
- `lsp_diagnostics` / `lsp_goto_definition` / `lsp_find_references`：V1 **不在 worker 工具集中**，避免多 worker 并发请求压垮 `typescript-language-server` 单 stdio pipe；主 session LspClient 实例与 worker 完全独立
- `subagent` / `team`：worker 不注册，自动防嵌套 team
- `webfetch`：默认注入 worker 工具集，受 `Config.teams.workerPermissions.networkRestricted` 收口

**备选**：
- 自建轻量 agent loop（仅 LLM + 工具回路）——被否，成本高、SDK 行为漂移、丢失权限模型与 streaming event。
- 让 worker 注入与主 session 等同的 customTools（包含 edit/question/LSP）——被否，多 worker 共享单 bridge 会状态混乱、多 LSP 客户端会撑爆 LSP server。

### D2：worker pool 与 AgentServer 的关系——挂载而非新建总线

`AgentServer` 持有一个 `WorkerSessionPool` 实例；worker 自己的 `session.subscribe()` 事件经 `WorkerSessionPool` 聚合后**打 `workerId` 标签**转发给 `AgentServer` 已有的 `eventHandlers`。不新建独立总线。

**注入路径（关键修复）**：`team` 工具需要访问 `workerPool`，而 `team` 工具作为 `customTools` 在 `src/agent/session.ts:initServices` 中创建，**早于** `AgentServer` 构造。因此采用 **延迟 owner 模式**：

```ts
// 在 initServices 时 team 工具持有 WorkerPoolRef
const poolRef: WorkerPoolRef = { current: null };
const teamTool = createTeamTool({ cwd, services, parentModel, poolRef });

// 在 AgentServer 构造完成后立即填充 ref
this.workerPool = new WorkerSessionPool(...);
poolRef.current = this.workerPool;
```

`WorkerPoolRef` 是 `{ current: WorkerSessionPool | null }` 单例对象，`team` 工具在每次 execute 时读 `poolRef.current`：
- 若为 null → 返回 `isError: "teams not initialized yet"`
- 若非 null → 正常执行

**理由**：
- 不需要把 pool 创建提前到 services（pool 与 server 强绑定，生命周期一致）
- 不需要改动 `initServices` 的 services 结构，最小侵入
- ref 单例避免 `setActiveToolsByName` 重新激活或动态注入 customTools 的复杂度

**备选**：
- 把 `WorkerSessionPool` 提前到 `initServices` 作为 services 一部分——被否，pool 在 server 不存在时没有事件路由出口，构造期 window 难定义。
- 在主 session 启动后动态追加 customTools——被否，SDK 不保证工具激活后可动态扩展，且需重新刷新 active tools 触发 LLM 工具清单更新，做法脆弱。

```
                          ┌──── 主 AgentSession ────┐
                          │ session.subscribe()     │
                          └────────────┬────────────┘
                                       │ existing event flow
                                       ▼
       ┌──────────── AgentServer ──────────────────────────┐
       │  eventHandlers: Set<(e: AgentSessionEvent) => ..> │
       │  workerPool: WorkerSessionPool                     │
       │       ┌────────────┴───────────────────────┐      │
       │       │ workers: Map<wkr_xxx, Worker>       │      │
       │       │  ├─ wkr_a1: lysosome, running        │      │
       │       │  ├─ wkr_b2: nucleus,  done           │      │
       │       │ subscribe(listener) → onWorkerEvent  │      │
       │       └────────────┬───────────────────────┘       │
       └────────────────────┬───────────────────────────────┘
                            │ tagged event: { workerId, kind, payload }
                            ▼
              TUI / headless / HTTP SSE 三种模式统一消费
```

**理由**：TUI、headless runner、HTTP serve+attach 已经订阅 `AgentServer.eventHandlers`；新总线会迫使三人换 محل。打标签后复用总线是零路由改动。

**备选**：每个 worker 自己 `AgentServer` 实例 + 各自 SSE——被否，多总线下 TUI 需新事件订阅矩阵、生命周期管理失控。

### D3：team 工具的三个动作而非把 worker 暴露为多个工具

`team` 工具是单一 ToolDefinition，参数 `action: "spawn" | "poll" | "cancel"`。`spawn` 非阻塞立即返回 `workerId`，主 agent **不 await 结果**，继续推进当前轮次。

```
主 Agent 轮次：
  ┌─ team.spawn({agent:"lysosome", task:"review src/auth"})
  │    └─ 非阻塞，立即返回 workerId=wkr_a1
  ├─ team.spawn({agent:"lysosome", task:"review src/api"})
  │    └─ 非阻塞，立即返回 workerId=wkr_b2
  ├─ <其他工作：read 文件、grep 等>
  └─ team.poll({workerIds:["wkr_a1","wkr_b2"], wait:true})
       └─ 此时阻塞，等所有 polled worker 完成；返回每个 worker 的 summary + token/cost
```

**理由**：
- 单一工具降低 LLM 学习成本，poll 是显式同步原语
- 与现有 `subagent` 工具的同步 `parallel` 模式同形（主 agent 知道 aggregate）但新增"continue-between-spawn-and-poll"能力
- `cancel` 独立 action 而非 spawn 参数：避免把 cancel 与 spawn 混在一个工具调用里

**备选**：拆成 `spawn_worker` / `poll_workers` / `cancel_worker` 三个工具——被否，工具列表噪音大、LLM 选择面广。

### D4：per-agent 工具收口用 `tools` + `disallowedTools` 双层（与 Claude Code 对齐）

```yaml
# ~/.config/openagent/agents/lysosome.md  （frontmatter）
---
name: lysosome
description: Code reviewer. Use when reviewing changes for quality, security, correctness.
tools: read, grep, find, bash
disallowedTools: write, edit     # ← 新字段
model: glm-5.1-air
maxTurns: 8                      # ← 新字段
background: true                 # ← 新字段：可作为异步 worker spawn
permissionMode: default          # ← 新字段，取值 "default" | "plan" | "acceptEdits"
---
```

应用顺序：先 `disallowedTools` 砍掉，再 `tools` 收 allowlist；两者都为可选；为空时不强制（默认沿用 SDK 默认激活工具集，但 worker 默认 deny `write`/`edit`）。

**permissionMode 取值**（V1 仅 3 个，移除 "bypass"）：
- `"default"`：标准权限（worker 路径下等价 default deny write/edit，详见 D5）
- `"plan"`：强制只读，从工具集中移除 `write`/`edit`/`bash`
- `"acceptEdits"`：worker 允许 edit/write，**不**经主 session `EditConfirmBridge`、直接写盘（headless 模式行为一致）

**理由**：
- 与 Claude Code 对齐三个安全基线值，降低迁移成本
- `bypass` 被刻意移除：V1 无明确业务场景，且会击穿 D5 默认 deny write/edit 的最小权限基线，违背"安全基线不被单字段击穿"原则
- `acceptEdits` 仅在用户**显式**在前 frontmatter 写出时生效，符合"白色优于黑色"
- denylist 必要：MCP 工具用 `mcp__server` 模式可一次禁掉一组，allowlist 不方便
- `maxTurns` 是硬上限，避免 worker 在盲走的循环里烧钱
- `permissionMode: "plan"` 时 worker 强制只读，等价 orchestrator 防失控

**备选**：
- 仅 allowlist——被否，无法一刀禁掉一组 MCP 工具。
- 包含 `"bypass"`——被否（见上），留给 V2 提案独立设计权限模型时再评估其必要性。

### D5：worker 默认 `disallowedTools: ["write", "edit"]`——最小权限基线

未声明 frontmatter 时，worker spawn 默认无写盘工具。要在 worker 里写代码必须 agent 定义**显式**声明 `tools: [..., edit]`。

**理由**：
- 并行 worker 同时改同一文件会互相覆盖（Claude Code 官方文档明确指出该风险）
- 默认只读 + 显式开写 = "白名单优于黑名单"
- 调研中 Claude Code、Roo Code、Cline Subagents 都默认 worker 只读，是行业标准

**备选**：worker 默认继承全部工具，靠 frontmatter deny——被否，failure mode 太危险（一个忘了 deny 的 worker 即可破坏他人正在写的文件）。

### D6：TUI 渲染——inline 聚合 + 选择器聚焦，不上 split-pane

V1 不接 tmux / iTerm2 split-pane。worker 流式输出**作为新消息角色 `worker` 插入主消息流**，每个 worker 一行带状态指示 + 当前流式 token；`/workers` 命令进入选择器列表，方向键选某 worker → Enter 进入详细历史查看；ESC 返回主流程。

```
┌── Messages ──────────────────────────────────┐
│  user: 并行审 src/auth 和 src/api 各起 lysosome │
│  assistant: 主 Agent 决策: spawn 2 个 worker     │
│  [tool: team.spawn] → wkr_a1                   │ ← tool 消息
│  [tool: team.spawn] → wkr_b2                   │
│  [worker wkr_a1 / lysosome · running]          │ ← worker 角色消息
│    <流式 token 实时滚动>                         │
│  [worker wkr_b2 / lysosome · running]          │
│    <流式 token 实时滚动>                         │
│  [tool: team.poll wait=true]                   │
│  [worker wkr_a1 · done] summary: ...           │
│  [worker wkr_b2 · done] summary: ...           │
│  assistant: 两处都发现 …综合建议 …              │
└────────────────────────────────────────────────┘
```

**理由**：
- split-pane 依赖终端特性（tmux / iTerm2 it2 CLI），跨平台不一致、依赖外部环境
- inline + 选择器聚焦模式与现有 TUI 架构零冲突，复用 `MessageList` 渲染管线
- 一个原生 OpenTUI `<scrollbox>` 即可承载选择器，零新依赖

**备选**：tmux/iterm2 斜开窗口——被否，V1 不引入外部终端依赖；V2 可作为可选模式。

### D7：并发上限与 maxTurns 是硬上限，不可软排队

`Config.teams.maxWorkers`（默认 4）超限时 `team.spawn` **直接拒绝**并返回错误给主 agent，**不**排队。`worker.maxTurns` 超 ≥1 时 SDK `abort()`，状态置 `error`，return summary 中标注 hit-maxTurns。

**理由**：
- 排队隐藏失控——主 agent 不知道 spawn 是否真起效，Claude Code 文档也提示过该问题
- 主 agent 应自己感知到上限、自己做 prioritization，强制其决策而非依赖底层调度
- LLM 调用 `team.poll wait:true` 是显式阻塞点，不会触发并发风暴

**备选**：超上限时排队等待——被否，调研回顾：Claude Code Agent Teams 自身的 task 状态滞后问题正源于排队 + 异步信号混合。

### D8：进程退出钩子保证 dispose 所有 worker

Bun 进程级 `process.on("exit") / on("SIGINT") / on("SIGTERM")` 调用 `workerPool.disposeAll()`，确保任何运行中的 worker `session.dispose()` 被调用，避免孤儿 session 占用 LLM 连接。

**理由**：worker 默认不持久化，但 Pi SDK 内部可能持有 LLM HTTP keep-alive 连接、LSP 客户端 socket——必须显式释放。

### D9：worker 事件聚合标签 schema

worker 事件经 `WorkerSessionPool` 转发时统一包裹在 `WorkerEventEnvelope` 类型，由 `AgentServer` 在 `eventHandlers` 之前作为新事件类型 `team_worker_event` 分发：

```ts
type WorkerEventEnvelope = {
  type: "team_worker_event";
  workerId: string;        // wkr_xxx
  workerAgent: string;     // "lysosome"
  kind: "message_delta" | "message_end" | "tool_call" | "tool_result" | "agent_end" | "error";
  payload: AgentSessionEvent;  // 原 Pi SDK 事件
};

type TeamOrphansCancelledEvent = {
  type: "team_orphans_cancelled";
  workerIds: string[];
};

// AgentServer 的事件总线 union 类型
export type AgentClientEvent =
  | AgentSessionEvent
  | WorkerEventEnvelope
  | TeamOrphansCancelledEvent;
```

**EventHandler 类型扩展**：`src/client/types.ts:EventHandler` 当前签名 `(event: AgentSessionEvent) => void`，V1 通过扩展为 `(event: AgentClientEvent) => void`收敛。现有订阅者通过 `if (event.type === "team_worker_event")` / `"team_orphans_cancelled"` 路由，**其余 type 命中现有 AgentSessionEvent 处理路径**——不变的现有事件 schema 仍是 union 的子集，向后兼容。

订阅者（TUI、headless、HTTP）通过判断 `event.type === "team_worker_event"` 路由到独立处理路径，与现有 `agent_start` / `message_update` / ... 平行，**不污染现有事件 schema**。

## Decision D10：worker 不共享主 session 的 EditConfirmBridge / QuestionBridge

V1 worker 通过 `Worker.spawn` 创建的独立 `AgentSession` 完全独立于主 session 的 `runtime.factory` 配置：

- **不**注入 `editBridge`：worker 不在 customTools 中包含 `createEditTool`；当 agent frontmatter `permissionMode: "acceptEdits"` 且 `tools` 显式含 `edit` / `write` 时，worker 调用 SDK 内置 `edit` / `write` 工具的 fsWriteFile 路径（无 confirm UI 与主 session 一致），**不**走主 session `EditConfirmBridge`
- **不**注入 `questionTool`：worker 后台无人值守，无 UI 通道接受输入；任何对 question 的调用由 worker 直接抛 `Error("question tool unavailable in worker context")`，主 agent 在 `team.poll` 看到 `status: "error"` + `lastError: "question tool unavailable in worker context"` 后自行决定下一步

**理由**：
- 共享 bridge 会撞单槽 pending state（参考 `src/agent/session.ts:EditConfirmBridge` 与现有 edit 工具 sequential 模式约束，多 worker 并发时单槽 PendingPattern resolve 错乱）
- 共享 question 通道无意义——主 agent 自己 await 工具结果，没有可见 UI 让用户与后台 worker 问答
- 直接 error 让主 agent 自行补偿，是 headless 与 background 场景下最清晰的 failure path

**备选**：worker 各自独占 `EditConfirmBridge` 实例并加 ranks → 被否，V1 不引入"用户后台逐个确认后台 edit" 的复杂 UI 通路；V2 候选设计。

## Risks / Trade-offs

**[R1 主 agent 上下文膨胀]** → team.spawn 多次 + team.poll 多次，summary 累积可能撑爆主上下文窗口
- **缓解**：`team.poll` 默认返回 truncated summary（≤ 1KB）+ token/cost/状态；主 agent 想看完整结果需显式 `team.poll({workerId, full:true})`；超过阈值时 summary 自动截断并提示"[full output truncated, N tokens]"
- **累积保护**：当主 agent 累计 worker summary 字节数超过 contextWindow 50% 时，TUI SHALL 在 StatusBar 显示告警 `teams: context near limit, consider compaction`；不在 V1 自动 compact，由用户手动 `/compact`

**[R2 worker 持续 retry 撞 maxTurns]** → 长 task 在 maxTurns=8 内跑不完
- **缓解**：maxTurns 默认 8 但可在 frontmatter 覆盖；命中时 error 状态明确标注 `hit_maxTurns`，主 agent poll 看到 error 后可自行决定升级到更高 maxTurns 重 spawn

**[R3 进程 SIGKILL 无法 hook dispose]** → 终端强杀 → 孤儿 LLM 连接 + 磁盘上的 LSP stdin 管道
- **缓解**：worker 默认 `noContextFiles: true, noSkills: true`，状态轻；SIGKILL 是不可避免 corner case，文档提示用户用 `Ctrl+C`（SIGINT）优雅退出

**[R4 主 agent 不 poll 就逃跑]** → 主 agent 完成 agent_end 但 worker 仍在跑
- **缓解**：`AgentServer.handleAgentEnd` 钩子里检查 `workerPool.runningCount`，若非 0：
  - 默认配置 `cancelOrphansOnAgentEnd: true`：自动 `workerPool.cancelAll()` + 触发 `team_orphans_cancelled` 事件（TUI 显示提示）
  - 配置项可关闭，让 worker 继续后台跑——但 `process.on("exit")` 仍会 disposeAll

**[R5 HTTP serve+attach 远程模式 worker 事件洪流]** → 多 worker 流式 token 经 SSE 推送，远程客户端流量爆炸
- **缓解**：HTTP 客户端默认订阅 `kind === "message_end" || kind === "agent_end"`（不推流 delta）；客户端想看流式时显式 `client.subscribeWorkers({ streaming: true })`

**[R6 worker 自身 fail（LLM 限流、模型不可用）]** → worker 抛错进 error 状态
- **缓解**：worker 单点失败不传染 worker pool；error 状态由 `WorkerEventEnvelope.kind === "error"` 通知主 agent；主 agent 在 `team.poll` 时看到 error 后由主 agent 决定 retry / 改 model 重 spawn

**[R7 worker 默认 disallowedTools 收口太严]** → 用户受限想用通用 agent 跑写代码 worker
- **缓解**：用户自定义 agent 时显式声明 `tools: [..., edit, write]` 即可解锁；默认否认是安全基线，"白色优于黑色"

**[R8 TUI 并行渲染压力]** → 同时多 worker 流式 token + 每块带 border + markdown 渲染超过 OpenTUI Zig 引擎 80ms 节流的舒适区（N=4 临界、N≥6 抖动）
- **缓解**：默认 `Config.teams.maxWorkers = 4` 保持 80ms 节流舒适区
- **可选**：预设 `Config.teams.uiStreamingLimit`（V1 仅是 reserved name，不实现，也不在 V1 Non-goals 中承诺）；超过 maxWorkers 时 worker delta **自动降级为非流式**——仅 push `kind: "message_end"` + truncated 最终 summary

**[R9 worker 内 LLM 限流 / 网络 drop 导致 session.prompt reject 的处理一致性]** → worker.status 转换路径需统一
- **缓解**：`Worker.run()` 内 `try { await session.prompt() } catch (e) { status="error"; lastError=e.message; emit kind="error" }` 是唯一可写路径；spec Scenario 强制约束

## Migration Plan

V1 是纯新增功能，不修改任何现有同步 `subagent` 行为，**无破坏性变更、无回滚需求**。

部署步骤：

1. **代码合并即生效**：merge 到 main 后下次启动 openagent 即自动支持 teams；未配置 `teams.enabled` 默认 `true`，主 agent 只有在自然语言里被指示用 team 时才会调 `team` 工具——存量 session 不受影响
2. **配置可选**：用户不写 `Config.teams` 一切走默认；要禁用整个 teams 设 `teams.enabled: false`
3. **frontmatter 兼容**：现有 agent 定义文件**无需改写**——新字段为可选
4. **回滚**：若 V1 引发 bug，单 commit `git revert` 即可，无 schema 迁移、无数据迁移
5. **过期清理**：进程退出 worker dispose 不会写 `~/.config/openagent/sessions/`，不污染会话目录

## Open Questions

- **Q1 已收敛为 D1 决策**：V1 worker **不持主 session `LspClient` 引用、不创建独立 `LspClient`、不注入 LSP tools 到 worker active tools 集**——避免并发请求竞争同一 `typescript-language-server` stdio pipe，同时节省多 LSP server 进程；与 agent-session spec `worker 不注入 LSP 工具避免并发压力` Scenario 严格对齐。待 V2 实测 LSP server 多 client 支持后再开放。
- **Q2**：`team.poll({wait:true})` 的阻塞上限是否应有 timeout？（已在 team-orchestration spec Scenario `poll 动作阻塞等待` 写死 60s 默认 timeout，超时返回当前进度让主 agent 自己评估是否继续 poll——避免主 agent 自己 timeout）
- **Q3**：worker token / cost 是否独立显示在 `/usage` 之外还是合并到主 session？（建议独立，poll 时返回，避免主 session 用量被 worker 污染导致计费误读）
- **Q4 已收敛为 Non-goal**：`/workers` 在 V1 是只读查看 + cancel 单个 worker；send-to-worker 投消息与 V2 mailbox 同期落。