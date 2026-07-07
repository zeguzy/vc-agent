## Context

openagent 使用 pi-coding-agent 作为 Agent SDK（工具系统 + Agent 循环），但构建了独立的 React TUI（@opentui/react）。pi-coding-agent 提供的 `ctx.ui.custom()` 基于 pi 自己的 string[] 渲染系统，与 openagent 的 React TUI 不兼容。因此需要一套自定义的桥接机制，使 Agent 工具能异步等待用户交互式输入。

当前架构的数据流：

```
index.tsx
  │
  ├──▶ createRuntime({cwd, model, config, ...})
  │       │
  │       └──▶ createAgentSessionRuntime(factory)
  │              factory: customTools = [lspTools, todoTool]
  │
  ├──▶ createServer({runtime})
  │
  ├──▶ createClient(server)
  │
  └──▶ <App client model cwd config />
          │
          ├── useSessionEvents(client) → events → setState
          ├── useKeyboard() → global key handling
          └── <MessageList /> + <InputBox disabled={isRunning} />
```

工具执行流：
```
Agent loop → tool.execute(toolCallId, params, signal, onUpdate, ctx)
           → 返回 AgentToolResult { content, details }
           → 事件: tool_execution_start → (execute blocks) → tool_execution_end
```

## Goals / Non-Goals

**Goals:**
- Agent 能通过 `question` 工具向用户展示结构化问题（支持多问题、多选、自定义输入）
- Q&A UI 渲染在编辑框区域（InputBox 位置），不使用单独的 popup/overlay
- 工具的异步 execute() 能可靠等待用户交互完成后再返回
- 复用 opencode 的 question 工具 schema 设计（多问题 + multi-select + header）
- 非交互模式（headless/HTTP）下优雅降级

**Non-Goals:**
- 不实现 pi-coding-agent 的 `ctx.ui.custom()` 渲染（渲染系统不兼容）
- 不实现 `/ask` 用户命令（那是 user→agent 方向）
- 不在消息列表区域持久化 question 交互过程
- 不实现 fuzzy search 或复杂选项过滤

## Decisions

### 决策 1：Bridge Pattern（可变对象 + Promise）

**选择**：创建一个共享的可变 `QuestionBridge` 对象，在 `index.tsx` 中创建，同时传递给 runtime（→ 工具）和 App（→ QuestionBox）。

```
                    QuestionBridge
                    ┌──────────────────────────┐
                    │ pending: QuestionData|null│
                    │ resolve: ((a)=>void)|null │
                    │ reject:  ((e)=>void)|null │
                    └──────────────────────────┘
                         ▲                ▲
                         │                │
         ┌───────────────┴──┐    ┌────────┴──────────┐
         │  question.ts     │    │  QuestionBox.tsx   │
         │  execute():      │    │                    │
         │   bridge.pending │    │  bridge.resolve()  │
         │     = data       │    │    = answers       │
         │   await promise  │    │                    │
         └──────────────────┘    └────────────────────┘
```

**理由**：
- 比 EventEmitter 简单——无需订阅/取消订阅管理
- Promise 天然处理异步等待，与 tool execute() 的 async 签名契合
- 可变对象在 JS 中天然共享引用，无需额外通信机制

**备选方案**：
- ❌ EventEmitter：需要订阅管理，增加复杂度
- ❌ React Context：工具层不在 React 树中，无法访问
- ❌ 全局单例：session 热切换时需要重置，难以管理生命周期

### 决策 2：通过事件系统检测 question 调用

**选择**：App 通过现有的 `useSessionEvents` hook 中的 `tool_execution_start` 事件检测 question 工具调用。事件包含 `toolName` 和 `args`，App 读取 args 设置 `pendingQuestion` state。

```
Event Flow:
  tool_execution_start { toolName: 'question', args: {questions:[...]} }
       │
       ▼
  useSessionEvents → 检测 toolName === 'question'
       │
       ▼
  setPendingQuestion(args.questions)  ← 通过回调传入 App
       │
       ▼
  App renders <QuestionBox> instead of <InputBox>
```

**理由**：
- 复用现有事件流，零新增通信层
- `tool_execution_start` 在 execute() 阻塞期间持续可见
- 事件中的 `args` 直接包含 question 参数，无需额外传递

### 决策 3：QuestionBox 替换 InputBox（同位置渲染）

**选择**：QuestionBox 在 App 渲染树中占据 InputBox 的同一位置（flexShrink=0, 底部），使用相同的圆角边框风格。当 `pendingQuestion` 存在时，条件渲染 QuestionBox，否则渲染 InputBox。

**理由**：
- 用户视线焦点保持在编辑框区域，体验自然
- 避免引入 overlay/popup 层，保持架构简洁
- 与 InputBox 共享样式变量（borderActive、backgroundInset）

### 决策 4：多问题逐个展示 + Tab 导航

**选择**：当 question 工具包含多个问题时，QuestionBox 一次只显示一个问题，用户用 Tab 键切换到下一个，最后一个问题的 Enter 直接提交所有答案。

**理由**：
- 终端 UI 空间有限，单问题展示更清晰
- Tab 导航是 terminal UI 的常见模式
- 避免一次渲染多个问题导致布局拥挤

### 决策 5：Schema 对齐 opencode

**选择**：工具参数 schema 与 opencode 的 question 工具完全对齐：
```
{
  questions: [{
    question: string,      // 完整问题描述
    header: string,        // ≤30 字符短标签
    options: [{ label: string, description: string }],
    multiple?: boolean     // 是否允许多选
  }]
}
返回: string[][]  // 每个问题的选中 label 数组
```

**理由**：
- opencode 的 schema 已经过生产验证，设计合理
- 对齐 schema 使 Agent 的 prompt 指令可复用
- `multiple` + `header` 提供足够的表达力

## Risks / Trade-offs

- **[风险] session 热切换时 bridge 状态不一致** → bridge 在 `index.tsx` 创建（进程级），热切换不重建 bridge；但 pending question 可能属于旧 session。→ 缓解：rebind 回调中清空 bridge.pending + reject promise
- **[风险] Agent 长时间不回答导致工具阻塞** → 用户可通过 Ctrl+C 中断 Agent（已有机制），中断信号触发 AbortSignal，工具应监听 signal 并 reject promise。→ 缓解：execute 中注册 signal.abort 监听
- **[风险] headless/HTTP 模式下工具阻塞** → 这些模式不创建 bridge 或 bridge.resolve 为 null。→ 缓解：execute 开始时检查 bridge.resolve 是否可用，不可用则立即返回错误
- **[trade-off] QuestionBox 交互期间 InputBox 不可用** → 这是设计意图——用户需要先回答问题才能继续。但 follow-up 消息队列在此期间不可用。→ 可接受：question 是阻塞式交互，时间通常很短
