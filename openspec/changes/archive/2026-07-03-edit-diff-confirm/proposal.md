## Why

edit 工具（pi-coding-agent 内置）当前在 vc-agent 里是**零确认直写**：LLM 一旦决定改文件，
SDK 立即写盘，用户既看不到要改什么，也无法在落盘前否决。这与 opencode 的 edit 体验形成鲜明
对比——opencode 在写盘前弹出 unified diff 预览，用户选 Allow / Reject，Reject 还能带文本
反馈回喂 agent 让它改方向。用户明确要求"体验对齐 opencode"。

更深一层：vc-agent 当前的 TUI 层把 edit 执行后返回的 `result.details.diff` / `details.patch`
（unified diff 数据）**直接丢弃**，`formatToolDetail` 的 edit 分支只取 `edits[0]` 的 old/new
首行单行文本（截断 80 字符）。用户连"事后看 diff"都做不到。

这是对 `openspec/config.yaml` 设计理念第 15 行"比 Pi 默认 TUI 更简洁（不做 diff 渲染…）"的
**主动演进**——数据已在、能力已在（OpenTUI 原生 `<diff>` 组件）、参考实现已在（opencode），
继续"不做"是纯损失。本次同时完成"事前确认"与"事后可见"。

## What Changes

- **复用 SDK edit 工具 + operations.writeFile 注入拦截**：从 `BUILTIN_TOOLS` 移除 `"edit"`，
  在 `customTools` 加入 `createEditTool(cwd, bridge)`——它调用 SDK 公开的
  `createEditToolDefinition(cwd, { operations: customOps })`，注入 customOps.writeFile 拦截器。
  SDK execute 完成匹配/应用后调 `ops.writeFile`（edit.js:208 裸 await，无 try/catch），拦截器在此
  算 patch → 通过 `EditConfirmBridge` 等待确认 → accept 真写盘 / reject throw 传播为 isError。
  **完全复用 SDK 匹配逻辑**（fuzzy/唯一性/overlap/BOM/CRLF/withFileMutationQueue），零自研，零行为偏差。
  设 `executionMode: "sequential"` 防并行 bridge 冲突；`STANDARD_ACTIVE_TOOLS` 显式补 edit 防激活丢失。
- **新增 EditConfirmBridge**：参照 `question-bridge.ts`，持有 `{ pending, resolve, reject }`，
  连接工具层与 React TUI 层。`src/index.tsx` 创建并三处接线（runtime / App），与会话切换联动。
- **新增 DiffConfirmBox TUI 组件**：参照 `QuestionBox.tsx`，编辑前弹出。上半区用 OpenTUI 原生
  `<diff>` 元素渲染 unified diff（行号 + +/- 染色 + tree-sitter 语法高亮），下半区两个按钮
  `Allow once` / `Reject`，选中态 `warning` 色背景。键盘 `←/→` 切换、`enter` 确认、`esc` reject。
- **Reject 带反馈回喂 agent**：选 Reject 进入文本框子步骤（placeholder "告诉 agent 该怎么改"），
  非空提交 → 工具返回 `isError: true` + 用户反馈文本作为 tool_result 喂回 LLM；空提交 →
  通用拒绝错误。这是 opencode 的核心循环：Reject 不只是否定，是 correction signal。
- **edit 工具卡片升级**：编辑完成后，工具卡片用原生 `<diff>` 元素渲染 `toolResult.details.patch`
  （unified diff），替代当前的单行 old/new 文本。复用 `EditDiffView` 组件（含 filetype 映射）。
- **filetype 映射纯函数**：新增 `pathToFiletype(path)`，按扩展名映射 tree-sitter 语言名，驱动
  `<diff>` 语法高亮；未知扩展名退化为纯 +/- 染色。

## Capabilities

### New Capabilities

- `agent-session` → **工具调用确认（edit）**：edit 工具在写盘前 SHALL 通过 bridge 等待用户确认；
  确认/拒绝/带反馈拒绝三态决定工具结果。

### Modified Capabilities

- `agent-session` → **创建 Pi SDK Agent 会话**：`BUILTIN_TOOLS` 不再含 `"edit"`；`customTools`
  加入 `createEditTool(cwd, bridge)`；runtime factory 接收 `editBridge` 参数。
- `tui-messages` → **工具调用卡片**：edit 工具卡片详情从"单行 old/new 文本"升级为消费
  `toolResult.details.patch` 渲染 unified diff（原生 `<diff>` 元素 + 语法高亮 + 行号）。
- `tui-messages` → **diff scope 注册**：解除"vc-agent 当前不渲染 diff，无 `*Bg`"约束，
  按需补 `diff.plus`/`diff.minus` 的背景色字段。
- `openspec/config.yaml` → 设计理念演进："不做 diff 渲染"更新为"edit 工具消费 unified diff
  并支持编辑前确认（对齐 opencode）"。

## Impact

- **新增代码**：
  - `src/tools/edit.ts`（createEditTool 拦截器壳：复用 SDK createEditToolDefinition + customOps.writeFile 注入 + executionMode sequential）
  - `src/tools/edit-confirm-bridge.ts`（EditConfirmBridge + createEditConfirmBridge + clearBridge）
  - `src/tui/components/DiffConfirmBox.tsx`（编辑前确认 UI）
  - `src/tui/components/EditDiffView.tsx`（编辑后卡片 diff 渲染）
  - `src/tui/utils/filetype.ts`（pathToFiletype 纯函数）
  - `tests/filetype.test.ts`（纯函数测试）
- **修改代码**：
  - `src/agent/session.ts`（BUILTIN_TOOLS 移除 edit；**STANDARD_ACTIVE_TOOLS 显式补 edit**；customTools 加 createEditTool；clearBridge 联动会话切换；runtime factory 接收 editBridge）
  - `src/index.tsx`（创建 EditConfirmBridge，三处接线）
  - `src/tui/App.tsx`（pendingEditConfirm state + 渲染 DiffConfirmBox）
  - `src/tui/hooks/useSessionEvents.ts`（edit 确认事件接入）
  - `src/tui/components/MessageList.tsx`（edit 分支渲染 EditDiffView）
  - `src/tui/utils/syntax.ts`（diff scope 补 *Bg）
  - `src/tui/utils/theme.ts`（diffAddedBg/diffRemovedBg/diffContextBg 等配色）
- **依赖**：无新增依赖。复用 SDK 公开导出（`createEditToolDefinition` / `EditOperations` /
  `generateUnifiedPatch` / `withFileMutationQueue`，均在 `index.d.ts:21-22` 导出），不引入 `diff` 包
  作为直接依赖（SDK 已传递依赖且公开封装为 `generateUnifiedPatch`）。
- **风险**：拦截器方案的 reject throw 依赖 edit.js:208 裸 await 无 try/catch（已验证），SDK 升级若
  加 try/catch 包装 writeFile 可能吞 reject → apply 阶段加回归测试监控；非交互模式（无 bridge）
  降级为"直接执行不确认"，保证 headless/serve 模式不阻塞。

## Non-goals

- **不做 "Allow always"**：MVP 只有 `Allow once` 与 `Reject`。"Allow always"（会话内/持久化记住
  规则跳过确认）作为后续提案，避免引入规则存储与匹配的复杂度。
- **不改 write 工具**：write 是整文件覆盖，unified diff 意义有限；本次保持现有"path + 行数"展示，
  不加确认流程。用户只要求 edit。
- **不做 split 视图**：原生 `<diff>` 固定 `view="unified"`（终端宽度自适应由后续提案处理）。
- **不做 diff 折叠/展开**：unified patch 自带上下文已精简，多 hunk 全展开。
- **不改会话恢复路径**：恢复的历史 edit 消息无 `details.patch`，降级为现有文本展示。
- **不改非交互模式行为**：headless / serve+attach 模式下无 bridge，edit 工具降级为"无确认直写"
  （与当前行为一致），不阻塞自动化流。
