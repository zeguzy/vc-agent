## 1. Leader 事件驱动等待

- [ ] 1.1 `src/server/index.ts` ensureSubscribed 中 member_done 通知改为结构化系统标记（`[SYSTEM NOTIFICATION — DO NOT ACT unless there's a problem]` 包裹），非 streaming 时不主动 prompt Leader
- [ ] 1.2 `src/server/index.ts` member_error 事件保持始终主动注入（不受 streaming 状态影响）
- [ ] 1.3 `src/context-files.ts` TEAM_ORCHESTRATOR_PROMPT 增加 "Waiting for Your Team" 段落，禁止轮询，说明系统自动推送通知
- [ ] 1.4 `src/tools/team.ts` team 工具 wait action 的 description 弱化轮询鼓励，改为 "prefer waiting for system notifications"

## 2. team 工具增加 discussion type 参数

- [ ] 2.1 `src/tools/team.ts` TeamParamsSchema 中 assign/assign-batch action 增加可选 `type` 参数（`"execution" | "discussion"`，默认 `"execution"`）
- [ ] 2.2 `src/tools/team.ts` TeamParamsSchema 中 create/create-batch action 增加可选 `taskType` 参数
- [ ] 2.3 `src/tools/team.ts` handleAssign/handleAssignBatch 透传 type 给 manager.assignTask
- [ ] 2.4 `src/tools/team.ts` handleCreate/handleCreateBatch 在创建成员后分配任务时透传 taskType
- [ ] 2.5 `src/teams/types-v2.ts` TeamManagerLike.assignTask 接口增加可选 `type?: TaskType` 参数
- [ ] 2.6 `src/teams/manager-v2.ts` TeamManager.assignTask 实现透传 type 到 TaskState（默认 "execution"）
- [ ] 2.7 `src/client/types.ts` AgentClient.assignTask 增加 type 参数
- [ ] 2.8 `src/client/in-process.ts` / `src/client/http.ts` 透传 type 参数

## 3. DiscussionSupervisor 类型定义和 prompt 增强

- [ ] 3.1 `src/teams/coordinator.ts` 新增 AgendaItem、DiscussionPlan 类型定义
- [ ] 3.2 `src/teams/coordinator.ts` 新增 SupervisorContinue/SupervisorRedirect/SupervisorSummarize/SupervisorComplete/SupervisorDecision 类型定义
- [ ] 3.3 `src/teams/coordinator.ts` 新增 buildSupervisorPrompt 函数，包含 agenda 跟踪、偏移检测指令、scope 边界、off-topic 信号
- [ ] 3.4 `src/teams/coordinator.ts` 新增 parseSupervisorDecision 函数，支持 redirect/summarize action 解析

## 4. DiscussionSupervisor 类实现

- [ ] 4.1 `src/teams/coordinator.ts` 新增 DiscussionSupervisor 类，持有 AgentSession（跨轮复用）、DiscussionPlan、round 计数器
- [ ] 4.2 DiscussionSupervisor.evaluate() 方法：注入最新消息和 agenda 状态到 session，获取决策
- [ ] 4.3 DiscussionSupervisor 自动生成 DiscussionPlan（当 Leader 未提供时，从 task.title/description 推导）
- [ ] 4.4 DiscussionSupervisor.dispose() 方法清理 session
- [ ] 4.5 `src/teams/manager-v2.ts` TeamManager 持有 Map<taskId, DiscussionSupervisor>，在 doEvaluateDiscussion 中使用 Supervisor 替代 runCoordinator

## 5. redirect 和 summarize action 处理

- [ ] 5.1 `src/teams/manager-v2.ts` doEvaluateDiscussion 中 redirect action 调用 directMember(kind="redirect") 而非 steer
- [ ] 5.2 `src/teams/manager-v2.ts` doEvaluateDiscussion 中 summarize action 通过 steer 注入（与 continue 类似）
- [ ] 5.3 `src/teams/context.ts` member 参与讨论任务时 Anti-Patterns 追加 supervisor 遵循约束

## 6. 多成员讨论任务支持

- [ ] 6.1 `src/teams/types-v2.ts` TaskState 增加 `participants: MemberName[]` 字段
- [ ] 6.2 `src/teams/files.ts` TEAM.md 解析/写入适配 participants 字段
- [ ] 6.3 `src/teams/manager-v2.ts` 新增 startDiscussion(opts) 方法
- [ ] 6.4 `src/teams/manager-v2.ts` assignTask 中执行任务自动设置 participants 为 [memberName]
- [ ] 6.5 `src/teams/types-v2.ts` TeamManagerLike 接口增加 startDiscussion 方法

## 7. 测试

- [ ] 7.1 `tests/team-discussion-unit.test.ts` 适配新 SupervisorDecision 类型（redirect/summarize 解析测试）
- [ ] 7.2 `tests/team-discussion-unit.test.ts` 新增 buildSupervisorPrompt 测试（agenda 跟踪、偏移检测指令存在性）
- [ ] 7.3 `tests/team-discussion-unit.test.ts` 新增 TaskState participants 字段测试
- [ ] 7.4 `tests/team-discussion-integration.test.ts` 适配 DiscussionSupervisor 类接口
