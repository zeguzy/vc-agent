# Tasks: subagent-in-team-mode

- [ ] T1: `TEAM_ACTIVE_TOOLS` 白名单加入 `"subagent"`
- [ ] T2: `createRuntime` factory 中 `isTeamMode` 分支也注册 `createSubagentTool`，非 team 分支保持不变
- [ ] T3: `appendSystemPromptFor("team")` 注入 agent 列表
- [ ] T4: 更新 `src/context-files.ts` 中 team/subagent 互补性描述
- [ ] T5: 更新 `tests/agent-session.test.ts` 中 team 模式断言
- [ ] T6: 运行 `bun run check` 确认全绿
