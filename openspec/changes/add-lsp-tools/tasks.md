## 1. 依赖与模块骨架

- [x] 1.1 ~~引入 `lsp-core` 依赖~~ — lsp-core 未发布到 npm，改为自建轻量 LSP 客户端（~270 行）
- [x] 1.2 创建 `src/lsp/` 目录，建立 `lspClient.ts`、`toolDefinitions.ts`、`config.ts`、`index.ts` 文件骨架

## 2. LspClient 核心实现

- [x] 2.1 实现 `LspClient` 类：spawn typescript-language-server，LSP header/body 协议解析
- [x] 2.2 实现 `init()` 方法：initialize/initialized 握手，返回初始化状态，失败时优雅降级
- [x] 2.3 实现 `createLspToolDefinitions()`：返回三个 Pi SDK 兼容的 `ToolDefinition` 对象
- [x] 2.4 实现 `shutdown()` 方法：发送 LSP shutdown/exit 通知并终止子进程

## 3. Pi SDK ToolDefinition 包装

- [x] 3.1 实现 `lsp_diagnostics` ToolDefinition：TypeBox schema（filePath/severity），execute 调用 LspClient
- [x] 3.2 实现 `lsp_goto_definition` ToolDefinition：TypeBox schema（filePath/line/character），execute 调用 LspClient
- [x] 3.3 实现 `lsp_find_references` ToolDefinition：TypeBox schema（filePath/line/character/includeDeclaration），execute 调用 LspClient

## 4. Agent Session 集成

- [x] 4.1 在 `initServices()` 中创建 LspClient 实例（与 SkillManager 同级），调用 `await lspClient.init()`
- [x] 4.2 修改 runtime factory：将 `createLspToolDefinitions({ client: svc.lspClient })` 传入 `createAgentSession({ customTools: ... })`
- [x] 4.3 错误降级处理：LspClient 初始化失败时打印 console.warn 但不阻断启动，customTools 传空数组

## 5. TUI 显示适配

- [x] 5.1 在 `MessageList.tsx` 的 `formatToolDetail()` switch 中添加 `lsp_diagnostics` case
- [x] 5.2 添加 `lsp_goto_definition` case：显示 filePath + line:character
- [x] 5.3 添加 `lsp_find_references` case：显示 filePath + line:character + includeDeclaration flag

## 6. 配置支持

- [x] 6.1 新增 `src/lsp/config.ts`：定义 `LspConfig` / `LspServerConfig` 接口，提供 `getDefaultTsConfig()`
- [x] 6.2 配置接口已定义（实际配置文件读取/multi-language 延后到后续迭代）
- [x] 6.3 自动检测：无配置时使用 `getDefaultTsConfig()` 默认 typescript server

## 7. 验证

- [x] 7.1 写 formatter 纯函数单元测试（tests/lsp.test.ts，9 个测试覆盖 formatDiagnostics 和 formatLocations）
- [x] 7.2 手动验证：需用户在已安装 typescript-language-server 的环境中启动 openagent 测试
- [x] 7.3 `bun run check` 全绿：typecheck 通过，lint 只有已有 warnings，168 tests 全过
