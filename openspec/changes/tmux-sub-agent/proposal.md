## Why

openagent 当前只能在单一 session 内自主工作，无法编排外部 code agent（如 opencode）作为 sub-agent 协同完成任务。用户希望 vcagent 自己运行在 tmux 里，通过分屏 + 控制能力管理多个 sub-agent session，方便统一调度、可视化查看和接管。opencode 自带完整的 HTTP SDK（`@opencode-ai/sdk` + `opencode serve`），输出结构化 JSON，无需 screen-scraping —— 这让"vcagent 控制 opencode"成为当前最可靠、价值最高的编排场景。

## What Changes

- **新增 TmuxController**：封装 tmux 二进制调用（split-window / send-keys / capture-pane / list-panes / kill-pane / respawn-pane），提供 `node:child_process` 同步/异步 API。检测 `$TMUX` 环境变量判断是否在 tmux 内
- **新增 vc-agent 自启 tmux 能力**：`runTui` 入口检测 `$TMUX`，不在 tmux 内时自动创建 session 并 attach（用户可配置开关，默认关闭避免意外行为）
- **新增 OpencodeAdapter**：通过 `@opencode-ai/sdk` 连接 `opencode serve` 实例，提供 `createSession` / `prompt` / `abort` / 订阅事件 四个核心操作，输出结构化 `Part[]`
- **新增 SubAgentService**：进程级 sub-agent 注册表，复用 `BackgroundJobService` 的生命周期模式（start → running → completed/error/cancelled），持有 `{ id, name, type, status, paneId?, httpSessionId?, lastOutput }`
- **新增 `tmux_agent` 工具**：让 vcagent 自主创建/查询/取消 sub-agent session，注册到 customTools + 双名单
- **新增 TUI sub-agent 视图**：list/switch 键盘快捷键 + 状态面板展示所有 sub-agent 的 name/type/status/lastOutput 摘要

## Capabilities

### New Capabilities

- `tmux-controller`: tmux 二进制控制层 —— 检测环境、分屏、发送按键、捕获输出、列举/销毁 pane 的同步封装
- `sub-agent-orchestration`: sub-agent 编排系统 —— SubAgentService 注册表 + OpencodeAdapter + `tmux_agent` 工具 + TUI 切换视图，覆盖 sub-agent 的创建/查询/取消/输出抓取全链路

### Modified Capabilities

- `agent-session`: `createRuntime` factory 和 `handleSetAgentMode` 的工具双名单需新增 `tmux_agent`；`STANDARD_ACTIVE_TOOLS` 和 `TEAM_ACTIVE_TOOLS` 同步加入
- `cli-entry`: `runTui` 入口新增 tmux 自启检测逻辑（可配置开关）
- `tui-layout`: 新增 sub-agent 状态面板组件和切换快捷键

## Impact

- **依赖**: 新增 `@opencode-ai/sdk`（HTTP 客户端，纯 TS，零原生编译）
- **配置**: `config.json` 新增 `tmux` 段（`autoStart`、`sessionName`）和 `subAgent` 段（`opencodeServeUrl`）
- **代码**:
  - 新增 `src/tmux/controller.ts`（TmuxController 封装）
  - 新增 `src/tmux/autostart.ts`（自启检测逻辑）
  - 新增 `src/agents/sub-agent-service.ts`（SubAgentService，参照 BackgroundJobService）
  - 新增 `src/agents/adapters/opencode.ts`（OpencodeAdapter）
  - 新增 `src/agents/adapters/types.ts`（SubAgentAdapter 接口，为后续扩展预留）
  - 新增 `src/tools/tmux-agent.ts`（工具定义）
  - 修改 `src/agent/session.ts`（双名单注册）
  - 修改 `src/server/index.ts`（AgentServer 持有 SubAgentService + handler 方法）
  - 修改 `src/client/types.ts` + `src/client/in-process.ts`（AgentClient 接口扩展）
  - 修改 `src/index.tsx`（runTui 自启检测）
  - 修改 `src/tui/App.tsx` + `src/tui/keymap.ts`（sub-agent 视图和快捷键）
  - 新增 `src/tui/components/SubAgentPanel.tsx`（状态面板）

## Non-goals

- ❌ Claude Code / Codex CLI adapter —— 首期只做 opencode，验证主路径可行后再扩展
- ❌ tmux 通用兜底 adapter（capture-pane + regex 状态检测）—— 首期 opencode 走 SDK 不需要 screen-scraping
- ❌ 多 opencode serve 实例端口管理 —— 首期固定单实例（用户配置 url），不做自动端口分配
- ❌ TUI 实时流式输出渲染 —— 首期 sub-agent 面板只展示 lastOutput 文本摘要，不做 token-by-token 流式
- ❌ sub-agent 之间消息传递 —— sub-agent 只与 vcagent 主 session 通信，互不感知
- ❌ sub-agent 持久化 —— vcagent 重启后 sub-agent session 丢失（opencode serve 侧 session 仍存活，可手动重连）
- ❌ 自动启动 `opencode serve` —— 用户需预先运行，或在配置里指定已运行的 serve url
- ❌ SSH 远程 tmux 控制 —— 首期只支持本地 tmux
- ❌ tmux 控制模式（`tmux -C`）事件流 —— 首期用轮询 capture-pane，简单可靠
- ❌ sub-agent 并发数量动态调度 —— 首期固定上限（复用 `MAX_BG_JOBS = 8`）
