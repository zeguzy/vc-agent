## 1. lysosome 对抗性升级

- [x] 1.1 重写 `src/agents/defaults.ts` 中 lysosome 的 systemPrompt（建议同样拆成 section 常量提升可维护性）：哲学改为"试图证伪的独立验证者"；加入 6 种自我合理化借口识别清单（"the code looks correct → reading is not verification" 等）；强制输出 `VERDICT: PASS | FAIL | PARTIAL` 行（缺失则响应无效）；要求 PASS 必须附带 Evidence 段（实际运行的 tsc/biome/test 命令+结果）；FAIL 必须为每个 broken claim 提供反例；工具不可用时输出 PARTIAL + unverified 列表。**注**：当前 `APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION` 经 grep 确认无下游解析，可安全替换
- [x] 1.2 在 `tests/agents/defaults.test.ts` 加 lysosome prompt 内容测试：断言 systemPrompt 含 `VERDICT:` 关键字、含 "reading is not verification" 借口关键词、含 Evidence 段要求、不再含 `APPROVE` 旧词

## 2. ORCHESTRATOR_SYSTEM_PROMPT 模块化 + Never delegate understanding 反例教学

- [x] 2.1 把 `src/context-files.ts` 的 `ORCHESTRATOR_SYSTEM_PROMPT`（L20-77）拆分为多个 section 常量（`INTENT_GATE_SECTION`、`DELEGATION_SECTION`、`PARALLEL_EXECUTION_SECTION`、`FAILURE_RECOVERY_SECTION`、`EVIDENCE_SECTION`、`COMMUNICATION_SECTION`），每个 section 是独立 string export
- [x] 2.2 新增 `NEVER_DELEGATE_UNDERSTANDING_SECTION` 常量：原则声明（coordinator 必须先理解研究结果再写委托）+ ❌/✅ 反例对照（含具体路径如 `src/auth/validate.ts:42`）+ **强化已有的 "3 行硬约束"**（ORCHESTRATOR L52 已有 "If your delegation prompt is shorter than 3 lines, it is too vague"，本 task 是把这条规则纳入 NEVER_DELEGATE_UNDERSTANDING_SECTION 并补反例上下文，不是新增规则）
- [x] 2.3 用 section 常量按顺序拼装重构后的 `ORCHESTRATOR_SYSTEM_PROMPT`，将 `NEVER_DELEGATE_UNDERSTANDING_SECTION` 置于 `DELEGATION_SECTION` 之后
- [x] 2.4 在 `tests/context-files.test.ts` 加 ORCHESTRATOR_SYSTEM_PROMPT 内容测试：断言含 "Never delegate understanding" 段、含反例关键字（"based on your findings"）、含 "3 lines" 硬约束

## 3. subagent agent list 动态抽取到系统提示词

- [x] 3.1 在 `src/agents/discover.ts`（或新建 `src/agents/prompt-builder.ts`）新增 `buildAvailableAgentsPrompt(cwd): string` 函数：调用现有的 `discoverAgents(cwd)` 拿到**所有** agent（5 个内置 + 用户自定义），生成 markdown 描述段（name + description + 典型用例 + 工具集）。**关键**：必须动态发现，不能硬编码 5 个内置——否则用户自定义 agent 描述丢失，LLM 无法调用
- [x] 3.2 修改 `src/tools/subagent.ts` 的工具 `description`：移除 `agentTable` 动态生成的详细描述部分，仅保留 mode 取值说明（single/parallel/chain）、参数结构、GOAL/CONTEXT/SCOPE 委托模板要求，以及一行动态索引（如 `Available agents: see system prompt for the full list.`）
- [x] 3.3 修改 `src/agent/session.ts` 的 `appendSystemPromptFor`（L105-113）：在 standard 和 orchestrator 模式下，调用 `buildAvailableAgentsPrompt(cwd)` 生成 agent list 段，加入 `appendSystemPrompt` 返回数组（planner/team 模式不注入）。**注意修改位置是 session.ts，不是 context-files.ts**——appendSystemPromptFor 定义在 session.ts L105

## 4. cache 边界注释（仅文档化）

- [x] 4.1 在 `src/agent/session.ts` 的 `appendSystemPromptFor` 函数和 `src/context-files.ts` 的 `loadSystemContext` 关键位置加 `// CACHE-STATIC`（BASE/AGENTS/instructions/ORCHESTRATOR/TEAM prompt/agent list）和 `// CACHE-DYNAMIC`（运行时 steer 注入的 task/TEAM.md 摘要）注释，仅作文档化标记。**不调整加载顺序**（当前顺序已正确），**不加强制运行时行为的 spec requirement**（spec 仅要求注释存在，不要求 cache 行为），**不加测试**——决策 2 已降级，避免 ROI 不足的过度工程

## 5. 只读 agent noContextFiles 测试保障

- [x] 5.1 创建 `tests/agents/runner.test.ts`：mock `createAgentSession`，对 flagella/nucleus/plasmid/lysosome 各跑一次 `runSubagent` 调用断言，验证传入的 `resourceLoader` 配置含 `noContextFiles: true`、`noSkills: true`、`noExtensions: true`；任一缺失则测试失败

## 6. 全量验证

- [x] 6.1 运行 `bun run check`（typecheck + lint + test），修复任何由本次改动引入的回归（不修复无关的预存在问题）
