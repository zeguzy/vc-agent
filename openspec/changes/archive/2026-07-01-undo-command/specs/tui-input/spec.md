## ADDED Requirements

### Requirement: Undo 命令

系统 SHALL 提供 `/undo` 命令，撤销最近一轮对话（最后一条用户消息 + 其后的全部 assistant 回复与工具调用），将当前会话的 leaf 指针移回上一轮结束的位置，并把被撤销的最后一条用户消息原文回填到输入框。

底层通过 `AgentSession.navigateTree(parentId)` 实现，其中 `parentId` 为最后一条用户消息 entry 的前驱 entry id（取自 `AgentSession.sessionManager.getEntry(id).parentId`）。撤销采用分支式保留——被撤销的 turn 仍保留在会话文件中，只是不在 active path 上，可通过 `/tree` 访问。

#### Scenario: 撤销最近一轮并回填输入框

- **WHEN** 当前会话存在至少一轮完整对话（即存在一条用户消息，且该消息有前驱 entry）
- **AND** 用户执行 `/undo` 命令
- **THEN** 系统 SHALL 调用 `AgentSession.navigateTree`，将 leaf 指针移至最后一条用户消息的前驱 entry
- **AND** 系统 SHALL 刷新消息列表，使其只反映从 root 到新 leaf 的路径
- **AND** 系统 SHALL 将被撤销的最后一条用户消息原文写入输入框，光标定位到文本末尾

#### Scenario: 空会话撤销

- **WHEN** 当前会话没有任何用户消息（`getUserMessagesForForking()` 返回空数组）
- **AND** 用户执行 `/undo` 命令
- **THEN** 系统 SHALL 追加一条 assistant 消息提示 "没有可撤销的对话。"
- **AND** 系统 SHALL NOT 修改 leaf 指针或输入框内容

#### Scenario: 撤销会话首条消息

- **WHEN** 最后一条用户消息是会话中的第一条 entry（其 `parentId` 为空）
- **AND** 用户执行 `/undo` 命令
- **THEN** 系统 SHALL 追加一条 assistant 消息提示 "已是会话开头，无法继续撤销。"
- **AND** 系统 SHALL NOT 修改 leaf 指针或输入框内容

#### Scenario: Agent 运行中拒绝撤销

- **WHEN** Agent 正在运行（`isRunning === true`）
- **AND** 用户执行 `/undo` 命令
- **THEN** 系统 SHALL 追加一条 assistant 消息提示 "Agent 正在运行，请先等待完成或 /abort。"
- **AND** 系统 SHALL NOT 修改 leaf 指针或输入框内容

#### Scenario: navigateTree 被取消

- **WHEN** `/undo` 调用 `navigateTree` 后返回 `{ cancelled: true }`
- **THEN** 系统 SHALL 追加一条 assistant 消息提示 "已取消撤销。"
- **AND** 系统 SHALL NOT 回填输入框

#### Scenario: HTTP 客户端模式降级

- **WHEN** `client.getSession()` 抛出 `NotSupportedError`（HTTP 远程模式不支持直接访问 AgentSession）
- **AND** 用户执行 `/undo` 命令
- **THEN** 系统 SHALL 追加一条 assistant 消息提示 "/undo 仅在本地模式可用。"
- **AND** 系统 SHALL NOT 崩溃

#### Scenario: 连续多次撤销

- **WHEN** 用户连续执行多次 `/undo` 命令
- **THEN** 每次执行 SHALL 撤销当前 active path 上的最后一轮对话
- **AND** 每次 SHALL 把对应的用户消息原文回填输入框（覆盖上一次回填内容）

#### Scenario: 撤销后重发产生新分支

- **WHEN** 用户执行 `/undo` 后，编辑或不编辑输入框中的回填文本并按 Enter 发送
- **THEN** 系统 SHALL 从当前 leaf（即上一轮结束点）追加新的用户消息 + 触发新的 assistant 回复
- **AND** 被撤销的旧分支 SHALL 仍保留在会话文件中

### Requirement: 输入框外部文本填充

系统 SHALL 允许命令通过 `CommandContext.setInputText(text: string)` 向输入框注入文本，供命令将操作结果回填到编辑区供用户继续编辑。

注入通过 `pendingInput: { text: string; nonce: number } | null` 对象在 App 与 InputBox 间传递：App 持有该 state，命令调用 `setInputText` 时创建新对象（nonce 取 `Date.now()`），InputBox 监听 `pendingInput.nonce` 变化执行写入。nonce 机制保证两次注入相同文本也能触发。

#### Scenario: 命令注入文本

- **WHEN** 命令 handler 调用 `ctx.setInputText(text)`
- **THEN** 系统 SHALL 把 `text` 写入输入框底层 TextareaRenderable
- **AND** 系统 SHALL 把光标移动到文本末尾
- **AND** 系统 SHALL 同步输入框内部 `currentText` 状态与高度计算

#### Scenario: 注入清空历史导航状态

- **WHEN** 输入框接收到外部文本注入
- **THEN** 系统 SHALL 重置历史导航状态（`historyIndex = -1`、`savedDraft = null`）
- **AND** 系统 SHALL NOT 将注入的文本视为历史导航选中的草稿

#### Scenario: 连续注入相同文本

- **WHEN** 命令连续两次调用 `setInputText("相同内容")`
- **THEN** 第二次注入 SHALL 同样生效（因 `nonce` 不同，`useEffect` 重新触发）

## MODIFIED Requirements

### Requirement: Slash Command

系统 SHALL 支持以 `/` 开头的命令输入，提供自动补全建议列表和命令分发。

#### Scenario: 命令建议

- **WHEN** 用户输入 `/` 开头的内容
- **THEN** 系统 SHALL 在输入框上方显示匹配的命令建议列表（命令名 + 描述），当前选中项用 `▶` 标记

#### Scenario: 建议导航

- **WHEN** 建议列表可见且用户按 `↑`/`↓`
- **THEN** 系统 SHALL 上下移动选中项

#### Scenario: Tab 补全

- **WHEN** 建议列表可见且用户按 Tab
- **THEN** 系统 SHALL 将选中命令补全到输入框（`/command ` 格式）

#### Scenario: 命令执行

- **WHEN** 用户在 `/` 开头时按 Enter
- **THEN** 系统 SHALL 执行匹配的选中命令（通过 `matchCommands` 解析），不发送给 Agent
- **AND** 支持的命令：`/clear`、`/compact`、`/model`、`/thinking`、`/context`、`/exit`、`/help`、`/setting`、`/undo`

#### Scenario: /setting 打开设置页面

- **WHEN** 用户执行 `/setting` 命令
- **THEN** 系统 SHALL 触发 App 顶层 `view` 切换为 `"settings"`，整屏渲染设置页面（详见 `settings` capability 的 "/setting 设置页面" requirement）
