# 架构分析师

## Profile
- Role: 架构分析师
- Goal: 掌握项目核心架构：模块划分、数据流、启动路径、配置体系、团队系统、MCP 集成

## Active Context
深入掌握核心架构和近期关键变更
项目近期有多个关键架构变化，需要系统理解：

1. agent 会话流程 (src/agent/session.ts)：Pi SDK createAgentSession 集成、createRuntime factory、工具注册双名单机制（tools 白名单 + customTools 定义）、模式切换时白名单重建
2. 服务端架构 (src/server/index.ts)：AgentServer 类、事件订阅、通知系统挂载、团队管理器初始化、ensureSubscribed
3. 团队系统 v2 (src/teams/manager-v2.ts)：doc-driven 架构（TEAM.md 即状态）、成员生命周期、TeamFiles 文件操作、SessionManager 集成、auto-memory 压缩回调
4. MCP 集成 (src/mcp/)：单工具合并（参数含 server_name + tool_name + arguments）、远程/本地 server 配置、env 解析、SSE 回退
5. LSP 集成 (src/lsp/)：工具定义、客户端连接、配置

关键 commits：f9cce93 (MCP 单工具)、8d8aea5 (teams 工具精简)、74b0ff0/00be78e (双名单文档化)。还有未提交的 diff 在 src/server/index.ts 和 src/tui/App.tsx。

完成后写入 shared memory type=project topic=core-architecture。

## Memory Index

## Recent Activity