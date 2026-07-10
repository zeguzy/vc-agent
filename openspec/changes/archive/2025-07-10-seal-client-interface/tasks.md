## Phase A: 新增值类型和方法（不改旧行为）

- [ ] 1.1 在 `src/client/types.ts` 中新增值类型定义：`UserMessageSummary`、`NavigateResult`、`SkillListResult`、`SkillDirectories`、`LoadSkillResult`、`ExtendedModelInfo`
- [ ] 1.2 在 `AgentClient` 接口中新增 ~16 个值类型方法（与泄露 getter 并存）
- [ ] 1.3 在 `AgentServer` 中实现对应 handle 方法（委托到内部模块，返回值类型）
- [ ] 1.4 在 `InProcessClient` 中实现新方法（委托到 server handler）
- [ ] 1.5 在 `src/server/http.ts` 中新增 REST 端点 + localhost 绑定 + loadDynamicSkill 路径验证
- [ ] 1.6 在 `HttpClient` 中实现新方法（通过 REST 端点调用）
- [ ] 1.7 修复 `onSessionChange` 签名：`(session: AgentSession) => Promise<void>` → `(sessionId: string) => Promise<void>`，迁移 App.tsx 回调
- [ ] 1.8 运行 `bun run check` 确保编译通过

## Phase B: TUI 迁移

- [ ] 2.1 迁移 `src/settings/types.ts` — SettingContext 移除内部对象字段，保留 `client: AgentClient`
- [ ] 2.2 迁移 `src/settings/definitions.ts` — apply 函数改用 `ctx.client.*` 方法
- [ ] 2.3 迁移 `src/tui/App.tsx` — SettingContext 构造改为仅用 client；skillManager prop 改用 `client.listSkills()`
- [ ] 2.4 迁移 `src/tui/commands.ts` — `/skills`、`/load-skill`、`/unload-skill` 改用 `ctx.client.*` 方法
- [ ] 2.5 迁移 `src/tui/commands.ts` — `/undo` 命令改用 `client.getUserMessagesForForking()`/`client.getEntryParentId()`/`client.navigateTree()`
- [ ] 2.6 迁移 `src/tui/components/ModelPicker.tsx` — 改用 `client.listModels()`/`client.hasAuthProvider()`/`client.setRuntimeApiKey()`
- [ ] 2.7 迁移 `src/tui/components/InputBox.tsx` — skill 自动补全改用 `client.listSkills()` 值类型
- [ ] 2.8 迁移 `src/tui/commands.ts` — `matchSuggestions` 函数改用值类型参数
- [ ] 2.9 运行 `bun run check` 确保编译通过

## Phase C: 删除泄露方法

- [ ] 3.1 从 `AgentClient` 接口移除 6 个泄露 getter + `onSessionChange` 旧签名
- [ ] 3.2 从 `InProcessClient` 移除对应实现
- [ ] 3.3 从 `HttpClient` 移除对应实现和 NotSupportedError
- [ ] 3.4 确认 TUI 目录无任何对已删除方法的引用
- [ ] 3.5 运行 `bun run check` 全通过
