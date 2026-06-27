# tui-input Specification

## Purpose
定义底部输入区的编辑、提交、模式切换、消息队列、slash command 和状态提示行为。
## Requirements
### Requirement: OpenTUI Textarea 组件集成
系统 SHALL 使用 OpenTUI 的 Textarea 组件（`@opentui/core` 的 `TextareaRenderable`）处理用户输入，支持多行草稿编辑。

#### Scenario: 输入字符
- **WHEN** 用户在 INSERT 模式下按下可打印字符键
- **THEN** 字符追加到 Textarea 当前内容，显示更新

#### Scenario: 退格删除
- **WHEN** 用户按下退格键（Backspace）
- **THEN** Textarea 删除光标前的字符，光标左移

#### Scenario: 多行草稿高度增长
- **WHEN** 用户通过换行创建多行草稿
- **THEN** 输入区高度 SHALL 随行数增长，并限制在 2 到 6 行之间

#### Scenario: 提交输入
- **WHEN** 用户在 INSERT 模式下按下 Enter 键
- **THEN** Textarea 当前内容 SHALL 作为消息提交，触发 `handlePrompt(text)`，然后清空输入区

#### Scenario: 插入换行
- **WHEN** 用户按下 Shift+Enter
- **THEN** Textarea SHALL 插入换行，不提交消息

#### Scenario: 备用提交快捷键
- **WHEN** 用户按下 Ctrl+Enter 或 Meta+Enter
- **THEN** Textarea 当前内容 SHALL 作为消息提交

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
- **AND** 支持的命令：`/clear`、`/compact`、`/model`、`/thinking`、`/context`、`/exit`、`/help`、`/setting`

#### Scenario: /setting 打开设置页面
- **WHEN** 用户执行 `/setting` 命令
- **THEN** 系统 SHALL 触发 App 顶层 `view` 切换为 `"settings"`，整屏渲染设置页面（详见 `settings` capability 的 "/setting 设置页面" requirement）

### Requirement: CommandRegistry 命令注册表
系统 SHALL 通过 `CommandRegistry` 类管理所有 slash 命令，支持运行时注册、注销和查询。

#### Scenario: 注册表单例
- **WHEN** 应用启动
- **THEN** 系统 SHALL 通过 `registerBuiltinCommands()` 将内置命令注册到全局 `commandRegistry`
- **AND** 注册表 SHALL 通过 `get(name)` / `getAll()` / `match(input)` / `execute(name, args, ctx)` 提供查询和分发

#### Scenario: 阻止重复注册
- **WHEN** 尝试注册已存在的命令名
- **THEN** `register()` SHALL 抛出 `Error`，除非使用 `registerOrReplace()`

#### Scenario: 命令上下文
- **WHEN** 执行命令 handler
- **THEN** handler 接收 `CommandContext` 对象，包含 `session`、`skillManager`、`messages`、`setMessages`、`setIsRunning` 等

### Requirement: 技能管理命令
系统 SHALL 提供 `/skills`、`/load-skill`、`/unload-skill` 三个命令来管理技能生命周期。

#### Scenario: 列出技能
- **WHEN** 用户执行 `/skills`
- **THEN** 输出 SHALL 分为 auto（自动加载）和 dynamic（动态加载）两组，显示技能名称、描述、调用方式
- **AND** 显示默认的全局和项目技能目录路径

#### Scenario: 动态加载技能
- **WHEN** 用户执行 `/load-skill <path>` 且路径存在有效的 SKILL.md
- **THEN** 系统 SHALL 通过 `SkillManager.loadDynamicSkill(path)` 加载技能并注入到 ResourceLoader
- **AND** 返回技能名称、描述和调用方式

#### Scenario: 加载无效路径
- **WHEN** 用户执行 `/load-skill <path>` 但路径不存在或不包含 SKILL.md
- **THEN** 系统 SHALL 显示明确错误信息

#### Scenario: 卸载动态技能
- **WHEN** 用户执行 `/unload-skill <name>` 且该技能之前通过动态加载
- **THEN** 系统 SHALL 从 `SkillManager` 动态列表中移除该技能

#### Scenario: 卸载不存在的技能
- **WHEN** 用户执行 `/unload-skill <name>` 但该技能不存在或不是动态加载的
- **THEN** 系统 SHALL 显示提示信息，并建议用 `/skills` 查看

### Requirement: 中断处理
系统 SHALL 通过 `useKeyboard` 监听 Ctrl+C，在不同状态下产生不同行为。

#### Scenario: Agent 运行中中断
- **WHEN** Agent 正在生成响应时用户按下 Ctrl+C
- **THEN** 调用 `session.abort()` 中断当前 Agent 循环，停止流式输出

#### Scenario: 空闲时退出
- **WHEN** Agent 空闲时用户按下 Ctrl+C
- **THEN** 退出 alternate screen，终止程序

#### Scenario: 连续两次 Ctrl+C 强制退出
- **WHEN** 用户在 1 秒内连续按两次 Ctrl+C
- **THEN** 立即调用 `process.exit(0)` 强制退出

### Requirement: 圆角边框样式
系统 SHALL 为输入框边框使用 `borderStyle="rounded"`（`╭╮╰╯` 圆角字符）。

#### Scenario: 边框渲染
- **WHEN** 渲染输入框
- **THEN** 四边边框 SHALL 使用圆角样式，边框颜色根据模式变化（INSERT: `borderActive`，NORMAL: `borderSoft`）

#### Scenario: 内层背景
- **WHEN** 渲染输入框
- **THEN** 外层 box SHALL 只包含边框，内层嵌套 box SHALL 包含 `backgroundColor`（`backgroundInset`）和 padding，确保背景色不溢出边框字符

### Requirement: Thinking 折叠
系统 SHALL 在 NORMAL 模式下通过 `t` 键切换 AI 思考内容的折叠/展开状态。

#### Scenario: 默认展开
- **WHEN** 应用启动
- **THEN** thinking 折叠状态 SHALL 为展开（`thinkingCollapsed: false`）

#### Scenario: 折叠切换
- **WHEN** 用户在 NORMAL 模式下按 `t`
- **THEN** thinking 折叠状态 SHALL 取反

### Requirement: Help 命令输出
系统 SHALL 在用户执行 `/help` 命令时，输出由"命令列表"和"快捷键"两部分组成的帮助信息，作为获取操作指引的唯一入口。

#### Scenario: 命令列表动态生成
- **WHEN** 渲染 `/help` 输出的命令列表部分
- **THEN** 系统 SHALL 从 `CommandRegistry（src/commands/registry.ts）` 动态遍历生成，而非硬编码字符串
- **AND** 每条命令 SHALL 显示命令名、description 和 usage

#### Scenario: 完整命令列表
- **WHEN** 用户执行 `/help`
- **THEN** 输出 SHALL 列出 `CommandRegistry.getAll()` 返回的全部已注册命令，包括：
- 内置命令：`/clear`、`/compact`、`/model`、`/thinking`、`/context`、`/exit`、`/help`
- 技能管理命令：`/skills`、`/load-skill`、`/unload-skill`
- 后续由技能或插件动态注册的命令

#### Scenario: 快捷键小节内容
- **WHEN** 用户执行 `/help`
- **THEN** 输出 SHALL 包含独立的快捷键小节，分两组列出：
- INSERT 模式：Enter 发送、Shift+Enter 换行、Esc 进入 NORMAL、Ctrl+C 中断/退出（连按两次强制退出）
- NORMAL 模式：i/a/o 进入 INSERT、j/k 上下滚动、g/G 顶/底、t 折叠 thinking

#### Scenario: 帮助文案集中维护
- **WHEN** 实现 `/help` 输出
- **THEN** 拼接逻辑 SHALL 位于 `src/tui/commands.ts` 的导出函数（如 `buildHelpText()`），App.tsx 仅负责调用并包装为 assistant 消息

### Requirement: /mcp 命令注册
系统 SHALL 通过 `CommandRegistry` 注册 `/mcp` 命令，执行时打开 MCP 连接状态面板（面板行为详见 `mcp` capability 的 "/mcp 命令面板" requirement）。

#### Scenario: 注册 /mcp
- **WHEN** 应用启动调用 `registerBuiltinCommands()`
- **THEN** `commandRegistry` SHALL 注册 `mcp` 命令，description 标明打开 MCP server 状态面板

#### Scenario: 执行 /mcp
- **WHEN** 用户执行 `/mcp`
- **THEN** 系统 SHALL 触发 App 顶层 view 切换为 MCP 面板视图，`CommandContext` SHALL 提供 `mcpManager` 访问

#### Scenario: 自动补全
- **WHEN** 用户输入 `/m` 并触发命令建议
- **THEN** `/mcp` SHALL 出现在匹配建议列表中（与 `/model` 一并匹配）

