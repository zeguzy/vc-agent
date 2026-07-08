# Design: activate-dcp

## Context

openagent 的 `src/dcp/` 目录是 Opencode-DCP v3.1.14 的部分移植：
- **已有**：config.ts（344行，类型完整）、compress/pipeline.ts（512行，压缩管道完整）、core/compress/search.ts（313行，搜索上下文完整）、core/state-types.ts（17行，stub）
- **缺失**：13 个核心模块（logger、token-utils、message-ids、adapter、messages×3、compress×3、state×2、prompts）+ nudge 注入系统

Pi SDK 提供 3 层 hook，全部可用：
- `transformContext`：每次 LLM 调用前拦截 AgentMessage[]，可修改后返回
- `systemPrompt`：每次 prompt 前可替换系统提示词
- `customTools`：工具注册

Opencode-DCP 的触发机制是三层 nudge + compress 工具，通过 `chat.messages.transform` hook 注入。我们需要适配到 Pi SDK 的 `transformContext`。

## Goals

- 补完 13 个缺失核心模块，使 pipeline.ts 可独立运行
- 移植 nudge 注入系统，实现三层渐进式压缩提示
- 接线 session.ts，使 DCP opt-in 可用
- compress 工具进入 Pi SDK 双名单（customTools + tools 白名单）
- 默认关闭，回滚安全

## Non-goals

- 不移植 deduplication/purgeErrors/turnProtection 策略
- 不替换 Pi SDK compaction
- 不修改 TUI 渲染层

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Pi SDK Agent                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │            transformContext (wrapped)              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────┐  │  │
│  │  │ adapter.ts  │→ │ inject.ts    │→ │ 返回     │  │  │
│  │  │ Pi→DCP 桥接 │  │ nudge 注入   │  │ 修改后   │  │  │
│  │  └─────────────┘  └──────────────┘  └──────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                        ↓                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │              compress 工具 (range/message)         │  │
│  │  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │  │
│  │  │ resolve  │→ │ allocate │→ │ persist + notify│  │  │
│  │  │ ranges   │  │ blockId  │  │                 │  │  │
│  │  └──────────┘  └──────────┘  └─────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         ↑                              ↑
         │                              │
┌─────────────────┐          ┌──────────────────────┐
│  session.ts     │          │  config.ts (holder)  │
│  三处接线点:     │          │  setDcpConfig()      │
│  - createRuntime│─────────→│  setDcpState()       │
│  - createSession│          │  isDcpEnabled()      │
│  - handleSetMode│          │  getDcpConfig()      │
└─────────────────┘          └──────────────────────┘
```

## Decisions

### D1: Path B — wrap transformContext（不改创建流程）

**选择**：createAgentSession 返回后，包装 `session.agent.transformContext`。

**理由**：
- createAgentSession 无 extensionFactories 参数，extension 从磁盘加载（不适合 opt-in 场景）
- Path B 最小侵入，不改 createAgentSession 签名
- DCP 关闭时（`isDcpEnabled() === false`）transformContext 透传，零开销

**风险**：Pi SDK transformContext 无类型声明，行为需运行时验证。缓解：防御性 try/catch + 降级。

### D2: 模块级 holder 解耦

**选择**：沿用 config.ts 已有的模块级 holder 模式（setDcpConfig/setDcpState/setDirectCompressFn 等）。

**理由**：
- 避免改 createAgentSession 签名（需传 DCP 依赖）
- holder 在 initDcpExtension 中初始化，在 compress pipeline / nudge inject 中读取
- 与现有代码风格一致

### D3: 三层 Nudge 注入

**选择**：在 transformContext wrap 内，每次 LLM 调用前：
1. **< minContextLimit**：静默，不注入任何 nudge
2. **turn 边界检测**：用户消息后第一个 assistant 响应完成时，注入 soft nudge
3. **iteration ≥ iterationNudgeThreshold**：距离上次用户消息超过 15 条，注入 soft nudge
4. **> maxContextLimit**：注入 strong nudge（MUST compress now）

**冷却**：compress 工具被调用后，清除所有 nudge 锚点（避免压缩循环 bug）。

**节流**：nudgeFrequency=5，每 5 次 LLM 调用最多注入 1 次。

### D4: Token 测量（含 provider 差异修复）

**选择**：从最近一条 assistant 消息的 token metadata 读取（input + output + reasoning + cacheRead + cacheWrite）。

**provider 差异修复**（PR#523）：
- 非 Anthropic provider：input 不含 cache，cacheRead ≈ 实际上下文大小
- 直接相加会双倍计数
- 修复：`cacheRead > input && input > 0` 时返回 cacheRead

### D5: compress 工具双名单

**选择**：compress 同时出现在 customTools 数组和 tools 白名单中。

**三处同步**：
- createRuntime factory：customTools.push(createCompressTool(...))，tools=["compress",...]
- createSession：同上
- handleSetAgentMode：重建 tools 白名单时保留 "compress"

### D6: DCP 与 compaction 共存

**选择**：DCP 优先，Pi SDK compaction 兜底。

**理由**：
- DCP 是模型自主压缩（更精准），compaction 是强制摘要（兜底）
- 两者不冲突：DCP 在 token 低时主动压缩，compaction 在 token 超限时兜底
- 用户可通过 settings.compaction 关闭 Pi SDK compaction，只留 DCP

### D7: adapter.ts — Pi SDK ↔ DCP 消息桥接

**选择**：新建 `src/dcp/adapter.ts`，实现两个函数：
- `toDcpMessages(messages: AgentMessage[]): WithParts[]`：Pi SDK 消息转 DCP 内部格式
- `fromDcpMessages(messages: WithParts[]): AgentMessage[]`：DCP 格式转回 Pi SDK

**消息 ID 策略**：Pi SDK AgentMessage 无稳定 ID，按 array index 生成 `m0001`/`m0002`/... 格式。

## Risks

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | Pi SDK transformContext 行为未知 | wrap 可能不生效 | 运行时验证 + 防御性降级 |
| R2 | 13 模块工作量大 | 单 change 评审风险高 | task 粒度 ≤2h，逐项 check |
| R3 | nudge 注入影响非 DCP 场景 | 意外压缩 | opt-in + isDcpEnabled 守卫 |
| R4 | provider 差异 token 计数不准 | 误触发或漏触发 nudge | D4 修复 + 运行时日志 |
| R5 | 压缩循环 bug | 压缩后立即再触发 | 冷却机制（compress 后清锚点） |
| R6 | 消息 ID 不稳定 | range/message 压缩错位 | array index 生成 + 压缩时锁定 |
| R7 | 并发 session 状态泄漏 | holder 模式全局状态 | openagent 单 session 设计，暂不处理 |

## Migration Plan

- **opt-in 默认关闭**：`contextPruning.enabled` 默认 `false`
- **回滚**：设置 `enabled: false`，transformContext wrap 透传，compress 工具从白名单移除
- **渐进启用**：用户手动开启后，首次压缩时观察日志（dcpDiag）
