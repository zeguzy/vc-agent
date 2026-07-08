# Design: unified-tool-display

## Context

openagent 的 TUI 展示层在 4 个位置涉及工具/MCP 信息：

```
┌─────────────────────────────────────────────┐
│  MessageList                                │
│    ToolMessageView → formatToolDetail()     │ ← 改动 #4: 加 case "mcp"
│                      default → 裸工具名       │
├─────────────────────────────────────────────┤
│  InputBox                                   │
│    状态行: mode · model · path · branch      │ ← 改动 #1: 加 ⊙ N MCP
├─────────────────────────────────────────────┤
│  /mcp status → [connected] github (15 tools)│ ← 改动 #3: 改为 ✓ 图标
│  /tools (不存在)                             │ ← 改动 #2: 新建命令
└─────────────────────────────────────────────┘
```

## Goals

- MCP 工具调用在消息流中可辨识（server + tool name + 参数摘要）
- InputBox 状态行一眼看出 MCP 连接健康度
- `/tools` 命令提供统一概览（活跃工具 + MCP servers）
- `/mcp status` 输出风格与 opencode 对齐（图标）

## Decisions

### Decision 1: InputBox 指示器用 polling + App 层派生

MCP 连接状态变化频率低（启动时连接，之后基本稳定）。用 pollManager 的轮询机制（每 5s）即可，不需要事件订阅。

**关键**：不传 mcpManager 给 InputBox（保持组件边界纯淨）。在 App.tsx 注册 poll task，返回 **primitive string key**（`"${total}:${hasFailed}"`）而非原始数组——PollManager 的变更检测用 `!==`，而 `getConnectionStatus()` 每次返回新对象，直接 poll 会导致每 5s 必然 re-render。

```ts
pollManager.register("mcp-status", () => {
  const statuses = mcpManager?.getConnectionStatus() ?? [];
  const total = statuses.length;
  const hasFailed = statuses.some(s => s.status === "failed");
  return `${total}:${hasFailed}`;
}, 5000);
```

InputBox 接收 `mcpStatus?: { total: number; hasFailed: boolean }` prop（App 从 poll state 解析后传入）。

**格式**: `⊙ N MCP`（N = total server count）
- 绿色 `⊙`: 无 failed（全 connected/cached）
- 红色 `⊙`: 有 server failed
- 不显示: 0 server 或 mcpManager undefined

### Decision 2: `/tools` 命令分两段展示

```
$ /tools

Tools (standard mode):
  read  bash  write  grep  find  lsp  glob  edit
  todo  question  subagent  webfetch

MCP Servers:
  ✓ github          15 tools   remote
  ✓ filesystem       8 tools   local
  ⚠ postgres         0 tools   failed — Connection timeout

3 servers · 2 connected · 1 failed
```

内置工具用空格分隔的单词列表（紧凑），MCP servers 用图标对齐列表。

### Decision 3: `/mcp status` 图标映射

| 状态 | 当前 | 改后 | 说明 |
|------|------|------|------|
| connected | `[connected]` | `✓` | 绿色 |
| cached | `[cached]` | `○` | 黄色（后台刷新中） |
| connecting | `[connecting]` | `◌` | 黄色（spinner 风格） |
| failed | `[failed]` | `✗` | 红色 + 内联错误 |

附加 type hint（remote/local）从 mcpManager 的 server config 获取。

### Decision 4: formatToolDetail MCP 参数提取（独立函数）

MCP 工具调用的参数结构: `{ server_name: string, tool_name: string, arguments: object }`

提取逻辑提取为独立函数 `formatMcpArgs(args)`，不内联在 switch case 中（可维护性 + 可测试性）：

```ts
const SENSITIVE_KEYS = /key|token|secret|password|auth|credential|private|bearer|cookie|session/i;

function formatMcpArgs(args: Record<string, unknown>): { label: string; lines: string[] } {
  const serverName = String(args.server_name ?? "");
  const toolName = String(args.tool_name ?? "");
  const inner = (args.arguments ?? {}) as Record<string, unknown>;
  const lines = Object.entries(inner)
    .filter(([k, v]) => typeof v !== "object" && v !== null && !SENSITIVE_KEYS.test(k))
    .slice(0, 3)
    .map(([k, v]) => `${k}=${String(v).slice(0, 50)}`);
  return { label: `${serverName} · ${toolName}`, lines };
}
```

**边界处理**：
- `arguments` 为 undefined → inner = `{}`，lines = []
- 嵌套对象/数组 → 跳过（`typeof v !== "object"` 过滤）
- 敏感 key（含 key/token/secret/password/auth/credential/private/bearer/cookie/session）→ 跳过

### Decision 5: 新增 formatToolDetail cases

| 工具 | label | lines |
|------|-------|-------|
| `glob` | `glob` | `[pattern, path?]` |
| `webfetch` | `webfetch` | `[url]` |
| `question` | `question` | `[headers.join(", ")]` |
| `todo` | `todo` | `[action]` |
| `notify` | `notify` | `[title]` |

其他未列出的工具（`team`, `memory`, `message`）继续走 `default` 分支。

## Risks

### Risk 1: MCP status poll 增加开销

`getConnectionStatus()` 如果内部有 I/O 操作可能造成卡顿。

**缓解**: getConnectionStatus() 已是同步内存读取（读 Map），无 I/O。poll 间隔 5s 足够。

### Risk 2: MCP 参数摘要泄露敏感信息

arguments 可能含 API key 等敏感数据。

**缓解**: value 截断到 50 字符 + 只取前 3 个 key + key 名以常见敏感词（key, token, secret, password）过滤。

## Migration

纯展示层改动，无数据迁移。用户无需修改配置。

## Open Questions

无。所有 4 个改动点已明确。
