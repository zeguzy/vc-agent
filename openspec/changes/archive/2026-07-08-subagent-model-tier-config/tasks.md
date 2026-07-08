# Implementation Tasks

## 1. Config Schema 扩展

- [ ] 1.1 在 `src/config.ts` 新增 `ModelTier` 类型（`"fast" | "standard" | "powerful"`）和 `SubagentsConfig` 接口（`modelTiers?`, `models?`, `fallback?`），将 `subagents?` 可选字段加入 `Config` 接口
- [ ] 1.2 验证 `readConfig` 的 deepMerge 能正确合并全局 + 项目 config 的 `subagents` 块（若不能，补 merge 逻辑）

## 2. Type 定义扩展

- [ ] 2.1 在 `src/agents/types.ts` 的 `AgentConfig` 接口新增 `tier?: ModelTier` 字段（从 config.ts import 类型）
- [ ] 2.2 在 `src/agents/types.ts` 的 `SubagentServices` 接口新增 `config?: Config` 字段
- [ ] 2.3 在 `src/agent/session.ts` 的 `InitializedServices` 接口新增 `config?: Config` 字段，并在 `initServices` 中赋值 `config: config`

## 3. 统一模型解析器

- [ ] 3.1 新建 `src/agents/model-resolver.ts`，实现 `resolveSubagentModel({ agent, config, modelRegistry, parentModel, extraFallback? }): ResolvedModel | undefined` 函数，按 8 级链式优先级解析：`config.subagents.models[agent.name]` > `config.subagents.modelTiers[agent.tier]` > `parentModel`（已解析，直接用） > `agent.model`（经 resolveModel） > `extraFallback`（经 resolveModel） > `config.subagents.fallback`（经 resolveModel） > `config.model`（经 resolveModel） > 返回 undefined。关键：parentModel（③）优先于 agent.model（④），因为 agent.model 字符串经 resolveModel 可能误匹配到错误 provider
- [ ] 3.2 导出 `NO_MODEL_ERROR` 常量字符串，供 runner.ts 和 worker.ts 在解析失败时抛出统一错误信息（包含 agent name 和已尝试候选列表）

## 4. Frontmatter 解析

- [ ] 4.1 在 `src/agents/discover.ts` 的 frontmatter 解析逻辑中新增 `tier` 字段提取，验证值必须是 `"fast" | "standard" | "powerful"` 之一，非法值时忽略 tier 并输出警告日志

## 5. 内置 Agent Tier 标注

- [ ] 5.1 在 `src/agents/defaults.ts` 为 5 个内置 agent 添加 `tier`：flagella=`fast`, ribosome=`standard`, nucleus=`powerful`, plasmid=`standard`, lysosome=`powerful`

## 6. Runner 接入统一解析器

- [ ] 6.1 修改 `src/agents/runner.ts:13`，将 `const model = agent.model ? resolveModel(...) : parentModel` 替换为调用 `resolveSubagentModel({ agent, config: services.config, modelRegistry: services.modelRegistry, parentModel })`
- [ ] 6.2 在 model 为 undefined 时抛出 `NO_MODEL_ERROR` 错误（对齐 worker.ts:244-248 的防御性检查）
- [ ] 6.3 移除 runner.ts 中对 `resolveModel` 的直接 import（如不再使用）

## 7. Worker 接入统一解析器

- [ ] 7.1 修改 `src/teams/worker.ts:222-248`，将本地模型解析逻辑替换为调用 `resolveSubagentModel({ agent, config, modelRegistry, parentModel, extraFallback: defaultWorkerModel })`（config + defaultWorkerModel 需从 worker 构造参数透传）
- [ ] 7.2 确保 worker.ts 的 `config` 参数透传：检查 `Worker.create` 的调用方是否已传入 config，若无则在构造参数中新增
- [ ] 7.3 验证行为等价：worker 原有 parentModel-first 逻辑被统一解析器覆盖（③ parentModel 优先于 ④ agent.model），verbose 日志保留

## 8. Config 透传

- [ ] 8.1 修改 `src/agent/session.ts` 的 `createSubagentTool` 调用处，将 `config` 传入 `services`（`services: { ...svc, config }`）
- [ ] 8.2 修改 `src/tools/subagent.ts`（或 `src/agents/runner.ts` 的 `runSubagent` 签名），确保 `config` 从 `services` 流入 `resolveSubagentModel` 调用
- [ ] 8.3 在 `src/server/index.ts`（如也有 subagent 创建路径）同步透传 config

## 9. 测试

- [ ] 9.1 新建 `tests/agents-model-resolver.test.ts`，测试链式回退优先级（8 级）：每个优先级命中即停、越级跳过、parentModel（③）优先于 agent.model（④）、全部 miss 返回 undefined、extraFallback 参数仅 worker 路径传入
- [ ] 9.2 测试 `tier` frontmatter 解析：合法值写入 AgentConfig、非法值忽略 + 警告
- [ ] 9.3 运行 `bun run check`（typecheck + lint + test）确认全绿
