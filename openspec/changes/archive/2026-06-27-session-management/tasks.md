## 1. 会话存储与列表辅助层

- [x] 1.1 新增 `src/session/storage.ts`：导出 `resolveSessionDir()` 返回 `~/.config/openagent/sessions/`（处理目录创建，纯函数可单测）
- [x] 1.2 新增 `src/session/list.ts`：封装 `SessionManager.list(cwd, dir)` 与 `formatSessionList(SessionInfo[], currentId?)`（时间分组 Today/日期、序号、相对时间、名称或首条预览、消息数、当前会话高亮），纯函数可单测

## 2. createSession 重构为 runtime factory

- [x] 2.1 在 `src/agent/session.ts` 把现有 `createSession` 的 auth/model/settings/skill 初始化 + `createAgentSession` 调用抽成 `runtimeFactory({cwd, agentDir, sessionManager})` → `CreateAgentSessionRuntimeResult`（保持 AuthStorage/ModelRegistry/SettingsManager `inMemory()`）
- [x] 2.2 新增 `createRuntime({mode, cwd, config, resumeRef?, sessionPath?, name?})`：导出 `SessionMode` 类型；按 mode 构造 SessionManager（new→`create` / continue→`continueRecent` / resume→`list` 匹配 `resumeRef` / session→`open(sessionPath)`）
- [x] 2.3 调用 `createAgentSessionRuntime(runtimeFactory, {cwd, agentDir, sessionManager})` 返回 `AgentSessionRuntime`；移除硬编码 `SessionManager.inMemory()`；若 `name` 提供，在 runtime 就绪后 `runtime.session.setSessionName(name)`

## 3. 历史消息渲染映射

- [x] 3.1 新增 `src/session/render.ts` 的 `mapSdkMessagesToTui(sdkMessages): Message[]`：user → `createUserMessage`；assistant → `extractAssistantContent` + `createAssistantMessage`（含 thinking）；tool_use → `createToolMessage(name, args, "done")` 摘要；回合间 `createSeparator`；未知块降级纯文本。纯函数可单测

## 4. CLI 启动参数

- [x] 4.1 扩展 `src/index.tsx` 的 `parseArgs`：解析 `-c/--continue`、`-r/--resume`、`--session <path|id>`、`-n/--name <name>`，产出 `SessionMode` + `name`
- [x] 4.2 更新 `showHelp` 加入四个新参数及示例
- [x] 4.3 `main()` 改调 `createRuntime`，把 `runtime` 传给 App；`-r` 模式进 TUI 后触发 `/sessions`；`--model` 与恢复组合时先恢复再以 `--model` 覆盖；resume/session 目标无效时报错退出

## 5. App 持有 runtime + rebind 钩子

- [x] 5.1 改 `src/tui/App.tsx`：`props` 从 `session` 改为 `runtime`；`const [session, setSession] = useState(runtime.session)`
- [x] 5.2 注册 `runtime.setRebindSession(async (newSession) => { setSession(newSession); setMessages(mapSdkMessagesToTui(newSession.messages)); 重置滚动到底 + isRunning=false })`
- [x] 5.3 现有 `useEffect([session])` 的事件订阅因 session 引用变化自动重绑；`handlePrompt` / `settingCtx` / StatusBar 等改用 `session` state（替代原 prop）
- [x] 5.4 初始 `messages` state：若 `runtime.session.messages` 含历史则 `mapSdkMessagesToTui(...)`，否则保留欢迎消息

## 6. TUI 会话命令

- [x] 6.1 在 `src/tui/commands.ts` 注册 `/sessions`：调 `SessionManager.list` + `formatSessionList` 渲染分组列表（当前会话高亮），空列表提示
- [x] 6.2 注册 `/resume <序号|id>`（无参等同 `/sessions`）：纯数字按最近 `/sessions` 列表序号匹配 path，否则按 id 匹配，调 `runtime.switchSession(path)` 热切换；`/continue` 作为 `/resume` 别名
- [x] 6.3 注册 `/new`（调 `runtime.newSession()` 热切换）与 `/name <text>`（调 `runtime.session.setSessionName`）；`/name` 无参显示当前名称
- [x] 6.4 `CommandContext` 暴露 `runtime`（替代或补充 `session`）；热切换返回 `{cancelled}` 或抛错时在 TUI 显示提示且保持当前会话

## 7. 测试与验证

- [x] 7.1 新增 `tests/session-persistence.test.ts` 覆盖 `sessionDirRoot` / `formatSessionList` / `resolveSessionRef` / `mapSdkMessagesToTui` 纯函数（21 个用例）
- [x] 7.2 `bun run check` 全绿（typecheck + lint + test，159 pass / 0 fail）
- [x] 7.3 e2e 验证：CLI `--help` smoke 通过；集成脚本验证 `SessionManager.create→append→list→formatSessionList→resolveSessionRef→open→continueRecent` 全链路通过（临时目录，跑后清理）。对话恢复（新建→对话→退出→`-c` 见历史）需 LLM API key + 交互式终端，留用户最终确认
