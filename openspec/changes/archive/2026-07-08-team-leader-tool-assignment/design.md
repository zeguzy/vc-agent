## Context

Team 模式的 leader（`TEAM_ORCHESTRATOR_PROMPT`）从不给成员分配工具和 skill。调研确认 4 层缺陷链：

```
Layer 1 (提示词): TEAM_ORCHESTRATOR_PROMPT 对 tool/skill/mcp 分配零指引
                   leader 不知道默认成员是只读的（无 edit/write）
                        │
                        ▼
Layer 2 (Skill 不可见): injectAgentList 只列 subagent（.openagent/agents/）
                         不列 skill（.opencode/skills/）
                         leader 不知道有哪些 skill 可分配
                        │
                        ▼
Layer 3 (工具定义缺失): buildMemberCustomTools 只创建 memory+message+mcp
                         即使 leader 传 tools=["edit","glob","todo"]
                         这些工具名进入白名单但无 ToolDefinition
                         Pi SDK 静默丢弃 —— 工具根本不注册
                        │
                        ▼
Layer 4 (Legacy 路径): Worker.create() 不传 customTools，noSkills:true 写死
                        （本 change 不修，Non-goal）
```

**当前成员创建管道**：
```
filterMemberTools(opts.tools)         → assignedTools（工具白名单）
buildMemberLoader(systemPrompts, ...)  → resourceLoader（skill 开关）
buildMemberCustomTools(name, mcps)     → memberCustomTools（仅 memory+message+mcp）
createAgentSession({
    tools: syncMemberAllowlist(assignedTools, memberCustomTools),  ← 白名单
    customTools: memberCustomTools,                                ← 定义
})
```

问题在第三步：`buildMemberCustomTools` 不接收 `assignedTools`，即使白名单里有 edit/glob/todo，也不会创建对应 ToolDefinition。

## Goals / Non-Goals

**Goals:**
- Leader 提示词引导工具分配：让 leader 在创建成员时主动思考"这个角色需要什么工具"
- Leader 能看到可分配的 skill 清单
- 成员被分配的工具名能真正注册为可用工具（ToolDefinition 存在）
- team 工具描述增强，明确默认只读

**Non-Goals:**
- 不修 legacy Worker 路径（投入产出比低）
- 不引入运行时动态能力清单（Capability Roster）
- 不改成员创建后的工具更新机制
- 不改 MCP 作用域逻辑

## Decisions

### Decision 1: TEAM_ORCHESTRATOR_PROMPT 新增 "Building Your Team" 板块

**选择**: 在 "How You Think" 之后、"What Good Leadership Looks Like" 之前插入新板块。

**内容**:
- 工具能力表：read-only 组 vs write 组，明确哪些工具需要显式分配
- 规则："Members who write code MUST have edit + write"
- Skill 提示："Check Available Skills below — assign relevant ones"
- MCP 提示："If the member needs external services, specify mcps"

**备选方案**: 把工具指南放在 team 工具的 description 里而非系统提示词。
**否决理由**: 工具 description 已经 20+ 行且 leader 只在调用 team 时才看到；系统提示词每轮都在上下文里，覆盖率更高。

### Decision 2: 创建 `discoverAvailableSkills(cwd)` 函数注入 skill 清单

**选择**: 在 `discover.ts` 新增 `discoverAvailableSkills(cwd)`，读取 `.opencode/skills/*/SKILL.md` 和 `~/.config/openagent/skills/*/SKILL.md` 的 frontmatter（name + description）。在 `appendSystemPromptFor` 的 `injectAgentList` 内部，agent list 之后追加 skill list。

```
appendSystemPromptFor("team")
  → [TEAM_ORCHESTRATOR_PROMPT]
  → injectAgentList
      → buildAvailableAgentsPrompt(agents)     ← 已有
      → buildAvailableSkillsPrompt(skills)     ← 新增
  → [TEAM_ORCHESTRATOR_PROMPT, agentList, skillList]
```

**备选方案 A**: 复用 SkillManager.listSkills()。
**否决理由**: `appendSystemPromptFor` 是 CACHE-STATIC 纯函数，在 SkillManager async 初始化之前调用。引入 SkillManager 依赖会破坏缓存契约。

**备选方案 B**: 把 skill 清单写死在 TEAM_ORCHESTRATOR_PROMPT 里。
**否决理由**: Skill 列表是动态的（用户可随时安装/卸载），写死会过时。

### Decision 3: `buildMemberCustomTools` 接收 assignedTools，按需创建工具定义

**选择**: 修改签名为 `buildMemberCustomTools(memberName, assignedTools, assignedMcps)`。在现有 memory+message+mcp 基础上，根据 assignedTools 中的工具名条件创建：

| 工具名 | 工厂函数 | 参数 | 说明 |
|--------|----------|------|------|
| `edit` | `createEditTool(cwd)` | `this.cwd`，不传 bridge | 成员无确认 UI，直接编辑 |
| `glob` | `createGlobToolDefinition(cwd)` | `this.cwd` | 文件搜索 |
| `todo` | `createTodoTool()` | 无参数 | 任务跟踪 |
| `webfetch` | `createWebfetchTool()` | 无参数 | 网页抓取 |

两个调用点同步更新：
- `createMember()` line 205: 传 `assignedTools`
- `restoreMembers()` line 327: 传 `assignedTools`

**备选方案**: 让 Pi SDK 内置工具注册机制处理（即在 tools 白名单里放了名字就行）。
**否决理由**: edit/glob/todo/webfetch 是 openagent 自定义工具（不在 Pi SDK 内置注册表中），必须有 ToolDefinition。这是 AGENTS.md 文档化的双名单约束。

**关于 edit bridge**: 成员是 headless sub-session，没有 TUI 确认界面。`createEditTool` 的 bridge 参数传 `undefined`，成员直接执行编辑不确认——与成员的 "just do it" 工作模式一致。

**未知工具名处理**: assignedTools 中出现的工具名如果不在工厂映射表中（如拼写错误、未来新增工具、或 SDK 内置工具如 write/bash/read/grep/find），SHALL 被静默忽略。SDK 内置工具通过内部注册表自动注册，无需 customTools 定义。对于既不在工厂映射表也不是 SDK 内置工具的名称（可能是拼写错误），考虑添加 `console.warn` 帮助调试。

### Decision 4: team 工具 description 增强

**选择**: 在 `team.ts` 的工具描述开头加入醒目提示：
```
"IMPORTANT: New members are read-only by default (read, bash, grep, find, memory, message).
To let a member edit code, you MUST specify tools=["read","bash","edit","write","grep","find"]."
```

**理由**: 即使系统提示词有了指南，工具描述是 leader 调用 team 时的最后一道提醒。低成本、高触达。

## Risks / Trade-offs

**[Risk] 成员 edit/write 不经确认且绕过 team-guard**
→ `team-guard.ts` 只包装 `bash` 和 `write` 工具（通过 `createTeamGuardedWriteTool`），但该包装仅在 leader session 创建路径（`session.ts`）中应用。成员的 `write` 工具由 Pi SDK 内置自动注册，**不经过 team-guard 包装**。`edit` 工具通过 `operations.writeFile` 直接写文件，也**绕过 team-guard**。因此当前对 `.openagent/team/` 路径的保护是 prompt 级别（成员 anti-patterns 约束），不是代码级别。
→ Mitigation: (1) 成员的 anti-patterns 提示词已明确禁止触碰 `.openagent/team/` 文件；(2) `edit` 是外科手术式编辑（需匹配已有内容），不像 `write` 那样可随意覆写；(3) 如需代码级保护，应作为后续 change 在 `createEditTool` 和成员 write 路径上加 team-guard——不影响本次变更的推进。

**[Risk] discoverAvailableSkills 读取 SKILL.md frontmatter 与 SkillManager 结果不一致**
→ Mitigation: 两者读取相同目录（`.opencode/skills/` + 全局），格式相同。discoverAvailableSkills 只提取 name + description 用于展示，不做加载；SkillManager 做完整加载。功能正交。

**[Trade-off] buildMemberCustomTools 创建更多工具定义增加内存**
→ Acceptable: 工具定义是轻量对象（schema + handler 闭包），每个几 KB。即使一个成员有全部 4 个额外工具，增量 < 20KB。远小于 LLM 上下文成本。

**[Risk] assignedTools 里的 "write" 是 Pi SDK 内置工具，不需要 customTools 定义**
→ Verified: Pi SDK 内置工具（read/bash/write/grep/find）通过 SDK 内部注册表自动注册。只有 openagent 自定义工具（edit/glob/todo/webfetch/memory/message/mcp）需要 customTools 定义。所以 buildMemberCustomTools 只需处理 edit/glob/todo/webfetch，write/bash/read/grep/find 由 SDK 自动处理。
