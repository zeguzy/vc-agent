## 1. Skill 发现与清单注入

- [x] 1.1 在 `src/agents/discover.ts` 新增 `AvailableSkill` 类型（`{ name: string; description: string; source: "project" | "global" }`）和 `discoverAvailableSkills(cwd): AvailableSkill[]` 函数，从 `<cwd>/.opencode/skills/*/SKILL.md` 和 `~/.config/openagent/skills/*/SKILL.md` 读取 name + description frontmatter。遵循 `loadAgentsFromDir` 的错误处理模式：跳过缺少/格式错误的 name 或 description frontmatter 的 SKILL.md 文件
- [x] 1.2 在 `src/agents/discover.ts` 新增 `buildAvailableSkillsPrompt(cwd): string | undefined` 函数，将 skill 列表格式化为 markdown 段（`## Available Skills` + 每行 `- **name** (source): description`），无 skill 时返回 undefined
- [x] 1.3 在 `src/agent/session.ts` 的 `appendSystemPromptFor` 中，team 模式下调用 `buildAvailableSkillsPrompt(cwd)` 并追加到 prompt 数组（在 agent list 之后）

## 2. TEAM_ORCHESTRATOR_PROMPT 重构

- [x] 2.1 在 `src/context-files.ts` 的 `TEAM_ORCHESTRATOR_PROMPT` 中，在 "How You Think" 和 "What Good Leadership Looks Like" 之间插入 "## Building Your Team" 板块，包含：默认成员只读说明、工具能力表（read-only vs write 组）、角色-工具映射指引、skill 分配提示（"查看 Available Skills 清单"）、规则"实现类成员 MUST 分配 edit+write"

## 3. team 工具 description 增强

- [x] 3.1 在 `src/tools/team.ts` 的 `createTeamTool` description 字段开头加入醒目提示："IMPORTANT: New members are read-only by default. To let a member edit code, you MUST specify tools=[\"read\",\"bash\",\"edit\",\"write\",\"grep\",\"find\"]."

## 4. buildMemberCustomTools 补全工具定义

- [x] 4.1 在 `src/teams/manager-v2.ts` 修改 `buildMemberCustomTools` 签名为 `(memberName: MemberName, assignedTools: string[], assignedMcps: string[])`，在现有 memory+message+mcp 基础上，根据 assignedTools 中出现的工具名条件创建：`edit` → `createEditTool(this.cwd)`（不传 bridge）、`glob` → `createGlobToolDefinition(this.cwd)`、`todo` → `createTodoTool()`、`webfetch` → `createWebfetchTool()`。在文件顶部 import 这些工厂函数
- [x] 4.2 更新 `createMember` 方法（~L205）调用 `buildMemberCustomTools` 的调用点，传入 `assignedTools`
- [x] 4.3 更新 `restoreMembers` 方法（~L327）调用 `buildMemberCustomTools` 的调用点，传入 `assignedTools`

## 5. 测试

- [x] 5.1 在 `tests/` 新增或扩展 unit test，验证 `buildMemberCustomTools` 在 assignedTools 包含 edit/glob/todo/webfetch 时创建对应 ToolDefinition，不包含时不创建
- [x] 5.2 在 `tests/` 新增 unit test，验证 `discoverAvailableSkills` 能从 .opencode/skills/ 目录发现 skill，`buildAvailableSkillsPrompt` 格式化正确
- [x] 5.3 运行 `bun run check` 确认 typecheck + lint + test 全绿
