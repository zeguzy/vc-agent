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

## 约定

- **包管理器**：Bun，`bun.lock` 是唯一 lockfile；`package-lock.json` 已 gitignore，勿提交
- **测试**：`bun test`，纯函数测试放 `tests/*.test.ts`
- **提交钩子**：lefthook 自动 biome 修复 + typecheck（见 `lefthook.yml`），勿用 `--no-verify` 绕过
- **规格变更**：走 OpenSpec 流程（`openspec/specs/`），用 `/openspec-*` 命令驱动

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
