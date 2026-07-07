---
name: agent-config
description: 维护 openagent 运行时配置文件（config.json、mcp.json、自定义 agent、自定义 skill、AGENTS.md、instructions）。覆盖增删改查、优先级合并规则、校验方式。当用户提到「配置」「config」「mcp.json」「添加 MCP」「创建 agent」「创建 skill」「/setting」「/config」「修改设置」「instructions」「切换 mode」时使用。
license: MIT
metadata:
  author: openagent
  version: "1.0"
---

# Agent Config：运行时配置维护

维护 openagent **用户实例**的配置文件（运行时层，非源码层）。覆盖五类文件：主配置、MCP server、自定义 agent、自定义 skill、项目上下文。

所有路径遵循**双层结构**：全局（`~/.config/openagent/`）+ 项目（`<cwd>/.openagent/`）。

---

## 配置文件全貌

| 文件 | 全局位置 | 项目位置 | Schema 来源 | 修改方式 |
|------|----------|----------|-------------|----------|
| `config.json` | `~/.config/openagent/` | `<cwd>/.openagent/` | `src/config.ts` 的 `Config` | `/setting` 面板 或 直接编辑 |
| `mcp.json` | `~/.config/openagent/` | `<cwd>/.openagent/` | `src/mcp/types.ts` 的 `McpJsonConfig` | **仅手动编辑**（无命令封装） |
| `agents/*.md` | `~/.config/openagent/agents/` | `<cwd>/.openagent/agents/` | `src/agents/types.ts` 的 `AgentConfig` | 手动创建 |
| `skills/*/SKILL.md` | `~/.config/openagent/skills/` | `<cwd>/.openagent/skills/` | Pi SDK `Skill` + frontmatter | 手动创建 或 `/load-skill` |
| `AGENTS.md` | `~/.config/openagent/AGENTS.md` | findUp 从 `<cwd>` 向上找 | 纯文本 | 直接编辑 |

**合并规则**（项目优先于全局）：

| 文件 | 合并策略 |
|------|----------|
| `config.json` | **deep merge** — 嵌套字段也递归合并，项目覆盖同名键 |
| `mcp.json` | **by-key shallow merge** — 同名 server 项目覆盖全局，其余合并 |
| `agents/`、`skills/` | **合并发现** — 两层目录都扫描，同名时项目优先 |
| `AGENTS.md` | 全局 + 最近的 project 两者都加载到 systemPrompt |

---

## 维护任务

### 任务 1：修改运行时配置（config.json）

**优先用 `/setting`**（TUI 面板，带校验）—— 覆盖：`model`、`thinking`、`compaction`、`notifications`、`teams.enabled`、`teams.maxWorkers`、`teams.defaultMaxTurns`。

**必须直接编辑 config.json** 的场景：
- `providers`（自定义 LLM provider 配置）
- `display`（UI 偏好）
- `skills.paths` / `skills.autoLoad` / `skills.disabled`
- `contextPruning`（上下文压缩策略）
- `instructions`（见任务 5）
- `teams.agentModes`（自定义 mode 循环顺序）
- `teams.workerPermissions` / `teams.isolation` 等高级字段

**初始化空配置**：`/config init [project|global] [--force]` 写入模板。

改完后**重启 session** 才生效（`/setting` 改的即时生效，直接编辑的需重启）。

---

### 任务 2：添加 / 移除 MCP server（mcp.json）

mcp.json **没有命令封装**，必须手动编辑。格式：

```json
{
  "filesystem": {
    "type": "local",
    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/abs/path"],
    "env": { "FOO": "bar" },
    "cwd": "/optionally/set/cwd"
  },
  "github": {
    "type": "remote",
    "url": "https://api.mcp.github.com/sse",
    "headers": { "Authorization": "env:GITHUB_TOKEN" }
  }
}
```

**关键约定**：
- `env:` 前缀的值从环境变量解析（敏感信息勿明文写入文件）
- 所有 MCP server 在 Pi SDK 内合并为**单个 `mcp` 工具**（参数：`server_name` + `tool_name` + `arguments`），白名单只需加 `"mcp"` 一个名
- 改动需重启 session 才生效；连接失败时检查 `command`/`url`/网络/环境变量
- 完整 schema 见 `src/mcp/types.ts`

---

### 任务 3：创建自定义 agent（agents/*.md）

每个 agent 一个 `.md` 文件，YAML frontmatter + 正文（作为 systemPrompt）：

```markdown
---
name: code-reviewer
description: Reviews code for bugs and style. Use when user asks to review code.
tools: [read, grep, bash]
model: glm-5.2
maxTurns: 10
permissionMode: read-only
disallowedTools: []
---

You are a meticulous code reviewer. Check for:
1. Bugs and logic errors
2. Style violations
3. Security issues

报告格式：按严重度分级列出。
```

**关键字段**：
- `name`：kebab-case，全局唯一（项目同名覆盖全局）
- `description`：**必须**含触发场景 —— agent 靠它决定何时被调用
- `tools`：白名单，未列出的工具对该 agent 不可见；缺省用调用方的工具集
- `permissionMode`：`read-only` | `auto-edit` | `full-access`
- 正文 = `systemPrompt`，注入该 agent 的每次会话

**注意**：内置 agent（flagella / ribosome / nucleus / plasmid / lysosome）定义在 `src/agents/defaults.ts`，文件系统改不到；用户自定义 agent 与之合并发现。

加载失败 → 检查 frontmatter YAML 语法（缩进、引号、数组格式）。

---

### 任务 4：创建自定义 skill（skills/*/SKILL.md）

每个 skill 一个**目录**，内含 `SKILL.md`：

```markdown
---
name: my-skill
description: 一句话说明能力。Use when [触发词或场景]。
metadata:
  author: you
  version: "1.0"
---

# Skill 标题

## 何时触发
...

## 工作流
...
```

**两种触发方式**：
- **默认自动注入** systemPrompt（`disable-model-invocation` 缺省或 `false`）
- **手动 `/skill:<name>`** 扩展（设 `disable-model-invocation: true`）

**运行时载入**（不放入 skills 目录）：
- `/load-skill <path>` — 临时加载指定 SKILL.md
- `/unload-skill <name>` — 卸载动态加载的 skill
- `/skills` — 查看所有已加载 skill（自动 + 动态）

**description 是唯一触发线索** —— agent 选 skill 只看这一句，必须写清"做什么 + 何时用"。

---

### 任务 5：管理 instructions（config.json）

`config.instructions: string[]` —— 额外的上下文文件，注入每次会话的 systemPrompt：

```json
{
  "instructions": [
    "./docs/coding-standards.md",
    "~/shared/conventions.md",
    "https://example.com/style.md"
  ]
}
```

支持：相对路径（相对 cwd）、`~/` 展开、glob 模式、HTTP(S) URL。

`AGENTS.md` 是特殊的 instructions —— 自动从全局 + findUp(cwd) 加载，**不需要**写入 `instructions` 字段。

---

### 任务 6：切换 agent mode

四个 mode：`standard` | `planner` | `orchestrator` | `team`。

**临时切换**（无通用 `/mode` 命令，每个 mode 有独立命令）：

| 命令 | 切换到 |
|------|--------|
| `/plan` | `planner` |
| `/orchestrate` | `orchestrator` |
| `/team` | `team` |

`standard` 是默认初始 mode。

**改默认/循环顺序**：编辑 `config.teams.agentModes`（数组）：

```json
{ "teams": { "agentModes": ["standard", "planner"] } }
```

`teams.enabled: false` 时 `team` mode 自动从循环中剔除。

各 mode 的工具白名单定义在 `src/agent/session.ts`（`STANDARD_ACTIVE_TOOLS` / `PLANNER_ACTIVE_TOOLS` / `TEAM_ACTIVE_TOOLS`）—— 源码层，本 skill 不涉及。

---

## 护栏

- **mcp.json 无命令封装** —— 任何"添加/删除 MCP"的请求都是手动编辑文件，不要假装有命令
- **没有 `/agents`、`/mcp`、`/mode` 命令** —— 不要在指引里写这些不存在的命令
- **敏感信息用 `env:` 前缀** —— API key、token 不要明文写入 config/mcp 文件
- **frontmatter 必须合法 YAML** —— 缩进、引号、数组格式出错会导致 agent/skill 加载失败且无显式报错
- **直接编辑 config.json 后需重启 session** —— `/setting` 改的即时生效，手改的不一定
- **已被 `/setting` 覆盖的字段优先用 `/setting`** —— 有校验更安全
- **项目级配置优先于全局** —— 改之前确认要改哪一层
- **不要试图删除内置 agent** —— 它们在源码 `src/agents/defaults.ts`，文件系统改不到
- **skill 名 kebab-case 且全局唯一** —— 项目同名覆盖全局

---

## 校验清单

每次修改后按此校验：

| 改动 | 校验方式 |
|------|----------|
| `config.json`（/setting 字段） | `/setting` 打开面板看值是否反映 |
| `config.json`（手改字段） | 重启 session，观察行为；JSON 语法错会导致整个配置加载失败 |
| `mcp.json` | 重启 session，观察启动时 MCP server 连接日志；失败检查 command/url/env |
| `agents/*.md` | 重启 session 后尝试 `@<agent-name>` 调用；不可见说明 frontmatter 出错 |
| `skills/*/SKILL.md` | `/skills` 命令查看是否列出；未列出说明 frontmatter 或目录结构有问题 |
| `AGENTS.md` / `instructions` | 新会话中询问 agent 是否了解对应上下文 |

**加载失败的常见原因**：JSON/YAML 语法错（逗号、引号、缩进）、字段名拼错、文件路径不对、frontmatter 缺少必填字段（`name`/`description`）。

完整 schema 参考：
- `src/config.ts` — `Config` 及所有子类型
- `src/mcp/types.ts` — MCP 配置
- `src/agents/types.ts` — `AgentConfig`
- `src/settings/definitions.ts` — `/setting` 覆盖的字段清单
