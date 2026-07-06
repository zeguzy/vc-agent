## Context

vc-agent 的 team member（通过 `createMember` 动态创建）system prompt 分四层组装（`src/teams/context.ts`）：

```
buildMemberSystemPrompt(opts) → string[]
  ├─ L1 = buildIdentityLayer(role, goal)              ← 行为身份（当前只有两行字符串）
  ├─ L2 = buildMemoryIndexLayer(memberIndex)          ← 动态：member .md 索引
  ├─ L3 = buildTeamSummaryLayer(teamMd, selfName)     ← 动态：TEAM.md 摘要
  └─ (L4 = buildTaskLayer(task)，在 assignTask 时注入)  ← 动态：当前任务
```

L2/L3/L4 是动态数据，已经合理。**问题在 L1**：`buildIdentityLayer` 当前实现（context.ts:6-14）：

```
You are a team member with role "X" and goal "Y".

Use `memory` tool to read your memories and update your index,
and `memory(action="write")` to save new learnings.
```

两行字符串，没有行为约束。形参 `agentSystemPrompt` 存在但 `manager-v2.ts:89-95` 调用时从未传入，是 dead parameter。

### 当前数据流

```
leader 调 team(action="create", name, role, goal)
  │
  ▼
src/tools/team.ts:handleCreate
  │  args → { name, role, goal }
  ▼
src/teams/manager-v2.ts:createMember(opts)
  │  opts = { name, role, goal, model?, services, parentModel? }
  │
  ├─ files.initMemberDir(name, role, goal, model)         ← 写 member .md
  ├─ memberIndex = files.readMemberIndex(name)
  ├─ teamMd = files.readTeamMd()
  │
  ├─ systemPrompts = buildMemberSystemPrompt({            ← 组装 L1+L2+3
  │     role, goal,
  │     memberIndex, teamMd, selfName: name
  │   })        // ❌ 没传 agentSystemPrompt，也没传 constraints
  │
  ├─ new DefaultResourceLoader({ appendSystemPrompt: systemPrompts, ... })
  └─ createAgentSession({ resourceLoader, tools: ["read","bash","grep","find"], ... })

restore 路径（manager-v2.ts:restoreMembers）同构，也是从 memberIndex 读 role/goal 重建。
```

### member .md 持久化格式（关键事实）

**member index 用自定义 Markdown 章节格式，不是 YAML frontmatter**（核实 `src/teams/files.ts:344-377`）：

```
# <role placeholder>

## Profile
- Role: reviewer
- Goal: 审查代码
- Model: deepseek-chat

## Active Context
<多行自由文本>

## Memory Index
- `topic.md` [user] — description

## Recent Activity
- 2026-07-07: entry text
```

解析由 `splitSections`（按 `## ` 切分，section body 含多行）+ `extractField`（**单行** `- Key: value`，files.ts:430-435）完成。`parseFrontmatter`/`serializeFrontmatter`（YAML `---` 块，memory-types.ts）**只用于 topic memory 文件**（`readTopicFile`/`writeTopicFile`/`readSharedTopic`），不用于 member index。

**含义**：constraints 持久化不能用 YAML 多行字符串（`constraints: |`），必须沿用 `## Section` 模式。详见决策 4。

### 关键约束

- `appendSystemPrompt: string[]` 被 Pi SDK `ResourceLoader` 消费，数组元素按序用 `"\n\n"` join 拼接进最终 system prompt（核实 `agent-session.js:645`）
- member 工具集固定：`["read", "bash", "grep", "find"]` + `memory`（customTool）—— 不变
- L2/L3 在 compaction 后会被 `buildCompactionReinject` 重新注入，**L1 不会**（L1 是 static，随 session 创建固定）——所以 L1 的 constraints 必须能在 restore 时从持久化数据重建
- `MemberIndexStructure` 当前结构：`{ profile: {role, goal, model?}, activeContext, memoryIndex[], recentActivity[] }`——扩展新字段需保持向后兼容（可选）

## Goals / Non-Goals

**Goals:**

- L1 从两行字符串升级为七分区结构化行为契约（Identity / Capabilities / Work Discipline / Anti-Patterns / Escalation / Output Protocol / Memory Discipline）
- Anti-Patterns 分区支持动态注入 leader 提供的 role-specific constraints
- 接口向后兼容：不传 constraints 时退化回通用兜底契约，现有调用方零改动
- constraints 持久化到 member index，restore 时能重建完整 L1

**Non-Goals:**

- 不引入 member archetype 枚举
- 不做启发式 role 匹配
- 不动 L2/L3/L4
- 不改 member 工具集
- 不做 member 输出的 Status 行后处理校验
- 不动 subagent 系统（src/agents/）

## Decisions

### 决策 1：七分区行为契约结构，constraints 仅注入 Anti-Patterns

**选择**：L1 拆为七个分区常量，按序拼装。**constraints 只注入 Anti-Patterns 分区**（不重复出现在 Identity）：

```
L1 = [
  MEMBER_IDENTITY_SECTION,           // "You are {name}, a {role}..." + goal
                                     //   + (若 hasConstraints) "见下方 Anti-Patterns 段"
  MEMBER_CAPABILITIES_SECTION,       // 工具清单 + "验证优先于声称"原则
  MEMBER_WORK_DISCIPLINE_SECTION,    // 接 task → 理解 scope → 执行 → 验证 → 报告
  buildMemberAntiPatternsSection(    // 函数：通用兜底 + (leader constraints if provided)
    customConstraints?: string
  ),
  MEMBER_ESCALATION_SECTION,         // 何时 BLOCKED / NEEDS_CONTEXT（4 状态码）
  MEMBER_OUTPUT_PROTOCOL_SECTION,    // Status + Summary + Key files + Evidence
  MEMBER_MEMORY_DISCIPLINE_SECTION,  // 何时写 memory
]
```

Identity 段在 hasConstraints=true 时仅追加一行指引"你的行为约束见下方 Anti-Patterns 段"，不重复 constraints 内容。constraints 文本只在 Anti-Patterns 段出现一次。

**理由**：
- 对比 leader 端 6 大节（Intent Gate/Decomposition/...），member 端需要平行的结构化引导
- 七分区覆盖 member 工作全生命周期：是谁（Identity）→ 有什么（Capabilities）→ 怎么干（Work Discipline）→ 别犯什么错（Anti-Patterns）→ 干不动怎么办（Escalation）→ 怎么交付（Output Protocol）→ 学到什么（Memory Discipline）
- 参考 superpowers 的 implementer-prompt.md 和 claude-code-cli Verification agent 的分区实践

**替代方案（已否决）**：
- 维持单段字符串 + 只加 constraints → 缺其他六区，行为引导仍不完整
- 引入 YAML/JSON 配置驱动 → 失去 TypeScript 模板字符串可读性，过度工程

### 决策 2：constraints 通过 leader 显式传入，不做启发式匹配

**选择**：扩展 `createMember` 接口加 `constraints?: string` 可选参数，由 leader 的 LLM 在创建 member 时根据 role 语义生成。role 仍是自由字符串。

**理由**：
- 启发式匹配（"role 含 research → 给 explorer 约束"）本质是隐式 archetype，与"不引入 archetype"矛盾
- leader 的 LLM 智能远超任何硬编码启发式——它能理解"前端 dev"vs"后端架构师"vs"审查者"的细微差异并生成贴切约束
- 决策权交给 leader 符合 vc-agent 的 team 哲学（TEAM_ORCHESTRATOR_PROMPT: "give them clear roles and specific first tasks"）

**替代方案（已否决）**：
- 启发式关键词匹配 → 隐式 archetype，且对用户自定义 role 名（如中文"实现者"）覆盖差
- 预定义 archetype 枚举 → 破坏自由字符串接口，用户决策已否决
- team-level 共享 constraints（写 TEAM.md）→ 牺牲per-role 定制

### 决策 3：constraints 可选 + 通用兜底契约

**选择**：`constraints` 参数可选。传入时拼进 Anti-Patterns 分区；不传时 Anti-Patterns 只含通用兜底（scope creep / 不验证就报告 / 重复 leader 已做的事 / 擅自改 team 文件 四条）。

**理由**：
- 向后兼容：现有调用方（team 工具未传 constraints）零改动，prompt 自动退化到通用契约（仍比当前两行字符串丰富得多）
- 不强制 leader 每次都写 constraints——leader 可能对简单 role 觉得没必要，强制会造成负担或导致 leader 编造凑数内容
- 通用兜底覆盖 member 最常见的四个失败模式，即使无 constraints 也有基线保障

**替代方案（已否决）**：
- constraints 必填 → 破坏向后兼容，且 leader 可能偷懒编造

### 决策 4：constraints 持久化到独立 `## Constraints` markdown section

**选择**：扩展 `MemberIndexStructure` 顶层（不放 profile）新增 `constraints?: string` 字段。member .md 序列化/解析时新增 `## Constraints` section（与 `## Active Context` 多行 section 同构）。

```
member .md 格式（新增 ## Constraints section）:

# reviewer

## Profile
- Role: reviewer
- Goal: 审查代码

## Constraints                    ← 新增（可选，仅在 constraints 提供时写入）
不许只读代码就放行                  ← 多行自由文本
必须实际运行测试

## Active Context
...

## Memory Index
...
```

**实现**：
- `serializeMemberIndex`：若 `data.constraints` 非空，在 Profile 段之后、Active Context 段之前插入 `## Constraints\n${data.constraints}`
- `parseMemberIndex`：`constraints: sections.get("Constraints") ?? undefined`（`splitSections` 天然支持多行 section body，无需改 `extractField`）
- `MemberIndexStructure` 顶层加 `constraints?: string`（不放 profile——profile 是单行 `- Key: value` 字段，constraints 是多行自由文本，语义不同）

**理由**：
- member index 用自定义 markdown section（非 YAML frontmatter，已核实 files.ts:344-377）——必须沿用 `## Section` 模式
- `## Constraints` 与现有 `## Active Context`（多行自由文本）同构，`splitSections` 天然解析，无需改 `extractField`
- 顶层字段（非 profile）更准确反映语义：constraints 是行为约束，不是身份元数据
- restore 路径直接 `memberIndex.constraints` 读取，无需改 `extractField` 多行支持

**替代方案（已否决）**：
- YAML frontmatter `constraints: |` → member index 根本不用 YAML，前提错误
- 单行 `- Constraints: ...`（放 profile）→ `extractField` 单行解析，多行 constraints 会丢失；且用 `；` 分隔可读性差
- 存 MemberState 内存不持久化 → restore 后 L1 丢失 constraints
- 单独 constraints.md 文件 → 多一层 I/O，过度工程

### 决策 5：移除 agentSystemPrompt dead parameter

**选择**：`buildIdentityLayer` 和 `buildMemberSystemPrompt` 移除 `agentSystemPrompt?: string` 形参。

**理由**：
- grep 确认 `manager-v2.ts` 的 `createMember`（L89-95）和 `restoreMembers`（L179-185）调用 `buildMemberSystemPrompt` 时从未传入该参数
- 该参数预留的"agent 定义自带 systemPrompt"功能在 team member 场景不适用（member 不是 subagent，没有 agent 定义文件）
- 保留死参数误导维护者以为有外部注入路径

### 决策 6：七分区用 section 常量模块化，集中在 context.ts

**选择**：每个分区是独立 string export 常量（`MEMBER_IDENTITY_SECTION`、`MEMBER_CAPABILITIES_SECTION` 等），Anti-Patterns 用函数（因接受 customConstraints）。所有常量定义在 `src/teams/context.ts` 内。

**理由**：
- 与已有 change `optimize-team-prompts` 的 ORCHESTRATOR_SYSTEM_PROMPT 拆 section 常量模式一致（项目内风格统一，实施时核实该 change 的具体模式并保持一致）
- 每个分区独立可测，避免回归
- context.ts 当前 111 行，新增七常量 + 函数后约 ~300 行——仍在单文件可维护范围内（项目其他文件如 manager-v2.ts 689 行、team.ts 396 行均为单文件），无需拆子目录

**替代方案（已否决）**：
- 单个大模板字符串 + 字符串替换 → 难维护，难定位分区
- 拆 `src/teams/sections/` 子目录 → 七个分区强相关，分散反而增加导入负担

### 决策 7：constraints 长度上限 + 写入格式校验

**选择**：`createMember` 入口处校验 constraints：
- 长度上限 **800 字符**（约 200 token，保证 L1 总 token ≤ 800）
- 禁止 constraints 文本含 `## ` 开头的行（防止写入时被 `splitSections` 误判为新 section，破坏 `parseMemberIndex`）
- 超长或含非法格式时：**截断到上限 + 移除 `## ` 行**，不拒绝创建（向后兼容优先）

**理由**：
- leader LLM 可能生成超长 constraints，无 cap 导致 L1 token 失控（风险 1）
- `## ` 前缀行会污染 markdown section 解析（`splitSections` 按 `## ` 切分），必须在写入前清理
- 截断而非拒绝：避免因 constraints 质量问题阻断 member 创建，leader 可后续 edit-member 修正

**替代方案（已否决）**：
- 拒绝超长/非法 constraints → 破坏创建流程，leader 难以预期
- 不校验 → token 失控 + 解析污染风险

## Risks / Trade-offs

### 风险 1：member system prompt token 增加（含 constraints 变量）

- **风险**：L1 七分区骨架基线 ~600 token；若 leader 传 constraints（上限 800 字符 ≈ 200 token），L1 总计 ~800 token
- **缓解**：L1 是 cacheable 的 static 段（appendSystemPrompt 数组排在 ResourceLoader 加载链末尾）
- **cache 边界**：**同一 member 多轮对话内 prefix cache 命中**（L1 不变）；**跨 member 不共享 cache**（不同 member 的 role/goal/constraints 不同，L1 前缀不同）
- **权衡**：~800 token 换"member 行为质量显著提升 + 升级路径明确 + 自检机制"是高 ROI

### 风险 2：leader 不传 constraints，所有 member 用通用兜底

- **风险**：leader 可能偷懒不传 constraints，导致动态性名存实亡
- **缓解**：team 工具 description 加引导示例（"for a reviewer: constraints='must run tests, no rubber-stamping'"）；通用兜底本身已覆盖四大常见失败模式
- **残留风险**：动态约束的覆盖率取决于 leader LLM 的配合度，属可接受的渐进改进

### 风险 3：restore 时 `## Constraints` section 解析异常

- **风险**：member .md 的 `## Constraints` section 可能因手动编辑、磁盘损坏、或旧版本文件格式不一致导致解析异常
- **失败模式**：(a) section 不存在（旧 member .md）→ `sections.get("Constraints")` 返回 undefined → 退化通用兜底；(b) section body 含 `## ` 开头行 → `splitSections` 误切分（决策 7 已在写入时清理，但手动编辑可能引入）→ constraints 内容被截断
- **缓解**：constraints 是可选字段，解析为 undefined 时退化通用兜底，**不阻断 restore**；写入时已清理 `## ` 前缀行（决策 7），降低 (b) 概率
- **权衡**：退化兜底优于 restore 失败

### 风险 4：七分区与未来 archetype 需求的关系（措辞收敛）

- **风险**：未来若引入 archetype，七分区骨架可能需要扩展
- **缓解**：**常见 archetype 场景（只定制 constraints）下骨架不变**——archetype 只是预生成 constraints 参数填入 Anti-Patterns 段。**若 archetype 需定制其他分区**（如 reviewer 改 Capabilities 或 Output Protocol），则需扩展对应 section 的注入点——届时再演进
- **权衡**：当前七分区 + Anti-Patterns 动态注入点覆盖 80% archetype 场景，不阻塞未来扩展

### 风险 5：prompt injection（constraints 由 leader LLM 生成）

- **风险**：constraints 是 leader LLM 生成的文本，直接拼进 member system prompt。若 leader 被恶意用户输入诱导生成 `Ignore previous instructions...` 式 constraints，会劫持 member 行为
- **风险等级**：**与现有 `directMember`（manager-v2.ts:474-499）同级**——leader 本就能通过 directive/context/redirect 向 member 注入任意文本，constraints 只是又一条注入路径，且受限于 Anti-Patterns 分区上下文
- **缓解**：不新增攻击面；不做二次校验（与 directMember 一致）；constraints 长度上限（决策 7）限制注入规模
- **权衡**：vc-agent 的信任模型是"leader 可信"，constraints 继承此边界

## Migration Plan

纯 prompt + 接口扩展，无数据迁移、无 API 破坏（constraints 全部可选）。

**部署步骤**：
1. 合并到 main 后，下次 `bun run dev` 自动生效
2. 现有 member .md（无 `## Constraints` section）restore 时 `sections.get("Constraints")` 返回 undefined，`memberIndex.constraints = undefined`，退化通用兜底——行为正常
3. leader 开始传 constraints 后，新建的 member .md 含 `## Constraints` section；旧 member .md 不受影响（可选 section）

**回滚策略**：
- `git revert <merge-commit>` 即可
- 旧代码读到含 `## Constraints` 的 member .md 时，`splitSections` 仍能解析（多一个 section 不破坏旧解析），`MemberIndexStructure` 无 constraints 字段时忽略——向后兼容

## Open Questions

1. **leader 传 constraints 的实际质量如何？**
   - 影响：动态约束是否真正提升 member 行为质量
   - 处置：实施后用真实 team 场景跑 5-10 次，观察 leader 是否传 constraints + 内容是否贴切
   - 验证方式：手动调 `team(action="create", role="reviewer", constraints="...")`，检查生成 prompt
   - 本 change 不实现自动质量评估（属后续可选增强）

2. **通用兜底 Anti-Patterns 的四条是否足够？**
   - 影响：无 constraints 时的基线保障强度
   - 处置：实施后通过 code review 场景验证；不足再补
   - 候选补充：member 常见失败还有"不读 task description 就开干"、"改了代码不跑测试"——已纳入通用兜底候选

3. **与 optimize-team-prompts 的 section 常量模式是否完全一致？**
   - 影响：项目内代码风格统一
   - 处置：实施时核实该 change 的 ORCHESTRATOR_SYSTEM_PROMPT 拆分模式（常量命名、拼装方式），保持一致
   - 验证方式：读该 change worktree 的 context.ts 改动
