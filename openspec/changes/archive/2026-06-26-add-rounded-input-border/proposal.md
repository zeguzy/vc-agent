## Why

底部输入框目前使用 opentui 默认的 `"single"` 边框样式（直角 `┌┐└┘`），视觉上偏硬朗。改为 `"rounded"` 圆角边框（`╭╮╰╯`）可以让输入区域显得更柔和、更现代，提升整体视觉质感。

## What Changes

- 将 `InputBox` 组件中带四边边框的 `<box>` 元素的 `borderStyle` 设置为 `"rounded"`，使输入框四个角使用圆角 Unicode 字符。

## Capabilities

### New Capabilities
<!-- 无新增能力，仅修改现有输入框的视觉样式 -->

### Modified Capabilities
- `input-box`: 边框样式从默认直角改为圆角

## Impact

- **代码变更**：`src/tui/components/InputBox.tsx`，第 91 行的 `<box>` 添加 `borderStyle="rounded"` 属性
- **无 API 变化**：不影响组件接口或 props
- **无依赖变化**：`@opentui/core` 原生支持 `"rounded"` 边框样式，无需额外依赖

## Non-goals

- 不修改 `StatusBar`、`MessageList` 等其他组件的边框样式（它们的边框为单边线条，无角可圆）
- 不修改输入框的边框颜色、背景色、内边距等其他样式属性
- 不引入自定义边框字符（`customBorderChars`），仅使用内置 `"rounded"` 样式
