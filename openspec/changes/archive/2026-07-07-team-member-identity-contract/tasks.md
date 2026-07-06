## 1. context.ts 核心重构（七分区行为契约）

- [x] 1.1 在 `src/teams/context.ts` 新增七个 section 常量/函数（`MEMBER_IDENTITY_SECTION` / `MEMBER_CAPABILITIES_SECTION` / `MEMBER_WORK_DISCIPLINE_SECTION` / `MEMBER_ESCALATION_SECTION` / `MEMBER_OUTPUT_PROTOCOL_SECTION` / `MEMBER_MEMORY_DISCIPLINE_SECTION` 为独立 export 的 string 常量；Anti-Patterns 段为函数 `buildMemberAntiPatternsSection(customConstraints?: string)`，在通用兜底四条后追加定制约束）。Identity 段改为函数 `buildMemberIdentitySection(name, role, goal, hasConstraints)`，hasConstraints=true 时仅追加一行"行为约束见下方 Anti-Patterns 段"指引（**不重复 constraints 文本**）。实施前先读 `.git/worktree/optimize-team-prompts/src/context-files.ts` 核实该 change 的 ORCHESTRATOR section 拆分模式（常量命名、拼装），保持一致
- [x] 1.2 重写 `buildIdentityLayer`：移除 `agentSystemPrompt` dead parameter，签名改为 `buildIdentityLayer(opts: { name: MemberName; role: string; goal: string; constraints?: string })`，返回按序拼装的七分区字符串（identity 接受 hasConstraints 标志 = `Boolean(constraints?.trim())`，anti_patterns 合并通用 + constraints）
- [x] 1.3 更新 `buildMemberSystemPrompt`：移除 `agentSystemPrompt` 参数，签名加 `name: MemberName`（原本只有 role/goal）和 `constraints?: string`，调用 `buildIdentityLayer` 时透传；L2/L3 调用不变

## 2. types 扩展

- [x] 2.1 在 `src/teams/types-v2.ts` 的 `MemberIndexStructure` 接口**顶层**（不放 profile）新增可选字段 `constraints?: string`
- [x] 2.2 在 `TeamManagerLike.createMember` 的 opts 类型新增可选字段 `constraints?: string`（接口同步，不只是实现类）
- [x] 2.3 确认 `MemberState` **不加** constraints 字段（constraints 是创建时数据，runtime 通过 member index 访问）。在代码注释中说明此决策

## 3. files.ts 持久化扩展（## Constraints markdown section）

- [x] 3.1 修改 `src/teams/files.ts` 的 `initMemberDir(name, role, goal, model?, constraints?)`：接受可选 constraints 参数；调用 `writeMemberIndex` 时传入 `{ profile: {role, goal, model}, constraints, activeContext: "", memoryIndex: [], recentActivity: [] }`
- [x] 3.2 修改 `serializeMemberIndex`：若 `data.constraints` 非空，在 `## Profile` 段之后、`## Active Context` 段之前插入 `## Constraints\n${data.constraints}` section
- [x] 3.3 修改 `parseMemberIndex`：新增 `constraints: sections.get("Constraints") ?? undefined`（顶层字段，`splitSections` 天然支持多行 section body，**无需改 `extractField`**）

## 4. manager-v2.ts 扩展（含 constraints 校验）

- [x] 4.1 修改 `createMember`：opts 接受 `constraints?: string`；**入口处校验**——长度 > 800 字符则截断到 800，移除所有以 `## ` 开头的行（防止破坏 `splitSections`）；校验后的 constraints 透传给 `files.initMemberDir` 和 `buildMemberSystemPrompt`
- [x] 4.2 修改 `restoreMembers`：从 `memberIndex.constraints` 读取（顶层字段），透传给 `buildMemberSystemPrompt`；缺失（undefined）时按未提供处理（退化通用兜底）

## 5. team 工具扩展

- [x] 5.1 在 `src/tools/team.ts` 的 `TeamParamsSchema` 新增 `constraints: Type.Optional(Type.String({ description: "Role-specific behavioral constraints for the member (max 800 chars). Example for reviewer: 'must run tests, no rubber-stamping'" }))`；`BatchMemberSchema` **同步**新增 `constraints` 可选字段（支持 per-member 独立传入）
- [x] 5.2 修改 `handleCreate`：从 args 取 `constraints`，透传给 `manager.createMember`；修改 `handleCreateBatch` 同理（循环内每个 member 独立透传各自的 constraints）
- [x] 5.3 更新 `createTeamTool` 的 `description`：在 create 动作说明里加引导示例，提示 leader 可传 constraints（如 `team(action="create", name="kim", role="reviewer", goal="审查", constraints="must run tests, no rubber-stamping")`），并在 create-batch 示例里展示 per-member constraints 用法

## 6. 客户端接口扩展

- [x] 6.1 在 `src/client/types.ts` 的 `AgentClient.createMember` opts 类型新增可选 `constraints?: string`
- [x] 6.2 修改 `src/client/in-process.ts` 的 `createMember`：透传 constraints 给 `server.handleCreateMember`
- [x] 6.3 修改 `src/client/http.ts` 的 `createMember`：POST body 包含 constraints 字段（已通过 postJson 自动序列化，只需更新 opts 类型）
- [x] 6.4 检查 `src/server/index.ts` 的 `handleCreateMember`：确保 constraints 从请求 body 透传到 `manager.createMember`（若已有透传逻辑则无需改，否则补上）

## 7. 测试

- [x] 7.1 在 `tests/` 新增 `teams-context.test.ts`：测试 `buildIdentityLayer` — (a) 不传 constraints 时返回七分区完整内容 + Anti-Patterns 含通用兜底四条 + 不含 agentSystemPrompt 痕迹；(b) 传 constraints 时 Anti-Patterns 段在通用后追加定制文本 + Identity 段含"见下方"指引 + constraints 文本在整个 L1 只出现一次；(c) `buildMemberSystemPrompt` 返回三元素数组且首元素为 L1
- [x] 7.2 扩展 `tests/team-batch-create.test.ts`（或新增 `team-constraints.test.ts`）：测试 `team` 工具 create 动作接受 constraints 字段并透传给 createMember — mock TeamManager，验证 createMember 收到 constraints 参数；测试 create-batch 每个 member 独立透传 constraints（部分有部分无）
- [x] 7.3 在 `tests/` 新增 `teams-files-constraints.test.ts`：测试 `## Constraints` section 的序列化/解析往返——`serializeMemberIndex` 带 constraints 时生成 `## Constraints` section；`parseMemberIndex` 能读回；无 constraints 时不写 section 且解析返回 undefined（向后兼容旧文件）

## 8. 全量验证

- [x] 8.1 运行 `bun run check`（typecheck + lint + test），修复任何由本次改动引入的回归（不修复无关的预存在问题）。确认七分区常量被 export 且 biome 格式符合（tab/双引号/分号/行宽 100）；确认 `MemberIndexStructure.constraints` 是顶层字段而非 profile 字段
