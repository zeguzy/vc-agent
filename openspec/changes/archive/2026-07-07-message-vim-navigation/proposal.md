## Proposal: Message Area Vim Navigation

### Background

消息区当前仅支持基本滚动（j/k 滚动 2 行，g/G 跳顶/底）。用户无法在消息内容中进行字符级导航、跳转到特定单词、或高效选择文本。Normal mode 的潜力远未被利用——用户需要像 vim 一样在格式化内容中快速移动光标、按字符搜索跳跃、以及可视化选择文本。

### Features

1. **Virtual Cursor + Basic Motions**

   Normal mode 下，在消息区可见区域内维护一个虚拟光标。支持 vim 基础移动命令：`h/l`（左右移动）、`j/k`（上下移动，到边界自动滚动）、`w/b/e`（词移动）、`0/$/^`（行首/行尾/首个非空字符）、`gg/G`（跳转顶部/底部，触发滚动）。光标通过 `renderer.setCursorPosition()` 显示，位置始终 clamp 到非空字符单元格。

2. **Char Jump + Easymotion**

   `f/F/t/T<char>` 在当前行内搜索字符并跳转。`s<char>` 触发 easymotion 式全屏跳跃：扫描可见区域中所有匹配字符，使用 SCTree 算法分配最短标签（单键→双键→深层），通过 `buffer.setCell()` 在屏幕上叠加标签，用户按标签键即可瞬移到目标位置。

3. **Visual Selection + Yank**

   `v` 进入可视模式，移动操作扩展选区。`y` 复制选中文本到剪贴板，复用现有的 `copyToClipboard()` 基础设施。通过 `buffer.setCell()` 反色高亮选中区域。

### Non-goals

- **不做文本编辑**——消息区是只读的，不支持 insert mode 编辑消息内容
- **不做 Ex 命令**——不实现 `:s/old/new/`、`:%s`、`:g/pattern/` 等命令行模式
- **不做宏/寄存器/标记**——不实现 `qa...q`、`"ay`、`ma`、`'a` 等
- **不做与 `<markdown>` 内部结构的集成**——不追踪 BlockState token 级别的位置映射
- **不做多窗口/分屏**——不实现 `:split`、`:vsplit` 或多 buffer 切换
- **不做 dot-repeat**——不实现 `.` 重复上次复合操作
- **不做 j/k 原有滚动行为的向后兼容**——j/k 从「滚动 2 行」变为「光标移动 1 行 + 边界自动滚动」
