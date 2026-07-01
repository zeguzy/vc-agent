## 1. Phase 2a — Headless Mode

- [x] 1.1 创建 `src/headless/runner.ts`：HeadlessRunner 类，构造函数接收 { cwd, model, config, mode, agentMode, sessionRef?, name? }
- [x] 1.2 实现 `HeadlessRunner.run(prompt: string)`：createRuntime → createServer → createClient → client.prompt(prompt)
- [x] 1.3 实现事件流 → stdout 渲染：subscribe 事件，message_update 增量输出，tool_execution 显示工具名，agent_end 退出
- [x] 1.4 实现 stderr 输出：错误信息、tool 结果摘要写 stderr，assistant 文本写 stdout
- [x] 1.5 在 `src/index.tsx` 添加 `run` 子命令解析：`openagent run [--continue] [--session <id>] [--model <m>] "<prompt>"`
- [x] 1.6 运行 `bun run check` 验证

## 2. Phase 2b — HTTP Server

- [x] 2.1 创建 `src/server/http.ts`：createHttpServer(server, port) 函数，返回 node:http Server 实例
- [x] 2.2 实现路由：POST /prompt, /follow-up, /abort, /compact, /session/new, /session/switch, /session/name, /mode
- [x] 2.3 实现路由：GET /session/id, /session/name, /model, /context, /messages, /sessions
- [x] 2.4 实现 SSE 事件流：GET /events → server.subscribe 推送到 SSE response
- [x] 2.5 在 `src/index.tsx` 添加 `serve` 子命令：createServer → createHttpServer → 打印 URL
- [x] 2.6 运行 `bun run check` 验证

## 3. Phase 2b — HttpClient

- [x] 3.1 创建 `src/client/http.ts`：HttpClient 类实现 AgentClient 接口
- [x] 3.2 实现 prompt/followUp/abort/compact/newSession/switchSession/setSessionName/setAgentMode/listSessions：POST/GET via fetch
- [x] 3.3 实现 getContextUsage/getModel/getMessages/getSessionId/getSessionName/getSessionFile：GET via fetch，init() 异步拉取后缓存
- [x] 3.4 实现 subscribe(handler)：建立 SSE 连接到 /events，解析事件转发给 handler
- [x] 3.5 实现 @internal 方法：抛出 NotSupportedError
- [x] 3.6 实现 executeCommand：标记不支持（远程命令执行需要 UI 回调）
- [x] 3.7 导出 createHttpClient(url) 工厂

## 4. Phase 2c — Multi-client Attach

- [x] 4.1 在 `src/index.tsx` 添加 `attach` 子命令：`openagent attach <url>`
- [x] 4.2 attach 流程：createHttpClient(url) → init() → createCliRenderer → <App client={httpClient}>
- [x] 4.3 处理 HttpClient 的限制：SettingContext 在远程模式下显示不可用或跳过
- [x] 4.4 运行 `bun run check` 验证

## 5. Tests

- [~] 5.1 tests/headless.test.ts：跳过（HeadlessRunner 依赖 Pi SDK createRuntime，无法独立 mock）
- [x] 5.2 tests/http-client.test.ts：HttpClient fetch 调用测试（mock AgentServer + 真实 HTTP server）
- [x] 5.3 tests/http-server.test.ts：HTTP server 端点测试（mock AgentServer + 真实 HTTP server）
- [x] 5.4 运行 `bun run test` 全量验证（258 pass, 0 fail）
