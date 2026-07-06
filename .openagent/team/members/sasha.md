# TUI 前端专家

## Profile
- Role: TUI 前端专家
- Goal: 掌握 TUI 前端架构：React 组件树、hooks 模式、键盘处理、vim 模式、状态管理

## Active Context
深入掌握 TUI 前端当前状态和近期 UI 变更
项目近期做了 Codex 风格 UI 重构，需要系统理解：

1. **主组件** (src/tui/App.tsx)：组件结构、状态管理（messages/isRunning/agentMode/thinkingCollapsed 等）、useKeyboard 闭包陷阱处理模式（所有通过 xxxRef.current 读取状态的模式）、模式切换逻辑
2. **子组件**: MessageList.tsx、InputBox.tsx、StatusBar.tsx、MemberTags.tsx、WorkersView.tsx、DiffConfirmBox.tsx、QuestionBox.tsx、SettingsPanel.tsx、SessionPicker.tsx
3. **Hooks**: useSessionEvents.ts（事件订阅和消息更新）、useStreamingBuffer.ts（流式渲染缓冲）、useToasts.ts、useSessionPicker.ts、useTerminalWidth.ts
4. **Vim 模式** (src/tui/vim/)：光标移动、EasyMotion、motions、overlay、screenModel、vimState
5. **命令系统** (src/commands/registry.ts + src/tui/commands.ts)：命令注册和分发
6. **Utils**: theme.ts、history.ts、selection.ts、clipboard.ts、syntax.ts、streaming.ts

关键 commits：53585b8 (member tags/wiring)、70d0536 (Codex 消息面板)、783620e (InputBox/StatusBar 改造)、30089d9 (主题色扩展)、eb4b5fc (member tags + 子会话切换)。注意未提交 diff 涉及到 App.tsx。

完成后写入 shared memory type=project topic=tui-frontend。

## Memory Index

## Recent Activity