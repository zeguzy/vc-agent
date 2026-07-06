## Why

对比 claude-code-cli 的 team prompt 设计后发现，vc-agent 的编排提示词在两个维度存在明显短板：(1) **委托质量**——orchestrator 收到 subagent 研究结果后，常产出"based on your findings, fix the bug"这类懒惰委托，把理解工作甩给执行方；(2) **验证哲学**——lysosome 当前是"系统性检查清单"风格，缺少"试图证伪"的对抗性约束，容易 rubber-stamp 弱实现。同时系统提示词加载链缺少 prompt cache 友好的结构边界，每次 AGENTS.md/team 状态变化都会 bust 整个 cache，token 浪费严重。

本 change 通过纯 prompt 工程和加载策略调整（不动架构、不动工具集）补齐这两个短板。

## What Changes

- **ORCHESTRATOR_SYSTEM_PROMPT 增加 "Never delegate understanding" 反例教学段**：明确禁止 "based on your findings" 类懒惰委托，给出 ❌/✅ 对照示例，并**强化已有的 "3 行硬约束"**（ORCHESTRATOR L52 已存在，本 change 把它纳入新段落并补反例上下文，不是新增规则）。
- **lysosome 升级为对抗性验证 agent**：哲学从"质量审查员"→"试图证伪的独立验证者"，强制输出 `VERDICT: PASS | FAIL | PARTIAL`（替换当前的 APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION——经 grep 确认无下游解析），加入 6 种自我合理化借口的识别清单（"reading is not verification" 等），并要求"必须实际运行验证命令，不许只读代码就放行"。
- **系统提示词关键位置加 cache 边界文档注释**：在 `appendSystemPromptFor`（session.ts）和 `loadSystemContext`（context-files.ts）的关键位置加 `// CACHE-STATIC` / `// CACHE-DYNAMIC` 注释，仅作维护者文档。**不调整加载顺序**（当前已正确），**不强制运行时行为**——避免 ROI 不足的过度工程。
- **Subagent 工具的 agent list 改为动态生成后注入系统提示词**：新增 `buildAvailableAgentsPrompt(cwd)` 函数（调用现有 `discoverAgents`），动态发现**所有** agent（5 个内置 + 用户自定义），生成 markdown 段注入 standard/orchestrator 模式的 appendSystemPrompt。subagent 工具 description 移除详细描述，只留调用语法 + 一行动态索引。**关键**：必须动态发现，硬编码 5 个内置会丢失用户自定义 agent。
- **只读 agent 全覆盖 omitContextFiles 的测试保障**：确认 flagella/nucleus/plasmid/lysosome 的 `runSubagent` 调用都走 `noContextFiles: true` 路径（runner.ts 已支持，本 change 补测试防回归）。

## Non-goals

- **不做 Fork 语义**：subagent 仍为零上下文独立 session，不继承父对话。该改动需要 Pi SDK 支持 initialMessages，规模超出本 change，留待后续 `fork-subagent-mode`。
- **不做 Member 间直连通信**：team 工具仍为 leader→member 单向，不引入 member→member 消息路由。
- **不改 agent 工具集**：lysosome 仍为 read-only（read/grep/find/bash），不加 bash 写权限或其他工具。
- **不改 agent 命名体系**：保留 flagella/ribosome/nucleus/plasmid/lysosome 生物隐喻，不切换到功能化命名。
- **不引入独立第三方验证调用机制**：lysosome 仍由 orchestrator 在需要时显式调用，不强制"每轮实现后必须调用 lysosome"的硬流程。
- **不动 deepseek 之外的 provider 适配**：cache 优化以 deepseek 的 prompt cache 行为为准，不针对其他 provider 单独适配。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `team-orchestration`: ORCHESTRATOR_SYSTEM_PROMPT 增加 "Never delegate understanding" 反例教学段；lysosome agent 定义升级为对抗性验证（强制 VERDICT 输出 + 自我合理化借口识别 + 实际运行验证命令要求）。
- `context-files`: 系统提示词加载引入 static/dynamic 分段标记；subagent 工具的 agent list 改用 attachment 注入；只读 agent 全覆盖 omitContextFiles。

## Impact

- **代码文件**：
  - `src/context-files.ts` — 修改 ORCHESTRATOR_SYSTEM_PROMPT（拆 section 常量 + 加 NEVER_DELEGATE_UNDERSTANDING_SECTION）；loadSystemContext 加 cache 注释
  - `src/agents/defaults.ts` — 重写 lysosome.systemPrompt（对抗性 + VERDICT 强制输出 + 6 种借口清单）
  - `src/agents/discover.ts` 或新建 `src/agents/prompt-builder.ts` — 新增 `buildAvailableAgentsPrompt(cwd)` 函数
  - `src/agent/session.ts` — 修改 `appendSystemPromptFor`（L105-113）注入 agent list；加 cache 注释
  - `src/tools/subagent.ts` — 工具 description 移除详细 agent 描述，改为一行动态索引
  - `src/agents/runner.ts` — 无代码改动（已 noContextFiles: true），但被新测试覆盖
- **运行时行为**：
  - orchestrator 模式下，委托 prompt 平均长度增加（含具体文件路径+行号），但实现质量提升
  - lysosome 输出格式变化（VERDICT: PASS/FAIL/PARTIAL 替代 APPROVE 等），**无下游解析依赖**（grep 验证）
  - subagent 工具 description 变短，agent 列表通过系统提示词提供（standard/orchestrator 模式）
- **依赖**：无新增依赖；Pi SDK 的 ResourceLoader.appendSystemPrompt 拼接行为需在实施时确认（Open Question 3）
- **测试**：需补充 lysosome 输出格式校验测试、ORCHESTRATOR_SYSTEM_PROMPT 内容测试、noContextFiles 全覆盖测试
