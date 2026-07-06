# tui-layout Specification

## Purpose
定义全屏 TUI 的主要区域、底部输入组合区和状态栏布局。
## Requirements
### Requirement: 全屏布局结构
系统 SHALL 使用 OpenTUI 的 Box 组件构建全屏布局，将终端窗口划分为三个垂直区域：消息滚动区（顶部，弹性高度）、输入组合区（底部固定）、状态栏（最底部固定）。

#### Scenario: 三区域布局
- **WHEN** 应用启动并进入全屏模式
- **THEN** 终端窗口从上到下显示：ScrollBox 消息区（占据剩余空间）、InputBox 输入组合区（状态行 + 圆角边框 Textarea）、StatusBar 状态栏（单行高度）

#### Scenario: 弹性高度分配
- **WHEN** 终端窗口大小为 height 行
- **THEN** 消息区 SHALL 占据除底部固定区域外的剩余高度，输入组合区和状态栏 SHALL 保持 `flexShrink={0}`

#### Scenario: 输入组合区高度变化
- **WHEN** 用户编辑多行草稿导致输入区高度变化
- **THEN** 输入组合区 SHALL 在 2 到 6 行 Textarea 范围内增长，消息区 SHALL 相应让出空间并保持滚动到底部

### Requirement: 底部状态栏职责

系统 SHALL 将最底部状态栏限制为模式指示和上下文用量展示，不再显示成员标签。

#### Scenario: 状态栏显示模式与上下文用量

- **WHEN** 应用渲染底部状态栏
- **THEN** 状态栏 SHALL 显示当前模式（`-- INSERT --` 或 `-- NORMAL --`，颜色：insert=success绿、normal=primary蓝），右侧显示上下文用量指示器
- **AND** 状态栏 SHALL NOT 显示 leader tag、member tags、`★` 标记或任何成员相关 UI
- **AND** 状态栏 SHALL NOT 接收 `members`、`activeMemberName`、`agentMode` props

#### Scenario: 上下文用量指示器

- **WHEN** 状态栏渲染上下文用量
- **THEN** compact 模式 SHALL 显示 `◌ N%`，full 模式 SHALL 显示 `◌ tokens/window (N%)`，通过 `/context` 命令切换
- **AND** 颜色 SHALL 按用量变化：<50% success绿、50-80% warning黄、>80% error红

### Requirement: 输入组合区状态行
系统 SHALL 在输入框上方显示状态行，包含工作目录路径和运行状态。

#### Scenario: 空闲状态行
- **WHEN** Agent 空闲（非运行中）
- **THEN** 状态行 SHALL 显示 `󰝰 path:git_branch`（Nerd Font 文件夹图标 + 路径 + git 分支名，无 git 时省略分支），右侧显示模式快捷键提示

#### Scenario: 运行状态行
- **WHEN** Agent 正在响应或执行工具
- **THEN** 状态行 SHALL 在路径行上方显示独立行 `⠹ Working...`（spinner 动画 + 省略号），与路径行之间有 marginTop=1 间距

#### Scenario: 路径格式化
- **WHEN** 渲染工作目录路径
- **THEN** home 目录 SHALL 替换为 `~`，路径层级 >3 时 SHALL 显示 `…/last_dir`，≤3 时 SHALL 显示完整路径

#### Scenario: Git 分支名获取
- **WHEN** 渲染状态行
- **THEN** 系统 SHALL 通过读取 `.git/HEAD` 文件解析当前分支名，无 `.git` 目录时 SHALL 省略分支显示

### Requirement: 英文界面文案
系统 SHALL 在输入组合区和状态栏中使用英文文案。

#### Scenario: 用户可见文案英文化
- **WHEN** 渲染输入组合区和状态栏
- **THEN** 用户可见文案 SHALL 使用英文，例如 `Working...`、`Message openagent…`、`Enter to send`、`Queue a message…`

### Requirement: 终端 Resize 处理
系统 SHALL 在终端尺寸变化时（SIGWINCH）自动重新计算布局，保持三区域结构不变。

#### Scenario: 窗口缩小
- **WHEN** 用户调整终端窗口从 80x24 变为 80x12
- **THEN** 消息区高度缩减以容纳底部固定区域，输入组合区和状态栏保持可见，内容正确重排

#### Scenario: 窗口放大
- **WHEN** 用户调整终端窗口从 80x12 变为 120x40
- **THEN** 消息区扩展到更多可用空间，宽度扩展到 120 列，内容填充新空间

### Requirement: Alternate Screen Buffer
系统 SHALL 在启动时进入终端的 alternate screen buffer（ANSI `\x1b[?1049h`），在退出时恢复主 screen buffer（`\x1b[?1049l`）。

#### Scenario: 进入全屏
- **WHEN** OpenTUI 渲染器启动
- **THEN** 切换到 alternate screen，清除屏幕，开始渲染布局

#### Scenario: 退出全屏
- **WHEN** 用户退出程序（Ctrl+C 空闲时 / Ctrl+D / 进程终止）
- **THEN** 恢复主 screen buffer，光标回到原始位置，终端历史不受影响

### Requirement: 成员标签行布局

系统 SHALL 在 InputBox 与 StatusBar 之间为 team 模式渲染独立的拓扑图组件（替代原 InputBox 内部的成员标签行），位于 InputBox 之后、StatusBar 之前。

#### Scenario: 拓扑图位置

- **WHEN** team 模式且成员列表非空
- **THEN** 拓扑图组件 SHALL 渲染在 InputBox 之后、StatusBar 之前
- **AND** 拓扑图 SHALL 使用 `flexShrink={0}` 不参与弹性空间分配
- **AND** 拓扑图 SHALL 接收 `members`、`tasks`、`activeMemberName` 作为 props

#### Scenario: 拓扑图不影响三区域布局

- **WHEN** 拓扑图组件可见
- **THEN** 终端窗口三区域结构 SHALL 保持不变：消息区（弹性高度）、输入组合区（固定）、状态栏（固定）
- **AND** 输入组合区因拓扑图增加 N 行高度，消息区 SHALL 相应缩减 N 行
- **AND** 拓扑图自身 SHALL 使用 maxHeight=10 兜底，防止极端情况吃掉所有消息区空间

#### Scenario: 拓扑图隐藏时无额外空间

- **WHEN** team 模式关闭或成员列表为空导致拓扑图不可见（`return null`）
- **THEN** InputBox 与 StatusBar 之间 SHALL 无额外空白
- **AND** 输入组合区高度 SHALL 与拓扑图引入前一致

