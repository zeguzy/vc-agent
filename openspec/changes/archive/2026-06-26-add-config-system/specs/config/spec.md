## ADDED Requirements

### Requirement: Config file locations
配置系统 SHALL 支持两个配置文件位置：
- 全局配置：`~/.config/openagent/config.json`
- 项目配置：`{cwd}/.openagent/config.json`

#### Scenario: 全局配置文件存在
- **WHEN** 全局配置文件存在且合法 JSON
- **THEN** 系统 SHALL 读取并解析为全局配置对象

#### Scenario: 项目配置文件存在
- **WHEN** 项目配置文件存在且合法 JSON
- **THEN** 系统 SHALL 读取并解析为项目配置对象

#### Scenario: 配置文件不存在
- **WHEN** 全局和项目配置文件都不存在
- **THEN** 系统 SHALL 使用默认配置（CLI 参数 + 内置默认值），不报错

#### Scenario: 配置文件格式错误
- **WHEN** 配置文件存在但 JSON 解析失败
- **THEN** 系统 SHALL 输出警告到 stderr 并继续使用默认配置

### Requirement: Config deep merge
项目级配置 SHALL deep merge 覆盖全局配置。

#### Scenario: 两层配置合并
- **WHEN** 全局配置有 `{thinking: {level: "high"}}` 且项目配置有 `{model: "x"}`
- **THEN** 合并结果 SHALL 为 `{model: "x", thinking: {level: "high"}}`

#### Scenario: 同级嵌套对象合并
- **WHEN** 全局有 `{providers: {openai: {apiKey: "a"}}}` 且项目有 `{providers: {anthropic: {apiKey: "b"}}}`
- **THEN** 合并结果 SHALL 包含两个 provider

#### Scenario: 同级标量覆盖
- **WHEN** 全局有 `{model: "a"}` 且项目有 `{model: "b"}`
- **THEN** 合并结果 SHALL 为 `{model: "b"}`

### Requirement: Config schema
配置文件 SHALL 遵循以下 schema：

```
{
  model?: string,
  thinking?: { level?: string, collapsed?: boolean },
  providers?: Record<string, {
    apiKey?: string,
    baseUrl?: string,
    api?: string,
    headers?: Record<string, string>,
    models?: Array<{ id: string, name: string, contextWindow?: number, maxTokens?: number }>
  }>,
  display?: { contextMode?: "compact" | "full" },
  compaction?: { enabled?: boolean, threshold?: number }
}
```

所有字段均为可选。未指定的字段使用内置默认值。

### Requirement: Provider API key integration
配置中的 `providers.{name}.apiKey` SHALL 通过 `AuthStorage.setRuntimeApiKey()` 设置。

#### Scenario: 配置中提供 API key
- **WHEN** 配置中有 `providers.anthropic.apiKey: "sk-ant-xxx"`
- **THEN** 系统 SHALL 调用 `authStorage.setRuntimeApiKey("anthropic", "sk-ant-xxx")`

#### Scenario: 自定义 provider 同时提供 apiKey 和 baseUrl
- **WHEN** 配置中有 provider 同时提供 `apiKey`、`baseUrl`、`api`、`models`
- **THEN** 系统 SHALL 同时注册 API key 和调用 `registry.registerProvider()`

## MODIFIED Requirements

### Requirement: CLI entry configuration loading
CLI 入口 SHALL 在创建 session 前读取并合并配置文件。

#### Scenario: 有配置文件时启动
- **WHEN** 全局或项目配置文件存在
- **THEN** 系统 SHALL 读取配置 → deep merge → 传递合并结果给 createSession 和 App

#### Scenario: CLI --model 参数与配置文件同时存在
- **WHEN** CLI `--model` 参数和配置文件 `model` 字段同时存在
- **THEN** CLI 参数 SHALL 优先于配置文件
