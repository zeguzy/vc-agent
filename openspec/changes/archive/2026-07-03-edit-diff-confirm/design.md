## Context

当前 edit 工具是 pi-coding-agent 内置的 `createEditToolDefinition`
（`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js`），通过
`BUILTIN_TOOLS = ["read","bash","edit","write","grep","find"]` 激活。它的 execute 一次性完成
"读文件 → 匹配 → 写盘 → 返回 details.diff/patch"，**无任何确认环节**，写盘在 execute 内同步发生。

vc-agent 的 TUI 层（`MessageList.tsx` 的 `formatToolDetail` edit 分支）又把执行后返回的
`details.patch`（unified diff）**直接丢弃**，只显示 `edits[0]` 的 old/new 首行截断文本。

opencode 的 edit 工具是另一个范式：写盘前算 unified diff，弹出原生 `<diff>` 预览 + 确认选项，
Reject 带文本反馈回喂 agent。opencode TUI 基于 `@opentui/solid`，vc-agent 基于
`@opentui/react`——**同一个 Zig 核心引擎，同一个原生 `<diff>` 元素**，渲染路径可直接复用。

### 关键发现：SDK 提供 operations.writeFile 注入点（公开 API）

经 Oracle 评审 + 源码验证，SDK 的 edit 工具**不是**黑箱——`createEditToolDefinition(cwd, options?)`
接受 `options.operations: EditOperations`（`edit.d.ts:30-41`，`index.d.ts:22` 公开导出）：

```ts
interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;  // ← 拦截点
  access: (absolutePath: string) => Promise<void>;
}
```

execute 流程（`edit.js:182-219`）：`ops.access` → `ops.readFile` → 归一化+匹配+应用 →
**`await ops.writeFile(absolutePath, finalContent)`**（line 208）→ 算 diff → 返回。

**writeFile 调用无外层 try/catch**（line 208 裸 await），注入自定义 writeFile 后 throw 会直接
传播为 isError 工具结果。这让我们能在"SDK 匹配应用后、写盘前"插入确认，**完全复用 SDK 的匹配
逻辑**（fuzzy/overlap/BOM/CRLF/唯一性/withFileMutationQueue），零自研。

vc-agent 已有的"工具阻塞等用户输入"范式是 **question 工具 + QuestionBridge**
（`src/tools/question.ts` + `src/tools/question-bridge.ts`）：execute 把 `{pending, resolve, reject}`
存到 bridge，`await` Promise；TUI 的 `QuestionBox` 调 `bridge.resolve()` 唤醒 execute。本次复用此范式。

## Goals / Non-Goals

**Goals:**
- 复用 SDK edit 工具（`createEditToolDefinition`），通过 `operations.writeFile` 注入确认拦截
- 写盘前通过 EditConfirmBridge 等待用户确认（Allow / Reject）
- Reject 带文本反馈，作为 tool_result（isError）回喂 agent
- 用原生 `<diff>` 元素渲染 unified diff（行号 + +/- 染色 + tree-sitter 语法高亮）
- 编辑完成后，工具卡片消费 SDK 返回的 `details.patch` 渲染 diff（事后可见）
- 非交互模式（无 bridge）降级为直写，不阻塞 headless/serve

**Non-Goals:** 见 proposal.md

## Decisions

### 决策 1：拦截器方案——复用 SDK edit + operations.writeFile 注入（核心决策）

**选择**：用 `createEditToolDefinition(cwd, { operations: customOps })` 创建 edit 工具，
customOps.writeFile 是拦截器：算 patch → bridge 等待确认 → accept 真写盘 / reject throw。

```ts
const customOps: EditOperations = {
  readFile: (p) => fsReadFile(p),                    // 默认行为
  access: (p) => fsAccess(p, constants.R_OK | constants.W_OK),
  writeFile: async (absolutePath, newContent) => {
    if (!bridge) return fsWriteFile(absolutePath, newContent, "utf-8");  // 非交互降级（决策 5）
    const oldContent = await fsReadFile(absolutePath, "utf-8");
    const patch = generateUnifiedPatch(absolutePath, oldContent, newContent);  // SDK 公开导出
    const decision = await confirmViaBridge(bridge, { filePath: absolutePath, patch }, signal);
    if (decision.kind === "reject") throw new Error(decision.feedback || "用户拒绝了 edit 调用");
    await fsWriteFile(absolutePath, newContent, "utf-8");   // accept 真写盘
  },
};
const editTool = createEditToolDefinition(cwd, { operations: customOps });
editTool.executionMode = "sequential";   // 决策 3
return editTool;
```

**理由**：
- SDK 的 edit.execute 在 `ops.writeFile` 之后才算 diff 并返回 `details.patch`——拦截 writeFile
  正好是"匹配应用后、写盘前"的唯一注入点，无需拆分 execute
- **完全复用 SDK 匹配逻辑**（`applyEditsToNormalizedContent`：fuzzy find、唯一性校验、overlap 检测、
  BOM 处理、LF 归一化、倒序应用），零自研，零行为偏差风险
- **自动复用 `withFileMutationQueue`**（SDK execute line 177 包裹整个读改写），跨批次/子 agent
  并发安全，无需自研队列
- 只依赖公开 API（`createEditToolDefinition` + `EditOperations` + `generateUnifiedPatch`，均
  `index.d.ts:21-22` 导出），SDK 升级无影响
- accept 后 execute 继续执行，自动算并返回 `details.patch`（事后卡片 diff 渲染直接用，无需自己算）

**备选（已否决）**：
- **完全自实现 edit**（原提案初版）：重新实现 200+ 行匹配逻辑（含 fuzzy/overlap/BOM/CRLF），行为
  偏差风险高，SDK 升级需跟踪同步，违背"不重复造轮子"。opencode 自实现是因为它没有 SDK 可复用，
  vc-agent 有 pi-coding-agent 这个现成的、已验证的实现
- SDK extension `tool_call` 事件拦截：vc-agent 未接线 extension runner，架构改动超范围

### 决策 2：覆盖方式 = BUILTIN_TOOLS 移除 "edit" + customTools + STANDARD_ACTIVE_TOOLS 显式加 "edit"

**选择**：
- `session.ts` 的 `BUILTIN_TOOLS` 移除 `"edit"`
- **`STANDARD_ACTIVE_TOOLS` 显式补 `"edit"`**（关键：原 `STANDARD_ACTIVE_TOOLS = [...ALL_TOOLS, ...]`
  从 `ALL_TOOLS = [...BUILTIN_TOOLS, ...]` 派生，移除 BUILTIN_TOOLS 的 edit 会级联导致 edit 从激活集
  消失，customTool 注册了但不激活，LLM 看不到——这是 Oracle 发现的 BLOCKER B2）
- `PLANNER_ACTIVE_TOOLS` 保持不含 edit（planner 只读模式）
- `createRuntime` 的 `customTools` 加入 `createEditTool(cwd, editBridge)`（决策 1 的拦截器壳）
- runtime factory 签名增加 `editBridge` 参数

**理由**：从 BUILTIN_TOOLS 移除是显式可控的覆盖；STANDARD_ACTIVE_TOOLS 显式补 edit 保证激活。

**证据**：`sdk.js:135` `initialActiveToolNames = options.tools ? [...options.tools] : ...`，
`customTools`（sdk.js:252）只注册不激活——激活由 `tools`/`initialActiveToolNames` 白名单决定。

### 决策 3：executionMode = "sequential"（防并行 bridge 冲突，BLOCKER B1）

**选择**：edit ToolDefinition 设 `executionMode: "sequential"`。

**理由**：SDK 默认 `toolExecution: "parallel"`（`agent.js:128`），LLM 一个 batch 发多个工具会
**并发执行**。EditConfirmBridge 是单槽 `{pending, resolve, reject}`——并发 edit 会覆盖 pending，
第一个 edit 的 Promise 永不 resolve → 死锁。设 executionMode: "sequential" 强制整个 batch 串行
（pi-agent-core README："If any tool call in a batch targets a tool with executionMode:
'sequential', the entire batch executes sequentially"）。

**代价**：LLM batch 里若有 `[edit, read, bash]`，三者全串行。可接受（MVP）。

**注**：createEditToolDefinition 返回的 ToolDefinition 默认无 executionMode，createEditTool 壳需
在返回对象上显式赋值 `executionMode: "sequential"`。

### 决策 4：EditConfirmBridge 完全复刻 QuestionBridge 范式

**选择**：`src/tools/edit-confirm-bridge.ts` 导出：
```ts
interface EditConfirmData { filePath: string; patch: string; }
interface EditConfirmBridge {
  pending: EditConfirmData | null;
  resolve: ((decision: EditConfirmDecision) => void) | null;
  reject: ((error: Error) => void) | null;
}
type EditConfirmDecision = { kind: "accept" } | { kind: "reject"; feedback: string };
```
`createEditConfirmBridge()` / `clearEditConfirmBridge(bridge)` 与 question 版同构。

**理由**：question 工具已验证此范式（pending/resolve/reject + abort 监听 + 会话切换清理）。

### 决策 5：非交互模式降级 = 无 bridge 时 customWriteFile 直写

**选择**：customWriteFile 检测 `bridge` 为 undefined 时，跳过确认直接 `fsWriteFile`（与 SDK 默认
operations.writeFile 行为一致）。

**理由**：headless / serve+attach 模式无 TUI，无法弹确认框；强行阻塞会死锁。bridge 只在 TUI 入口
（`src/index.tsx`）创建并注入。

### 决策 6：确认 UI = Allow once + Reject（不做 Allow always）

**选择**：DiffConfirmBox 两个按钮 `Allow once`（默认）/ `Reject`。Reject 进入文本框子步骤，
placeholder "告诉 agent 该怎么改（空提交=通用拒绝）"。

**理由**：MVP 聚焦核心价值；Allow always 的规则存储是额外复杂度，作为后续提案。

### 决策 7：Reject 通过 throw Error 传播为 isError 工具结果

**选择**：customWriteFile 在 reject 时 `throw new Error(decision.feedback || "用户拒绝了 edit 调用")`。

**理由**：edit.js:208 的 `await ops.writeFile(...)` 无外层 try/catch，throw 直接传播出 execute，
SDK 工具框架捕获转为 `{isError: true, content: [{type:"text", text: error.message}]}`。
- reject 带反馈 → error.message = feedback 文本 → 回喂 LLM 驱动自纠错
- reject 空反馈 → error.message = "用户拒绝了 edit 调用" → 通用拒绝
- accept 不 throw → execute 继续写盘（已在 customWriteFile 内完成）+ 算 diff + 返回 details.patch

**验证**：edit.js execute 错误处理（line 188-196 try/catch 只包 ops.access，writeFile 裸 await）。

### 决策 8：配色复用 + 补 diff scope 背景

**选择**：
- `<diff>` 语法高亮复用 `syntax.ts` 的 `syntaxStyle`
- theme 补 `diffAddedBg`/`diffRemovedBg`/`diffContextBg`/`diffLineNumber` 字段（对齐 opencode 配色）
- `syntax.ts` 的 `diff.plus`/`diff.minus` 补 `*Bg`（解除 tui-messages spec 旧约束）

## Risks / Trade-offs

- **[拦截器内重读文件开销]** → customWriteFile 重读旧内容算 patch（SDK execute 已读过一次），
  对大文件是双倍读开销。可接受（edit 频率低；且只在 TUI 模式）。优化：可让 bridge 携带 toolCallId，
  缓存 SDK readFile 结果——MVP 不做。
- **[throw 传播依赖 execute 无 try/catch]** → 已验证 edit.js:208 裸 await；SDK 升级若加 try/catch
  包装 writeFile，reject 可能被吞。降级：apply 阶段加回归测试监控此行为；SDK 升级时回归。
- **[大 diff 刷屏]** → unified patch 自带上下文精简；DiffConfirmBox 把 diff 区放 `<scrollbox>` 可滚动。
- **[会话切换 pending 确认悬挂]** → `clearEditConfirmBridge` 联动 session.ts 会话切换清理。
- **[executionMode sequential 拖慢 batch]** → 仅当 batch 含 edit 时串行；edit 本是写操作，串行合理。
- **[SDK 升级改 edit API]** → 拦截器方案只依赖公开 API（createEditToolDefinition/EditOperations/
  generateUnifiedPatch），升级影响面远小于自实现。

## 数据流（ASCII）

### 编辑前确认流程（拦截器方案）

```
┌─────────────────────────────────────────────────────────────────────┐
│ LLM tool_use: edit(path, edits:[{oldText,newText}])                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ customTool: createEditToolDefinition(cwd,{operations})
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SDK edit.execute() (复用，不自研):                                   │
│   1. ops.access → ops.readFile                                       │
│   2. applyEditsToNormalizedContent (fuzzy/唯一性/overlap/BOM/LF)     │
│   3. await ops.writeFile(absolutePath, finalContent)  ← 拦截点       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ customOps.writeFile
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ customOps.writeFile(absolutePath, newContent):                       │
│   bridge? ├─ 否（headless）→ fsWriteFile 直写 → 返回（execute 继续） │
│          ▼ 是（TUI）                                                  │
│   oldContent = fsReadFile(absolutePath)                              │
│   patch = generateUnifiedPatch(absolutePath, oldContent, newContent) │
│   bridge.pending = {filePath, patch}; await Promise(decision)        │
└───────────┬───────────────────────────────┬─────────────────────────┘
   accept   │                          reject│
            ▼                               ▼
 fsWriteFile(absolutePath, newContent)  throw new Error(feedback||"用户拒绝了 edit")
            │                               │ execute 不 try/catch → 传播
            ▼                               ▼
 execute 继续: 算 diff, 返回              工具结果 isError:true
   {content, details:{patch}}            content: feedback 文本 → 回喂 LLM
            │
            ▼
   工具卡片渲染 EditDiffView (消费 details.patch)
```

### 编辑后卡片 diff 渲染（事后可见，不变）

```
tool_execution_end 事件 (useSessionEvents.ts)
  message.toolResult.details.patch 完整保留
          │
          ▼
MessageList.tsx · ToolMessageView (edit 分支)
  patch = toolResult?.details?.patch
  ├─ string → <EditDiffView patch filePath>  (原生 <diff> + pathToFiletype)
  └─ 否 → formatToolResult 文本降级
```
