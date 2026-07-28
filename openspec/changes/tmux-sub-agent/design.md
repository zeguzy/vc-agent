## Context

openagent 当前是单 session 架构：一个 Pi SDK `AgentSession` 跑 agent loop，TUI 通过 `InProcessClient` 直连 `AgentServer`。`BackgroundJobService` 已实现 detached 后台任务模式（start → running → completed/error/cancelled），但只服务于 vcagent 内部的 subagent 工具（同样是 Pi SDK session）。

用户需求是让 vcagent 编排**外部** code agent（首期 opencode）作为 sub-agent。opencode 自带 `opencode serve` HTTP 服务 + `@opencode-ai/sdk` 类型安全客户端，输出结构化 `Part[]`（text/tool_call/tool_result/file/error），完全不需要 screen-scraping。同时用户希望 vcagent 自己跑在 tmux 里，利用分屏能力做人类可视化/接管。

现有可复用基础设施：
- `BackgroundJobService`（`src/background/service.ts`）— 生命周期模式参照
- `tools/subagent.ts` — 工具定义模板
- `client/types.ts:AgentClient` — TUI → server 接口扩展点
- `session.ts` 双名单注册（`STANDARD_ACTIVE_TOOLS` + `createRuntime` factory + `handleSetAgentMode`）

约束：
- 项目用 `node:child_process`（非 `Bun.spawn`，tsconfig 不含 Bun 全局）
- `useKeyboard` 闭包陈旧值坑（必须 `xxxRef.current`）
- OSC passthrough（tmux 内终端序列需包 `\x1bPtmux;\x1b...\x1b\\`）

## Goals / Non-Goals

**Goals:**
- vcagent 能在 tmux 内运行（检测 + 可选自启）
- vcagent 能通过 `tmux_agent` 工具自主创建/查询/取消 opencode sub-agent session
- sub-agent 输出通过 `@opencode-ai/sdk` 拿到结构化 JSON（非 screen-scraping）
- TUI 提供 sub-agent 列表面板，键盘切换查看状态
- tmux 分屏能力封装为通用 TmuxController（为后续 claude/codex/tmux-generic adapter 预留）

**Non-Goals:**
- 不做 claude/codex/tmux-generic adapter（首期只 opencode）
- 不做 sub-agent 间通信、持久化、自动 serve 启动
- 不做 tmux control mode 事件流（首期轮询）
- 不做 TUI 实时流式渲染（首期 lastOutput 摘要）

## Decisions

### 决策 1：自己封装 tmux 二进制，不用 npm 包

**选择**：自己封装 `node:child_process.execSync` 调 tmux 命令（~200 行 TS）。

**理由**：
- `node-tmux`：8⭐，2018 年最后更新，6 年未维护，不支持 split-pane/capture-pane
- `tmux-manager`：0⭐，2026-07 刚发布，API 设计合理但完全未经验证
- `tmux-control-mode-js`：0⭐，技术方向好（control mode 事件驱动）但同样未验证，且要求 tmux ≥ 3.2
- 自己封装零依赖、完全可控、覆盖 tmux 3.0+ 全版本

**替代方案**：依赖 `tmux-manager`（风险：0⭐，bug 无社区兜底）

### 决策 2：opencode 走 HTTP SDK，不走 tmux send-keys 抓输出

**选择**：`@opencode-ai/sdk` + `opencode serve`。

```
数据流（opencode 路径）:
┌─────────────────────────────────────────────────────────────┐
│  vcagent 主 session (Pi SDK AgentSession)                    │
│    │                                                          │
│    │ 调用 tmux_agent 工具                                      │
│    ▼                                                          │
│  SubAgentService.start({type:"opencode", prompt})            │
│    │                                                          │
│    │ 创建 OpencodeAdapter                                     │
│    ▼                                                          │
│  OpencodeAdapter ──HTTP──► opencode serve (:4096)            │
│    │  client.session.create()         │                       │
│    │  client.session.prompt()  ◄──────┤ SSE 事件流           │
│    │  client.session.abort()           │ {Part[]}             │
│    ▼                                  │                       │
│  SubAgentSession {id, httpSessionId, lastOutput}              │
│    │                                                          │
│    │ 更新 ActiveJob.output                                    │
│    ▼                                                          │
│  TUI SubAgentPanel 渲染 status + lastOutput 摘要              │
└─────────────────────────────────────────────────────────────┘
```

**理由**：
- SDK 输出结构化 `Part[]`，每个 part 有 `type`（text/tool_call/tool_result/file/error），零解析成本
- tmux send-keys + capture-pane 是 screen-scraping，opencode TUI 输出混合 ANSI 渲染序列 + spinner，抓结构化输出极难
- SDK 自带 SSE 实时事件流（token 级），无需轮询

**替代方案**：tmux pane 跑 opencode 交互模式（人类可看，但程序化抓输出靠 regex，脆弱）

### 决策 3：tmux 控制层与 sub-agent 编排解耦

**选择**：`TmuxController`（纯 tmux 操作）和 `SubAgentService`（sub-agent 生命周期）分离。

```
模块依赖:
src/tmux/controller.ts        ─── 纯 tmux 二进制封装，无业务依赖
src/tmux/autostart.ts         ─── 依赖 controller，runTui 入口调用
src/agents/adapters/types.ts  ─── SubAgentAdapter 接口
src/agents/adapters/opencode.ts ── 实现 SubAgentAdapter，依赖 @opencode-ai/sdk
src/agents/sub-agent-service.ts ── 依赖 adapters，参照 BackgroundJobService 模式
src/tools/tmux-agent.ts       ─── 依赖 sub-agent-service + controller
```

**理由**：
- TmuxController 可独立用于其他场景（通知系统、剪贴板增强）
- SubAgentService 不强依赖 tmux（opencode 走 HTTP 不需要 tmux pane）
- 未来 claude/codex adapter 可选择是否用 tmux pane（headless spawn 或交互式）

### 决策 4：新建 SubAgentService，不继承 BackgroundJobService

**选择**：新建 `SubAgentService` 类，接口设计参照 `BackgroundJobService`（同样的 start/cancel/list/get/dispose 模式），但不继承。

**理由**：
- `BackgroundJobService.StartJobOpts` 要求 `session: AgentSession`（Pi SDK 类型）
- sub-agent 的"session"是 opencode HTTP session（string id），类型不兼容
- 强行继承会导致泛型污染或 `any` 类型（违反项目 noExplicitAny 约定）

**接口设计**：
```typescript
interface SubAgentSession {
    id: string;                    // vcagent 侧唯一 ID
    name: string;                  // 人类可读名
    type: "opencode";              // 首期只有 opencode，预留扩展
    status: "running" | "completed" | "error" | "cancelled";
    startedAt: number;
    completedAt: number | null;
    httpSessionId?: string;        // opencode session ID
    paneId?: string;               // tmux pane（可选，用于可视化）
    lastOutput: string | null;     // 最后一次结构化输出摘要
    error: string | null;
}
```

### 决策 5：send-keys 两次调用模式

**选择**：`tmux send-keys -t <pane> -l "<text>"` + `tmux send-keys -t <pane> Enter`。

**理由**：
- `-l`（literal）模式把参数当字面文本，否则 tmux 会解释按键名（"Enter"/"Space"/"Escape" 会被当按键）
- 必须分两步：先发文本，再发回车
- 参考 swarmux 的实现（纯 bash 脚本，send-message.sh 标准做法）

### 决策 6：自启 tmux 默认关闭

**选择**：`config.json` 的 `tmux.autoStart` 默认 `false`。

**理由**：
- 强制进 tmux 是意外行为（用户可能在自己的终端环境里不想被接管）
- 用户显式开启才自启：`"tmux": {"autoStart": true, "sessionName": "vcagent"}`
- 检测到已在 tmux 内（`$TMUX` 非空）时跳过自启逻辑

### 决策 7：SubAgentAdapter 接口预留扩展

**选择**：定义抽象接口，OpencodeAdapter 实现它。

```typescript
interface SubAgentAdapter {
    createSession(name: string): Promise<{ sessionId: string }>;
    prompt(sessionId: string, text: string): Promise<{ output: string; parts: unknown[] }>;
    abort(sessionId: string): Promise<void>;
    subscribe(sessionId: string, handler: (event: AdapterEvent) => void): () => void;
    dispose(sessionId: string): Promise<void>;
}
```

**理由**：未来 ClaudeAdapter（`claude -p --output-format json`）/ CodexAdapter（`codex exec --json`）实现同一接口，SubAgentService 无需改动。

## Risks / Trade-offs

- **[风险] opencode serve 未运行** → `OpencodeAdapter` 初始化时探测 `baseUrl` 连通性，失败时 `tmux_agent` 工具返回 `isError: true` + 明确错误信息（"opencode serve 未启动，请先运行 `opencode serve`"），引导用户。不做自动启动（Non-goals）

- **[风险] opencode SDK 版本漂移** → `@opencode-ai/sdk` 锁定版本，CI 跑 `bun run check` 验证类型。SDK 是纯 TS 客户端，无原生编译，升级成本低

- **[风险] sub-agent 并发过多压垮 opencode serve** → 复用 `MAX_BG_JOBS = 8` 作为 sub-agent 并发上限。超限时 `tmux_agent` 工具返回 `isError`，由主 agent 决定 retry 时机（参照 WorkerPool 模式）

- **[风险] tmux 不存在或版本过低** → TmuxController 构造时探测 `tmux -V`，失败时降级为 no-op + 日志警告。自启逻辑跳过，不影响 vcagent 正常运行

- **[权衡] 轮询 vs 事件流** → 首期 opencode 走 SDK SSE（事件驱动，无轮询）；tmux capture-pane 路径（Non-goals 范围）才需要轮询。当前架构不引入轮询开销

- **[权衡] sub-agent 不持久化** → vcagent 重启后 sub-agent 注册表清空，但 opencode serve 侧 session 仍存活（可手动重连）。后续可加 `listRemoteSessions()` 恢复，首期不做

- **[风险] useKeyboard 闭包陈旧值** → 新增 sub-agent 视图的键盘逻辑必须通过 `subAgentsRef.current` / `activeSubAgentIdRef.current` 读取实时状态（AGENTS.md 约定），不直接读 state

- **[风险] OSC passthrough 干扰** → TmuxController 输出终端序列时检测 `$TMUX`，必要时包装 `\x1bPtmux;\x1b...\x1b\\`（参照 `tui/utils/clipboard.ts:16-18` 已有实现）
