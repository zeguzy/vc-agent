# openagent

终端编码助手。完整项目上下文见 `openspec/config.yaml`。

## 技术栈

- 运行时：Bun
- TUI：@opentui/react + @opentui/core（Zig 引擎，内置 ScrollBox/Input/Code 组件）
- Agent：@earendil-works/pi-coding-agent（Agent 循环 + 工具系统 + LLM Provider）
- MCP：@modelcontextprotocol/sdk

## 源码结构

```
src/
├── agent/          Pi SDK 集成（createAgentSession → 事件订阅 → prompt）
├── commands/       自定义命令系统（接口见 registry.ts）
├── lsp/            LSP 集成
├── notifications/  原生通知（OS + TUI Toast，三层级联：OSC → 平台二进制 → no-op）
├── session/        会话管理（含持久化）
├── skills/         Skill 系统
├── tools/          工具实现
├── tui/            TUI 渲染（React 状态驱动）
├── poll/           轮询
└── utils/
```

## 命令

| 命令 | 作用 |
|---|---|
| `bun run dev` | 启动 TUI |
| `bun run check` | typecheck + lint + test（提交前必过） |
| `bun run test` | bun test |

## 代码风格

见 `biome.json`。核心约定：tab 缩进、双引号、分号、行宽 100。
新代码不要再引入 `any`（含 noExplicitAny 等已降级为 warn 的技术债）。

## Pi SDK 工具注册双名单

`createAgentSession` 有两个工具相关参数，缺一不可：

| 参数 | 作用 | 缺失后果 |
|---|---|---|
| `tools`（→ SDK 内部 `allowedToolNames`） | **注册门槛** — 不在白名单里的工具直接从注册表删除，对 agent 完全不可见 | 工具定义再完整也进不去 |
| `customTools` | **工具定义** — schema、handler、prompt snippet | 没定义就没法注册 |

SDK 内部过滤逻辑：`isAllowedTool = !allowedToolNames || allowedToolNames.has(name)`。只有通过过滤的工具才会进入 `_toolRegistry`，其余连 inactive 都不是——直接不存在。

**新增工具时必须同时两处添加**：`customTools` 数组里放定义，`tools` 数组里放工具名。`handleSetAgentMode` 切换模式时会重建 `tools` 白名单，也必须包含 MCP 工具名。

当前受影响的三个位置（`src/agent/session.ts` 和 `src/server/index.ts`）：
1. `createSession`（legacy 路径）
2. `createRuntime` factory（主路径）
3. `handleSetAgentMode`（模式切换）

MCP 工具已合并为单个 `mcp` 工具（参数含 `server_name` + `tool_name` + `arguments`），白名单只需加 `"mcp"` 一个名。

## 约定

- **包管理器**：Bun，`bun.lock` 是唯一 lockfile；`package-lock.json` 已 gitignore，勿提交
- **测试**：`bun test`，纯函数测试放 `tests/*.test.ts`
- **Team 模式测试三层架构**（详见 `/team-test-writing` skill）：
  - **Unit**（`tests/team-*-unit.test.ts`）：纯函数，无 LLM 依赖，默认运行
  - **Integration**（`tests/team-*-integration.test.ts`）：mock session + `mock.module`，默认运行
  - **E2E**（`tests/team-*-e2e.test.ts`）：真 LLM，`describe.skipIf(process.env.RUN_LLM_TESTS !== "1")` 门控
  - **LLM provider 配置**：E2E 测试用 `tests/helpers/astron-config.ts` 共享 helper，默认 `ASTRON_INFINITY_API_KEY`（低级模型），切换用 `ASTRON_API_KEY`
  - **已知坑**：MemberState.session JSON 循环引用（已修 stripSession）、logger LOG_DIR 模块加载固化（缓存 REAL_HOME）、createRealServer 不传 config（E2E 自建 server）
- **提交钩子**：lefthook 自动 biome 修复 + typecheck（见 `lefthook.yml`），勿用 `--no-verify` 绕过
- **规格变更**：走 OpenSpec 流程（`openspec/specs/`），用 `/openspec-*` 命令驱动
- **React 状态引用**：`useKeyboard` / `useCallback` / `useEffect` 等闭包内读取组件状态时，**必须**通过 `xxxRef.current` 而非直接读 `state`。`useKeyboard` 的回调在组件挂载时注册一次，后续不随 re-render 更新——闭包里捕获的 `state` 永远是初始值。正确模式：
  ```tsx
  const stateRef = useRef(state);
  stateRef.current = state;  // 每次渲染同步

  useKeyboard((key) => {
      // ❌ 读 state → 闭包陈旧值
      // ✅ 读 stateRef.current → 实时值
  });
  ```
  现有 `agentModeRef`、`isRunningRef`、`messagesRef`、`configRef` 均按此模式。新增键盘逻辑必须沿用。

## 开发流程

所有非平凡的开发需求（新功能、重构、架构调整、非琐碎 bug 修复）一律走 **Harness** 流水线（`.opencode/skills/harness/SKILL.md`），不要直接上手写业务代码。

**注意**： 需求代码不要在 主分支直接修改， 一切都走  git worktree

**触发**：用户提出非平凡开发需求时自动进入 `/harness` 流程。

**不触发**（直接做）：拼写修正、格式化、依赖升级、文档错别字等纯机械改动。

**七步流水线**（用户只在 ★ 标记的两步介入，其余自动流转）：

```
探索 → 提案★ → 审核 → 实施 → 归档 → 验收★ → 合并清理
```

1. **探索**（自动）：`/opsx-explore` 理清需求，并行创建 worktree
2. **提案**（★ 用户）：`/opsx-propose` 生成 proposal/design/tasks + spec delta，用户确认方向
3. **审核**（自动）：① 格式门禁（完整性、Non-goals、任务粒度、规范一致、覆盖完整）→ ② Oracle 技术评审（架构合理性、替代方案、边界条件、性能、安全、依赖、可维护性）
4. **实施**（自动）：`/opsx-apply` 逐项执行 tasks，每项完成跑 `bun run check`
5. **归档**（自动）：`/opsx-archive` 归档 change + 同步 spec
6. **验收**（★ 用户）：展示变更全貌，用户确认
7. **合并清理**（自动）：merge 回 main + push + 删除 worktree 和分支

**护栏**：
- 不跳过审核和验收——验收前不合并到 main
- 探索/提案阶段只读代码库、生成 artifact，不写业务代码
- 所有开发操作在 `.git/worktree/<change>` 内进行，分支命名 `change/<change-id>`
- 一个 worktree 对应一个 change，用完即删
- `check` 失败必须修复，不得 `--no-verify` 绕过

详见 SKILL.md。

## 通知系统

原生通知（OS Notification Center + TUI 内 Toast），默认开启，覆盖 TUI / headless run / serve+attach 全部模式。

**架构**：三层级联投递 —— ① OpenTUI OSC（iTerm2/Ghostty/WezTerm 原生支持）→ ② 平台二进制（macOS `terminal-notifier`→`osascript`、Linux `notify-send`、Windows `SnoreToast`）→ ③ headless/SSH 静默 no-op。订阅挂在 `AgentServer.ensureSubscribed()`（`src/server/index.ts`），单点覆盖所有运行模式。不引入 `node-notifier`（vendor 二进制过旧）。

**配置**（`~/.config/openagent/config.json` 全局或 `<cwd>/.openagent/config.json` 项目）：

```json
{
  "notifications": {
    "enabled": true,
    "sound": true,
    "bashThresholdMs": 10000,
    "events": { "agentEnd": true, "toolError": true, "longBash": true, "needsInput": true, "compactionEnd": true },
    "channels": { "toast": true, "osc": true, "os": true }
  }
}
```

`/setting` 命令切换总开关 / 声音 / bash 阈值；细粒度事件与通道开关走 config.json。

**默认触发事件**：`agent_end`（一轮完成）、`tool_execution_end` + `isError`（工具失败）、bash 耗时 ≥ `bashThresholdMs`（长任务）、`question` 工具阻塞（需要输入）、`compaction_end`（压缩完成，仅 Toast）。

**平台注意**：
- macOS iTerm2/Ghostty：OSC 零配置；Terminal.app 不支持 OSC，降级 `terminal-notifier`（`brew install terminal-notifier`）或 `osascript`
- tmux：OSC 透传需 `set -g allow-passthrough on`（3.2+）
- SSH：OSC 仍尝试（序列透传到本地终端），OS 原生通道自动 no-op
- macOS 通知权限：首次通知后在「系统设置 → 通知」授权终端 app
