# tui-layout Specification

## Purpose
TBD - created by archiving change mvp-tui-agent. Update Purpose after archive.
## Requirements
### Requirement: 全屏布局结构
系统 SHALL 使用 OpenTUI 的 Box 组件构建全屏布局，将终端窗口划分为三个垂直区域：消息滚动区（顶部，弹性高度）、输入框（底部固定）、状态栏（最底部固定）。

#### Scenario: 三区域布局
- **WHEN** 应用启动并进入全屏模式
- **THEN** 终端窗口从上到下显示：ScrollBox 消息区（占据剩余空间）、Input 输入框（单行高度）、StatusBar 状态栏（单行高度）

#### Scenario: 弹性高度分配
- **WHEN** 终端窗口大小为 height 行
- **THEN** 消息区高度 = height - 2（减去输入框和状态栏各 1 行），输入框和状态栏各占 1 行

### Requirement: 终端 Resize 处理
系统 SHALL 在终端尺寸变化时（SIGWINCH）自动重新计算布局，保持三区域结构不变。

#### Scenario: 窗口缩小
- **WHEN** 用户调整终端窗口从 80x24 变为 80x12
- **THEN** 消息区高度从 22 缩减到 10，输入框和状态栏保持各 1 行，内容正确重排

#### Scenario: 窗口放大
- **WHEN** 用户调整终端窗口从 80x12 变为 120x40
- **THEN** 消息区高度扩展到 38，宽度扩展到 120 列，内容填充新空间

### Requirement: Alternate Screen Buffer
系统 SHALL 在启动时进入终端的 alternate screen buffer（ANSI `\x1b[?1049h`），在退出时恢复主 screen buffer（`\x1b[?1049l`）。

#### Scenario: 进入全屏
- **WHEN** OpenTUI 渲染器启动
- **THEN** 切换到 alternate screen，清除屏幕，开始渲染布局

#### Scenario: 退出全屏
- **WHEN** 用户退出程序（Ctrl+C 空闲时 / Ctrl+D / 进程终止）
- **THEN** 恢复主 screen buffer，光标回到原始位置，终端历史不受影响

