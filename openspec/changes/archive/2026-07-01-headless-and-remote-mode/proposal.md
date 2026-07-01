## Why

当前 openagent 只支持 TUI 交互模式。但 agent 引擎（AgentServer）已经是独立的 facade，AgentClient 接口是 transport 无关的。这意味着可以零架构改动地支持非交互式（headless）和远程（HTTP daemon）模式，解锁 CI/CD 集成、脚本自动化、多终端共享会话等场景。

## What Changes

- 新增 `openagent run "<prompt>"` 命令：headless 模式，创建 server+client in-process，执行单次 prompt，流式输出到 stdout，agent_end 后退出
- 新增 `openagent serve` 命令：启动 HTTP server（Bun.serve），暴露 REST API + SSE 事件流
- 新增 `openagent attach <url>` 命令：连接到远程 HTTP server，TUI 通过 HttpClient（fetch+SSE）操作
- 新增 `src/headless/runner.ts`：HeadlessRunner 类，封装 server+client 创建 + 事件流 → stdout 渲染
- 新增 `src/server/http.ts`：HTTP server，将 AgentServer 的 handler 方法暴露为 HTTP 端点
- 新增 `src/client/http.ts`：HttpClient 实现 AgentClient 接口（fetch + SSE）
- HttpClient 对 @internal 方法（getSettingsManager 等）抛出 NotSupportedError

## Capabilities

### New Capabilities

- `headless-mode`: 非交互式命令行执行模式，支持管道和脚本集成
- `http-server`: HTTP daemon 模式，暴露 REST API + SSE 事件流
- `remote-client`: 远程客户端，通过 HTTP 连接到 server 实例

## Impact

- **新增文件**：`src/headless/runner.ts`、`src/server/http.ts`、`src/client/http.ts`
- **修改文件**：`src/index.tsx`（新增 run/serve/attach 子命令解析）
- **不变文件**：现有 TUI 流程完全不变（始终用 InProcessClient）
- **依赖**：不引入新 npm 依赖（Bun 内置 fetch/serve/SSE）
