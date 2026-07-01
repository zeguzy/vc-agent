## Why

终端会话中，用户经常需要撤回上一条消息并重新编辑（措辞不当、漏了上下文、想换个问法）。目前 openagent 没有任何撤销机制——消息一旦发送就不可逆，用户只能 `/clear` 全部重来或继续追加修正。`@earendil-works/pi-coding-agent` SDK 的会话树（session tree）已经原生支持分支式回退（`navigateTree` / `getUserMessagesForForking`），pi 自带的 `/tree` 命令就是建在其上的。openagent 应当提供更轻量的 `/undo` 快捷命令，把"回退到上一轮 + 重新编辑"收敛成一次操作。

最终设计目标是支持 `/undo` 到任意一条历史用户消息；本次 MVP 仅实现 `/undo`（无参数）撤销最近一轮对话。

## What Changes

- 新增 `/undo` 命令：撤销最近一轮对话（最后一条用户消息 + 其后的全部 assistant 回复/工具调用），把 leaf 指针移回上一轮结束的位置
- 被撤销的最后一条用户消息原文，自动填入输入框，供用户直接编辑后重发
- 撤销采用**分支式保留**（SDK `navigateTree` 在同一会话文件内移动 leaf）：被撤销的 turn 仍留在磁盘 JSONL 里，只是不在 active path 上，未来可用 `/tree` 找回
- 扩展 `CommandContext` 增加 `setInputText(text)` 能力，让任意命令可以向输入框注入文本（为 `/undo` 服务，也开放给未来命令）
- 扩展 `InputBox` 支持接收外部 `pendingInput` prop，把文本写入底层 TextareaRenderable

## Capabilities

### New Capabilities
- `tui-input` → 「Undo 命令」requirement：定义 `/undo` 的触发条件、撤销语义、边界处理、输入框回填行为
- `tui-input` → 「输入框外部文本填充」requirement：定义命令通过 `CommandContext.setInputText` 向输入框注入文本的机制

### Modified Capabilities
- `tui-input` → 「Slash Command」requirement：`命令执行` Scenario 的支持命令列表增加 `/undo`

## Impact

- `src/commands/registry.ts` — `CommandContext` 接口新增 `setInputText: (text: string) => void` 字段
- `src/tui/commands.ts` — `registerBuiltinCommands` 注册 `/undo` 命令
- `src/tui/components/InputBox.tsx` — `InputBoxProps` 新增 `pendingInput` prop；新增 useEffect 响应该 prop 把文本写入 textarea 并同步内部 `currentText`/`inputHeight` 状态
- `src/tui/App.tsx` — 新增 `pendingInput` state；`buildCommandCtx` 注入 `setInputText`；把 `pendingInput` 传给 `<InputBox>`
- `openspec/specs/tui-input/spec.md` — 新增两个 Requirement，修改 Slash Command 一个 Scenario

## Non-goals

- **不实现** `/undo <N>` 或 `/undo <entryId>` 撤销到任意历史消息（本次仅无参数撤销最近一轮；任意点撤销留待未来基于 `/tree` 扩展）
- **不实现**物理删除被撤销的 turn（仅分支式保留；`createBranchedSession` + `switchSession` 的物理截断路径本次不走）
- **不实现** redo（向前恢复）；被撤销的分支通过 pi 的 `/tree` 访问
- **不支持** HTTP 客户端模式：`/undo` 依赖 `client.getSession()` 拿到 `AgentSession` 对象调 `navigateTree`，而 `HttpClient.getSession()` 抛 `NotSupportedError`；命令检测到此情况给出降级提示，不静默失败
- **不修改** SDK：不绕过 `SessionManager` 的 append-only 约束，不手改 JSONL 文件
- **不处理** undo 正在流式输出的 turn（`isRunning === true` 时 `/undo` 直接拒绝并提示，避免破坏正在进行的 agent 循环）
