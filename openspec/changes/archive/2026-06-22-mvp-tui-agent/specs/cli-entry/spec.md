## ADDED Requirements

### Requirement: CLI 启动与参数解析
系统 SHALL 提供一个 CLI 入口（`src/index.ts`），在启动时解析命令行参数，初始化 Agent 会话和 OpenTUI 渲染器，并进入全屏 TUI 交互模式。

#### Scenario: 无参数启动
- **WHEN** 用户运行 `openagent`（无参数）
- **THEN** 系统使用默认模型初始化 Agent 会话，启动 OpenTUI 渲染器进入全屏模式，显示欢迎消息

#### Scenario: 指定模型
- **WHEN** 用户运行 `openagent --model claude-sonnet-4-20250514`
- **THEN** 系统使用指定模型初始化 Agent 会话

#### Scenario: 显示帮助
- **WHEN** 用户运行 `openagent --help`
- **THEN** 系统显示用法说明、可用参数列表，然后退出（不进入交互模式）

### Requirement: 工作目录感知
系统 SHALL 以当前工作目录（`process.cwd()`）作为 Agent 的操作根目录，所有文件操作工具（read/edit/write）均在此目录下执行。

#### Scenario: 默认工作目录
- **WHEN** 用户在 `/home/user/project` 下运行 `openagent`
- **THEN** Agent 会话的 `cwd` 设为 `/home/user/project`，工具操作限定在此目录
