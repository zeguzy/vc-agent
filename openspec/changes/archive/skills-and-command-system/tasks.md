# Skills + Command 系统 — 任务列表

按依赖顺序排列，每任务 ≤ 2 小时。

| # | 任务 | 文件 | 状态 |
|---|---|---|---|
| 1 | 创建 SkillManager — 封装 Pi SDK 技能加载，管理 auto + dynamic 两类技能 | src/skills/manager.ts | ✅ |
| 2 | 扩展 Config — SkillsConfig 接口 (paths/autoLoad/disabled) | src/config.ts | ✅ |
| 3 | 改造 Session 创建 — 使用 DefaultResourceLoader + SkillManager 配置 | src/agent/session.ts | ✅ |
| 4 | 创建 CommandRegistry — 注册/匹配/执行/注销 | src/commands/registry.ts | ✅ |
| 5 | 重构命令系统 — 用 Registry 替代 switch/case；新增技能命令 | src/tui/commands.ts + App.tsx | ✅ |
| 6 | 验证 — typecheck + lint + test | bun run check | ✅ |
| 7 | 补充测试 — CommandRegistry 11 tests, SkillManager 7 tests | tests/*.test.ts | ✅ |
| 8 | 归档 — 设计文档 + 规格更新 | openspec/changes/archive/ | ✅ |
