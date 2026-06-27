## Why

openagent 目前缺乏 Language Server Protocol (LSP) 支持。LLM 无法获取编译错误、跳转到符号定义或查找引用。opencode 已有成熟的 `lsp-tools-mcp` 实现，其核心引擎已被提取为 `lsp-core` 独立包。直接将 `lsp-core` 引入 vc-agent，用 Pi SDK 的 `customTools` 包装，即可零成本复用 opencode 的生产级 LSP 实现。

## What Changes

- **新增 LspManager 服务**：管理 LSP 服务器进程（typescript-language-server）的生命周期、文件同步和 JSON-RPC 通信
- **新增 3 个 LSP 自定义工具**：通过 Pi SDK `customTools` 注入：
  - `lsp_diagnostics` — 获取文件诊断（错误/警告/提示），支持 severity 过滤
  - `lsp_goto_definition` — 跳转到光标处符号的定义位置
  - `lsp_find_references` — 查找符号的所有引用位置
- **引入 `lsp-core` 依赖**：直接使用 opencode 的 LSP 引擎（进程管理、JSON-RPC、server 定义、输出格式化），不做重复实现
- **新增配置支持**：`.openagent/lsp.json`（项目级）和 `~/.config/openagent/lsp.json`（全局），格式对齐 opencode 的 `.opencode/lsp.json`
- **TUI 显示适配**：`MessageList.tsx` 的 `formatToolDetail()` 添加 3 个 LSP 工具的 display

## Capabilities

### New Capabilities
- `lsp-tools`: LSP 工具系统，包含 diagnostics / goto_definition / find_references 三个 LLM 可调用的工具，基于 `lsp-core` 引擎，支持 TypeScript（可扩展多语言）

### Modified Capabilities
- `agent-session`: 在 `createAgentSession()` 中注入 LSP customTools，需要新增 `lspManager` 服务实例化和启动流程
- `tui-messages`: 在 `formatToolDetail()` switch 中添加 `lsp_diagnostics` / `lsp_goto_definition` / `lsp_find_references` 三个 case

## Impact

- **依赖**: 新增 `lsp-core`（从 opencode 的 `packages/lsp-core` 包引入）
- **配置**: 新增 `.openagent/lsp.json` 配置项
- **代码**: 
  - 新增 `src/lsp/` 模块（LspManager 包装层 + 工具定义）
  - 修改 `src/agent/session.ts`（注入 customTools）
  - 修改 `src/tui/components/MessageList.tsx`（TUI 显示）

## Non-goals

- ❌ `lsp_rename` / `lsp_symbols` / `lsp_prepare_rename` / `lsp_status` — 首期只做核心三件套
- ❌ `read` 钩子自动附加诊断 — 之后再加
- ❌ 多语言 LSP（Python/Go/Rust 等）— 首期只做 TypeScript
- ❌ TUI 实时波浪线诊断显示 — 这是编辑器功能，不是 agent 工具
- ❌ MCP 中间层 — vc-agent 已有一次 MCP 实现后被移除，直接走 customTools 更简洁
- ❌ `lsp_install_decision` — 不自动安装 LSP 服务器，依赖用户预先配置
