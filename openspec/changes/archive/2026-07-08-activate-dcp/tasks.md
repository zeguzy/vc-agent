# Tasks: activate-dcp

## G1. 基础类型模块（4 项）

- [x] 1.1 创建 `src/dcp/core/logger.ts`：实现 `dcpDiag`（诊断日志函数）和 `Logger` 类型。参考 openagent 现有日志风格（console.warn + 可选 LOG_DIR 写入）。dcpDiag 接受 string 或 () => string（惰性求值）。
- [x] 1.2 创建 `src/dcp/core/token-utils.ts`：实现 `countTokens(messages)`。从最近 assistant 消息读取 token metadata（input+output+reasoning+cacheRead+cacheWrite）。含 provider 差异修复：cacheRead > input && input > 0 时返回 cacheRead。无 metadata 时返回 0。
- [x] 1.3 创建 `src/dcp/core/message-ids.ts`：实现 `assignMessageRefs(messages)`。按 array index 生成稳定 ID（m0001/m0002 格式），赋值到消息的 `_dcpId` 字段。
- [x] 1.4 扩展 `src/dcp/core/state-types.ts`：补充 DcpState 接口（compressionBlocks: Map、stats: { totalCompressions, tokensSaved }、anchors: Set、lastUserMessageIndex、lastCompressTurn）。

## G2. 消息处理（3 项）

- [x] 2.1 创建 `src/dcp/adapter.ts`：实现 `toDcpMessages(messages: AgentMessage[]): WithParts[]` 和 `fromDcpMessages(messages): AgentMessage[]`。Pi SDK AgentMessage ↔ DCP WithParts 桥接。处理 text/tool_call/tool_result 消息类型映射。
- [x] 2.2 创建 `src/dcp/core/messages/shape.ts`：实现 `filterMessagesInPlace(messages)`。过滤无效消息（空内容、重复 tool_call），返回过滤后数组。保护 protectedTools 消息不被过滤。
- [x] 2.3 创建 `src/dcp/core/messages/utils.ts`：实现 `buildToolIdList(messages)`。遍历消息收集所有 tool_call ID 列表，用于 compress 时校验引用完整性。+ 创建 `src/dcp/core/messages/query.ts`：实现 `findMessageById(messages, id)` 和 `getMessageRange(messages, startId, endId)` 查询辅助。

## G3. 压缩核心（3 项）

- [x] 3.1 创建 `src/dcp/core/compress/types.ts`：定义 `CompressRange`、`CompressMessage`、`CompressionBlock`、`ResolvedRange`、`SnapshotResult` 等类型。
- [x] 3.2 创建 `src/dcp/core/compress/range-utils.ts`：实现 `resolveRanges(messages, ranges)`。校验 range 合法性（ID 存在、start ≤ end），返回 ResolvedRange 数组。
- [x] 3.3 创建 `src/dcp/core/compress/message-utils.ts`：实现 `resolveMessages(messages, targets)` 和 `extractSummary(message, maxLen=180)`。校验 messageId 存在，提取摘要。

## G4. 状态管理（2 项）

- [x] 4.1 创建 `src/dcp/core/state/index.ts`：实现 `allocateBlockId(state)`、`allocateRunId(state)`、`applyCompressionState(state, block)`、`wrapCompressedSummary(messages, block, summary)`。管理 compression blocks 分配和应用。
- [x] 4.2 创建 `src/dcp/core/state/persistence.ts`：实现 `saveSessionState(state)`。将 compression blocks 和 stats 持久化。使用模块级 holder 的 getDcpState/setDcpState。

## G5. Nudge 系统（3 项）

- [x] 5.1 创建 `src/dcp/core/prompts/index.ts`：实现 `createBundledRuntimePrompts()`。返回 DCP 提示词对象，含 promptSnippet（compress 工具说明）和 promptGuidelines（压缩时机指导）。含三层 nudge 提示词模板（soft/strong/iteration）。
- [x] 5.2 创建 `src/dcp/core/messages/inject/inject.ts`：实现 nudge 注入主逻辑 `injectNudges(messages, context)`。调用 isContextOverLimits + addAnchor，决定注入哪层 nudge。含冷却逻辑（compress 后清锚点）。
- [x] 5.3 创建 `src/dcp/core/messages/inject/utils.ts`：实现 `isContextOverLimits(config)`、`addAnchor(state, type, interval)`、`clearAnchors(state)`。token 阈值判断 + nudgeFrequency 节流 + 压缩后冷却。+ 创建 `src/dcp/transform-wrap.ts`：实现 `wrapTransformContext(agent, config)`。包装 agent.transformContext，每次调用时跑 injectNudges 逻辑。含防御性 try/catch 降级。

## G6. 接线 session.ts（3 项）

- [x] 6.1 创建 `src/dcp/init.ts`：实现 `initDcpExtension(session, config)` 公共函数。初始化 holder（setDcpConfig/setDcpState/setDirectCompressFn/setCompressNotifier）、调 wrapTransformContext、返回 compress 工具定义。供 createRuntime/createSession 共用。
- [x] 6.2 修改 `src/agent/session.ts` createRuntime factory：isDcpEnabled 检查 → initDcpExtension → customTools.push(compressTool) → tools 白名单加 "compress"。同步修改 createSession。
- [x] 6.3 修改 `src/agent/session.ts` handleSetAgentMode：重建 tools 白名单时，isDcpEnabled 检查 → 保留 "compress"。

## G7. 验证收尾（2 项）

- [x] 7.1 运行 `bun run check`（typecheck + lint + test），修复所有错误。新增 unit test：token-utils（provider 差异修复）、inject（三层 nudge 逻辑）、adapter（消息映射）。
- [x] 7.2 手动烟测：`bun run dev` 启动 TUI，config 设 `contextPruning.enabled: true`，发几条消息触发 nudge，调用 compress 工具验证压缩效果。
