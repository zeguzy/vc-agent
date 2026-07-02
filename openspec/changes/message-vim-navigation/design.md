## Design: Message Area Vim Navigation

### Architecture

```
┌─── App.tsx ───────────────────────────────────────────────────┐
│                                                                │
│  useKeyboard ──→ resolveKey(mode, key) ──→ action switch       │
│                          │                                     │
│              ┌───────────┴────────────┐                        │
│              │ existing: scroll/toggle│                        │
│              │ NEW: vim action handler│                        │
│              └───────────┬────────────┘                        │
│                          │                                     │
│  ┌──── postProcessFn ◄───┘     (registered when mode=normal)   │
│  │                                                             │
│  ▼                                                             │
│  OptimizedBuffer (final rendered frame)                        │
│  │                                                             │
│  │ buffer.buffers.char (Uint32Array) ── READ screen content    │
│  │ buffer.setCell(x,y,char,fg,bg) ───── WRITE overlay          │
│  │                                                             │
│  └─── src/tui/vim/ ────────────────────────────────────────┐   │
│      │                                                      │   │
│      │  screenModel.ts                                      │   │
│      │    scanBuffer(buffer, bounds) → ScreenCell[][]        │   │
│      │    ScreenCell = { char: string, isEmpty: boolean }    │   │
│      │                                                      │   │
│      │  cursor.ts                                           │   │
│      │    VirtualCursor { row, col }                        │   │
│      │    moveLeft/Right/Up/Down/To()                       │   │
│      │    clampToScreenModel(model)                          │   │
│      │                                                      │   │
│      │  motions.ts                                          │   │
│      │    wordForward/Backward/End(model, cursor)            │   │
│      │    findChar(model, cursor, char, {till, backward})    │   │
│      │    lineStart/End/FirstNonBlank(model, cursor)         │   │
│      │                                                      │   │
│      │  easymotion.ts                                       │   │
│      │    findTargets(model, char) → Position[]              │   │
│      │    assignLabels(targets, cursorPos)                   │   │
│      │      → Map<Position, string>  (SCTree)                │   │
│      │    resolveLabel(input, labelMap) → Position | null    │   │
│      │                                                      │   │
│      │  overlay.ts                                          │   │
│      │    renderCursor(buffer, cursor)                       │   │
│      │    renderLabels(buffer, labelMap)                     │   │
│      │    renderSelection(buffer, range)                     │   │
│      │                                                      │   │
│      │  vimState.ts                                         │   │
│      │    VimState = {                                      │   │
│      │      mode: "normal"|"visual",                        │   │
│      │      cursor: VirtualCursor,                           │   │
│      │      pending: PendingMotion | null,                  │   │
│      │      easymotion: { labels, typed } | null,           │   │
│      │      visualAnchor: Position | null,                  │   │
│      │    }                                                 │   │
│      │    handleKey(key, state, model) → VimState           │   │
│      └──────────────────────────────────────────────────────┘   │
│                                                                │
│  scrollRef.current.scrollBy/scrollTo  ◄── viewport scrolling   │
└────────────────────────────────────────────────────────────────┘
```

### Key Decisions

#### D1: Screen-level scan via `addPostProcessFn`（not component-level）

**Decision**: 使用 `renderer.addPostProcessFn(buffer => ...)` 在渲染管线的最后阶段扫描 `buffer.buffers.char`，构建虚拟屏幕模型并叠加 vim 元素。

**Rationale**: `<markdown>` 是纯展示组件——没有 cursor / selection / position API。在屏幕级操作意味着：
- 零修改 markdown 渲染逻辑
- 对任意格式化内容都有效（代码块、表格、标题、列表）
- 不需要维护「源文本 ↔ 格式化输出」的位置映射

**Trade-off**: 只有可见视口内可导航。屏幕外的内容需先滚动到可见区域。

#### D2: Virtual cursor in absolute screen coordinates

**Decision**: `VirtualCursor {row, col}` 使用绝对屏幕坐标（buffer 坐标系），与 `renderer.setCursorPosition(x, y)` 直接对应。

**Rationale**: postProcessFn 收到的 buffer 就是最终屏幕 buffer。cursor 坐标可以直接传给 `setCursorPosition()`，无需任何转换。

**Message bounds detection**: 通过 `scrollRef.current`（ScrollBoxRenderable）的绝对位置属性确定消息区在屏幕中的范围。所有扫描和操作限制在此范围内。

#### D3: SCTree label algorithm for easymotion

**Decision**: 实现 EasyMotion 的 SCTree 标签分配算法。

```
Keyset: "fjrudkeislwoaqghtyp" (home row优先, 19 keys)
       + "vncmxzb" (次选, 7 keys)

Level 0: targets[0..25] → 单键 (f, j, r, u, d, k, ...)
Level 1: targets[26..N] → 双键 (vf, vj, vr, ... nf, nj, nr, ...)
Level 2: 超多匹配时 → 三键

排序: Manhattan distance from cursor (近的先分配短标签)
```

**Rationale**: 最小化跳转按键数。邻近目标用单键，远的用双键。已在 VSCode EasyMotion 和 vim-easymotion 中验证。实现仅需 ~40 行 TS。

#### D4: j/k 语义变更——从「滚动」到「光标移动」

**Decision**: Normal mode 下 `j/k` 从现有的「滚动 2 行」变为「光标下移/上移 1 行」。当光标到达可见区域边界时，自动滚动 ScrollBox 以保持光标可见。

**Rationale**: 这是 vim 的标准行为。光标移动与视口滚动联动是 vim 体验的核心。原有的「纯滚动」行为可通过 `Ctrl-d/Ctrl-u`（半屏滚动）或保留的 `g/G` 提供。

#### D5: Visual selection via buffer overlay（not renderer selection）

**Decision**: 可视模式选区通过 `buffer.setCell()` 反色高亮实现，而不是使用 renderer 的 `startSelection()/updateSelection()`。

**Rationale**: renderer 的 selection API 与鼠标选区绑定，行为包括 OSC52 复制等副作用。vim visual mode 是独立的状态，用自己的 overlay 更简洁。yank 时从 screenModel 提取纯文本，走 `copyToClipboard()`。

### Data Flow

```
Frame render pipeline:
  ┌─────────────────────────────────────────────────────┐
  │ React reconciler → Renderable tree → OptimizedBuffer │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── postProcessFn(buffer, dt) ───────────────────────┐
  │                                                      │
  │  1. Determine message bounds from scrollRef          │
  │  2. screenModel = scanBuffer(buffer, bounds)         │
  │     → char[][], isEmpty[][]                          │
  │                                                      │
  │  3. IF easymotion active:                            │
  │     → render labels via buffer.setCell()             │
  │     → return (skip cursor/selection overlay)         │
  │                                                      │
  │  4. IF visual mode:                                  │
  │     → highlight range via buffer.setCell()           │
  │                                                      │
  │  5. Render cursor:                                   │
  │     → highlight cell at cursor position              │
  │     → renderer.setCursorPosition(x, y, true)         │
  │                                                      │
  └──────────────────────────────────────────────────────┘

Key event handling:
  ┌──────────────────────────────────────────────────────┐
  │ useKeyboard(key)                                      │
  │   → resolveKey(mode, key) → action                   │
  │   → IF action starts with "vim":                     │
  │       vimState = handleKey(key, vimState, model)     │
  │       IF cursor moved beyond bounds:                 │
  │         scrollRef.scrollBy(delta)                    │
  │       IF yank:                                        │
  │         text = extractText(model, selection)         │
  │         copyToClipboard(text)                        │
  │       requestRender()                                │
  └──────────────────────────────────────────────────────┘
```

### Files

```
src/tui/vim/
├── screenModel.ts    # Buffer scan → ScreenCell[][]
├── cursor.ts         # VirtualCursor + clamping
├── motions.ts        # h/j/k/l, w/b/e, f/F/t/T, 0/$/^, gg/G
├── easymotion.ts     # SCTree label assignment
├── overlay.ts        # Cursor/label/selection rendering
├── vimState.ts       # State machine: handleKey() → VimState
└── index.ts          # Public API: createVimOverlay()

Modified files:
├── src/tui/App.tsx          # Register postProcessFn, wire keys
├── src/tui/keymap.ts        # Add vim action bindings
└── src/tui/components/MessageList.tsx  # Export scrollRef bounds helper
```
