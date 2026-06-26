# agent-session Specification

## Purpose
定义 Agent 会话的创建过程，包括 Provider 注册、Model 解析、Skill 自动发现和 ResourceLoader 配置。
## Requirements
### Requirement: Skill 自动发现
系统 SHALL 在创建 Agent 会话时自动扫描并加载技能（Skills），将可自动调用的技能注入到系统提示中。

#### Scenario: 全局技能扫描
- **WHEN** 系统启动
- **THEN** 创建 `DefaultResourceLoader`，配置 `agentDir=~/.config/openagent`
- **AND** 自动扫描 `~/.config/openagent/skills/` 目录下的 SKILL.md 文件

#### Scenario: 项目技能扫描
- **WHEN** 系统启动
- **THEN** 自动扫描 `<cwd>/.openagent/skills/` 目录下的 SKILL.md 文件

#### Scenario: 额外技能路径
- **WHEN** `config.skills.paths` 配置了额外的路径
- **THEN** 这些路径 SHALL 被加入 `additionalSkillPaths` 传入 `DefaultResourceLoader`

#### Scenario: 禁用自动加载
- **WHEN** `config.skills.autoLoad` 为 `false`
- **THEN** 系统 SHALL 不扫描默认技能目录（但额外路径仍可配置）

#### Scenario: 排除特定技能
- **WHEN** `config.skills.disabled` 列出了技能名称
- **THEN** 这些技能 SHALL 通过 `skillsOverride` 从加载结果中过滤掉

### Requirement: 创建 Pi SDK Agent 会话
系统 SHALL 调用 Pi SDK 的 `createAgentSession()` 创建 Agent 会话，配置内置工具（read、bash、edit、write）；SHALL 使用 `SettingsManager.inMemory()` 而非文件版创建 settings 管理器，阻止 Pi 写自己的 settings.json（持久化由 vc-agent 自行写 openagent/config.json，避免双写漂移）。

#### Scenario: 成功创建会话
- **WHEN** 系统启动且检测到有效的 LLM API Key（如 `ANTHROPIC_API_KEY`）
- **THEN** 调用 `createAgentSession({ cwd, model, tools, settingsManager })`，其中 `settingsManager` 为 `SettingsManager.inMemory(从 openagent/config.json 转换的初始 settings)`；返回 `session`

#### Scenario: 缺少 API Key
- **WHEN** 系统启动但未检测到任何 LLM API Key
- **THEN** 显示错误消息（"请设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY"），然后退出

#### Scenario: SDK 句柄链式访问
- **WHEN** settings 模块需要调用 SDK 句柄使设置项立即生效
- **THEN** SHALL 通过 `session.settingsManager`、`session.modelRegistry`、`session.modelRegistry.authStorage` 链式访问（这些已公开），不扩展 `createSession` 返回值

#### Scenario: Pi settings.json 不被写入
- **WHEN** `Setting.apply` 调用 Pi setter（如 `setDefaultThinkingLevel`）
- **THEN** 因 `SettingsManager` 为 inMemory 实例，SHALL 仅改内存使设置立即生效，不触发 Pi 写 `~/.pi/agent/settings.json` 或 `.pi/settings.json`

### Requirement: Pi 事件流映射为 React State
系统 SHALL 订阅 Pi SDK 的事件系统，将 Agent 生命周期事件映射为 React state 更新，驱动 OpenTUI 组件重新渲染。

#### Scenario: 流式文本输出
- **WHEN** 收到 `message_update` 事件且包含 `text_delta`
- **THEN** 将文本增量追加到当前 Agent 消息的 state，触发 MessageList 组件重新渲染

#### Scenario: 工具调用开始
- **WHEN** 收到 `tool_execution_start` 事件
- **THEN** 在消息 state 中添加工具调用消息（`{ type: "tool", name, args, status: "running" }`）

#### Scenario: 工具调用完成
- **WHEN** 收到 `tool_execution_end` 事件
- **THEN** 更新对应工具消息的 status 为 "done"，记录结果摘要

#### Scenario: Agent 回合结束
- **WHEN** 收到 `agent_end` 事件
- **THEN** 设置 `isRunning` state 为 false，恢复输入框交互

### Requirement: 发送用户输入到 Agent
系统 SHALL 通过 `session.prompt(text)` 将用户输入发送到 Agent，触发新一轮 Agent 循环。

#### Scenario: 提交用户输入
- **WHEN** 用户在输入行按 Enter 键
- **THEN** 系统调用 `session.prompt(inputText)`，等待 Agent 响应期间禁用输入

