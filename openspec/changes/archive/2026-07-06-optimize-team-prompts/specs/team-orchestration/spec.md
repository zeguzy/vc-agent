## ADDED Requirements

### Requirement: ORCHESTRATOR_SYSTEM_PROMPT 包含 Never delegate understanding 反例教学

`ORCHESTRATOR_SYSTEM_PROMPT`（定义于 `src/context-files.ts`）SHALL 包含一个名为 "Never delegate understanding" 的段落，明确禁止把 subagent 研究结果直接转发为执行委托的懒惰行为。该段落 SHALL 包含：(a) 一条原则声明（coordinator 必须读完研究结果、识别方法、写出含具体文件路径+行号的委托 prompt）；(b) 至少一组 ❌ 反例（如 "based on your findings, fix the bug"）和 ✅ 正例对照；(c) **强化已有的 "3 行硬约束"**（ORCHESTRATOR_SYSTEM_PROMPT L52 已有 "If your delegation prompt is shorter than 3 lines, it is too vague"，本 requirement 是把这条规则纳入 "Never delegate understanding" 段落并补反例上下文，不是新增规则）。

#### Scenario: orchestrator 收到 flagella 研究结果后产出含具体路径的委托

- **WHEN** orchestrator 模式激活，且 orchestrator 刚收到 flagella 的研究结果（含文件路径、调用链分析）
- **THEN** orchestrator 后续对 ribosome/nucleus 的委托 prompt SHALL 包含具体的文件路径（如 `src/auth/validate.ts:42`）
- **AND** SHALL 包含明确的修改指令（如 "add null check before user.id access"）
- **AND** SHALL NOT 是 "based on your findings, fix the bug" 这类无具体路径的转发式委托

#### Scenario: orchestrator 委托 prompt 过短时被强化后的规则阻断

- **WHEN** orchestrator 准备发送一个少于 3 行的委托 prompt，且此前已收到过研究结果
- **THEN** "Never delegate understanding" 段落（含被纳入的已有 3 行硬约束 + 新增反例教学）SHALL 让 orchestrator 先停下来合成研究结果，再写完整委托
- **AND** 最终委托 prompt SHALL 含研究结论中的具体细节（路径/行号/模式名）

### Requirement: lysosome agent 定义为对抗性验证

`lysosome`（定义于 `src/agents/defaults.ts:BUILTIN_AGENTS`）的 `systemPrompt` SHALL 表达"对抗性验证"哲学——其职责是"试图证伪"实现，而非"系统性检查清单"。该 systemPrompt SHALL 强制要求：(a) 输出末尾必须有形如 `VERDICT: PASS` 或 `VERDICT: FAIL` 或 `VERDICT: PARTIAL` 的判定行，缺失该行则响应视为无效；(b) 列出至少 6 种自我合理化借口（如 "the code looks correct → reading is not verification"）让 lysosome 在自检时识别；(c) PASS 必须附带实际运行的验证命令及结果（tsc/biome/bun test 等），禁止仅凭阅读代码放行；(d) FAIL 必须为每个 broken claim 提供反例。

**注**：当前 lysosome 输出 `APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION`（defaults.ts L194-195），经 grep 在 `src/` 和 `tests/` 下确认**无任何下游代码解析这些词**，可安全替换为 `PASS / FAIL / PARTIAL`（含新增的 PARTIAL 状态）。

#### Scenario: lysosome 审查含类型抑制的代码

- **WHEN** orchestrator 调用 `subagent({ mode: "single", agent: "lysosome", description: "review src/auth/login.ts" })`，且该文件含 `as any` 或 `@ts-ignore`
- **THEN** lysosome 输出 SHALL 包含 `VERDICT: FAIL` 行
- **AND** Findings 段 SHALL 包含至少一个 `[CRITICAL]` 标签项，引用具体行号
- **AND** SHALL NOT 包含 `VERDICT: PASS`（即使代码"看起来"逻辑正确）
- **AND** SHALL NOT 包含旧的 `APPROVE` 词（已替换）

#### Scenario: lysosome PASS 必须附带验证命令证据

- **WHEN** lysosome 准备输出 `VERDICT: PASS`
- **THEN** 输出 SHALL 包含一个 Evidence 段，列出实际运行的验证命令（如 `tsc --noEmit`、`bun test`）
- **AND** 每条命令 SHALL 附带实际结果（如 "tsc: pass", "test: 42 pass"）
- **AND** SHALL NOT 仅凭阅读代码就输出 PASS

#### Scenario: lysosome 验证工具不可用时输出 PARTIAL

- **WHEN** lysosome 被要求审查代码，但项目无 tsc/biome/test 配置（无法运行验证命令）
- **THEN** lysosome SHALL 输出 `VERDICT: PARTIAL`
- **AND** SHALL 显式列出"unverified"项（如 "type safety: unverified (no tsc available)"）
- **AND** SHALL NOT 输出 PASS

#### Scenario: lysosome 识别自我合理化借口

- **WHEN** lysosome 在分析过程中产生 "the code looks correct" 或 "tests should pass" 这类未经验证的判断
- **THEN** systemPrompt 的自我合理化借口清单 SHALL 触发 lysosome 自我纠正
- **AND** lysosome SHALL 实际运行验证命令或显式标记为 unverified
