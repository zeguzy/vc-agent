# Skills + Command 系统 — 设计文档

## 概述

为 openagent 增加 Skills 系统和 Command 系统。Skills 系统支持两种技能（自动加载 + 动态加载），Command 系统提供可插拔的 slash 命令注册表。

## 架构图

```
┌─ 启动 ─────────────────────────────────────┐
│  index.tsx                                  │
│    └─ createSession({cwd, model, config})   │
│         └─ session.ts                       │
│              ├─ new SkillManager()           │
│              │   └─ initialize(cwd, config)  │
│              │        └─ DefaultResourceLoader│
│              │             ├─ agentDir: ~/.config/openagent
│              │             ├─ scan skills/    │
│              │             └─ reload()        │
│              ├─ createAgentSession({          │
│              │     resourceLoader, ...        │
│              │  })                            │
│              └─ return {session, skillManager}│
│                                              │
│  <App session skillManager model cwd config> │
│    └─ useEffect: registerBuiltinCommands()   │
│         └─ CommandRegistry.register(...)  x10│
└──────────────────────────────────────────────┘

┌─ Skills 数据流 ─────────────────────────────┐
│                                              │
│  自动加载 (auto)                             │
│    ~/.config/openagent/skills/*/SKILL.md     │
│    <cwd>/.openagent/skills/*/SKILL.md        │
│    config.skills.paths[]                     │
│      ↓                                       │
│    DefaultResourceLoader                     │
│      ↓                                       │
│    formatSkillsForPrompt() → system prompt   │
│      ↓                                       │
│    LLM 自动调用 / /skill:name 手动调用        │
│                                              │
│  动态加载 (dynamic)                          │
│    /load-skill <path>                        │
│      ↓                                       │
│    loadSkillsFromDir({dir: path})            │
│      ↓                                       │
│    SkillManager._dynamicSkills[]             │
│      ↓                                       │
│    extendResources({skillPaths: [path]})     │
│      ↓                                       │
│    Pi SDK 可展开 /skill:name                 │
└──────────────────────────────────────────────┘

┌─ Command 数据流 ────────────────────────────┐
│                                              │
│  用户输入 /clear                             │
│      ↓                                       │
│  InputBox.handleTextareaSubmit()             │
│      ↓                                       │
│  App.handlePrompt(text)                      │
│      ↓                                       │
│  commandRegistry.execute(cmd, args, ctx)     │
│      ↓                                       │
│  Command.handler(args, ctx)                  │
│    ctx = { session, skillManager,            │
│            setMessages, setIsRunning, ... }   │
│                                              │
│  autocomplete:                               │
│    InputBox → matchCommands(input)           │
│            → commandRegistry.match(input)    │
└──────────────────────────────────────────────┘
```

## 关键技术决策

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| 技能加载机制 | 自建 vs Pi SDK | Pi SDK ResourceLoader | SDK 已内置扫描/格式化/注入；只需配置路径 |
| 技能发现路径 | 复用 ~/.pi/ vs ~/.config/openagent/ | ~/.config/openagent/ | 与现有 config.json 一致，不与 Pi CLI 冲突 |
| 命令分发 | 硬编码 switch/case vs 注册表 | CommandRegistry | 技能系统需要动态注册命令；方便测试 |
| 命令上下文 | React hooks 直接调用 vs 数据对象 | CommandContext 数据对象 | 避免注册表依赖 React |

## 文件清单

### 新增

| 文件 | 作用 |
|---|---|
| src/skills/manager.ts | SkillManager 类 |
| src/commands/registry.ts | CommandRegistry 类 + 全局单例 |
| tests/commands.test.ts | CommandRegistry 单元测试 (11 tests) |
| tests/skills.test.ts | SkillManager 集成测试 (7 tests) |

### 修改

| 文件 | 变更 |
|---|---|
| src/config.ts | 新增 SkillsConfig (paths/autoLoad/disabled) |
| src/agent/session.ts | 创建 DefaultResourceLoader + SkillManager；返回 SessionResult |
| src/index.tsx | 传递 skillManager 给 <App> |
| src/tui/commands.ts | 用 CommandRegistry 重写；新增 3 个技能命令 |
| src/tui/App.tsx | 接受 skillManager；commandRegistry.execute() 替代 switch/case |
