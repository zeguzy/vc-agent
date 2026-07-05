## 1. HttpServer V2 Team 路由

- [ ] 1.1 在 `src/server/http.ts` 新增 POST /team/members 路由，调用 `server.handleCreateMember()`
- [ ] 1.2 在 `src/server/http.ts` 新增 GET /team/members 路由，调用 `server.handleListMembers()`
- [ ] 1.3 在 `src/server/http.ts` 新增 GET /team/members/:id 路由，调用 `server.handleGetMember()`
- [ ] 1.4 在 `src/server/http.ts` 新增 DELETE /team/members/:id 路由，调用 `server.handleRemoveMember()`
- [ ] 1.5 在 `src/server/http.ts` 新增 POST /team/tasks 路由，调用 `server.handleAssignTask()`
- [ ] 1.6 在 `src/server/http.ts` 新增 GET /team/tasks 路由，调用 `server.handleListTasks()`
- [ ] 1.7 在 `src/server/http.ts` 新增 GET /team/tasks/:id 路由，调用 `server.handleTaskStatus()`
- [ ] 1.8 在 `src/server/http.ts` 新增 POST /team/messages 路由，调用 `server.handleSendMessage()`
- [ ] 1.9 在 `src/server/http.ts` 新增 GET /team/inbox 路由，调用 `server.handleReadInbox()`
- [ ] 1.10 扩展 POST /mode 路由，接受 `"team" | "orchestrator"` 模式

## 2. HttpClient V2 方法实现

- [ ] 2.1 实现 `HttpClient.createMember()`：POST /team/members
- [ ] 2.2 实现 `HttpClient.removeMember()`：DELETE /team/members/:id
- [ ] 2.3 实现 `HttpClient.getMember()`：GET /team/members/:id
- [ ] 2.4 实现 `HttpClient.listMembers()`：GET /team/members
- [ ] 2.5 实现 `HttpClient.assignTask()`：POST /team/tasks
- [ ] 2.6 实现 `HttpClient.listTasks()`：GET /team/tasks
- [ ] 2.7 实现 `HttpClient.taskStatus()`：GET /team/tasks/:id
- [ ] 2.8 实现 `HttpClient.sendMessage()`：POST /team/messages
- [ ] 2.9 实现 `HttpClient.readInbox()`：GET /team/inbox

## 3. E2E 测试 — Layer 1: HTTP 路由层（mock AgentServer）

- [ ] 3.1 创建 `tests/team-http-v2.test.ts`，搭建 mock AgentServer + 真实 HttpServer 测试基础设施（扩展 createMockServer 包含 V2 handler）
- [ ] 3.2 编写 member CRUD 路由测试：create / list / get / remove
- [ ] 3.3 编写 task 路由测试：assign / list / status
- [ ] 3.4 编写 message 路由测试：send / read inbox
- [ ] 3.5 编写 mode 路由扩展测试：team / orchestrator
- [ ] 3.6 编写 HttpClient V2 方法集成测试：通过 HttpClient 调用全部 V2 API

## 4. E2E 测试 — Layer 2: 真实 LLM 层

- [ ] 4.1 创建 `tests/team-e2e-llm.test.ts`，搭建真实 AgentServer + HttpServer 测试基础设施
- [ ] 4.2 编写极简 LLM 验收测试：create member → assign 单 turn 任务（maxTurns:1, prompt<20token）→ 等待 member done → 断言 status 转换
- [ ] 4.3 编写 SSE 事件流验收测试：监听 /events，断言 agent_end 事件到达
- [ ] 4.4 编写日志一致性验收测试：验证 JSONL 日志包含 member_status_changed 事件
- [ ] 4.5 运行 `bun run check` 确保全绿
