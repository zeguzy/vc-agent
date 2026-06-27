## Context

openagent 目前有 6 个内置工具（read、bash、edit、write、grep、find），通过 Pi SDK 的 `tools` 字符串数组注入。Pi SDK 同时支持 `customTools?: ToolDefinition[]` 参数，可以将自定义工具定义注入 Agent。

opencode 的 LSP 引擎已从 `lsp-tools-mcp` 包中提取为独立 `lsp-core` 包，包含完整的 LSP 客户端实现（进程管理、JSON-RPC、server 定义、输出格式化）。直接复用该包作为依赖，通过 Pi SDK 的 `customTools` 机制暴露为 Agent 工具，零重复实现。

## Goals / Non-Goals

**Goals:**
- 复用 opencode 的 `lsp-core` 引擎，不做重复实现
- 通过 Pi SDK `customTools` 暴露 `lsp_diagnostics` / `lsp_goto_definition` / `lsp_find_references`
- 首期支持 TypeScript（typescript-language-server）
- 配置格式对齐 opencode（`.openagent/lsp.json`）

**Non-Goals:**
- 不做 rename / symbols / prepare_rename（后续加）
- 不实现 read 钩子自动附加诊断（后续加）
- 不做多语言 LSP（首期只 TypeScript）
- 不使用 MCP 中间层（直接 customTools 注入）

## Decisions

### Decision 1: 复用 lsp-core 而非自建 LSP 引擎

**结论**：引入 `lsp-core` 作为依赖，编写薄适配层。

**备选方案**：
- A) 自建 LSP 客户端（child_process + JSON-RPC 手工实现）→ 工作量 ~800 行，需自行处理 40+ server 定义、输出格式化、连接生命周期等
- B) 通过 MCP 连接 lsp-tools-mcp → 需先重建 MCP client（之前因依赖问题被移除），增加约 500 行开销
- C) 复用 lsp-core 作为库 → ~150 行适配代码，生产验证的引擎

**选择 C**。lsp-core 已从 opencode 提取为独立包，包含所有 LSP 引擎逻辑，只需编写 ToolDefinition 包装层。

### Decision 2: LspManager 生命周期

**结论**：LspManager 在 `initServices()` 中创建，与 SkillManager 同级，生命周期与 AgentSession 绑定。

```
createRuntime() → initServices() {
  authStorage = AuthStorage.inMemory()
  modelRegistry = ModelRegistry.inMemory(authStorage)
  skillManager = new SkillManager()
  lspManager = new LspManager(cwd, config)  // ← 新增
  resourceLoader = await skillManager.initialize(...)
  return { ..., lspManager, resourceLoader }
}
```

然后 factory 中用 `lspManager.getToolDefinitions()` 获取 customTools 传给 `createAgentSession()`。

**备选方案**：延迟初始化（首次 tool 调用时才启动 LSP）→ 增加首次调用延迟，且失败处理复杂。选择 session 启动时同步初始化，失败时优雅降级（customTools 不含该工具）。

### Decision 3: 配置格式

**结论**：对齐 opencode 的 JSON 格式，使用 `.openagent/lsp.json`。

```jsonc
{
  "lsp": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "priority": 100
    }
  }
}
```

不配置时，自动检测项目是否为 TypeScript（检查 `tsconfig.json` 存在性），有则启用默认 typescript 服务器。全局配置路径 `~/.config/openagent/lsp.json` 作为 fallback。

### Decision 4: TUI 显示

**结论**：在 `formatToolDetail()` 中添加具体的 case 分支，展示关键参数（文件路径、行号/列号、severity 过滤等）。结果通过已有的 `formatToolResult()` 透传，不做特殊渲染。

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       openagent TUI                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    App.tsx                             │   │
│  │  createRuntime() → initServices() → createAgentSession│   │
│  │                                   (customTools: [...]) │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              src/lsp/                                  │   │
│  │  ┌──────────────┐  ┌───────────────────────────┐      │   │
│  │  │ LspManager    │  │ toolDefinitions.ts        │      │   │
│  │  │ · init()      │  │ · lsp_diagnostics         │      │   │
│  │  │ · getDefs()    │  │ · lsp_goto_definition     │      │   │
│  │  │ · shutdown()   │  │ · lsp_find_references     │      │   │
│  │  └──────┬───────┘  └─────────────┬─────────────┘      │   │
│  │         │                         │                     │   │
│  │         └─────────┬───────────────┘                     │   │
│  │                   ▼                                     │   │
│  │         ┌───────────────────┐                            │   │
│  │         │    lsp-core       │ ← opencode 引擎           │   │
│  │         │  (外部依赖)        │                            │   │
│  │         └─────────┬─────────┘                            │   │
│  └───────────────────┼──────────────────────────────────────┘   │
│                      │                                          │
│                      ▼                                          │
│         ┌────────────────────────────┐                          │
│         │ typescript-language-server  │  ← stdio 子进程         │
│         │ (系统 PATH 或全局安装)       │                          │
│         └────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

### 数据流（以 lsp_diagnostics 为例）

```
LLM calls lsp_diagnostics({ filePath: "src/foo.ts" })
  │
  ▼
ToolDefinition.execute()
  │
  ▼
LspManager.getClient() → lsp-core ClientWrapper
  │
  ├── didOpen(filePath)           // 通知 LSP 打开文件
  ├── wait for diagnostics        // 等待 publishDiagnostics 通知
  └── formatters.format()         // 格式化为文本
       │
       ▼
  "error [15:10]: Cannot find name 'processData'"
  "warning [42:5]: Unused variable 'result'"
```

## Risks / Trade-offs

- **[风险] typescript-language-server 未安装** → 工具调用时返回友好错误消息（"typescript-language-server not found. Install: npm i -g typescript-language-server"），不影响其他工具
- **[风险] lsp-core 包依赖可能不可用（npm 发布状态）** → 备选：git submodule 或 vendor 方式引入源码；实在不行回退到直接依赖 `typescript-language-server` npm API
- **[风险] 项目不是 TypeScript 则 LSP 无意义** → 通过配置控制启用/禁用，自动检测 tsconfig.json

## Open Questions

1. `lsp-core` 是否已发布到 npm？如果未发布，需要确认引入方式（git 依赖 / vendor / submodule）
2. typescript-language-server 安装方式：需要用户手动安装 `npm i -g typescript-language-server`，还是由 openagent 自动安装？
