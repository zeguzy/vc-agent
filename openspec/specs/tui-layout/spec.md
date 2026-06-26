# tui-layout Specification

## Purpose
定义全屏 TUI 的主要区域、底部输入组合区和状态栏布局。

## Requirements
### Requirement: 全屏布局结构
系统 SHALL 使用 OpenTUI 的 Box 组件构建全屏布局，将终端窗口划分为三个垂直区域：消息滚动区（顶部，弹性高度）、输入组合区（底部固定）、状态栏（最底部固定）。

#### Scenario: 三区域布局
- **WHEN** 应用启动并进入全屏模式
- **THEN** 终端窗口从上到下显示：ScrollBox 消息区（占据剩余空间）、InputBox 输入组合区（状态提示 + 多行 Textarea）、StatusBar 状态栏（单行高度）

#### Scenario: 弹性高度分配
- **WHEN** 终端窗口大小为 height 行
- **THEN** 消息区 SHALL 占据除底部固定区域外的剩余高度，输入组合区和状态栏 SHALL 保持 `flexShrink={0}`

#### Scenario: 输入组合区高度变化
- **WHEN** 用户编辑多行草稿导致输入区高度变化
- **THEN** 输入组合区 SHALL 在 2 到 6 行 Textarea 范围内增长，消息区 SHALL 相应让出空间并保持滚动到底部

### Requirement: 底部状态栏职责
系统 SHALL 将运行状态提示放在输入框上方，并将最底部状态栏限制为环境信息展示。

#### Scenario: 状态栏显示环境信息
- **WHEN** 应用渲染底部状态栏
- **THEN** 状态栏 SHALL 显示当前 model 和 cwd 摘要，不显示 `Ready`、`Working` 或输入快捷键提示

#### Scenario: 英文界面文案
- **WHEN** 渲染输入组合区和状态栏
- **THEN** 用户可见文案 SHALL 使用英文，例如 `Ready`、`Working`、`Message openagent…`、`Enter to send` 和 `Shift+Enter for newline`

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
