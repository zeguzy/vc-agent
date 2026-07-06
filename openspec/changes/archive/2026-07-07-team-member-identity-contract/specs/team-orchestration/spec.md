## ADDED Requirements

### Requirement: Team member L1 身份层行为契约

系统 SHALL 在 `src/teams/context.ts` 的 `buildIdentityLayer` 函数中，将 team member 的 L1 身份层从单段字符串升级为七个结构化分区，按以下顺序拼装：

1. **Identity** — `You are {name}, a {role} on this team. Your goal: {goal}.` 若 leader 提供了 constraints，SHALL 在 Identity 段末尾追加一行指引"你的行为约束见下方 Anti-Patterns 段"（不重复 constraints 内容）。
2. **Capabilities** — 列出 member 可用工具（`read` / `bash` / `grep` / `find` / `memory`）及使用原则，MUST 包含"验证优先于声称（reading is not verification）"原则。
3. **Work Discipline** — 描述工作流程：接 task → 理解 scope → 执行 → 验证 → 报告，MUST 强调执行前先读 task description、执行后必须验证。
4. **Anti-Patterns** — MUST 包含通用兜底约束（至少覆盖：scope creep / 不验证就报告 / 重复 leader 已做的事 / 擅自改 team 文件 四类）。**constraints 文本 SHALL 只注入此分区一次**（不重复出现在 Identity）。若 leader 通过 `constraints` 参数提供了 role-specific 约束，SHALL 在通用约束后追加定制约束。
5. **Escalation** — MUST 定义四种状态码（`DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`）及各自的触发条件。
6. **Output Protocol** — MUST 要求完成时返回结构化报告：Status（四种状态码之一）+ Summary（简洁摘要）+ Key files（触及的文件路径）+ Evidence（验证证据，如运行的命令及结果）。
7. **Memory Discipline** — MUST 指导 member 何时使用 `memory(action="write")`（学到新模式 / 踩过的坑 / 用户偏好）。

`buildIdentityLayer` SHALL 移除 `agentSystemPrompt` 形参（dead parameter，无调用方传入）。每个分区 SHALL 作为独立 string export 常量定义（Anti-Patterns 为函数，因接受 customConstraints），便于单元测试和未来维护。

#### Scenario: L1 包含全部七个分区

- **WHEN** 调用 `buildIdentityLayer({ name: "alice", role: "reviewer", goal: "审查代码" })` 且未提供 constraints
- **THEN** 返回的字符串 SHALL 包含全部七个分区标题或关键词（Identity / Capabilities / Work Discipline / Anti-Patterns / Escalation / Output Protocol / Memory Discipline）
- **AND** Anti-Patterns 段 SHALL 包含通用兜底约束（含 scope creep / 不验证就报告 / 重复 leader 工作 / 擅自改 team 文件）
- **AND** 字符串 SHALL NOT 包含 `agentSystemPrompt` 相关内容（该 dead parameter 已移除）

#### Scenario: leader 提供 constraints 时只拼入 Anti-Patterns 段

- **WHEN** 调用 `buildIdentityLayer({ name: "bob", role: "implementer", goal: "...", constraints: "不许跳过测试；每个改动必须跑 bun test" })`
- **THEN** Anti-Patterns 段 SHALL 在通用兜底约束之后追加 leader 提供的 constraints 文本
- **AND** Identity 段 SHALL 仅追加一行"行为约束见下方 Anti-Patterns 段"指引（不重复 constraints 文本）
- **AND** constraints 文本 SHALL 在整个 L1 中只出现一次（仅在 Anti-Patterns 段）
- **AND** 其他六个分区内容与未提供 constraints 时一致

#### Scenario: buildMemberSystemPrompt 返回 L1+L2+L3 三元素数组

- **WHEN** 调用 `buildMemberSystemPrompt({ role, goal, name, constraints, memberIndex, teamMd, selfName })`
- **THEN** 返回值 SHALL 为三元素 string 数组：`[L1, L2, L3]`
- **AND** L1（首元素）SHALL 为 `buildIdentityLayer` 的输出（含七分区）
- **AND** L2/L3 与当前实现一致（buildMemoryIndexLayer / buildTeamSummaryLayer 输出不变）

#### Scenario: 不传 constraints 时退化通用兜底

- **WHEN** `createMember` 调用时未提供 `constraints` 参数（或提供空字符串）
- **THEN** `buildIdentityLayer` SHALL 仅使用通用兜底 Anti-Patterns，不追加定制约束
- **AND** Identity 段 SHALL NOT 包含"行为约束见下方"指引（因无定制约束）
- **AND** 行为 SHALL 与本 change 引入前的调用方完全兼容（现有 team 工具不传 constraints 时仍正常工作）

### Requirement: createMember 接口接受可选 constraints 参数

`TeamManager.createMember`（含接口 `TeamManagerLike.createMember`）的 opts 参数 SHALL 新增可选字段 `constraints?: string`。该字段 SHALL 透传给 `buildMemberSystemPrompt` → `buildIdentityLayer`，用于在 Anti-Patterns 分区注入 role-specific 行为约束。

`MemberIndexStructure` SHALL 在顶层（不放 profile）新增可选字段 `constraints?: string` 用于持久化。`MemberState` SHALL NOT 持有 constraints（constraints 是创建时数据，runtime 通过 member index 访问）。

`createMember` SHALL 在调用 `files.initMemberDir` 前对 constraints 做校验：长度超过 800 字符 SHALL 截断到 800；含 `## ` 开头的行 SHALL 移除这些行（防止破坏 markdown section 解析）。校验后的 constraints SHALL 写入 member .md 的 `## Constraints` section（位于 `## Profile` 之后、`## Active Context` 之前）。

`restoreMembers` SHALL 从 `memberIndex.constraints`（由 `parseMemberIndex` 从 `## Constraints` section 读取）透传给 `buildMemberSystemPrompt`。读取时若 constraints 字段缺失或 section 不存在，SHALL 按未提供处理（退化通用兜底），不阻断 restore。

`team` 工具的 `TeamParamsSchema` SHALL 新增可选字段 `constraints`。`BatchMemberSchema`（create-batch 用）SHALL 同步新增可选字段 `constraints`，支持 per-member 独立传入。`handleCreate` 和 `handleCreateBatch` SHALL 将 args.constraints 透传给 `manager.createMember`。

客户端接口（`AgentClient.createMember`、`InProcessClient.createMember`、`HttpClient` 的 `/team/members` POST body）SHALL 同步接受并透传 `constraints` 字段。

#### Scenario: createMember 透传 constraints 到 prompt

- **WHEN** leader 调用 `team` 工具，参数 `{ action: "create", name: "kim", role: "reviewer", goal: "审查", constraints: "must run tests, no rubber-stamping" }`
- **THEN** `handleCreate` SHALL 调用 `manager.createMember({ name, role, goal, constraints: "must run tests, ...", ... })`
- **AND** `createMember` SHALL 将 constraints 透传给 `buildMemberSystemPrompt`
- **AND** 最终 member session 的 system prompt SHALL 在 Anti-Patterns 段含 "must run tests, no rubber-stamping"

#### Scenario: constraints 持久化到 member .md 的 ## Constraints section

- **WHEN** `createMember` 提供 constraints 参数（经校验后）
- **THEN** `files.initMemberDir` SHALL 在 member .md 写入 `## Constraints` section（位于 `## Profile` 之后、`## Active Context` 之前）
- **AND** section body SHALL 为 constraints 文本（多行自由文本）
- **AND** `parseMemberIndex` SHALL 通过 `sections.get("Constraints")` 读取到 `memberIndex.constraints`（顶层字段，不放 profile）

#### Scenario: constraints 长度超限被截断

- **WHEN** `createMember` 收到长度 > 800 字符的 constraints
- **THEN** 系统 SHALL 截断 constraints 到 800 字符（不拒绝创建）
- **AND** 截断后的 constraints SHALL 正常写入 `## Constraints` section 并注入 prompt

#### Scenario: constraints 含 ## 开头的行被清理

- **WHEN** `createMember` 收到含 `## some heading` 行的 constraints
- **THEN** 系统 SHALL 移除所有以 `## ` 开头的行（防止破坏 `splitSections` 解析）
- **AND** 清理后的 constraints SHALL 正常写入 `## Constraints` section

#### Scenario: restore 重建含 constraints 的 L1

- **WHEN** 进程重启，`restoreMembers` 从 member .md 读到 `constraints: "must run tests, ..."`
- **THEN** `restoreMembers` SHALL 调用 `buildMemberSystemPrompt({ role, goal, name, constraints: "must run tests, ...", ... })`
- **AND** 重建的 member session system prompt SHALL 与创建时一致（含定制 Anti-Patterns）

#### Scenario: restore 时 ## Constraints section 不存在

- **WHEN** `restoreMembers` 读取旧 member .md（无 `## Constraints` section）
- **THEN** `parseMemberIndex` SHALL 返回 `constraints: undefined`（`sections.get("Constraints")` 返回 undefined）
- **AND** `restoreMembers` SHALL 调用 `buildMemberSystemPrompt` 时不传 constraints
- **AND** 重建的 L1 SHALL 使用通用兜底 Anti-Patterns（行为正常，不阻断 restore）

#### Scenario: create-batch per-member 独立透传 constraints

- **WHEN** leader 调用 `team` 工具，参数 `{ action: "create-batch", members: [{ name: "alice", role: "frontend", goal: "UI", constraints: "不许跳过 lint" }, { name: "bob", role: "backend", goal: "API" }] }`
- **THEN** `handleCreateBatch` SHALL 对 alice 调用 `createMember` 时透传 `constraints: "不许跳过 lint"`
- **AND** SHALL 对 bob 调用 `createMember` 时不传 constraints（bob 未提供）
- **AND** 每个 member 的 L1 SHALL 独立按各自 constraints 情况构建

#### Scenario: HTTP 客户端透传 constraints

- **WHEN** `HttpClient.createMember({ name, role, goal, constraints })` 发送 POST `/team/members`
- **THEN** 请求 body SHALL 包含 `constraints` 字段
- **AND** 服务端 `handleCreateMember` SHALL 将 constraints 透传给 `manager.createMember`
