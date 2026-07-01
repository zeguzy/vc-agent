## MODIFIED Requirements

### Requirement: Startup flow with Client-Server layers

应用启动流程 SHALL 先创建 `AgentServer`（封装 runtime），再创建 `AgentClient`（in-process 实现），最后将 `client` 作为 prop 传入 `<App>`。

#### Scenario: Normal startup

- **WHEN** 用户运行 `bun run dev`（或等效启动命令）
- **THEN** 执行流程为：`createServer(args)` → `createClient(server)` → 创建 OpenTUI renderer → `<App client={client} />`

#### Scenario: Session mode initialization

- **WHEN** 启动参数指定 session 模式（`--continue`、`--resume`、`--session <id>`、`-n <name>`）
- **THEN** session 模式逻辑在 `AgentServer` 初始化阶段处理，Server 就绪后 Client/TUI 连接的已经是正确的 session
