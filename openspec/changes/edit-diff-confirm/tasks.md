# Tasks

## 1. 基础设施：纯函数

- [x] 1.1 新增 `src/tui/utils/filetype.ts`：导出纯函数 `pathToFiletype(path: string): string | undefined`，按扩展名映射 tree-sitter 语言名（`.ts`/`.tsx`/`.mts`/`.cts`→`typescript`、`.js`/`.jsx`/`.mjs`→`javascript`、`.py`→`python`、`.go`→`go`、`.rs`→`rust`、`.java`→`java`、`.kt`→`kotlin`、`.md`→`markdown`、`.json`→`json`、`.sh`/`.bash`→`bash`、`.c`/`.h`→`c`、`.cpp`→`cpp`、`.yml`/`.yaml`→`yaml`、`.toml`→`toml`），`Dockerfile` 特判；未知扩展名/无扩展名返回 `undefined`，大小写不敏感
- [x] 1.2 新增 `tests/filetype.test.ts`：覆盖已知扩展名、未知扩展名返回 undefined、无扩展名、大小写不敏感、Dockerfile 特判

## 2. EditConfirmBridge + createEditTool 拦截器壳（工具层）

- [x] 2.1 新增 `src/tools/edit-confirm-bridge.ts`：定义 `EditConfirmData {filePath,patch}`、`EditConfirmDecision = {kind:"accept"} | {kind:"reject";feedback:string}`、`EditConfirmBridge {pending,resolve,reject}`；导出 `createEditConfirmBridge()` 与 `clearEditConfirmBridge(bridge)`（reject pending Promise + 清空），与 `question-bridge.ts` 同构
- [x] 2.2 新增 `src/tools/edit.ts`：导出 `createEditTool(cwd, bridge?)` —— 内部用 SDK 的 `createEditToolDefinition(cwd, { operations: customOps })` 创建工具，注入 customOps.writeFile 拦截器（决策 1）；customWriteFile 流程：`bridge` 不存在 → `fsWriteFile` 直写（决策 5 降级）；存在 → `fsReadFile` 读旧内容 + `generateUnifiedPatch`（SDK 公开导出）算 patch + `bridge.pending={filePath,patch}` + `await new Promise`；accept → `fsWriteFile` 真写盘；reject → `throw new Error(feedback||"用户拒绝了 edit 调用")`（决策 7）；在返回的 ToolDefinition 上设 `executionMode = "sequential"`（决策 3，防并行 bridge 冲突）
- [x] 2.3 createEditTool 内 customWriteFile 注册 `signal.abort` 监听：abort 时 `clearEditConfirmBridge` + reject Promise（参照 question.ts:66-77）；用 helper `confirmViaBridge(bridge, data, signal)` 封装 await + abort 逻辑

## 3. 工具注册与会话联动（含 BLOCKER B1/B2 修复）

- [x] 3.1 修改 `src/agent/session.ts`：`BUILTIN_TOOLS` 移除 `"edit"`（变 `["read","bash","write","grep","find"]`）；**`STANDARD_ACTIVE_TOOLS` 显式补 `"edit"`**（BLOCKER B2——原从 ALL_TOOLS/BUILTIN_TOOLS 派生会级联丢失 edit，必须显式加入，不再依赖继承）；`PLANNER_ACTIVE_TOOLS` 保持不含 edit（planner 只读模式）；验证 `activeToolsFor("standard")` 返回的集合含 "edit"、`activeToolsFor("planner")` 不含
- [x] 3.2 修改 `src/agent/session.ts`：`createRuntime` 签名增加 `editBridge` 参数；`customTools` 数组加入 `createEditTool(cwd, editBridge)`；保持 edit 在所有 standard mode 可用
- [x] 3.3 修改 `src/agent/session.ts`：在会话切换清理处（`clearBridge(question)` 同位置）加 `clearEditConfirmBridge(editBridge)`，避免切换后 pending 确认悬挂
- [x] 3.4 修改 `src/index.tsx`：创建 `const editBridge = createEditConfirmBridge()`；传入 `createRuntime({...,editBridge})`（对应 3.2）；传入 `<App ... editBridge={editBridge}>`（对应 4.3）

## 4. TUI 确认组件（编辑前）

- [x] 4.1 新增 `src/tui/components/DiffConfirmBox.tsx`：props `{bridge: EditConfirmBridge}`；当 `bridge.pending` 非空时渲染确认框。结构：标题行 `△ 确认 edit · <filePath>`（`warning` 色 三角 + 文本）+ `<scrollbox>` 包裹原生 `<diff diff={pending.patch} filetype={pathToFiletype(filePath)} syntaxStyle={syntaxStyle} view="unified" showLineNumbers addedBg={colors.diffAddedBg} removedBg={colors.diffRemovedBg} contextBg={colors.diffContextBg} addedSignColor removedSignColor>`（支持长 diff 滚动）+ 按钮行 `[ Allow once ] [ Reject ]`（选中态 `warning` 背景与 `background` 前景，未选中 `backgroundMenu`）；内部状态机 `phase: "choose" | "reject-feedback"`
- [x] 4.2 DiffConfirmBox 键盘交互：`←/→` 或 `tab`/`shift+tab` 切换按钮（默认选中 Allow once）；`enter` 确认 → choose 阶段 Allow → `bridge.resolve({kind:"accept"})`、Reject → 进入 reject-feedback；reject-feedback 阶段渲染 `<input>`（placeholder "告诉 agent 该怎么改（空提交=通用拒绝）"），`enter` 提交 `bridge.resolve({kind:"reject",feedback})`，`esc` 返回 choose；choose 阶段 `esc` 直接 `bridge.resolve({kind:"reject",feedback:""})`（通用拒绝）
- [x] 4.3 修改 `src/tui/App.tsx`：新增 `pendingEditConfirm` state（参照 `pendingQuestion`）；通过 `editBridge.pending` 检测（与 `onQuestionAsked` 对称机制）触发 setState；渲染 `<DiffConfirmBox bridge={editBridge}>`（位置参照 QuestionBox，叠加层或 InputBox 上方）；确认后清 pendingEditConfirm
- [x] 4.4 修改 `src/tui/hooks/useSessionEvents.ts`：edit 确认事件接入——检测 `editBridge.pending` 变化触发 App 回调（与 question 的 `onQuestionAsked` 对称机制，确保 React 检测到 bridge.pending 变化并渲染）

## 5. TUI 卡片 diff 渲染（编辑后）

- [x] 5.1 新增 `src/tui/components/EditDiffView.tsx`：props `{patch, filePath}`；渲染原生 `<diff diff={patch} filetype={pathToFiletype(filePath)} syntaxStyle={syntaxStyle} view="unified" showLineNumbers fg={colors.text} addedSignColor={colors.diffAdded} removedSignColor={colors.diffRemoved} flexShrink={0}>`
- [x] 5.2 修改 `src/tui/components/MessageList.tsx` 的 `formatToolDetail` edit 分支：移除单行 old/new 文本拼接，edit 分支只返回 `{label:"edit", lines:[filePath]}`（diff 由 EditDiffView 接管）；删除仅 edit 使用的死代码 `truncate`（若存在，已验证 L127-128 仅 edit 用）
- [x] 5.3 修改 `src/tui/components/MessageList.tsx` 的 `ToolMessageView`：新增 helper `getEditPatch(message)` 从 `message.toolResult?.details?.patch` 安全提取非空字符串；当 `toolName==="edit"` 且 `getEditPatch` 返回非空时，path 标题行下方渲染 `<EditDiffView>`；edit 成功渲染 diff 时抑制 "Successfully replaced N block(s)" resultLines；无 patch 时（edit 失败/reject/旧会话恢复）走 `formatToolResult` 文本降级

## 6. 配色与 scope

- [x] 6.1 修改 `src/tui/utils/theme.ts`：新增 `diffAddedBg`/`diffRemovedBg`/`diffContextBg`/`diffLineNumber`/`diffAddedLineNumberBg`/`diffRemovedLineNumberBg` 字段（dark/light 配色对齐 opencode：added bg 深绿暗调、removed bg 深红暗调、行号灰）
- [x] 6.2 修改 `src/tui/utils/syntax.ts`：`diff.plus`/`diff.minus`/`diff.delta` 补 `background` 字段引用 theme 的新 *Bg；解除 tui-messages spec"无 *Bg"约束（spec delta 同步）
- [x] 6.3 更新 `openspec/config.yaml` 的 context：将"比 Pi 默认 TUI 更简洁（不做 diff 渲染…）"演进为"edit 工具消费 unified diff 并支持编辑前确认（对齐 opencode）"，反映本次理念升级

## 7. 验证

- [x] 7.1 `bun run check` 全绿（typecheck + lint + test，含新增 filetype 测试；playwright typecheck 错误是 pre-existing 基线，非本次引入，不阻塞）
- [ ] 7.2 `bun run dev` 手动验收：(a) 让 Agent edit 一个 .ts 文件 → 确认 DiffConfirmBox 弹出 diff 预览 + 语法高亮 + 行号；(b) Allow → 文件被改 + 工具卡片显示 diff；(c) Reject 带反馈 → agent 收到反馈文本并重新尝试；(d) Reject 空反馈 → 通用拒绝；(e) edit 未知扩展名 → 降级无语法高亮但仍可读；(f) LLM 一个 batch 发多个 edit → 因 executionMode sequential 串行确认，不死锁（B1 验证）；(g) headless 模式（无 bridge）→ 直写无阻塞；(h) edit 不存在的文件 → SDK 抛 "Could not edit file" 错误正常传播
