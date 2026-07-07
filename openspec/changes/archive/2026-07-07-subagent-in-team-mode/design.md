# Design: Team 模式下启用 Subagent 工具

## 架构变更

当前互斥逻辑：

```
isTeamMode ?
  → 注册 team/memory/message + team-guarded bash/write
  → 不注册 subagent
:
  → 注册 subagent + 原生 bash/write
```

变更为：

```
isTeamMode ?
  → 注册 team/memory/message + team-guarded bash/write
  → 注册 subagent  ← 新增
  → 注入 agent 列表  ← 新增
:
  → 注册 subagent + 原生 bash/write
```

## 修改点

### 1. `src/agent/session.ts` — TEAM_ACTIVE_TOOLS 白名单

```ts
// Before
export const TEAM_ACTIVE_TOOLS = [
  ...ALL_TOOLS, "glob", "edit", "todo", "question", "webfetch",
  "team", "memory", "message",
];

// After
export const TEAM_ACTIVE_TOOLS = [
  ...ALL_TOOLS, "glob", "edit", "todo", "question", "webfetch",
  "team", "memory", "message", "subagent",
];
```

### 2. `src/agent/session.ts` — createRuntime factory customTools

在 `isTeamMode` 分支中也 push `createSubagentTool`：

```ts
// Before
if (isTeamMode) {
  customTools.push(createTeamGuardedBashTool(fCwd), createTeamGuardedWriteTool(fCwd));
} else {
  customTools.push(createSubagentTool({ ... }));
}

// After
if (isTeamMode) {
  customTools.push(createTeamGuardedBashTool(fCwd), createTeamGuardedWriteTool(fCwd));
}
customTools.push(createSubagentTool({
  cwd: fCwd,
  services: svc,
  parentModel: svc.model,
}));
```

### 3. `src/agent/session.ts` — appendSystemPromptFor team 模式注入 agent 列表

```ts
// Before
if (agentMode === "team") return [TEAM_ORCHESTRATOR_PROMPT];

// After
if (agentMode === "team") return injectAgentList([TEAM_ORCHESTRATOR_PROMPT]);
```

### 4. `src/agent/session.ts` — createSession (legacy 路径) 同步

`createSession` 使用 `STANDARD_ACTIVE_TOOLS`（已含 subagent），且无条件注册 subagent。此路径无需修改。

### 5. `src/context-files.ts` — 更新委派指引

移除"prefer team() over subagent()"的排他性表述，改为互补性描述。

### 6. 测试更新

更新 `tests/agent-session.test.ts` 中 team 模式断言：
- team 模式应包含 "Available subagents"
- team 模式 active tools 应包含 "subagent"

## 安全护栏

- team member 内部仍禁止 subagent（`NEVER_MEMBER_TOOLS` 已含 `"subagent"`），防止递归嵌套
- subagent 执行是同步阻塞的，不会与 team 异步机制冲突
