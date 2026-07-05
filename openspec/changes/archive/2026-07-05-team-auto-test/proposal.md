## Why

Team 模式目前只有 FakeWorker mock 的单元测试，缺少端到端验收手段。每次功能变更都需要手动启动 TUI 交互验证，严重拖慢项目推进。需要补全 V2 Team HTTP API 并构建 httpClient + 日志埋点的自动化测试框架，实现 CI 可跑的验收测试。

## What Changes

- **HttpServer 新增 V2 Team 路由**：`/team/members`（CRUD）、`/team/tasks`（CRUD）、`/team/messages`（send + read）、`/mode` 扩展支持 `"team"` / `"orchestrator"`
- **HttpClient 实现 V2 方法**：`createMember`、`removeMember`、`getMember`、`listMembers`、`assignTask`、`listTasks`、`taskStatus`、`sendMessage`、`readInbox`，不再 throw NotSupportedError
- **新增端到端测试**：`tests/team-e2e.test.ts`，启动真实 HttpServer，通过 fetch + SSE + JSONL 日志断言验证 team 全生命周期

## Capabilities

### New Capabilities
- `team-v2-http-api`: V2 Team 成员/任务/消息的 HTTP API 端点及 HttpClient 实现
- `team-e2e-test`: 基于 httpClient + 日志埋点的 Team 模式端到端自动化测试框架

### Modified Capabilities

## Impact

- `src/server/http.ts` — 新增 ~10 个路由
- `src/client/http.ts` — 9 个方法从 throw 改为真实 HTTP 调用
- `tests/team-e2e.test.ts` — 新增测试文件
- 无破坏性变更：V2 路由为新增端点，HttpClient 原有 V1 方法不受影响
