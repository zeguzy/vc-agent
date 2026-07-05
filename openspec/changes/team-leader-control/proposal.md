## Why

Team 模式的 member 和 subagent 没有本质区别：member 没有工具、没有通信通道、leader 无法控制运行中的 member。这让 team 模式失去了存在的意义——用户可以直接用 subagent 工具得到同样效果。需要让 leader-member 关系成为真正的主从关系：leader 可以指挥、控制、通信，member 可以执行、反馈、持久存在。

## What Changes

- **Member 工具注入**：Member 创建时注入基础工具集（read, bash, grep, find, member-read, self-edit, memory-write），不再是空壳
- **Leader→Member 通信通道**：新增 `member-direct` 工具，leader 可向运行中的 member 发送结构化消息（指令、上下文补充、方向调整）
- **Member 生命周期控制**：Leader 可暂停（pause）、恢复（resume）、终止（cancel）member，不再只有 removeMember 强杀或等 member_done
- **Member→Leader 反馈通道**：Member 完成任务时产出写入文档，leader 通过 `member-read` 获取结果细节
- **BREAKING**：`MemberState.status` 新增 `"paused"` 状态；`TeamManagerLike` 接口新增 `pauseMember`、`resumeMember`、`cancelMember`、`directMember` 方法

## Capabilities

### New Capabilities
- `member-tools`: Member 工具注入——定义 member 可用的工具集、权限模型和注入机制
- `member-lifecycle`: Member 生命周期控制——pause/resume/cancel 命令和状态机
- `leader-member-comm`: Leader-Member 通信通道——direct 消息机制和消息路由

### Modified Capabilities
- `team-orchestration`: Member 创建流程变更（注入工具集），TeamManagerLike 接口扩展

## Impact

- `src/teams/manager-v2.ts`：新增 pauseMember/resumeMember/cancelMember/directMember，createMember 注入工具
- `src/teams/types-v2.ts`：MemberState.status 新增 "paused"，TeamManagerLike 扩展
- `src/teams/worker.ts`：resolveTools/deniedToolsFor 复用，可能需要调整
- `src/tools/`：新增 member-direct 工具
- `src/client/types.ts`：AgentClient 接口扩展（pauseMember/resumeMember/cancelMember/directMember）
- `src/client/in-process.ts`、`src/client/http.ts`：实现新方法
- `src/server/index.ts`、`src/server/http.ts`：新增路由/handler
- `src/tui/`：WorkersView 展示 paused 状态，commands 更新
- `src/context-files.ts`：TEAM_ORCHESTRATOR_PROMPT 更新（新增工具说明）

## Non-goals

- 不做 member 之间的直接通信（只做 leader→member 和 member→leader）
- 不做 member 自动调度/负载均衡（leader 手动分配）
- 不做 member 持久化重启（member 随进程生命周期）
- 不做工作目录隔离（worktree isolation 是独立特性）
- 不做 member 权限细粒度控制（沿用 V1 Worker 的 permissionMode 即可）
