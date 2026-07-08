## Why

Subagent 生成时模型路由到错误的 provider（openrouter），导致无 API key 崩溃。根因：`runner.ts:13` 的模型解析优先级是 `agent.model > parentModel`，而内置 agent 硬编码了 `deepseek/deepseek-v4-pro`，该字符串经 `resolveModel` 遍历 registry 时命中 openrouter provider 的同名 model id（openrouter 使用 `provider/model-name` id 格式）。Teams worker 路径（`worker.ts:227`）早已修复此 bug（`parentModel` 优先），但 subagent 工具路径从未同步。

此外，当前没有机制让用户为不同 agent 配置不同模型——所有内置 agent 共享同一个硬编码模型字符串，无法按任务强度路由模型。

## What Changes

- **修 Bug**：统一 subagent 和 worker 的模型解析逻辑为 `parentModel > agent.model`，消除 runner.ts 的路由错误
- **新增 Config 块** `subagents`：支持 `modelTiers`（fast/standard/powerful 三档模型）、`models`（按 agent 名精确覆盖）、`fallback`（兜底模型）
- **Agent tier 声明**：`AgentConfig` 新增 `tier?: "fast" | "standard" | "powerful"` 字段，frontmatter 可声明
- **统一解析器**：新建 `src/agents/model-resolver.ts`，链式回退优先级 `per-agent override > tier model > agent.model > parentModel > fallback > global model > throw`，runner.ts 和 worker.ts 共用
- **Config 透传**：`SubagentServices` 和 `InitializedServices` 新增 `config` 字段，使子代理路径可访问用户配置

## Non-goals

- 不做动态运行时模型选择（编排 LLM 每次调用时自选模型）——用户选择了静态 tier 映射方案
- 不修改 `resolveModel` 函数本身的匹配逻辑——仅改变调用方如何选择候选 model 字符串
- 不引入新的 LLM provider 或认证机制
- 不修改 team worker 的 spawn/list/cancel 生命周期行为——仅统一其模型解析调用
- 不为 team members（持久化 session 路径）添加 tier 配置——仅覆盖 subagent tool 和 worker spawn 路径

## Capabilities

### New Capabilities

- `subagent-model-config`: subagent 模型解析的 tier 映射系统——config schema、链式回退解析器、agent tier 声明

### Modified Capabilities

- `agent-session`: subagent 模型解析从 `agent.model > parentModel` 反转为链式回退（parentModel 优先），并支持 tier 配置覆盖

## Impact

- **代码**：`src/config.ts`（schema 扩展）、`src/agents/{types,defaults,discover,runner}.ts`、`src/agents/model-resolver.ts`（新文件）、`src/teams/worker.ts`、`src/agent/session.ts`、`src/tools/subagent.ts`
- **API**：Config 新增可选 `subagents` 块，AgentConfig 新增可选 `tier` 字段——纯增量，不破坏现有配置
- **依赖**：无新增依赖
- **向后兼容**：`subagents` config 缺省时行为等价于 bug 修复后的状态（parentModel 优先），不强制用户配置
