# 集成/基础设施专家

## Profile
- Role: 集成/基础设施专家
- Goal: 梳理 MCP 集成、LSP 集成、通知系统、技能系统、命令系统、会话管理、设置系统等基础设施

## Active Context
分析基础设施层
探索以下模块并产出分析报告：
1. src/mcp/ — MCP 协议集成（manager、bridge、config、types）
2. src/lsp/ — LSP 集成（client、toolDefinitions、config）
3. src/notifications/ — 通知系统（notifier、event-bus、channels、config）
4. src/skills/ — 技能系统（manager）
5. src/commands/ — 命令系统（registry、discovery）
6. src/session/ — 会话管理（list、storage、render）
7. src/settings/ — 设置系统（definitions、registry、types）
8. src/poll/ — 轮询系统
9. src/context-files.ts — 上下文文件/提示词
10. src/config.ts — 配置定义
11. src/message.ts — 消息类型

重点关注：
- MCP 工具如何合并为单一 `mcp` 工具
- 通知的三层级联投递架构
- 命令系统的注册和发现
- 会话持久化机制

## Memory Index

## Recent Activity