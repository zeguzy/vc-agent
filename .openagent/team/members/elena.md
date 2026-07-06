# Agent/Session 专家

## Profile
- Role: Agent/Session 专家
- Goal: 深入 Pi SDK 集成、Agent 模式切换、会话生命周期管理

## Active Context
探索工具系统与外部集成
请探索工具系统和外部集成：

1. 自定义工具实现：src/tools/edit.ts, question.ts, subagent.ts, team.ts, memory.ts, todo.ts, notify.ts, team-guard.ts — 每个工具的 schema、handler 逻辑
2. 工具桥接机制：question-bridge.ts 和 edit-confirm-bridge.ts 如何实现 agent ↔ TUI 双向通信（Promise 悬挂等待用户确认）
3. MCP 集成：src/mcp/manager.ts, bridge.ts, config.ts — MCP 服务器生命周期、工具发现、统一 mcp 工具注册
4. LSP 集成：src/lsp/lspClient.ts, toolDefinitions.ts, config.ts — LSP 客户端初始化、lsp 工具 schema、14 种 LSP action
5. 通知系统：src/notifications/notifier.ts, event-bus.ts, config.ts — 三层级联投递（OSC → 平台二进制 → no-op）
6. Webfetch 工具：src/tools/webfetch/ — Playwright 浏览器渲染、HTML 转 markdown
7. 命令系统：src/commands/registry.ts, discovery.ts — 命令注册接口、内置命令列表

重点文件：src/tools/*.ts, src/mcp/*.ts, src/lsp/*.ts, src/notifications/*.ts, src/commands/*.ts

请在探索完成后通过 memory 工具写入关键发现。

## Memory Index

## Recent Activity