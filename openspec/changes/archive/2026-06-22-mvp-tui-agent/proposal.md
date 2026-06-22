## Why

需要一个比 Pi 默认 TUI 更简洁的终端代码 Agent。Pi 的 TUI 功能强大但复杂（diff 渲染、kill ring、fuzzy 等），且视觉设计不够清爽。利用 OpenTUI（OpenCode 在生产中使用的 Zig 原生 TUI 引擎）的内置组件（ScrollBox/Input/Code）+ Pi SDK 的 Agent 能力，搭建一个视觉简洁、功能聚焦的全屏 TUI 代码 Agent。

## What Changes

- **新增** CLI 入口（`src/index.ts`）：解析命令行参数（`--model`、`--help`），启动 Pi SDK Agent 会话 + OpenTUI 渲染器
- **新增** Agent 会话层（`src/agent/session.ts`）：调用 Pi SDK `createAgentSession()`，订阅事件流并映射为 React state 更新
- **新增** TUI 全屏布局（`src/tui/App.tsx`）：OpenTUI React 组件——ScrollBox 消息区 + Input 输入框 + StatusBar 状态栏
- **新增** 消息渲染组件（`src/tui/components/`）：用户消息、Agent 流式文本、工具调用状态、代码块（tree-sitter 高亮）
- **新增** 项目脚手架：`package.json`（Bun + pi-coding-agent + @opentui/core + @opentui/react + react）、`tsconfig.json`

## Capabilities

### New Capabilities

- `cli-entry`: CLI 启动与参数解析。处理 `--model`、`--help`，初始化 Agent 会话和 OpenTUI 渲染器，进入全屏交互模式。
- `agent-session`: Pi SDK 集成层。封装 `createAgentSession()`，将 Pi 事件流（`message_update`、`tool_execution_*`、`agent_end`）映射为消息状态更新，驱动 React 重新渲染。
- `tui-layout`: 全屏 TUI 布局管理。使用 OpenTUI 的 Box/Flexbox 布局，划分消息滚动区（ScrollBox）、输入区（Input）、状态栏三个区域，处理终端 resize。
- `tui-messages`: 消息渲染。将消息列表渲染到 ScrollBox 中——用户消息（绿色前缀）、Agent 流式文本、工具调用行（🔧 图标）、代码块（tree-sitter 语法高亮）、分隔线。
- `tui-input`: 用户输入处理。基于 OpenTUI Input 组件，支持行编辑、历史记录（↑↓）、Ctrl+C 中断（AbortSignal 传递给 Pi SDK）。

### Modified Capabilities

（无 — 这是全新项目，没有已有 spec）

## Impact

- **新增依赖**：`@earendil-works/pi-coding-agent`、`@opentui/core`、`@opentui/react`、`react`
- **运行时要求**：Bun >= 1.0（OpenTUI 原生 Zig 二进制由 Bun 自动加载）
- **环境变量**：依赖 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 等（由 Pi SDK 管理）
- **不影响**：Pi 仓库本身（纯消费方，不修改 Pi 源码）
