# Proposal: unified-tool-display

## Why

当前 MCP 和内置工具的展示层存在 3 个问题：

1. **消息流中 MCP 调用无详情** — `formatToolDetail()` 的 `default` 分支把 `mcp`、`glob`、`webfetch` 等工具调用渲染为裸工具名（`label: "mcp", lines: []`），无法看出调用了哪个 server/tool。
2. **`/mcp status` 使用纯文本标签** — `[connected]`、`[cached]` 等方括号标签不如 opencode 的 `✓/✗/○/⚠` 图标直观。
3. **缺少统一工具概览** — 没有 `/tools` 命令，用户无法在一处查看当前模式可用工具 + MCP server 状态。
4. **InputBox 状态行无 MCP 信息** — 底部 `code · gpt-4o · myproject · main` 缺少 MCP 连接状态指示器。

## What Changes

1. **InputBox MCP 指示器** — 状态行末尾追加 `⊙ N MCP`，绿色=全部连接、红色=有失败。0 server 时不显示。
2. **`/tools` 命令** — 新注册命令，一屏展示当前模式活跃工具 + MCP server 列表（含 `✓/✗/○` 图标 + 类型 + tool count）。
3. **`/mcp status` 风格对齐** — `[connected]` → `✓`，`[cached]` → `○`，`[failed]` → `✗`，附加 type hint（remote/local）。
4. **`formatToolDetail()` 扩展** — 新增 `case "mcp"`（提取 server_name + tool_name）、`case "glob"`（pattern + path）、`case "webfetch"`（url），替换裸 `default` 分支。

## Capabilities

### NEW: unified-tool-display

统一的工具/MCP 展示层，包含 InputBox 指示器、`/tools` 命令、`/mcp status` 风格、消息流工具详情提取。

### MODIFIED: tui-messages

`formatToolDetail()` 扩展，新增 `mcp`/`glob`/`webfetch` 等 case，消息流中 MCP 调用不再显示为裸 `mcp` 标签。

### MODIFIED: mcp

`/mcp status` 命令输出格式更新为图标风格。

## Impact

| 文件 | 改动 |
|------|------|
| `src/tui/components/InputBox.tsx` | 状态行加 MCP 指示器，需从 App 接收 mcpManager 或 connection summary |
| `src/tui/App.tsx` | 传 mcpManager 给 InputBox（已有 mcpManager 实例） |
| `src/tui/commands.ts` | 新增 `/tools` 命令，重写 `/mcp status` 输出格式 |
| `src/tui/components/MessageList.tsx` | `formatToolDetail()` 新增 case |

向后兼容：无 breaking change，纯展示层改动。

## Non-goals

- **不**实现 opencode 的 InlineTool/BlockTool 双模式渲染（当前所有工具统一用 top-border box，不区分内联/块级）——这是一个更大的重构。
- **不**实现工具结果的折叠/展开（collapsibility）——保持当前固定 max 15 行截断。
- **不**实现 opencode 的侧边栏 MCP 面板——openagent 没有 sidebar 组件。
- **不**实现 MCP 工具命名的 `{server}_{tool}` 自动拆分——保持当前 `server_name + tool_name` 参数格式。
- **不**修改工具执行逻辑——仅改展示层。
