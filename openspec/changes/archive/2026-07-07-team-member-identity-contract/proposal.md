## Why

Team member 的 L1 身份层（`src/teams/context.ts:buildIdentityLayer`）只有两行字符串——`You are a team member with role "X" and goal "Y".` + memory 工具用法提示。没有行为约束、错误恢复、终止条件、输出格式、自检机制、升级路径。对比 leader 端（`TEAM_ORCHESTRATOR_PROMPT` + `ORCHESTRATOR_SYSTEM_PROMPT` 有 Intent Gate / Decomposition / Failure Recovery / Evidence / Communication / Guardrails 六大节），member 端几乎为零——"教练有战术手册，球员只有球衣号码"。

`buildIdentityLayer` 的 `agentSystemPrompt` 形参存在但 `manager-v2.ts` 调用时从未传入，是 dead parameter。member 拿到 task 后完全不知道该怎么干、什么时候停、什么时候求助，行为质量完全依赖 LLM 默认能力，没有 prompt 层的结构化引导。

参考 claude-code-cli（三层叠加身份 + Verification 自省式 prompt）和 superpowers（HARD-GATE + Anti-Pattern 表 + 4 状态码 + Self-Review checklist）后确认：member 需要的是"行为契约"而非"角色扮演"——明确告诉它如何工作、何时停下、如何报告。

## What Changes

- **`buildIdentityLayer` 升级为七分区行为契约**：从两行字符串重构为 Identity / Capabilities / Work Discipline / Anti-Patterns / Escalation / Output Protocol / Memory Discipline 七个分区。Anti-Patterns 内容由 leader 在创建 member 时动态传入（`constraints` 参数），实现"按 role 定制约束"而不引入预定义 archetype。
- **`createMember` 接口扩展 `constraints` 可选参数**：leader 创建 member 时传入针对该 role 的行为约束文本（如 reviewer 要写"不许只读代码就放行"、implementer 要写"不许 scope creep"）。`MemberState` 存储 constraints 用于 restore 时重建 prompt。不传则退化回通用兜底契约。
- **吸收 `agentSystemPrompt` dead parameter**：该形参从未被传入，重构时移除，避免误导。
- **`team` 工具 schema 增加 `constraints` 字段 + 工具 description 引导**：让 leader 知道可以为 member 定制行为约束，给出示例。
- **客户端接口同步扩展**：`AgentClient.createMember`、`InProcessClient`、`HttpClient` 一并加 `constraints` 参数。

## Non-goals

- **不引入 member archetype 枚举**：role 仍是自由字符串，不预定义 explorer/implementer/reviewer 等类型。"动态"靠 leader 的 LLM 智能生成 constraints，不靠启发式匹配或硬编码模板。
- **不动 L2/L3/L4**：Memory Index（L2）、TEAM.md Summary（L3）、Task（L4）保持现状，它们是动态数据，已经合理。
- **不动 subagent 系统**：`src/agents/`（flagella/ribosome/nucleus/plasmid/lysosome）是另一个 change（optimize-team-prompts）的范围。
- **不改 member 工具集**：member 仍只有 read/bash/grep/find/memory 五个工具，不加 edit/write。
- **不引入 member 间直连通信**：仍是 leader→member 单向。
- **不做后处理校验**：不强制校验 member 输出是否含 Status 行（属可选增强，留待后续）。
- **不动 member 持久化格式**：member .md 的 frontmatter 结构不变，constraints 存在 MemberState 内存 + member index 的 profile 段。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `team-orchestration`: 新增 Requirement 规定 team member 的 L1 身份层 SHALL 包含七分区行为契约结构，且 `createMember` 接口 SHALL 接受可选 `constraints` 参数用于动态注入 role-specific 行为约束。

## Impact

- **代码文件**：
  - `src/teams/context.ts` — 重构 `buildIdentityLayer`（核心），拆 section 常量，移除 `agentSystemPrompt` dead parameter
  - `src/teams/manager-v2.ts` — `createMember` / `restoreMembers` 接受并透传 `constraints`，存入 `MemberState`
  - `src/teams/types-v2.ts` — `TeamManagerLike.createMember` 签名 + `MemberState` 加 `constraints` 字段，`MemberIndexStructure.profile` 加 `constraints`
  - `src/tools/team.ts` — `TeamParamsSchema` 加 `constraints` 可选字段，`BatchMemberSchema` 同步，`handleCreate`/`handleCreateBatch` 传参，工具 description 加引导示例
  - `src/client/types.ts` + `src/client/in-process.ts` + `src/client/http.ts` — `createMember` 客户端接口扩展
  - `src/teams/files.ts` — `initMemberDir` / `readMemberIndex` / `writeMemberIndex` 处理 profile.constraints 持久化
- **运行时行为**：
  - member 的 system prompt 从 ~2 行变为 ~40 行结构化契约，首次加载 token 增加 ~600，但属 cacheable 的 static 段
  - leader 传 constraints 时，每个 member 的 L1 包含定制化 Anti-Patterns；不传时使用通用兜底
  - 现有调用方（未传 constraints）行为兼容，prompt 退化为通用契约
- **依赖**：无新增依赖
- **测试**：`context.ts` 的 `buildIdentityLayer` / `buildMemberSystemPrompt` 单元测试（七分区存在性 + constraints 注入 + 兜底）；`team` 工具 schema 测试（constraints 字段透传）
