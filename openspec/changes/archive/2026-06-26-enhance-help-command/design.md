## Context

当前 `/help` 命令已存在于 `src/tui/App.tsx` 的 `handlePrompt` switch 与 `src/tui/commands.ts` 的 `slashCommands` 数组中，但其输出内容硬编码在 App.tsx 内，且漏列了 `/context` 命令（实现 bug，spec 已要求 7 条）。

同时 `src/tui/components/InputBox.tsx` 在输入框上方状态行的右侧长期渲染模式快捷键提示（如 `Enter to send · Shift+Enter newline · Esc: normal`），与左侧 cwd/git 信息挤在同一行，造成视觉杂讯。该提示文案随 `mode` 和 `disabled` 状态变化，存在 3 个分支字符串。

本次变更将帮助信息统一收敛到 `/help`，让输入区只保留必要的上下文标识（cwd/git）。

```
数据流（/help 执行）

  用户键入 /help → Enter
        │
        ▼
  ┌──────────────────────┐
  │ InputBox             │
  │ handleTextareaSubmit │   选中 /help 建议 → onSubmit("/help")
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐         ┌─────────────────────────┐
  │ App.handlePrompt     │────────▶│ commands.ts             │
  │ case "help"          │         │ buildHelpText()         │
  │                      │         │  ├─ from slashCommands[]│ (动态, 杜绝漏列)
  │                      │         │  └─ 快捷键文案 (静态)    │
  └──────────┬───────────┘         └─────────────────────────┘
             │ createAssistantMessage(helpText)
             ▼
  ┌──────────────────────┐
  │ MessageList 渲染     │
  └──────────────────────┘


布局变化（InputBox 顶部状态行）

  [BEFORE]
  ┌────────────────────────────────────────────────────────┐
  │  openagent:main    Enter to send · Shift+Enter newline │  ← 提示挤右侧
  └────────────────────────────────────────────────────────┘

  [AFTER]
  ┌────────────────────────────────────────────────────────┐
  │  openagent:main                                        │  ← 右侧留白
  └────────────────────────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals:**
- 让 `/help` 成为获取"如何操作"信息的唯一入口，输出包含命令列表 + 快捷键两部分。
- 移除 InputBox 状态行右侧的快捷键提示，减少视觉杂讯。
- 修复 `/help` 输出漏列 `/context` 的实现 bug，并防止未来再漏（动态生成）。

**Non-Goals:**
- 不新增 slash command。
- 不修改 placeholder、StatusBar、cwd/git 标识。
- 不实现 `/help [command]` 子命令详细帮助。
- 不把快捷键从 `keymap.ts` 自动派生为帮助文案（keymap 是键→action 映射，非面向用户文案）。

## Decisions

### 决策 1：命令列表从 `slashCommands[]` 动态生成
**选择**：在 `commands.ts` 新增 `buildHelpText()` 函数，命令列表部分通过 `slashCommands.map(...)` 拼接。
**理由**：现状是硬编码字符串，已经导致 `/context` 漏列。动态生成让"命令注册表"成为单一事实源，未来新增命令只需改一处。
**备选**：继续硬编码 —— 否决，bug 已证明不可维护。
**备选**：把帮助文案字段加进 `SlashCommand` 接口 —— 否决，MVP 范围内 description 已足够，过度设计。

### 决策 2：快捷键部分保持静态文案
**选择**：快捷键小节在 `buildHelpText()` 内以静态多行字符串硬编码，分 INSERT / NORMAL 两小节。
**理由**：`src/tui/keymap.ts` 是 `key → action` 的机器映射（如 `escape → toNormal`），不是面向用户的友好文案（如 "Esc: normal"）。自动派生需要再维护一张 action→文案 表，复杂度收益不匹配。
**备选**：从 keymap 派生 —— 否决，文案质量下降且耦合两套命名。

### 决策 3：InputBox 右侧提示整段移除，保留 spacer
**选择**：删除 InputBox.tsx 中右侧 `<text fg={colors.textSubtle}>` 节点，保留其左侧的 `<box flexGrow={1} />` spacer，使 cwd/git 信息继续靠左、右侧自然留白。
**理由**：最小改动，不破坏布局结构；placeholder 中的 `/ for commands` 仍提示用户如何发现命令。
**备选**：把右侧替换为别的信息（如时间戳）—— 否决，超出本次范围且增加杂讯。

### 决策 4：帮助文案逻辑抽到 `commands.ts`，不留在 App.tsx
**选择**：新增 `buildHelpText(): string` 导出函数，App.tsx 的 `case "help"` 只调用 `createAssistantMessage(buildHelpText())`。
**理由**：App.tsx 已 314 行，继续在 switch 里堆多行字符串加剧膨胀；`commands.ts` 本就是命令元数据中心，帮助文案是其自然延伸，且便于未来单测。
**备选**：留在 App.tsx —— 否决，文件膨胀。

## Risks / Trade-offs

- **[可发现性下降]** 用户不再能在输入框直接看到快捷键 → 缓解：placeholder 持续提示 `/ for commands`，且 `/help` 在命令建议列表中始终可见（输入 `/` 即显示）。
- **[首次使用学习成本]** 新用户可能不知道快捷键 → 缓解：欢迎消息（App.tsx 第 29 行的初始 assistant 消息）可在后续迭代中追加一句"输入 /help 查看快捷键"，但**本次不改**（保持 MVP 范围）。
- **[文案与实际键位漂移]** 快捷键静态文案若未来 keymap 变更可能失配 → 缓解：本次范围小，keymap 稳定；后续可加单测断言 keymap 包含某 action。
- **[无破坏性变更]** 所有改动都是 UI 文案/布局调整，无 API/数据模型变更，无需迁移计划。
