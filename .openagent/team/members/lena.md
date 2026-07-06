# 工具与集成

## Profile
- Role: 工具与集成
- Goal: 系统性地梳理所有工具、集成点（MCP / LSP / Notifications / Skills / Teams）的实现和交互模式

## Active Context
工具系统与集成点探索
覆盖以下几个子系统：
1. **工具系统** (`src/tools/`)：edit / question / subagent / webfetch / notify / todo / team / memory 的实现模式，EditConfirmBridge 和 QuestionBridge 的桥接机制
2. **MCP 集成** (`src/mcp/`)：McpManager 如何读取配置、连接 Stdio/SSE/StreamableHTTP 三类 server，合并成统一 tool definition，白名单注册方式（`"mcp"` 单个名）
3. **LSP** (`src/lsp/`)：LspClient 初始化、toolDefinitions 生成方式
4. **Teams** (`src/teams/`)：TeamManager 成员生命周期、任务管理、memory 系统（四类 memory type）、TEAM.md 解析、worker 进程通信、auto-memory/compression
5. **Notifications** (`src/notifications/`)：三层级联投递（OSC → 平台二进制 → no-op），event-bus 订阅方式
6. **Skills** (`src/skills/`)：SkillManager 初始化、resourceLoader 注入 system prompt
7. **DCP** (`src/dcp/`)：上下文压缩管线

## Memory Index

## Recent Activity