## Context

openagent 是一个 TUI 终端编程助手。代码库经过多轮功能迭代后，出现了架构层面的技术债：

- `App.tsx` 482 行，是单个 React 组件的反模式上限
- `agent/session.ts` 308 行，混合了服务初始化、Provider 注册、模型解析、内容提取四类逻辑
- `settings/` 7 个文件，每个仅 ~30 行，碎片化
- `store.ts` 命名误导（不含状态管理，只是消息模型）
- `tui/` 目录工具文件与组件平铺，无分组
- 错误处理模式不统一：`err instanceof Error ? err.message : String(err)` 重复 15+ 次

本次重构严格保持行为不变，只做结构优化。

## Goals / Non-Goals

**Goals:**
- 降低核心文件的认知负担（App.tsx 482→~180 行，agent/session.ts 308→~200 行）
- 消除误导性命名（store.ts → message.ts）
- 统一文件组织模式（tui/hooks/、tui/utils/）
- 标准化错误处理（formatError 工具函数）
- 所有变更通过 `bun run check` 验证

**Non-Goals:**
- 不改变任何用户可见行为
- 不修改 Pi SDK 或 OpenTUI 的集成方式
- 不引入 React Context 替代 commandRegistry 单例
- 不修复 LspClient 的 sleep 竞态问题
- 不添加新功能

## Decisions

### Decision 1: Hook 提取粒度 — 3 个 Hook vs 1 个大 Hook

**选择**: 3 个独立 Hook（useSessionEvents, useStreamingBuffer, useSessionPicker）

**理由**: 
- 每个 Hook 有明确的单一职责
- 可独立测试，不依赖 React 组件树
- 未来可被其他组件复用（如 useSessionPicker 可用于其他 overlay）

**替代方案**: 1 个 `useAppState` Hook — 会再次成为新上帝 Hook，放弃。

### Decision 2: 消息映射统一 — 新增 mapSingleEvent vs 改造 mapSdkMessagesToTui

**选择**: 新增 `mapAgentEvent(event, context)` 纯函数处理实时事件，保留 `mapSdkMessagesToTui` 处理历史恢复

**理由**:
- 两种场景本质不同：实时事件有增量状态（pendingTextRef），历史恢复是批量转换
- `mapSdkMessagesToTui` 遍历整个数组，不适合逐事件调用
- 共享底层工具函数（extractAssistantContent 等），避免重复

### Decision 3: agent/session.ts 拆分策略

**选择**: 只移出纯工具函数（内容提取、错误格式化），保留 Provider 注册和模型解析

**理由**:
- `registerCustomProvider` / `resolveModel` 仅在 `initServices` 内部使用，拆出增加跳转负担
- 工具函数被 4+ 个模块引用，移出减少循环依赖风险
- 文件从 308 行降到 ~200 行，已达可管理规模

```
Before:                          After:
agent/session.ts (308行)         agent/session.ts (~200行)
├── initServices                  ├── initServices
├── createSession                 ├── createSession
├── createRuntime                 ├── createRuntime
├── registerCustomProvider        ├── registerCustomProvider
├── resolveModel                  ├── resolveModel
├── extractAssistantContent  ──→  utils/content.ts
├── extractAssistantText    ──→  utils/content.ts
└── summarizeArgs           ──→  utils/content.ts
```

### Decision 4: settings/ 合并策略 — 单文件 vs 按类别分组

**选择**: 单个 `settings/definitions.ts`（~150 行）

**理由**:
- 当前只有 7 个设置项，单文件足够
- SettingsPanel 已经通过数组索引遍历，合并减少 import 数量
- 未来超过 15 个设置项时可再拆分

### Decision 5: tui/ 目录重组

**选择**: 三级分组：hooks/、utils/、components/，保留 keymap.ts、commands.ts 在根目录

```
tui/
  App.tsx                   ← 薄编排层
  keymap.ts                 ← vim 键位映射（独立关注点）
  commands.ts               ← 命令注册（与 commandRegistry 紧耦合）
  hooks/
    useSessionEvents.ts     ← 事件订阅
    useStreamingBuffer.ts   ← 流式缓冲
    useSessionPicker.ts     ← 会话选择器状态
  utils/
    clipboard.ts, selection.ts, streaming.ts, syntax.ts, theme.ts
  components/
    InputBox, MessageList, ModelPicker, SessionPicker, SettingsPanel, StatusBar, WelcomeBanner
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Import 路径大量变更导致 CI 失败 | 每次文件移动后立即运行 `bun run check`，不累积错误 |
| Hook 提取引入闭包/ref 时序 bug | 每个 Hook 提取后手动验证流式输出和会话切换 |
| settings/ 合并破坏 SettingsPanel 的索引引用 | 合并后验证设置面板所有选项可正常切换和保存 |
| store.ts → message.ts 遗漏引用 | 全局 grep `store.js` 确认无残留引用 |

## Migration Plan

1. 在 worktree 内按 tasks.md 顺序执行
2. 每个 task 完成后 `bun run check` 验证
3. 全部完成后在主 worktree 合并
4. 无需数据迁移 — 纯代码重构
