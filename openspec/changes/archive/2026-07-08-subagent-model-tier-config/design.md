## Context

openagent 有两条子代理生成路径，模型解析逻辑各自实现、行为不一致：

```
                    ┌─────────────────────────┐
                    │   用户 config.json       │
                    │  model: "Astron:xxx"     │
                    │  providers: [Astron∞]    │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │  initServices()          │
                    │  resolveModel("Astron:xxx")│  ← 有 ':' 前缀，正确路由
                    │  → svc.model (ResolvedModel)│
                    └──┬───────────────────┬───┘
                       │                   │
          ┌────────────▼──┐      ┌─────────▼────────────┐
          │ runner.ts:13  │      │ worker.ts:227        │
          │ (subagent 工具)│      │ (team worker)         │
          │               │      │                       │
          │ BUG:          │      │ FIXED:                │
          │ agent.model   │      │ parentModel           │
          │  > parentModel│      │  > agent.model        │
          │               │      │  > defaultWorker      │
          │ → openrouter  │      │  > throw              │
          │ → 无 key 崩溃  │      │ → 正确               │
          └───────────────┘      └───────────────────────┘
```

根因：内置 agents 硬编码 `model: "deepseek/deepseek-v4-pro"`（无 `:` 前缀），`resolveModel` 遍历 registry.getAll() 匹配 `m.id`，命中 openrouter provider 下同 id 的模型（openrouter 使用 `provider/model-name` id 格式）。

此外，当前没有机制让用户为不同 agent 按任务强度配置不同模型——所有 agent 共享硬编码字符串。

## Goals / Non-Goals

**Goals:**
- 修复 subagent 路径的模型路由 bug（runner.ts 与 worker.ts 行为对齐）
- 引入 tier 映射系统：config 定义 fast/standard/powerful 三档模型，agent 声明所属档位
- 提供链式回退：任一环节解析失败自动降级，绝不静默路由到错误 provider
- 统一解析器消除 runner.ts 与 worker.ts 的代码重复

**Non-Goals:**
- 不做动态运行时模型选择（编排 LLM 每次调用时自选模型）
- 不修改 `resolveModel` 本身的匹配逻辑
- 不为 team members（持久化 session 路径）添加 tier 配置
- 不引入新的 LLM provider 或认证机制

## Decisions

### 决策 1：静态 tier 映射（而非动态运行时选择）

**选择**：Config 定义三档模型，agent 声明 tier，生成时静态解析。

**替代方案**：subagent 工具新增 model/tier 参数让编排 LLM 每次调用时选择。

**理由**：静态映射确定性高、可测试、不依赖 LLM 判断力。编排 agent 通过选择不同 agent 类型（flagella/nucleus）间接选择模型档位，已足够灵活。动态选择虽灵活但增加 LLM 调用复杂度和不可预测性。

### 决策 2：链式回退 7 级优先级（Oracle 评审修正版）

```
resolveSubagentModel(agent, config, registry, parentModel) 解析链：

  ① config.subagents.models[agent.name]     ─── 精确覆盖（最高优先级）
                        │
                        ▼ 无
  ② config.subagents.modelTiers[agent.tier] ─── tier 映射
                        │
                        ▼ 无 / agent 无 tier
  ③ parentModel                             ─── 继承父会话（已解析，安全）
                        │
                        ▼ undefined
  ④ agent.model → resolveModel               ─── agent frontmatter（有风险，最低优先级）
                        │
                        ▼ resolveModel 失败
  ⑤ config.subagents.fallback → resolveModel ─── 显式兜底
                        │
                        ▼ 无
  ⑥ config.model → resolveModel              ─── 全局默认
                        │
                        ▼ 无
  ⑦ THROW                                   ─── 失败暴露，不静默路由
```

**Oracle 评审关键修正**：原设计 ③ agent.model > ④ parentModel，但 `resolveModel` 对无 `:` 前缀的字符串（如 `deepseek/deepseek-v4-pro`）会遍历 registry 匹配 `m.id`，可能**成功匹配到错误 provider**（openrouter 使用 `provider/model-name` id 格式）。这意味着 ③ "成功"返回了一个指向错误 provider 的 ResolvedModel，④ parentModel 永远不会被触达——正是 bug 本身。

修正后 ③ parentModel（已解析、安全）优先于 ④ agent.model（字符串、有误匹配风险）。仅当 parentModel 为 undefined 时才尝试 agent.model。

**理由**：① > ② 让用户精确控制单个 agent；② > ③ 让 tier 配置覆盖父会话模型；③ > ④ parentModel 优先于有风险的 frontmatter 字符串解析；⑤⑥ 兜底防止启动失败。

**config 字符串 colon 前缀指引**：config 中所有 model id 字符串（①②⑤⑥）推荐使用 `provider:model` 冒号语法（如 `Astron:astron-code-latest`），`resolveModel` 对冒号语法走 `registry.find(provider, modelId)` 精确匹配，不会误匹配到其他 provider。无冒号字符串（如 `deepseek-chat`）走 `registry.getAll()` 遍历 `m.id`，有误匹配风险。

**替代方案**：直接用 parentModel（简单但丢失 tier 路由能力）→ 否决，因为用户明确想要 tier 映射。

### 决策 3：统一解析器新建独立文件

**选择**：`src/agents/model-resolver.ts` 导出 `resolveSubagentModel()`。

**理由**：runner.ts 和 worker.ts 共用同一函数消除重复，确保两条路径永不再次分叉。签名接收 `{agent, config, modelRegistry, parentModel, extraFallback?}` 返回 `ResolvedModel | undefined`，调用方负责 throw。`extraFallback` 为可选参数，worker 路径传入 `defaultWorkerModel`（来自 `TeamConfig`），subagent 路径不传。

### 决策 4：Config 透传路径

```
initServices(config)
    │
    ├── svc.config = config          ← 新增
    │
    ▼
createSubagentTool({services: svc, parentModel: svc.model})
    │
    ▼
runSubagent({services, agent, parentModel})
    │
    ├── config = services.config     ← 从 services 取
    │
    ▼
resolveSubagentModel({agent, config, services.modelRegistry, parentModel})
```

`SubagentServices` 接口新增 `config?: Config`。`InitializedServices` 新增 `config` 字段。worker.ts 已有 config 透传路径（通过 `services` 参数），需同步添加。

### 决策 5：tier 字段校验放 discover.ts

`loadAgentsFromDir` 解析 frontmatter 时校验 `tier` 取值必须为 `"fast" | "standard" | "powerful"` 之一。非法值跳过 agent 并 warn，与 `permissionMode` 的校验模式一致。

## Risks / Trade-offs

- **[风险] Config 配置错误的模型 id** → 解析器在第 ⑦ 级 throw，错误消息包含失败的 model 字符串和已尝试的候选列表，用户可快速定位。不静默降级到错误 provider。

- **[风险] resolveModel 误匹配错误 provider** → Oracle 指出：无 `:` 前缀的 model 字符串（如 `deepseek/deepseek-v4-pro`）经 `resolveModel` 遍历 `registry.getAll()` 匹配 `m.id` 时，可能命中使用 `provider/model-name` id 格式的 openrouter provider。修正后的链将 parentModel（③）置于 agent.model（④）之前，规避了 frontmatter model 的误匹配风险。对于 config 层字符串（①②⑤⑥），文档推荐使用 `provider:model` 冒号语法（走 `registry.find()` 精确匹配），避免同样问题。

- **[风险] 用户依赖旧行为**（agent.model 优先）→ 向后兼容设计：不配 `subagents` 块时，解析链退化为 `parentModel > agent.model > config.model > throw`，与 worker.ts 修复后的行为完全一致。仅 bug 被修复，无功能损失。

- **[权衡] 三档不够细粒度** → fast/standard/powerful 覆盖典型场景。用户可通过 `config.subagents.models[agentName]` 精确覆盖单个 agent，无需扩展档位系统。

- **[风险] worker.ts `defaultWorkerModel` 语义变化** → Oracle 指出原 worker 有 `defaultWorkerModel`（来自 `TeamConfig`）兜底概念。统一解析器中，`defaultWorkerModel` 作为额外的可选 fallback 参数 `extraFallback?: string` 传入，插入在 `config.subagents.fallback`（⑤）和 `config.model`（⑥）之间。这样 worker 路径保留 team 特定的兜底语义，subagent 路径不传此参数。解析器签名变为 `resolveSubagentModel({agent, config, modelRegistry, parentModel, extraFallback?})`。
