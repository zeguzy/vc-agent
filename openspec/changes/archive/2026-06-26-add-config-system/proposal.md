## Why

openagent 目前所有配置都硬编码：模型从 CLI 参数传入，API key 只从环境变量读取，思考级别、显示模式等 TUI 设置无法持久化。用户每次启动都要手动重新配置。需要一个配置系统支持全局和项目级配置，让用户一次设置、永久生效。

## What Changes

- 新增配置文件系统：`~/.config/openagent/config.json`（全局）+ `.openagent/config.json`（项目级）
- 启动时读取两个配置文件，项目级覆盖全局级（deep merge）
- 配置内容传递给 Pi SDK：
  - `providers.*.apiKey` → `AuthStorage.setRuntimeApiKey()`
  - `providers.*` 自定义 → `ModelRegistry.registerProvider()`
  - `model` → 模型解析
  - `thinking.level` → `SettingsManager.setThinkingLevel()`
- TUI 设置直接驱动 UI 状态：
  - `thinking.collapsed` → 思考折叠默认值
  - `display.contextMode` → 上下文显示模式
  - `compaction.enabled` / `compaction.threshold` → 压缩行为
- 移除环境变量 API key 检查（配置文件为唯一来源）

## Capabilities

### New Capabilities
- `config`: 配置文件读取、合并、类型校验

### Modified Capabilities
- `cli-entry`: 启动时读取配置文件，传递给 session 和 TUI
- `agent-session`: 接受配置驱动的 provider/model/thinking 设置

## Impact

- **新增文件**: `src/config.ts` — 配置读取、类型定义、合并逻辑
- **修改文件**:
  - `src/index.tsx` — 读取配置，传递给 createSession 和 App
  - `src/agent/session.ts` — 接受配置参数，注册 providers/apiKeys
  - `src/tui/App.tsx` — 从配置初始化 thinkingCollapsed/contextDisplay
- **无破坏性变化**: 配置文件不存在时回退到当前行为（CLI 参数 + 默认值）

## Non-goals

- 不支持环境变量配置（配置文件为唯一来源）
- 不支持运行时修改配置文件的热重载
- 不实现 `config init` 交互式配置向导（后续可加）
- 不实现配置文件加密
