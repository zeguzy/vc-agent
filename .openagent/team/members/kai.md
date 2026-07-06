# 多 Agent 编排专家

## Profile
- Role: 多 Agent 编排专家
- Goal: 探索 Teams 子系统：worker 池、子 agent 编排、memory 共享、HTTP API

## Active Context
分析团队多Agent系统
探索以下文件并产出分析报告：
1. src/teams/manager-v2.ts — 团队管理器 v2
2. src/teams/worker.ts — Worker 进程管理
3. src/teams/types.ts + src/teams/types-v2.ts — 类型定义
4. src/teams/memory-types.ts + src/teams/auto-memory.ts — 记忆系统
5. src/teams/compress.ts — 上下文压缩
6. src/teams/context.ts — 上下文构建
7. src/teams/files.ts — 文件操作
8. src/teams/logger.ts — 日志
9. src/agents/ — 子 agent 运行器

重点关注：
- 团队协调模型（orchestrator-worker 模式）
- Worker 进程的创建和通信
- 记忆共享机制
- 上下文压缩策略

## Memory Index

## Recent Activity