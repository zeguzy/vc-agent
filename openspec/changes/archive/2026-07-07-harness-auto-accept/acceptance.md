## Smoke

- `bun run check` 应全绿（typecheck + lint + test），acceptance-smoke 套件默认 skip 不影响
- `ACCEPTANCE_SMOKE=1 bun test tests/acceptance-smoke.test.ts` 应全 PASS（若环境支持 bun install + 网络可达）。若环境不允许（如代理未启动），标注 SKIP 并说明原因
- 验证 `tests/helpers/real-server.ts` 已创建且导出 `createRealServer` 函数：
  ```bash
  bun -e "import { createRealServer } from './tests/helpers/real-server.ts'; console.log(typeof createRealServer)"
  ```
  应输出 `function`
- 验证 `tests/team-e2e-llm.test.ts` 已改为从 helper import（无内联 createRealServer 定义）：
  ```bash
  bun -e "const src = await Bun.file('./tests/team-e2e-llm.test.ts').text(); console.log(src.includes('from \"./helpers/real-server.js\"'))"
  ```
  应输出 `true`

## Manual QA

- 阅读 `.opencode/skills/opsx-accept/SKILL.md`：触发条件应明确包含「harness 步骤 6 自动调用」和「用户显式 /opsx-accept」
- 阅读 `.opencode/skills/harness/SKILL.md` 步骤 6：应明确写「调用 /opsx-accept skill 跑三层自动验收」+「保留 ★ 用户参与点」+「不取消人工把关」
- 阅读 `.opencode/skills/harness/SKILL.md` 自动流转规则表：「验收→合并清理」行触发条件应改为「自动验收通过 + 用户确认」
- 阅读 `.opencode/skills/harness/SKILL.md` 护栏段：应包含「自动验收不替代用户确认」条目
- 阅读 `.opencode/skills/harness/SKILL.md` frontmatter：`metadata.version` 应为 `1.4`
- 确认未修改任何 `src/` 代码（本 change 纯文档 + 测试新增）
- 确认 opsx-accept SKILL.md 护栏段明确写「不调 `/prompt`」并解释原因（handler 阻塞至完整 agent turn）

## Log Assertions

N/A — 本 change 不改 team 日志系统（`src/teams/logger.ts`），无 team 事件可断言。该段对当前 change 自然空。
