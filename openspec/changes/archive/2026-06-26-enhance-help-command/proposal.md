## Why

输入框右上角长期显示一串快捷键提示（如 `Enter to send · Shift+Enter newline · Esc: normal`），与左侧的 cwd/git 信息挤在同一行，视觉杂讯较多。而 `/help` 命令已存在，但输出只列了 slash commands，未包含这些快捷键。应将帮助信息集中到 `/help`，让输入区保持简洁，同时让 `/help` 成为唯一的"如何操作"入口。

## What Changes

- **增强 `/help` 输出**：在现有 slash command 列表基础上，新增"快捷键 / 模式提示"小节，覆盖 INSERT/NORMAL 两种模式下的键位说明。
- **移除 InputBox 右上角提示文案**：删除 InputBox.tsx 中右侧 `<text fg={colors.textSubtle}>` 渲染的模式快捷键提示（含运行时 queue 提示变体）。
- **保留 cwd/git 路径信息**：InputBox 左侧的工作目录与 git branch 标识不受影响（那是上下文标识，不是帮助提示）。
- **修正 `/help` 输出遗漏**：现有 `/help` 输出漏列了 `/context` 命令，顺便补齐为完整的 7 条命令。

## Capabilities

### New Capabilities
<!-- 无新增 capability，所有变更都在 tui-input 范畴内 -->

### Modified Capabilities
- `tui-input`: 两处 requirement 变更——(1) "模式快捷键提示" requirement 删除 InputBox 右侧提示的 scenario，改为仅由 `/help` 提供；(2) "Slash Command" requirement 中 `/help` 的输出内容扩展为包含命令列表 + 快捷键两部分。

## Non-goals

- 不新增 slash command（`/help` 已存在，仅增强其输出）。
- 不修改 InputBox 左侧 cwd/git 路径信息的渲染。
- 不调整 placeholder 文案（`Message openagent… / for commands` 等仍保留在 textarea 内）。
- 不引入 `/help [command]` 子命令式详细帮助（MVP 保持单页输出）。
- 不改动 StatusBar 组件（底部的 model/mode/context 信息独立于本次变更）。

## Impact

- **代码**：`src/tui/components/InputBox.tsx`（删除右侧提示 text 节点及相关 mode/disabled 分支）、`src/tui/App.tsx`（重写 `case "help"` 输出，补齐 `/context` 并新增快捷键小节）。
- **Spec**：`openspec/specs/tui-input/spec.md` 的两个 requirement 需更新（通过 delta spec）。
- **依赖/系统**：无新增依赖，无 API 变更，纯 UI 文案与布局调整。
- **用户体验**：输入区视觉更简洁；用户需主动输入 `/help` 查看快捷键——这是可接受的取舍，因为 placeholder 已提示 `/ for commands`。
