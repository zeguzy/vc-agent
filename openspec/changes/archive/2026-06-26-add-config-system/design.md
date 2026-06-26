## Context

openagent 是基于 @opentui/core TUI 框架和 @earendil-works/pi-coding-agent SDK 构建的终端 AI 编码助手。

Pi SDK 已有完整的配置系统：
- `AuthStorage` — 管理 API key（优先级：runtime > auth.json > OAuth > env > fallback）
- `ModelRegistry` — 管理模型注册（内置 + 自定义 provider）
- `SettingsManager` — 管理 40+ 设置字段（thinking level, compaction, theme 等）

但 openagent 目前完全没使用这些系统：
- `AuthStorage.create()` 用默认路径 `~/.config/pi/auth.json`
- `ModelRegistry.create(authStorage)` 只加载内置模型
- 没有传 `SettingsManager` 给 `createAgentSession`
- API key 只从环境变量读取
- TUI 设置（thinking 折叠、上下文显示模式）不持久化

## Goals / Non-Goals

**Goals:**
- 用户可通过 JSON 配置文件设置所有参数
- 支持全局 + 项目级两层配置，项目级覆盖全局级
- 支持自定义 provider（Ollama/vLLM/Azure 等，需 baseUrl + api + models）
- 配置文件不存在时优雅降级到默认行为

**Non-Goals:**
- 不支持 YAML/TOML（仅 JSON）
- 不支持环境变量（配置文件为唯一来源）
- 不支持热重载

## Decisions

### 配置文件位置

```
~/.config/openagent/config.json     ← 全局配置
.openagent/config.json               ← 项目级配置（CWD 下）
```

项目级 deep merge 覆盖全局级。

### 配置 Schema

```jsonc
{
  // 默认模型，格式: "provider:modelId" 或 "modelId"
  "model": "anthropic:claude-sonnet-4-20250514",

  // 思考相关
  "thinking": {
    "level": "medium",       // "none" | "low" | "medium" | "high"
    "collapsed": false       // TUI 中思考内容默认折叠状态
  },

  // Provider 配置（API key + 自定义 provider）
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-..."
    },
    "openai": {
      "apiKey": "sk-..."
    },
    // 自定义 provider（Ollama/vLLM/Azure 等）
    "ollama": {
      "apiKey": "ollama",           // 占位符即可
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai",              // API 兼容格式
      "models": [
        {
          "id": "llama3.2",
          "name": "Llama 3.2",
          "contextWindow": 128000,
          "maxTokens": 4096
        }
      ]
    }
  },

  // TUI 显示设置
  "display": {
    "contextMode": "compact"   // "compact" | "full"
  },

  // 上下文压缩设置
  "compaction": {
    "enabled": true,
    "threshold": 0.8           // 80% 时触发
  }
}
```

### Deep Merge 策略

```
全局: { model: "a", thinking: { level: "high" }, providers: { openai: { apiKey: "x" } } }
项目: { model: "b", providers: { anthropic: { apiKey: "y" } } }
                                            ↓ deep merge
结果: { model: "b", thinking: { level: "high" }, providers: { openai: { apiKey: "x" }, anthropic: { apiKey: "y" } } }
```

### 启动流程

```
main()
  │
  ├─ readGlobalConfig()    → ~/.config/openagent/config.json
  ├─ readProjectConfig()   → .openagent/config.json
  │
  ├─ deepMerge(global, project)
  │
  ├─ resolvedConfig = {
  │     model, thinking, providers, display, compaction
  │  }
  │
  ├─ createSession(cwd, resolvedConfig)
  │     ├─ AuthStorage.create()
  │     ├─ ModelRegistry.create(authStorage)
  │     │     └─ for each provider in config.providers:
  │     │          ├─ if has apiKey: authStorage.setRuntimeApiKey(name, key)
  │     │          └─ if has baseUrl/api/models: registry.registerProvider(name, config)
  │     ├─ resolveModel(registry, config.model)
  │     ├─ SettingsManager.create(cwd)
  │     │     └─ setThinkingLevel(config.thinking.level)
  │     └─ createAgentSession({ cwd, authStorage, modelRegistry, model, settingsManager, tools })
  │
  └─ <App session config={resolvedConfig} />
        ├─ thinking.collapsed → useState init
        └─ display.contextMode → useState init
```

## Risks / Trade-offs

- **[与 Pi SDK auth.json 的关系]** openagent 配置中的 apiKey 通过 `setRuntimeApiKey` 设置（内存级），不写入 Pi SDK 的 `~/.config/pi/auth.json`。两套配置独立运行，openagent 配置优先级更高（runtime override）。→ 无冲突风险
- **[配置文件不存在]** 全局和项目配置都不存在时，回退到当前行为：CLI `--model` 参数 + 默认值。→ 无破坏性变化
- **[自定义 provider 注册]** `registerProvider` 会添加到 ModelRegistry，但需要 API key 才会出现在 `getAvailable()` 中。→ 自定义 provider 必须同时提供 apiKey
