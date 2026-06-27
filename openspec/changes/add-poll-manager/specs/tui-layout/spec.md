## MODIFIED Requirements

### Requirement: 输入组合区状态行
系统 SHALL 在输入框上方显示状态行，包含工作目录路径和运行状态。

#### Scenario: 空闲状态行
- **WHEN** Agent 空闲（非运行中）
- **THEN** 状态行 SHALL 显示 ` path:git_branch`（Nerd Font 文件夹图标 + 路径 + git 分支名，无 git 时省略分支），右侧显示模式快捷键提示

#### Scenario: 运行状态行
- **WHEN** Agent 正在响应或执行工具
- **THEN** 状态行 SHALL 在路径行上方显示独立行 `⠹ Working...`（spinner 动画 + 省略号），与路径行之间有 marginTop=1 间距

#### Scenario: 路径格式化
- **WHEN** 渲染工作目录路径
- **THEN** home 目录 SHALL 替换为 `~`，路径层级 >3 时 SHALL 显示 `…/last_dir`，≤3 时 SHALL 显示完整路径

#### Scenario: Git 分支名获取
- **WHEN** 渲染状态行
- **THEN** 系统 SHALL 通过 PollManager 轮询（默认每 3 秒）读取 `.git/HEAD` 文件解析当前分支名
- **AND** 无 `.git` 目录时 SHALL 省略分支显示
- **AND** 外部 `git checkout` 后 SHALL 在下一轮询周期内自动更新显示
