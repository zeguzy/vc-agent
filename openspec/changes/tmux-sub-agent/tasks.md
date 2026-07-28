## 1. 依赖与配置基础

- [ ] 1.1 安装 `@opencode-ai/sdk` 依赖（`bun add @opencode-ai/sdk`），验证 `bun run typecheck` 通过
- [ ] 1.2 扩展 `src/config.ts` 的 Config 类型，新增 `tmux?: { autoStart?: boolean; sessionName?: string }` 和 `subAgent?: { opencodeServeUrl?: string }`，默认值 `autoStart: false`、`sessionName: "vcagent"`、`opencodeServeUrl: "http://localhost:4096"`

## 2. TmuxController（tmux 二进制封装）

- [ ] 2.1 创建 `src/tmux/controller.ts`，定义 `TmuxController` 类和 `PaneInfo` 接口。构造时执行 `tmux -V` 探测版本，失败时 `available = false`。提供静态方法 `isInTmux(): boolean` 检测 `process.env.TMUX`
- [ ] 2.2 实现 `splitWindow(opts)` / `sendKeys(paneId, text, opts)` / `capturePane(paneId, opts)` / `listPanes(sessionName?)` / `killPane(paneId)` 五个方法，全部通过 `node:child_process.execSync` 调 tmux 命令。`sendKeys` 使用两次调用模式（`-l` literal + 单独 Enter）
- [ ] 2.3 在 `tests/tmux-controller-unit.test.ts` 添加单元测试：mock `execSync` 验证命令拼接、`isInTmux` 逻辑、`available = false` 降级 no-op 行为

## 3. tmux 自启检测

- [ ] 3.1 创建 `src/tmux/autostart.ts`，导出 `maybeAutoStartTmux(config, argv): void` 函数。当 `config.tmux.autoStart === true` 且 `process.env.TMUX` 为空时，执行 `tmux new-session -d -s <sessionName> bun run src/index.tsx <argv>` + `tmux attach-session -t <sessionName>` + `process.exit(0)`。tmux 不存在时捕获错误并降级
- [ ] 3.2 在 `src/index.tsx` 的 `runTui()` 函数入口（读取 config 之后、创建 runtime 之前）调用 `maybeAutoStartTmux(config, argv)`
- [ ] 3.3 在 `tests/tmux-autostart-unit.test.ts` 添加单元测试：mock `execSync` 验证 autoStart=true/false 分支、已在 tmux 内跳过、tmux 不存在降级

## 4. SubAgentService 与 Adapter

- [ ] 4.1 创建 `src/agents/adapters/types.ts`，定义 `SubAgentAdapter` 接口（`createSession` / `prompt` / `abort` / `dispose` 方法签名）和 `SubAgentSession` 接口（id/name/type/status/startedAt/completedAt/httpSessionId/paneId/lastOutput/error 字段）
- [ ] 4.2 创建 `src/agents/adapters/opencode.ts`，实现 `OpencodeAdapter` 类。基于 `createOpencodeClient({ baseUrl })`，`baseUrl` 从 config 读取。实现四个方法，serve 未运行时 `createSession` 抛含明确指引的 Error
- [ ] 4.3 创建 `src/agents/sub-agent-service.ts`，实现 `SubAgentService` 类（参照 `BackgroundJobService` 模式）。维护 `Map<string, SubAgentSession>`，提供 `start(opts)` / `get(id)` / `list()` / `cancel(id)` / `dispose()`。并发上限 `MAX_BG_JOBS`（8），`start` 时委托 adapter 执行 prompt 并更新 lastOutput
- [ ] 4.4 在 `tests/sub-agent-service-unit.test.ts` 添加单元测试：mock adapter 验证 start/list/get/cancel 生命周期、并发上限抛错、dispose 级联取消

## 5. tmux_agent 工具注册

- [ ] 5.1 创建 `src/tools/tmux-agent.ts`，导出 `createTmuxAgentTool(opts: { subAgentService: SubAgentService }): ToolDefinition`。工具名 `tmux_agent`，参数 schema 支持 `action: "create" | "status" | "cancel"`，create 时调 `subAgentService.start`，status 时返回 list 或单个，cancel 时调 `subAgentService.cancel`。错误返回 `isError: true`
- [ ] 5.2 在 `src/agent/session.ts` 的 `STANDARD_ACTIVE_TOOLS` 和 `TEAM_ACTIVE_TOOLS` 数组加入 `"tmux_agent"`；在 `createRuntime` factory 的 customTools 数组加入 `createTmuxAgentTool({ subAgentService })`，`tools` 白名单参数加入 `"tmux_agent"`；在 `src/server/index.ts` 的 `handleSetAgentMode` 的 `setActiveToolsByName` 调用加入 `"tmux_agent"`。三处双名单同步
- [ ] 5.3 在 `tests/tmux-agent-tool-unit.test.ts` 添加单元测试：mock SubAgentService 验证 create/status/cancel action 参数解析、返回值格式、isError 错误处理

## 6. TUI SubAgentPanel 与客户端接口

- [ ] 6.1 在 `src/client/types.ts` 的 `AgentClient` 接口新增 `listSubAgents(): SubAgentSession[]` 和 `cancelSubAgent(id: string): Promise<SubAgentSession | undefined>` 方法。在 `src/client/in-process.ts` 实现这两个方法（委托 server handler）。在 `src/client/http.ts` 实现异步版本（`fetchSubAgents` / `cancelSubAgent` 走 HTTP），sync 版本 throw `NotSupportedError`
- [ ] 6.2 在 `src/server/index.ts` 的 `AgentServer` 类新增 `handleListSubAgents()` 和 `handleCancelSubAgent(id)` 方法，委托 `SubAgentService` 实例（构造时创建并持有）。在 HTTP 路由注册 `/sub-agents` GET 和 `/sub-agents/:id` DELETE
- [ ] 6.3 创建 `src/tui/components/SubAgentPanel.tsx`，渲染 sub-agent 列表（name/type/status 指示符/lastOutput 截断）。status 用颜色区分（running 绿/completed 默认/error 红/cancelled 灰）。空列表显示提示文本
- [ ] 6.4 在 `src/tui/keymap.ts` 新增 normal 模式快捷键（选用未占用键，如 `Ctrl+S` 或 `,`），切换 `showSubAgents` 状态。在 `src/tui/App.tsx` 新增 `showSubAgents` state 和 `showSubAgentsRef`，在 `useKeyboard` 回调通过 ref 读取并切换。面板打开时拦截非 Ctrl+C/Escape 按键。在根布局条件渲染 `<SubAgentPanel>`

## 7. 集成验收

- [ ] 7.1 运行 `bun run check`（typecheck + lint + test）确保全绿，修复所有由本次变更引入的失败
- [ ] 7.2 手动联调：启动 `opencode serve`，在 vcagent 内通过 agent 调用 `tmux_agent` 工具创建 sub-agent，验证 SubAgentPanel 显示状态、cancel 可终止。记录验证结果到 `acceptance.md`
