## 1. 项目脚手架

- [x] 1.1 初始化 `package.json`：name=openagent, type=module, dependencies 加入 `@earendil-works/pi-coding-agent`、`@opentui/core`、`@opentui/react`、`react`
- [x] 1.2 创建 `tsconfig.json`：target=ESNext, module=ESNext, moduleResolution=bundler, strict=true, jsx=react-jsx, jsxImportSource=@opentui/react
- [x] 1.3 运行 `bun install`，验证依赖安装成功（确认 OpenTUI Zig 二进制下载）
- [x] 1.4 创建目录结构：`src/`、`src/agent/`、`src/tui/`、`src/tui/components/`

## 2. Agent 会话层

- [x] 2.1 创建 `src/agent/session.ts`：实现 `createSession(options)` 函数，调用 Pi SDK 的 `createAgentSession({ cwd, model, tools: ["read","bash","edit","write"], sessionManager: SessionManager.inMemory() })`
- [x] 2.2 定义消息类型 `src/store.ts`：`type Message = { id, role: "user"|"assistant"|"tool", content, toolName?, toolArgs?, toolStatus? }`
- [x] 2.3 实现 `subscribeToEvents(session, callbacks)`：订阅 `message_update`（追加文本）、`tool_execution_start`（添加工具消息）、`tool_execution_end`（更新工具状态）、`agent_end`（设置 isRunning=false）事件
- [x] 2.4 实现 `prompt(session, text, signal)` 函数：调用 `session.prompt(text)`，传入 AbortSignal
- [x] 2.5 验证：写临时脚本创建 session → prompt("hello") → 打印事件流，确认 Pi SDK 调用通畅

## 3. OpenTUI 渲染器与布局

- [x] 3.1 创建 `src/tui/App.tsx`：用 `createCliRenderer()` + `createRoot()` 初始化 OpenTUI React 渲染
- [x] 3.2 实现三区域布局：`<box flexDirection="column" height="100%">` 包含 ScrollBox（flexGrow=1）、InputBox（固定高度）、StatusBar（固定高度）
- [x] 3.3 创建 `src/tui/components/StatusBar.tsx`：显示 `model: <name> | cwd: <path>`
- [x] 3.4 验证：渲染空的 App，确认全屏 alternate screen 启动、三区域布局正确、resize 正常 ✅

## 4. 消息列表组件

- [x] 4.1 创建 `src/tui/components/MessageList.tsx`：用 OpenTUI ScrollBox 渲染消息列表，遍历 messages state
- [x] 4.2 实现用户消息渲染：绿色 `> ` 前缀 + 内容
- [x] 4.3 实现工具调用渲染：`🔧 toolName(args)` 行（运行中）/ `✅ toolName`（完成）/ `❌ toolName(error)`（失败）
- [x] 4.4 实现分隔线渲染：每轮 agent_end 后追加 `─` 填充行
- [x] 4.5 实现自动滚动：新消息追加后 ScrollBox 滚动到底部
- [x] 4.6 验证：手动注入 mock messages state，检查各消息类型渲染正确 ✅

## 5. 代码块渲染

- [x] 5.1 创建 `src/tui/components/CodeBlock.tsx`：解析 Markdown 代码块（MVP 用 `<text>` 黄色渲染，跳过 tree-sitter 高亮因为 `<code>` 组件需要 syntaxStyle prop）
- [x] 5.2 在 MessageList 中解析 Agent 文本：识别三反引号代码块 `` ```lang...``` ``，拆分为 Text + CodeBlock 组件混合渲染
- [x] 5.3 验证：注入含代码块的 mock Agent 消息，确认渲染正确 ✅

## 6. 输入框组件

- [x] 6.1 创建 `src/tui/components/InputBox.tsx`：封装 OpenTUI Input 组件，管理 value state
- [x] 6.2 实现 onSubmit：Enter 键提交 → 调用 `prompt(session, value, abortSignal)` → 清空 Input
- [x] 6.3 实现禁用态：`isRunning` 为 true 时 Input 变灰/不可聚焦
- [x] 6.4 实现历史记录：维护 `history: string[]`，↑↓ 键切换 Input value
- [x] 6.5 验证：手动测试输入、退格、Enter 提交、↑↓ 历史 ✅

## 7. 中断处理

- [x] 7.1 在 App 中维护 `abortController` ref，每次 prompt 时创建新 controller
- [x] 7.2 用 OpenTUI useKeyboard 监听 Ctrl+C：运行中调用 `session.abort()`，空闲时退出程序
- [x] 7.3 实现双击 Ctrl+C 强制退出：1 秒内两次 → `process.exit(0)`
- [x] 7.4 退出清理：恢复 alternate screen（renderer.destroy()）
- [x] 7.5 验证：Agent 响应中按 Ctrl+C 确认中断生效 ✅

## 8. CLI 入口与集成

- [x] 8.1 创建 `src/index.tsx`：解析 `process.argv`（支持 `--model`、`--help`）
- [x] 8.2 串联主流程：parseArgs → createSession → subscribeToEvents（更新 React state）→ 渲染 App
- [x] 8.3 实现 `--help` 输出
- [x] 8.4 设置 `bin` 字段，确认 `bun run src/index.tsx` 可正常启动

## 9. 端到端验证

- [x] 9.1 设置可用的 LLM API Key ✅ (DeepSeek 余额已充值)
- [x] 9.2 启动 openagent，输入"读取当前目录的 package.json"，验证完整交互流程 ✅ (read 工具调用成功，Agent 正确回答 "openagent")
- [x] 9.3 测试 Ctrl+C 中断 ✅ (useKeyboard + session.abort())
- [x] 9.4 测试 `--model` 参数切换模型 ✅ (deepseek:deepseek-v4-flash 正确解析)
- [x] 9.5 测试 `--help` 显示帮助并退出 ✅
- [x] 9.6 测试 resize：调整终端窗口大小 ✅ (OpenTUI Yoga 布局自动重排)
- [x] 9.7 测试代码块渲染 ✅ (Agent 回复中 JSON 代码块正常渲染)
