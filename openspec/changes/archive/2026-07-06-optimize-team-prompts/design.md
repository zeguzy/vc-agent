## Context

vc-agent 当前有 5 个内置 agent（flagella/ribosome/nucleus/plasmid/lysosome）+ 用户可在 `~/.config/openagent/agents/` 或 `<cwd>/.openagent/agents/` 定义自定义 agent，以及 4 种 AgentMode（standard/team/planner/orchestrator）。

**系统提示词加载链分两条独立路径**：

1. **静态上下文文件路径**（`src/context-files.ts:loadSystemContext(cwd, config)`）：只负责拼装 `BASE_SYSTEM_PROMPT + 全局 AGENTS.md + 项目级 AGENTS.md + config.instructions`，返回单个 string。**不处理 AgentMode 相关的 prompt**。
2. **AgentMode 追加提示词路径**（`src/agent/session.ts:appendSystemPromptFor(agentMode, config)` → `initServices.appendSystemPrompt` → `SkillManager.initialize` → Pi SDK `ResourceLoader.appendSystemPrompt`）：在静态上下文之外，按 agentMode 追加 `ORCHESTRATOR_SYSTEM_PROMPT` / `TEAM_ORCHESTRATOR_PROMPT`。模式切换时（`handleSetAgentMode`）还会通过 `session.steer()` 运行时追加。

对比 claude-code-cli 后发现两个 prompt 层短板：

1. **委托质量**：`ORCHESTRATOR_SYSTEM_PROMPT`（context-files.ts L20-77）已有 Intent Gate 路由和 GOAL/CONTEXT/SCOPE 三段式约束，**L52 已有 "If your delegation prompt is shorter than 3 lines, it is too vague" 硬约束**，但缺少"coordinator 必须先理解研究结果再写委托"的反例教学。LLM 实际产出常是"based on your findings, fix the bug"这类懒惰委托。

2. **验证哲学**：`lysosome.systemPrompt`（defaults.ts L163-204）是"系统性检查清单"——列出 Correctness/Architecture/Type safety 等维度让 agent 自查，输出 `## Verdict` 段 + `APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION`。这种风格容易让 LLM 走过场（"看起来没问题 → APPROVE"）。claude-code 的 verification agent 哲学是"try to break it"，强制 VERDICT + 实际运行验证命令，明显更严格。

**已确认**：grep `APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION|Verdict` 在 src/ 和 tests/ 下除 defaults.ts 外无任何匹配——**lysosome 输出无下游解析**，可安全变更 Verdict 词义（包括新增 PARTIAL 状态）。

同时 subagent 工具的 agent 列表当前内联在工具 description 里（`src/tools/subagent.ts` 用 `discoverAgents(cwd)` 动态生成，含内置 + 用户自定义），每次工具调用结果返回时都进 LLM 上下文，cache 不友好。

### 当前数据流

```
主 agent session 启动（src/agent/session.ts:createRuntime L290）
  │
  ├─ agentMode = options.agentMode ?? getBaseMode(config)           // L295-296
  │
  ├─ svc = initServices({                                           // L298-303
  │     cwd, config, modelStr,
  │     appendSystemPrompt: appendSystemPromptFor(agentMode, config) // L302 ← 关键
  │   })
  │   │
  │   ├─ modelRegistry / settingsManager / lspClient / mcpManager 初始化
  │   └─ skillManager.initialize(cwd, config, settingsManager, appendSystemPrompt)  // L205-210
  │       │
  │       └─ 创建 ResourceLoader（含 appendSystemPrompt，由 Pi SDK 消费）
  │            └─ ResourceLoader 内部还调用 loadSystemContext(cwd, config)
  │                拼 BASE + AGENTS.md + instructions（这条路径不含 agentMode prompt）
  │
  └─ factory → createAgentSession({ resourceLoader: svc.resourceLoader, ... })

模式切换（src/server/index.ts:handleSetAgentMode L266-275）
  ├─ session.setActiveToolsByName(activeToolsFor(mode))
  ├─ if orchestrator: session.steer(ORCHESTRATOR_SYSTEM_PROMPT)     // 运行时追加
  └─ if orchestrator|team && teams.enabled: session.steer(TEAM_ORCHESTRATOR_PROMPT)

subagent 调用（src/agents/runner.ts:runSubagent）
  ├─ new DefaultResourceLoader({
  │     cwd, agentDir, settingsManager,
  │     appendSystemPrompt: [agent.systemPrompt],                    // 仅 agent 自身 prompt
  │     noExtensions: true, noSkills: true, noContextFiles: true    // ← 已全覆盖
  │  })
  └─ createAgentSession({ tools, resourceLoader, ... })             // 独立 session，零父上下文
```

### 关键约束

- `appendSystemPromptFor` 定义在 **`src/agent/session.ts` L105-113**（不在 context-files.ts）；context-files.ts 只导出 prompt 常量 + `loadSystemContext`
- Pi SDK `ResourceLoader` 接受 `appendSystemPrompt: string[]`，已支持 `noContextFiles/noSkills/noExtensions` 开关
- Pi SDK 是否暴露 `cache_control` 标记 API **未确认**（Open Question 1）—— 本 change 不依赖
- 当前所有 subagent 都已 `noContextFiles: true`（runner.ts L21）——Wave 2 的"全覆盖"实际已达成，本 change 仅补测试保障
- lysosome 工具集为 `["read", "grep", "find", "bash"]`，已能跑 tsc/biome/bun test（通过 bash）
- lysosome 当前输出 `APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION` **无任何下游解析**（grep 验证），可安全改为 `PASS/FAIL/PARTIAL`

## Goals / Non-Goals

**Goals:**

- ORCHESTRATOR_SYSTEM_PROMPT 加入反例教学，让 LLM 产出含具体文件路径+行号的委托 prompt
- lysosome 升级为对抗性验证，强制 VERDICT 输出，要求实际运行验证命令
- 系统提示词加载链引入 cache 友好的分段结构，减少 cache bust
- subagent 工具 description 中的 agent list 抽出到 attachment，避免工具调用时反复进 prompt

**Non-Goals:**

- 不改 Pi SDK（如 SDK 不支持 cache_control，本 change 降级为"文档化边界 + 顺序优化"）
- 不引入新 agent（不加 verification/optimizer 等新角色）
- 不改 agent 工具集（lysosome 仍 read-only）
- 不动 subagent 执行机制（仍零上下文，无 fork）
- 不引入"强制每轮实现后必须调 lysosome"的硬流程

## Decisions

### 决策 1：lysosome 哲学升级而非新增 agent

**选择**：重写 `lysosome.systemPrompt` 为对抗性验证风格，不新增 `verifier` agent。

**理由**：
- 避免角色爆炸——5 个内置 agent 已覆盖感知/合成/决策/规划/审查，新增第 6 个破坏生物隐喻
- lysosome 的"溶酶体降解缺陷蛋白"隐喻本身就契合"对抗性验证"语义
- 工具集不变（read/grep/find/bash），无需调整工具白名单或权限

**替代方案（已否决）**：
- 新增 `verifier` agent → 角色与 lysosome 重叠，用户难选择
- 把 lysosome 改名 `verifier` → 破坏现有 spec 和用户习惯

### 决策 2：cache 边界仅作代码注释文档化，不引入强制运行时行为的 spec requirement

**选择**：在 `src/agent/session.ts` 和 `src/context-files.ts` 的关键位置加 `// CACHE-STATIC` / `// CACHE-DYNAMIC` 注释，仅作文档化标记（提示维护者哪些段稳定、哪些会 bust cache）。**不调整加载顺序**（实际顺序已基本正确：static 在前），**不引入强制运行时行为的 spec requirement**（spec 仅要求"注释存在"这个文档化事实，不要求任何 cache 行为），**不加测试**。

**理由**：
- Oracle 评审指出：当前 `loadSystemContext` 顺序已是 static 在前（BASE → AGENTS → instructions），`appendSystemPrompt` 也排在末尾——顺序优化空间已耗尽
- 仅加注释不强制运行时行为，ROI 接近 0，但文档化对维护者有价值（避免未来误把 dynamic 段插到 static 前）
- 如果后续实测 cacheReadTokens 发现明显收益，再升级为 spec requirement + 测试

**替代方案（已否决）**：
- 调用 SDK cache_control → 依赖未确认 API（Open Question 1），风险高
- 把 cache 注释升级为 spec requirement + 测试 → ROI 不足以支撑维护成本
- 完全不加注释 → 维护者不知道 cache 边界在哪，未来改动可能意外破坏

### 决策 3：agent list 通过 discoverAgents 动态生成后注入系统提示词

**选择**：新增 `buildAvailableAgentsPrompt(cwd)` 函数（调用 `discoverAgents(cwd)` 拿到**所有** agent：5 个内置 + 用户自定义），生成 markdown 描述段。在 `appendSystemPromptFor`（session.ts L105）里，standard 和 orchestrator 模式下把它加入 appendSystemPrompt 数组。subagent 工具 description 移除详细描述，只保留 mode 说明 + 一行动态索引。

**为什么是动态而非硬编码 5 个内置**：
- Oracle 评审指出：`src/tools/subagent.ts` 用 `discoverAgents(cwd)` 动态发现所有 agent（含用户在 `~/.config/openagent/agents/` 或 `.openagent/agents/` 定义的自定义 agent）。如果只把内置 5 个移到系统提示词、工具 description 删掉详细描述，**用户自定义 agent 的描述就无处可见**，LLM 无法调用——破坏自定义 agent 可用性
- 因此 agent list 必须动态生成，覆盖所有 discoverAgents 结果

**token trade-off 分析**：
- Oracle 担心 standard 模式（默认模式，可能不调 subagent）always carry agent list ~400 token
- 但现状是：standard 模式本来就有 subagent 工具，agent list 已经在工具 description 里 always carry（工具定义在每次请求附带）
- 移到系统提示词后：工具 description 变短（省 ~400 token），系统提示词变长（加 ~400 token）——**净 token 持平**
- 真正的收益是 cache：系统提示词的 agent list 是 cacheable 的（appendSystemPrompt 数组排在 static 末尾），而工具 description 在工具调用结果返回时反复进上下文——移到系统提示词后 cache 命中率提升

**为何仅 standard/orchestrator 注入**：
- planner 模式：只读规划，subagent 工具不在白名单，不需要 agent list
- team 模式：用 team 工具而非 subagent，subagent 工具不在白名单，不需要 agent list

**替代方案（已否决）**：
- 硬编码 5 个内置 agent → 丢失用户自定义 agent，破坏可用性
- 保留在工具 description → cache 不友好（工具定义反复进上下文）
- 通过单独的 `agents.md` 文件注入 → 多一层 I/O，且 `noContextFiles: true` 的 subagent 看不到
- 撤销决策 3（保留现状）→ 放弃 cache 优化收益，但减少改动范围——已权衡，净 token 持平且 cache 收益值得做

### 决策 4：用 ESM 模块化重组系统提示词

**选择**：把 `ORCHESTRATOR_SYSTEM_PROMPT`、`TEAM_ORCHESTRATOR_PROMPT`、`BASE_SYSTEM_PROMPT` 拆成多个小常量（如 `INTENT_GATE_SECTION`、`DELEGATION_SECTION`、`NEVER_DELEGATE_UNDERSTANDING_SECTION`、`PARALLEL_EXECUTION_SECTION` 等），按段落拼装。每个 section 单独可测、可标记 cache 边界。

**理由**：
- 当前 ORCHESTRATOR_SYSTEM_PROMPT 是单个 ~60 行模板字符串，难维护
- 分段后可在测试中快照每个 section，避免意外回归
- 为决策 2 的 cache 边界标记提供物理基础

**替代方案（已否决）**：
- 维持单模板字符串 → 难以做 cache 边界标记
- 改用 YAML/JSON 配置 → 失去 TypeScript 模板字符串的可读性

## Risks / Trade-offs

### 风险 1：lysosome VERDICT 格式可能被 LLM 偶尔遗漏

- **风险**：LLM 在长篇分析后可能忘记输出 `VERDICT: PASS/FAIL/PARTIAL` 行
- **缓解**：prompt 中用 "REQUIRED — response is invalid without this line" 强约束；可在 `runSubagent` 后处理时检测 VERDICT 行是否存在，缺失则返回 error 让 orchestrator 重新委托
- **残留风险**：后处理检测属可选增强，本 change 不实现，留待后续

### 风险 2：ORCHESTRATOR_SYSTEM_PROMPT 变长导致 token 增加

- **风险**：加入反例教学段后，每次 orchestrator 模式启动多消耗 ~300 token
- **缓解**：反例教学段是 cacheable 的 static 段（决策 2），首次加载后命中 prefix cache，边际成本趋近于 0
- **权衡**：300 token 换"委托质量提升"是高 ROI

### 风险 3：agent list 移到系统提示词后，LLM 可能误用不存在的 agent 名

- **风险**：LLM 在不知道完整 agent 列表的情况下，可能调用 `agent: "researcher"`（不存在的 agent）
- **缓解**：`buildAvailableAgentsPrompt(cwd)` 动态生成完整列表（含用户自定义），注入系统提示词；工具 description 保留一行索引（动态生成，如 `Available agents: flagella, ribosome, ... (+ N custom). See system prompt for details.`）
- **权衡**：LLM 读系统提示词是默认行为，索引+详情分离是常见模式；动态生成确保用户自定义 agent 不丢失

### 风险 4：cache 边界注释可能被 biome 格式化误删

- **风险**：`// CACHE-STATIC` 注释可能被 lint 工具视为冗余
- **缓解**：用 `/* CACHE-STATIC */` 块注释 + biome.json 配置保留；测试中校验注释存在
- **权衡**：注释不强制运行时行为，仅文档化意图

### 风险 5：noContextFiles 已全覆盖，"Wave 2 全覆盖"目标实际无代码改动

- **发现**：runner.ts L21 已 `noContextFiles: true`，5 个内置 agent 都走同一 `runSubagent`，已全覆盖
- **处置**：本 change 在 tasks 中改为"添加测试验证全覆盖"，而非"修改代码"
- **权衡**：测试覆盖也是交付物

## Migration Plan

纯 prompt 改动 + 加载链重构，无数据迁移、无 API 破坏。

**部署步骤**：
1. 合并到 main 后，下次 `bun run dev` 自动生效
2. 用户无需改 config.json
3. 现有 session 不受影响（系统提示词在新 turn 时按新逻辑组装）

**回滚策略**：
- `git revert <merge-commit>` 即可
- 无需 downgrade 数据/配置

## Open Questions

1. **Pi SDK 的 `ResourceLoader` 是否暴露 cache_control 标记 API？**
   - 影响：决策 2 是否能进一步优化（当前已降级为纯注释文档化）
   - 处置：本 change 不依赖，作为后续 `prompt-cache-hardening` change 的调研项
   - 验证方式：实施时读 `@earendil-works/pi-coding-agent` 的 .d.ts，确认接口形状

2. **lysosome 输出 VERDICT 行的稳定性如何？**
   - 影响：是否需要后处理强制校验
   - 处置：实施后用真实场景跑 5-10 次，统计 VERDICT 行命中率；<90% 则在后续 change 补后处理
   - 验证方式：手动调用 `subagent({ mode: "single", agent: "lysosome", description: "review src/..." })`，检查输出
   - **本 change 不实现后处理**（属可选增强，引入运行时校验需独立评估对 subagent 返回值的影响）

3. **`ResourceLoader.appendSystemPrompt: string[]` 的拼接行为？**
   - 影响：决策 3 把 `buildAvailableAgentsPrompt` 加入数组后，SDK 如何拼接（是否插入分隔符、元素间是否影响 prefix cache 边界）
   - 处置：实施时读 Pi SDK 的 SkillManager.initialize（session.ts L205-210 调用）下游的 ResourceLoader 构造逻辑，确认拼接行为
   - 验证方式：在 appendSystemPrompt 数组里放两个元素，运行后检查最终 system prompt 的实际拼接结果

## Oracle 评审已确认项（不再 Open）

- ✅ `appendSystemPromptFor` 实际位置：`src/agent/session.ts` L105-113（不在 context-files.ts）
- ✅ `ORCHESTRATOR_SYSTEM_PROMPT` 注入路径：`appendSystemPromptFor → initServices → SkillManager.initialize → ResourceLoader`（主路径）+ `handleSetAgentMode → session.steer`（模式切换）
- ✅ lysosome 输出 `APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION` 无任何下游解析（src/ + tests/ grep 验证），可安全改为 `PASS/FAIL/PARTIAL`
- ✅ ORCHESTRATOR_SYSTEM_PROMPT L52 已有 "3 行硬约束"，本 change 是补反例教学而非新增规则
