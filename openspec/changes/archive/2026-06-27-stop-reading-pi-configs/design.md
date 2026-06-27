## Context

openagent 基于 Pi SDK（`@earendil-works/pi-coding-agent`）构建，但保持自身的配置体系（`~/.config/openagent/config.json` + `.openagent/config.json`）。当前 `createSession()` 中有两处调用隐式读取 Pi 的全局配置文件，使 openagent 的启动行为依赖于 Pi 配置目录的存在和内容，与"openagent 独立于 Pi 配置"的定位不符。

### 当前数据流

```
src/index.tsx
  │
  ├─ loadConfig(cwd) ──────────── 读 openagent 自身 config  ✅ 不读 Pi
  │
  └─ createSession({cwd, model, config})
       │
       ├─ AuthStorage.create() ── 读 ~/.pi/agent/auth.json   ❌ 读 Pi 配置
       ├─ ModelRegistry.create() ─ 读 ~/.pi/agent/models.json ❌ 读 Pi 配置
       ├─ SettingsManager.inMemory() ──────────────────────── ✅ 已在内存
       ├─ SessionManager.inMemory() ───────────────────────── ✅ 已在内存
       └─ createAgentSession({
            authStorage,      ← 注入（但已含 Pi 磁盘数据）
            modelRegistry,    ← 注入（但已含 Pi 磁盘数据）
            settingsManager,  ← 内存模式
            sessionManager,   ← 内存模式
            resourceLoader,   ← openagent 自建（~/.config/openagent）
          })
```

### 目标数据流

```
src/index.tsx
  │
  ├─ loadConfig(cwd) ──────────── 读 openagent 自身 config   ✅ 不读 Pi
  │
  └─ createSession({cwd, model, config})
       │
       ├─ AuthStorage.inMemory() ──────────────────────────── ✅ 不读磁盘
       │    └─ 凭据来源：setRuntimeApiKey(config.providers) + 环境变量
       ├─ ModelRegistry.inMemory(authStorage) ─────────────── ✅ 不读磁盘
       │    └─ 自定义 model：registerCustomProvider(config.providers)
       ├─ SettingsManager.inMemory() ──────────────────────── ✅ 已在内存
       ├─ SessionManager.inMemory() ───────────────────────── ✅ 已在内存
       └─ createAgentSession({...}) ← 全部 in-memory 注入
```

## Goals / Non-Goals

**Goals:**
- 使 openagent 的 Agent 会话创建完全不依赖 Pi 的磁盘配置文件
- 保留 openagent 自身 config.json 的所有功能（providers、API key、custom models、settings）

**Non-Goals:**
- 不修改 openagent config.json 的 schema
- 不改变 Pi SDK 的版本或依赖关系
- 不引入新的配置文件格式

## Decisions

### Decision 1: 使用 `AuthStorage.inMemory()` 替代 `AuthStorage.create()`

**选择**: `AuthStorage.inMemory()`，凭据通过 `setRuntimeApiKey` 注入。

**理由**:
- Pi SDK 已内置此 API，无需 hack
- `AuthStorage.inMemory(data?)` 不访问 `~/.pi/agent/auth.json`
- openagent 已在 `session.ts:30-32` 调用 `authStorage.setRuntimeApiKey(name, providerConfig.apiKey)` 注入凭据
- 环境变量（`ANTHROPIC_API_KEY` 等）仍由 `AuthStorage.getApiKey()` 优先级链自动支持

**备选方案**: 
- 传入自定义 `authPath` 到 `AuthStorage.create(authPath)` 指向 openagent 目录 —— 引入额外文件管理负担
- 使用 `AuthStorage.fromStorage()` 自定义 storage backend —— 过度工程化

### Decision 2: 使用 `ModelRegistry.inMemory(authStorage)` 替代 `ModelRegistry.create(authStorage)`

**选择**: `ModelRegistry.inMemory(authStorage)`，自定义 provider 通过 `registerProvider` 注入。

**理由**:
- Pi SDK 内置，仅加载内置模型，不读 `models.json`
- openagent 已在 `session.ts:72-94` 的 `registerCustomProvider` 中注册自定义 provider
- 避免从 `~/.pi/agent/models.json` 读取未经 openagent 管理的模型配置

**备选方案**:
- 传入自定义 `modelsJsonPath` —— 多一个管理点，且 Pi 格式与 openagent config 不兼容

### Decision 3: 不新增 `agentDir` 参数

`createAgentSession()` 中不传 `agentDir`，Pi SDK 内部 `getDefaultAgentDir()` 虽会计算其值，但因为我们已注入全部依赖（`authStorage`、`modelRegistry`、`settingsManager`、`resourceLoader`），`agentDir` 不会被用于任何磁盘读取路径。

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| 之前依赖 `/login` OAuth 订阅凭据的用户将无法直接使用 | help 文本已说明使用 `config.providers[name].apiKey` 或环境变量；可在后续单独变更中补充引导 |
| `ModelRegistry.inMemory()` 只加载内置模型，若有用户依赖 `models.json` 自定义模型 | openagent 已有 `registerCustomProvider` 从 `config.providers` 注入自定义 provider，无需 `models.json` |
| API 兼容性：`AuthStorage.inMemory()` 和 `ModelRegistry.inMemory()` 的返回类型与 create 版本一致 | Pi SDK d.ts 已确认，签名完全兼容 |
