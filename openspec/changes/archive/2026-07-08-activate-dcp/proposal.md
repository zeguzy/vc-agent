# activate-dcp

## Why

openagent 当前依赖 Pi SDK 内置的 auto-compaction（简单的 token 阈值摘要），这在长会话中表现为"钝器"——它不分消息类型、不保护关键上下文、不提供选择性压缩。项目中已存在一个从 Opencode-DCP v3.1.14 移植的模块（`src/dcp/`），但只是外壳：config 类型完整，compress pipeline 逻辑完整，然而 **13 个核心依赖模块全部缺失**，nudge 注入系统完全未移植，compress 工具从未被 import 或注册。

激活 DCP 能让 openagent 获得：
- **模型自主压缩**：模型通过 `compress` 工具选择性压缩已关闭的对话段落，保留关键事实
- **三层渐进式 nudge**：根据 token 用量自动注入压缩提示（紧急/边界/迭代），<minLimit 时静默
- **受保护工具**：task/skill/todowrite 等关键工具输出不被压缩
- **手动触发**：`/dcp-compress` 命令一键压缩

## What Changes

1. 补完 13 个缺失核心模块（logger、token-utils、message-ids、adapter、messages/{shape,query,utils}、compress/{types,range-utils,message-utils}、state/{index,persistence}、prompts）
2. 新建 nudge 注入系统（inject + transformContext wrap），实现三层渐进式压缩提示
3. 接线 session.ts 三处（createRuntime / createSession / handleSetAgentMode），compress 工具双名单注册
4. opt-in 默认关闭（`contextPruning.enabled: false`），回滚只需关闭开关

## Capabilities

### New

- **dcp-context-pruning**：完整的动态上下文压缩系统——compress 工具（range/message 两模式）、三层 nudge 自动触发、token 监控、手动触发、状态持久化

### Modified

- **agent-session**：新增 DCP extension 注入点（opt-in），在 createRuntime/createSession 返回后 wrap transformContext，在 handleSetAgentMode 中保留 compress 工具白名单

## Impact

- **新增文件**：`src/dcp/` 下约 13 个新模块文件
- **修改文件**：`src/agent/session.ts`（三处接线点 + initDcpExtension 公共函数）
- **无需修改**：`src/config.ts`（contextPruning key 和默认值已存在）
- **配置**：用户通过 `contextPruning.enabled: true` 开启，默认关闭

## Non-goals

- 不实现 Opencode-DCP 的 deduplication 策略（自动去重）——后续 change
- 不实现 purgeErrors 策略（错误工具调用自动清理）——后续 change
- 不实现 turnProtection（回合保护）——后续 change
- 不实现 per-model manualMode（按模型调整压缩策略）——后续 change
- 不替换 Pi SDK 内置 compaction——DCP 优先，compaction 兜底，两者共存
- 不修改 TUI 渲染层——压缩状态通过现有事件系统传递
