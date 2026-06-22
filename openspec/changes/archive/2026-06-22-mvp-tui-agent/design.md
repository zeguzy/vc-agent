## Context

这是 openagent 项目的第一个 change——从零搭建 MVP。核心技术依赖：
- **Pi SDK**（`@earendil-works/pi-coding-agent`）：Agent 循环、工具系统、30+ LLM Provider 抽象
- **OpenTUI**（`@opentui/core` + `@opentui/react`）：Zig 原生 TUI 引擎，React 绑定

我们不需要重新实现 Agent 逻辑（Pi SDK 负责），也不需要手写终端渲染层（OpenTUI 负责）。我们只需要：
1. 正确调用 Pi SDK 的 `createAgentSession()`
2. 订阅事件流，映射为 React state
3. 用 OpenTUI React 组件渲染 UI
4. 处理用户输入，转发给 Agent

运行时选 Bun（原生 TypeScript，OpenTUI 原生支持）。

## Goals / Non-Goals

**Goals:**
- 全屏 TUI 体验：消息滚动区 + 输入框 + 状态栏
- 跑通完整交互循环：用户输入 → Agent 流式响应 → 工具调用显示 → 回到输入
- 代码块语法高亮（利用 OpenTUI 内置 tree-sitter）
- 组件化结构，易于后续扩展

**Non-Goals:**
- 不做 diff 渲染（文件编辑的可视化 diff）
- 不做 Markdown 渲染（MVP 直接用 OpenTUI Text/Code 组件）
- 不做会话持久化（每次启动是新会话）
- 不做 slash 命令系统
- 不做权限/安全系统（Pi 本身不做权限）
- 不做 MCP 支持
- 不做 fuzzy 搜索、kill ring、自动补全等高级编辑功能

## Decisions

### D1: 全屏 TUI（OpenTUI）vs REPL 滚动

```
选择: 全屏 TUI（OpenTUI React 组件）
放弃: REPL 滚动式（picocolors + process.stdout）
```

**理由**：全屏 TUI 提供更好的用户体验——消息区可滚动、输入区固定在底部、状态栏显示元信息。OpenTUI 的 Zig 原生核心 + 内置组件（ScrollBox/Input/Code）省去了手写终端管理的复杂度。OpenCode 已在生产中验证了这条路。

### D2: OpenTUI vs Ink vs 从零搭建

```
选择: OpenTUI（@opentui/core + @opentui/react）
放弃: Ink / 纯 ANSI 手写
```

**理由**：
- vs Ink：OpenTUI 内置 tree-sitter 代码高亮、ScrollBox、Code/Diff 组件——对代码 Agent 是刚需，Ink 没有
- vs 从零：OpenTUI 处理了 Yoga 布局、resize、raw mode 输入、差分渲染，省 500+ 行终端管理代码
- Bun 原生支持，OpenCode 生产验证，场景完全匹配

### D3: React 绑定 vs 纯 TS API

```
选择: React 绑定（@opentui/react）
放弃: 纯 TS 命令式 API（@opentui/core 的 renderer.root.add）
```

**理由**：动态消息列表（不断追加 Agent 流式文本）用 React 的 state/props 模型更自然。组件化拆分（MessageList/Input/StatusBar）也更清晰。OpenTUI 的 React 绑定是一等支持，含 React DevTools 支持。

### D4: 事件流 → React State 映射

```typescript
// Pi SDK 事件 → React state 更新 → OpenTUI 重新渲染
//
// session.subscribe((event) => {
//   switch (event.type) {
//     case "message_update":
//       updateLastMessage(event.textDelta)  // 追加文本到当前消息
//       break
//     case "tool_execution_start":
//       addToolMessage(event.tool, event.args)  // 添加工具调用消息
//       break
//     case "agent_end":
//       setIsRunning(false)  // 恢复输入
//       break
//   }
// })
```

**理由**：单向数据流，事件 → state → UI。React 的 batching 保证流式输出不会触发过多重渲染。OpenTUI 的差分渲染只更新变化的部分。

### D5: 中断机制——AbortSignal

```
用户 Ctrl+C → AbortController.abort() → Pi Agent 循环收到 signal → 停止
```

**理由**：Pi SDK 的 `session.prompt()` 支持 AbortSignal。OpenTUI Input 的键盘事件可监听 Ctrl+C。

## 架构图

```
┌──────────────────────────────────────────────────────┐
│                    index.ts                           │
│              (CLI 入口 + 参数解析)                     │
│                                                       │
│  parseArgs() → createSession() → renderApp()         │
├──────────────────────────────────────────────────────┤
│                                                       │
│   ┌──────────────────┐    ┌────────────────────────┐ │
│   │   session.ts     │    │      App.tsx           │ │
│   │  (Pi SDK 封装)    │    │   (React Root)         │ │
│   │                   │    │                        │ │
│   │ createAgentSession│    │  ┌─ ScrollBox ──────┐  │ │
│   │ • subscribe()     │───▶│  │                  │  │ │
│   │ • prompt(text)    │    │  │  MessageList     │  │ │
│   │ • abort()         │    │  │  • 用户消息       │  │ │
│   │                   │    │  │  • Agent 流式     │  │ │
│   │   events ↓        │    │  │  • 🔧 工具调用    │  │ │
│   │                   │    │  │  • 📝 代码块      │  │ │
│   │                   │    │  │                  │  │ │
│   │                   │    │  └──────────────────┘  │ │
│   │                   │◀───│  ┌─ Input ──────────┐  │ │
│   │   prompt(text)    │    │  │ > _              │  │ │
│   │   + signal        │    │  └──────────────────┘  │ │
│   │                   │    │  ┌─ StatusBar ──────┐  │ │
│   │                   │    │  │ model | cwd      │  │ │
│   │                   │    │  └──────────────────┘  │ │
│   └──────────────────┘    └────────────────────────┘ │
│                                                       │
│              @opentui/core (Zig native)               │
│              @opentui/react (React reconciler)        │
└──────────────────────────────────────────────────────┘
```

## 文件结构

```
openagent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # 入口：参数解析 → createSession → renderApp
│   ├── agent/
│   │   └── session.ts        # createAgentSession 封装 + 事件订阅
│   ├── tui/
│   │   ├── App.tsx           # React 根组件
│   │   ├── components/
│   │   │   ├── MessageList.tsx   # ScrollBox + 消息渲染
│   │   │   ├── InputBox.tsx      # OpenTUI Input 封装
│   │   │   ├── StatusBar.tsx     # 模型/工作目录状态
│   │   │   ├── CodeBlock.tsx     # tree-sitter 代码高亮
│   │   │   └── ToolCall.tsx      # 工具调用状态行
│   │   └── theme.ts          # 颜色/样式常量
│   └── store.ts              # 全局状态（useStore hook）
└── openspec/
```

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| OpenTUI React 绑定可能不成熟（新项目） | OpenCode 生产验证 + imperative API 可作 fallback |
| Pi SDK 事件 API 可能在版本更新中变化 | 锁定版本（`^0.79.9`），关注 CHANGELOG |
| OpenTUI Zig 二进制平台兼容性 | 先在 macOS/Linux 验证，Windows 后续测试 |
| React + OpenTUI 的性能（高频流式更新） | OpenTUI 差分渲染 + React batching 应能处理；如不行降频更新 |
| @opentui/react 和 @opentui/core 版本同步 | 锁定相同版本号 |

## Open Questions

- **OpenTUI Input 的 onChange/onSubmit API**：需要查阅 `@opentui/react` 的 Input 组件文档，确认事件接口
- **流式更新的性能**：LLM 每秒可能输出几十个 token，每个 token 触发一次 state 更新。需要验证 React + OpenTUI 的渲染性能，必要时做防抖（如每 50ms 合并一次更新）
- **OpenTUI 安装方式**：`bun add @opentui/core @opentui/react` 是否自动下载 Zig 二进制？需要验证
