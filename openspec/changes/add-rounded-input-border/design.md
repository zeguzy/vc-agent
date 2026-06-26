## Context

InputBox 组件 (`src/tui/components/InputBox.tsx`) 使用 `@opentui/core` 的 `<box>` 元素渲染底部输入区域。当前带四边边框的 `<box>` 未显式指定 `borderStyle`，使用默认值 `"single"`（直角字符 `┌┐└┘`）。

opentui 的 `BorderStyle` 类型定义：

```
BorderStyle = "single" | "double" | "rounded" | "heavy"
```

各样式对应的角字符：

```
single:   ┌┐└┘    heavy:   ┏┓┗┛
rounded:  ╭╮╰╯    double:  ╔╗╚╝
```

## Goals / Non-Goals

**Goals:**
- 将输入框边框角字符改为圆角（`╭╮╰╯`）

**Non-Goals:**
- 不修改边框颜色、宽度、内边距
- 不修改其他组件的边框

## Decisions

### 使用内置 `borderStyle="rounded"` 而非 `customBorderChars`

opentui 提供两种自定义边框的方式：
1. 内置 `borderStyle` 枚举值 — 一行 prop 即可
2. `customBorderChars` — 完全自定义 11 个边框字符

选择内置 `"rounded"`，因为它是标准样式，一行代码完成，无需维护自定义字符映射。

```
当前:                          改后:
┌──────────────────┐          ╭──────────────────╮
│ > Message opena… │          │ > Message opena… │
└──────────────────┘          ╰──────────────────╯
```

## Risks / Trade-offs

- **[终端兼容性]** 圆角字符（╭╮╰╯）属于 Unicode Box Drawing 块 (U+256D, U+256E, U+2570, U+256F)，绝大多数现代终端均支持 → 无需额外处理
