## MODIFIED Requirements

### Requirement: Vim 模式系统
系统 SHALL 支持 INSERT 和 NORMAL 两种模式，通过声明式 keymap（`src/tui/keymap.ts`）路由键盘事件。模式状态 SHALL 使用 `modeRef.current` 和 `isRunningRef.current` 在 `useKeyboard` 回调中读取，避免闭包过期问题。

#### Scenario: INSERT 模式（默认）
- **WHEN** 应用启动
- **THEN** 模式 SHALL 为 INSERT，Textarea 获取焦点，边框颜色为 `borderActive`，placeholder 显示 `Message openagent…  / for commands`

#### Scenario: INSERT → NORMAL
- **WHEN** 用户在 INSERT 模式下按 Escape
- **THEN** 模式 SHALL 切换为 NORMAL，Textarea 失去焦点，边框颜色变为 `borderSoft`，placeholder 显示 `Press i to type`

#### Scenario: NORMAL → INSERT
- **WHEN** 用户在 NORMAL 模式下按 `i`、`a` 或 `o`
- **THEN** 模式 SHALL 切换为 INSERT，Textarea 获取焦点

#### Scenario: NORMAL 模式滚动
- **WHEN** 用户在 NORMAL 模式下按 `j`（下）、`k`（上）、`g`（顶部）、`G`（底部）
- **THEN** 系统 SHALL 调用 `scrollRef.current.scrollBy()` 或 `scrollTo()` 滚动消息列表

#### Scenario: 状态行不显示快捷键
- **WHEN** 渲染 InputBox 顶部状态行
- **THEN** 系统 SHALL 仅在左侧显示 cwd/git 路径信息，右侧 SHALL 留白
- **AND** 系统 SHALL 不渲染任何模式快捷键提示文案（包括 INSERT 空闲、INSERT 运行中、NORMAL 三种状态的提示）
- **AND** 快捷键信息 SHALL 仅通过 `/help` 命令提供（见 "Help 命令输出" requirement）

### Requirement: 消息队列
系统 SHALL 在 Agent 运行期间允许用户继续输入并提交消息，通过 `session.followUp(text)` 将消息排队，而非禁用输入。

#### Scenario: Agent 运行时提交
- **WHEN** `isRunningRef.current` 为 true 且用户提交消息
- **THEN** 系统 SHALL 创建用户消息（`queued: true` 标记），调用 `session.followUp(text)` 排队消息，不清空输入框禁用

#### Scenario: 输入框始终可用
- **WHEN** Agent 正在运行
- **THEN** Textarea SHALL 保持可用（可输入、可提交），placeholder 显示 `Queue a message…`

#### Scenario: 排队消息转正
- **WHEN** 收到 `agent_start` 事件（Agent 开始处理排队消息）
- **THEN** 系统 SHALL 将所有 `queued: true` 的消息标记为 `queued: false`，移入正常消息流

## ADDED Requirements

### Requirement: Help 命令输出
系统 SHALL 在用户执行 `/help` 命令时，输出由"命令列表"和"快捷键"两部分组成的帮助信息，作为获取操作指引的唯一入口。

#### Scenario: 命令列表动态生成
- **WHEN** 渲染 `/help` 输出的命令列表部分
- **THEN** 系统 SHALL 从 `slashCommands` 数组（`src/tui/commands.ts`）动态遍历生成，而非硬编码字符串
- **AND** 每条命令 SHALL 显示命令名与对应 description

#### Scenario: 完整命令列表
- **WHEN** 用户执行 `/help`
- **THEN** 输出 SHALL 列出全部已注册命令：`/clear`、`/compact`、`/model`、`/thinking`、`/context`、`/exit`、`/help`

#### Scenario: 快捷键小节内容
- **WHEN** 用户执行 `/help`
- **THEN** 输出 SHALL 包含独立的快捷键小节，分两组列出：
- INSERT 模式：Enter 发送、Shift+Enter 换行、Esc 进入 NORMAL、Ctrl+C 中断/退出（连按两次强制退出）
- NORMAL 模式：i/a/o 进入 INSERT、j/k 上下滚动、g/G 顶/底、t 折叠 thinking

#### Scenario: 帮助文案集中维护
- **WHEN** 实现 `/help` 输出
- **THEN** 拼接逻辑 SHALL 位于 `src/tui/commands.ts` 的导出函数（如 `buildHelpText()`），App.tsx 仅负责调用并包装为 assistant 消息
