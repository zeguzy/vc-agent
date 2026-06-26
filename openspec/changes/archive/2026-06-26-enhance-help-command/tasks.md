## 1. 帮助文案中心化（src/tui/commands.ts）

- [x] 1.1 新增导出函数 `buildHelpText(): string`，返回完整的 `/help` 输出文本
- [x] 1.2 命令列表部分通过 `slashCommands.map(c => \`  /${c.name.padEnd(...)}  — ${c.description}\`)` 动态生成，确保包含全部 7 条命令（含 `/context`）
- [x] 1.3 在命令列表后追加独立的"快捷键"小节，分 INSERT（Enter 发送 / Shift+Enter 换行 / Esc 进入 NORMAL / Ctrl+C 中断或连按两次退出）和 NORMAL（i·a·o 进入 INSERT / j·k 滚动 / g·G 顶·底 / t 折叠 thinking）两组

## 2. App.tsx 接入新帮助文案

- [x] 2.1 在 `src/tui/App.tsx` 顶部从 `./commands.js` 导入 `buildHelpText`
- [x] 2.2 将 `case "help"` 中硬编码的多行字符串替换为 `createAssistantMessage(buildHelpText())`

## 3. 移除 InputBox 右侧提示（src/tui/components/InputBox.tsx）

- [x] 3.1 删除顶部状态行内右侧的 `<text fg={colors.textSubtle}>{mode === "insert" ? ... : ...}</text>` 节点（即渲染 `Enter to send · Shift+Enter newline · Esc: normal` 等提示的 text）
- [x] 3.2 保留其左侧的 `<box flexGrow={1} />` spacer，使 cwd/git 信息继续靠左、右侧自然留白
- [x] 3.3 确认 `mode` 与 `disabled` 变量仍被其他地方使用（placeholder、border、spinner、marginTop），不得误删

## 4. 验证

- [x] 4.1 运行 `bun run src/index.tsx` 或 tsc 类型检查，确认无编译/类型错误
- [x] 4.2 启动应用，输入 `/help`，确认输出包含 7 条命令 + 快捷键小节
- [x] 4.3 确认 InputBox 顶部状态行右侧已无快捷键提示，仅左侧显示 cwd/git 信息
