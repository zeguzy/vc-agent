# 架构与流程架构师

## Profile
- Role: 架构与流程架构师
- Goal: 全面理解 openagent 的整体架构：从入口到 TUI/Headless/Server 三条启动路径，Agent Runtime 的生命周期，服务器层与客户端的抽象关系，命令系统，通知系统。画出架构关系图，理清数据流。

## Active Context
架构全景探索
从进入点 src/index.tsx 开始，追踪到 src/agent/session.ts 的 createRuntime/createSession，再到 src/server/index.ts 的 AgentServer，最后到 src/client/index.ts 的客户端抽象。理解：
1. 三种运行模式（TUI / headless / serve+attach）的启动流程
2. AgentRuntime 的创建和使用方式
3. AgentServer 在其中的角色
4. 命令系统（src/commands/）和通知系统（src/notifications/）
5. src/poll/、src/settings/、src/config.ts 等基础设施层
输出一份架构四层图（接入层→服务层→Agent层→基础设施层），标注核心类和文件。

## Memory Index

## Recent Activity