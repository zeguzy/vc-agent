## Context

vc-agent 的 `team` 工具（`src/tools/team.ts`）有一个 `wait` action，设计意图是让 leader agent 暂停 N 秒后再检查团队状态，避免频繁轮询。但当前实现（L631-647）有 bug。

### 当前（buggy）数据流

```
leader turn (isStreaming=true，整个 runWithLifecycle 期间)
  │
  ├─ LLM 决定调用 team(action="wait", duration=60)
  │
  ├─ agent-loop.js:117  await executeToolCalls(...)
  │    └─ executePreparedToolCall → await tool.execute(...)
  │         └─ handleWait(teamRef, args):
  │              ├─ wakeUp = teamRef.wakeUp       ← server/index.ts:81 赋值
  │              ├─ setTimeout(60s, () => wakeUp(...))   ← 排个回调
  │              └─ return ok("Waiting 60s...")    ← 同步立即返回！
  │
  │    executeToolCalls 的 await 立刻拿到 ok 结果
  │
  ├─ agent loop 继续 → 调用 LLM 处理 tool result    ← ❌ leader 没停下来
  │    └─ LLM 看到 "Waiting..." 但工具已返回，继续干活（跑 mission）
  │
  └─ …60s 后 setTimeout 触发
       └─ wakeUp(msg):
            ├─ this.session.isStreaming === true   ← leader 还在忙
            └─ session.steer(msg)                  ← ❌ 走错分支（应为 prompt）
```

**根因**：`handleWait` 是同步函数，`return ok()` 不阻塞。pi-coding-agent 的 agent loop（`agent-loop.js:117`）本可以 `await` 工具返回的 pending Promise（已由 `question.ts:59` 的 `new Promise` 验证可行），但当前实现白白浪费了这个能力。

### 关键事实（探索确认）

1. **agent loop 会 await 工具 Promise**：`agent-loop.js:117` → `executeToolCalls` → `executePreparedToolCall`（L416-446）→ `await prepared.tool.execute(...)`。工具返回的 Promise 不 resolve，agent loop 就不继续。`question.ts` 已用此模式阻塞等用户输入。

2. **abort 不会自动 reject 工具的 Promise**：`agent.abort()`（`agent.js:196`）调用 `abortController.abort()`，只触发 signal 的 abort 事件。工具**必须自己**监听 `signal.addEventListener("abort", ...)` 来清理（clearTimeout）并 reject，否则 agent loop 会被卡住。`question.ts:66-77` 是标准范式。

3. **wakeUp 仅 handleWait 自唤起使用**：grep 全仓确认：
   - `server/index.ts:81` 赋值
   - `team.ts:633-641` 读取调用
   - `types-v2.ts:259` 声明
   
   **没有任何「成员完成时调用 wakeUp 唤醒 leader」的代码**。wakeUp 纯粹是 handleWait 的 setTimeout 自唤起机制，阻塞化后完全多余，可安全移除。

4. **headless 模式未传 teamRef**：`src/headless/runner.ts:35` 的 `createServer` 调用未传 teamRef，导致 headless 下 `wakeUp` 为 undefined，handleWait 走 `err("Wake-up callback not available")`。阻塞化后 handleWait 不依赖 teamRef，附带修复此问题。

5. **isStreaming 在整个 runWithLifecycle 期间为 true**（`agent.js:316` set / `agent.js:347` clear），包括工具执行期间——这是 wakeUp 命中 steer 而非 prompt 分支的直接原因。

## Goals / Non-Goals

**Goals:**

- `wait` 真正阻塞 agent loop N 秒，期间不消耗 LLM 调用
- 支持 abort 中断（用户 ESC / session 切换），清理定时器不泄漏
- 移除冗余的 wakeUp 机制（字段 + 赋值），简化 TeamManagerRef
- headless 模式下 wait 正常工作

**Non-Goals:**

- 不实现「成员提前完成时唤醒 leader」（见 proposal Non-goals）
- 不改 duration 边界
- 不动 leader system prompt
- 不改其他 team action

## Decisions

### 决策 1：handleWait 改为 async + `new Promise` 阻塞（参照 question.ts）

**选择**：

```typescript
async function handleWait(
    args: { duration?: number },
    signal: AbortSignal | undefined,
): Promise<{ content: ...; details: {} }> {
    const seconds = Math.max(5, Math.min(300, args.duration ?? 30));
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), seconds * 1000);
        if (signal) {
            signal.addEventListener(
                "abort",
                () => {
                    clearTimeout(timer);
                    reject(signal.reason ?? new Error("Aborted"));
                },
                { once: true },
            );
        }
    });
    return ok(`Waited ${seconds}s. Checking team status now.`);
}
```

execute 路由改为 `case "wait": return await handleWait(args, _signal);`。

**理由**：
- 与同项目 `question.ts:59-78` 完全一致的范式（`new Promise` + `signal.addEventListener("abort", ...)` + `{ once: true }`），项目内风格统一
- agent loop 天然 await 工具 Promise（已由 question.ts 验证），阻塞是 agent loop 的预期用法
- Promise resolve 后 agent loop 自动继续调用 LLM——天然实现「等 N 秒后检查状态」

**替代方案（已否决）**：
- 保留立即返回 + 改 leader prompt 强制停止 → 依赖 LLM 自律，不可靠（就是当前 bug 的根源）
- 保留 wakeUp 但改为 abort signal 触发 → 过度设计，当前无「提前唤醒」需求

### 决策 2：abort 时 reject（而非 resolve）

**选择**：abort 时 `reject(signal.reason ?? new Error("Aborted"))`，与 question.ts 一致。

**理由**：
- 项目内一致性（question.ts 先例）
- abort 发生时整个 agent run 要终止，reject 被 execute 的 `try/catch`（team.ts:255-257）捕获返回 `err(...)`，agent loop 随后因 signal aborted 而停止——返回值不会被 LLM 看到，reject 安全
- reject 语义比 resolve 更准确表达「被中断，非正常完成」

**替代方案（已否决）**：
- abort 时 resolve 返回 "Interrupted" 文本 → 语义模糊（像正常完成），且与 question.ts 不一致

### 决策 3：移除 wakeUp 机制（字段 + 赋值）

**选择**：
- `src/teams/types-v2.ts:257-260` 的 `TeamManagerRef` 移除 `wakeUp?: (msg: string) => void` 字段
- `src/server/index.ts:81-87` 移除 `opts.teamRef.wakeUp = (msg) => {...}` 整个赋值块

**理由**：
- grep 确认 wakeUp 仅 handleWait 的 setTimeout 自唤起使用，无其他调用方
- 阻塞化后 setTimeout 本身被移除，wakeUp 无存在意义
- 移除后 `TeamManagerRef` 简化为 `{ current: TeamManagerLike | null }`，语义更清晰
- 清理避免维护者误以为存在「外部唤醒」机制

**替代方案（已否决）**：
- 保留 wakeUp 字段备用 → 死代码，误导维护者
- 改 wakeUp 语义为「abort wait signal」→ 当前无需求，YAGNI

### 决策 4：handleWait 不再接收 teamRef 参数

**选择**：`handleWait` 签名从 `(teamRef, args)` 改为 `(args, signal)`，execute 路由从 `handleWait(opts.teamRef, args)` 改为 `await handleWait(args, _signal)`。

**理由**：
- 阻塞化后 handleWait 不需要 team manager 引用（纯 setTimeout）
- 解耦后 headless 模式也能正常 wait

**隐含前提（Oracle 评审补充）**：headless 可用的前提是 `server/index.ts:88` 的 fallback `opts.teamRef ?? { current: this.teamManager }` 创建的 teamManager 非 null（当前成立——server 初始化时总会创建 teamManager）。注意 execute 入口 `team.ts:181-182` 的 `if (!manager) return err(...)` 守卫位于 switch 之前，对 wait 同样生效。当前 headless 能越过守卫是因为 teamManager 非 null；若未来 headless 改为不创建 teamManager，wait 仍会被此守卫拦截。本次不改动该守卫（保持所有 action 一致的前置检查）。

### 决策 5：工具 description 措辞修正

**选择**：`team.ts:177` 的 wait 描述从：
```
"- wait: Pause for N seconds (default 30, max 300), then wake up to check team status. Use this instead of repeatedly calling read while members work."
```
改为：
```
"- wait: Block for N seconds (default 30, max 300), then resume to check team status. Use this instead of repeatedly calling read while members work. The agent loop is suspended during the wait."
```

**理由**：
- "wake up" 暗示异步回调机制（已移除），"resume" 更准确描述阻塞→恢复
- 明确「agent loop is suspended」让 LLM 理解 wait 期间它不会消耗调用

## Risks / Trade-offs

### 风险 1：阻塞期间占用一个工具执行 slot

- **风险**：wait 阻塞 N 秒（最多 300s），agent loop 挂起在 `await executeToolCalls`。若用户在阻塞期间想输入，agent 不响应。
- **缓解**：abort signal 覆盖——用户 ESC / 发新消息会触发 abort，wait 立即 reject 中断，agent run 终止后接受新输入
- **权衡**：这正是 wait 的预期语义（「我等一会儿」），与 question 工具阻塞等用户输入同构

### 风险 2：long-running wait 的资源占用

- **风险**：leader wait 300s 期间，成员仍在后台跑（各自独立 session），消耗 token。wait 本身不消耗 LLM 调用（Promise pending），但成员在跑。
- **缓解**：这是 team 模式的正常并发行为，wait 只控制 leader 不轮询；成员资源由各自的 maxTurns / 任务完成控制
- **权衡**：可接受——wait 的目的就是让 leader 别频繁 read 打扰，成员该跑还得跑

### 风险 2.5：timer resolve 与 abort reject 的竞态（Oracle 评审补充）

- **风险**：若 `setTimeout→resolve` 微任务先入队，随后 abort 事件触发 `clearTimeout`（timer 已 fire，clearTimeout 无效）+ `reject`——Promise 已 resolved，reject 被静默忽略，结果走 `ok()` 路径
- **分析**：此竞态**良性**。无论 Promise 采纳 resolve 还是 reject，abort 发生后 `signal.aborted === true`，pi-coding-agent 的 `executeToolCallsSequential`（agent-loop.js:290）的 `if (signal?.aborted) break` 仍会终止循环，leader 不会继续推进。两种终态下 agent run 都正确终止
- **权衡**：无需额外防护，竞态不导致错误行为

### 风险 3：TeamManagerRef.wakeUp 字段移除的破坏性

- **风险**：接口字段移除，若有外部代码读取 wakeUp 会编译失败
- **缓解**：grep 全仓确认共 **3 处**涉及 wakeUp：`types-v2.ts:259`（字段定义）、`server/index.ts:81`（赋值）、`team.ts:633`（读取），均在本次清理；`memory.ts`/`message.ts` 虽 import `TeamManagerRef` 但只读 `.current` 不读 `.wakeUp`，无外部消费者
- **权衡**：内部接口，破坏性可控

## Migration Plan

纯代码改动，无数据迁移。

**部署步骤**：
1. 合并到 main 后，下次 `bun run dev` / `serve` / `run` 自动生效
2. leader 调用 `wait` 后真正阻塞，行为立即正确
3. headless 模式下 wait 不再报 "Wake-up callback not available"

**回滚策略**：
- `git revert <merge-commit>` 即可
- 无持久化数据变更，无回滚风险

## Open Questions

1. **wait 期间是否应显示 TUI 状态？**
   - 影响：用户体验——wait 60s 期间 TUI 是否显示「waiting…」提示
   - 处置：本 change 不实现（TUI 层改动，超出范围）。当前 tool execution 期间 TUI 已显示 spinner，够用
   - 后续可选增强：通过 `_onUpdate` 回调推送 wait 进度

2. **是否需要 wait 期间响应 steer（成员消息）？**
   - 影响：成员在 leader wait 期间发来消息，leader 是否立即响应
   - 处置：本 change 不实现。wait 期间 leader 的 session 在执行工具，成员消息会 persist 到 inbox，leader wait 结束后 read 即可看到
   - 后续可选增强：若需要实时响应，应走 event-driven 中断机制（非 wakeUp 复活）
