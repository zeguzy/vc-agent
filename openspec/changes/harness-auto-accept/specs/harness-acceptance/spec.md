# harness-acceptance Specification

## Purpose

基于 httpClient 的通用验收机制。把任意 OpenSpec change 的验收从「纯人工逐项核对」升级为「httpClient 驱动的三层自动验收 + 报告展示 + 用户最终确认」。复用 `team-verify` skill 验证过的「启动真实 server + HttpClient 调用 + SSE 事件」模式，泛化到 harness 流水线步骤 6。环境隔离确保烟测不污染用户配置、不消耗 LLM token、不暴露到网络。

## Requirements

### Requirement: 三层验收策略
验收机制 SHALL 提供三层独立判定的断言，每层产出 PASS/FAIL/SKIP 状态。

#### Scenario: Layer 0 静态检查必跑
- **WHEN** 验收流程启动
- **THEN** 系统 SHALL 执行 `bun run check`（typecheck + lint + test），失败即整体 FAIL

#### Scenario: Layer 1 烟测显式启用
- **WHEN** 环境变量 `ACCEPTANCE_SMOKE=1` 设置
- **THEN** 系统 SHALL 执行 `tests/acceptance-smoke.test.ts`，启动隔离的真实 server 并通过 HttpClient 验证核心 GET 端点可达
- **AND WHEN** 环境变量未设置
- **THEN** 系统 SHALL SKIP Layer 1 并记录 SKIP 原因

#### Scenario: Layer 2 change 级定制断言可选
- **WHEN** change 目录含 `acceptance.md` 文件
- **THEN** 系统 SHALL 解析并执行其中的 Smoke / Manual QA / Log Assertions 三段断言
- **AND WHEN** 无 acceptance.md
- **THEN** 系统 SHALL SKIP Layer 2

### Requirement: 共享测试 helper 强制环境隔离
`tests/helpers/real-server.ts` SHALL 导出 `createRealServer()` 函数，被 acceptance-smoke 和 team-e2e-llm 共享，并强制三项隔离。

#### Scenario: 临时 HOME 隔离
- **WHEN** createRealServer 启动
- **THEN** 系统 SHALL 设置 `process.env.HOME` 为 `os.tmpdir()/openagent-test-<pid>-<rand>/` 唯一路径
- **AND** 在函数返回的 `restoreHome()` 回调中还原原 HOME

#### Scenario: 绑定 127.0.0.1
- **WHEN** createHttpServer 启动
- **THEN** 系统 SHALL 调用 `httpServer.listen(port, "127.0.0.1")`，不绑定到 `::` 或 `0.0.0.0`

#### Scenario: 不调用 /prompt
- **WHEN** 烟测执行
- **THEN** 测试 SHALL NOT 调用 `POST /prompt`（该端点阻塞至完整 agent turn，会消耗 LLM token）
- **AND** 仅验证 GET 端点可达性 + SSE 订阅建立 + abort 端点存在性

#### Scenario: 共享 helper 消除 copy-paste
- **WHEN** tests/team-e2e-llm.test.ts 和 tests/acceptance-smoke.test.ts 都需要真实 server
- **THEN** 两者 SHALL 从 `tests/helpers/real-server.ts` import，不内联 createRealServer 实现

### Requirement: 烟测脚本复用 createRealServer 模式
`tests/acceptance-smoke.test.ts` SHALL 通过共享 helper 启动 server，做最小可达性验证。

#### Scenario: 进程内启动隔离 server
- **WHEN** 烟测套件初始化
- **THEN** 测试 SHALL 调用 `createRealServer()` + `createHttpServer({server, port:0, host:"127.0.0.1"})`
- **AND** 通过 `httpServer.address().port` 获取随机端口

#### Scenario: 核心 GET 端点烟测
- **WHEN** server 启动完成
- **THEN** 测试 SHALL 通过 fetch 验证 `GET /session/id`、`GET /model`、`GET /messages`、`GET /sessions` 返回 200，body 含预期字段

#### Scenario: SSE 事件流订阅建立
- **WHEN** 测试订阅 `GET /events`
- **THEN** 测试 SHALL 能在 5s 内建立 SSE 连接（不强制要求收到事件，因不触发 agent turn）
- **AND WHEN** 5s 内未建立连接
- **THEN** 测试 SHALL 记 SKIP 不 FAIL

#### Scenario: abort 端点存在性
- **WHEN** 测试调用 `POST /abort`
- **THEN** 端点 SHALL 返回 200（验证路由存在，不实际触发 abort）

#### Scenario: 烟测默认 skip
- **WHEN** 环境变量 `ACCEPTANCE_SMOKE` 未设置为 `1`
- **THEN** 整个烟测套件 SHALL 通过 `describe.skip` 跳过，不污染 `bun run check`

### Requirement: 结构化验收报告
验收机制 SHALL 产出结构化报告供 harness 步骤 6 展示。

#### Scenario: 报告包含三层状态
- **WHEN** 验收完成
- **THEN** 报告 SHALL 列出 Layer 0/1/2 各自的 PASS/FAIL/SKIP 状态

#### Scenario: 失败详情可定位
- **WHEN** 任一 Layer 失败
- **THEN** 报告 SHALL 包含失败用例名、错误消息、相关日志摘录

#### Scenario: 报告含变更元信息
- **WHEN** 报告生成
- **THEN** 报告 SHALL 附带 `git diff --stat` 摘要、当前 worktree 路径、change 名称

### Requirement: harness 步骤 6 集成
harness SKILL.md 步骤 6 SHALL 调用 `/opsx-accept` skill 执行自动验收。

#### Scenario: 自动验收通过请求用户确认
- **WHEN** Layer 0 PASS 且（Layer 1 PASS 或 SKIP）且（Layer 2 PASS 或 SKIP）
- **THEN** harness SHALL 展示报告 + diff stat + 完成任务列表，调用 AskUserQuestion 请求用户最终确认

#### Scenario: Layer 0 失败回退
- **WHEN** Layer 0 失败
- **THEN** harness SHALL 展示失败详情，回到步骤 4 实施修复

#### Scenario: 保留用户最终确认
- **WHEN** 自动验收全 PASS
- **THEN** 系统 SHALL 仍调用 AskUserQuestion 请求用户拍板，不自动合并到 main

### Requirement: change 级 acceptance.md 约定
change 目录可选地包含 `acceptance.md` 定义定制断言。

#### Scenario: acceptance.md 三段结构
- **WHEN** change 携带 acceptance.md
- **THEN** 文件 SHALL 支持三段结构：`## Smoke`（程序化验证）、`## Manual QA`（人工 QA 步骤）、`## Log Assertions`（日志断言，team change 用于查 JSONL）

#### Scenario: 缺失段落容错
- **WHEN** acceptance.md 只含部分段落
- **THEN** 系统 SHALL 仅执行存在的段落，缺失段落记为 SKIP

#### Scenario: 不强制要求 acceptance.md
- **WHEN** change 目录无 acceptance.md
- **THEN** 系统 SHALL 跳过 Layer 2，仅靠 Layer 0/1 判定，不报错

#### Scenario: Log Assertions 段对非 team change 自然空
- **WHEN** 非 team change 在 acceptance.md 写 Log Assertions 段
- **THEN** 系统 SHALL 识别该段对当前 change 无意义（无 team 日志写入），记 SKIP
