# dcp-context-pruning Specification

## Purpose
TBD - created by archiving change activate-dcp. Update Purpose after archive.
## Requirements
### Requirement: DCP opt-in 启用

The DCP system MUST be disabled by default. The user SHALL enable it via `contextPruning.enabled: true`. When disabled, transformContext MUST pass through all messages unchanged and the compress tool MUST NOT appear in the tools whitelist.

#### Scenario: DCP 关闭时无副作用

WHEN contextPruning.enabled 为 false
THEN transformContext wrap 透传所有消息，不注入任何 nudge
AND compress 工具不出现在 customTools 或 tools 白名单中

#### Scenario: DCP 开启后激活

WHEN contextPruning.enabled 为 true
THEN initDcpExtension 初始化 holder（config/state/runtime）
AND compress 工具加入 customTools + tools 白名单
AND transformContext wrap 注入 nudge 逻辑

---

### Requirement: compress 工具 — range 模式

The compress tool MUST support range mode: the model specifies startId and endId to compress a contiguous range of messages into a single summary block.

#### Scenario: range 模式正常压缩

WHEN 模型调用 compress 工具，mode 为 range，提供 topic + content[{startId,endId,summary}]
THEN 系统校验 range 合法性（ID 存在、start ≤ end）
AND 为该 range 分配 compression block ID
AND 用 wrapCompressedSummary 包裹原始消息
AND applyCompressionState 更新状态
AND persistAndNotify 持久化 + 通知

#### Scenario: range 模式 ID 不存在

WHEN compress 工具收到不存在的 message ID
THEN 返回错误信息，不修改任何消息

---

### Requirement: compress 工具 — message 模式

The compress tool MUST support message mode: the model specifies messageId to compress individual messages.

#### Scenario: message 模式正常压缩

WHEN 模型调用 compress 工具，mode 为 message，提供 topic + content[{messageId,topic,summary}]
THEN 系统校验 messageId 存在
AND 为该消息分配 compression block ID
AND wrapCompressedSummary 包裹
AND applyCompressionState + persistAndNotify

---

### Requirement: 三层 Nudge 自动触发

The system SHALL inject compression nudges automatically based on token usage and conversation progress to guide the model to call the compress tool.

#### Scenario: 低于 minContextLimit 静默

WHEN currentTokens < minContextLimit
THEN 不注入任何 nudge，模型无感知

#### Scenario: turn 边界 soft nudge

WHEN currentTokens ≥ minContextLimit
AND 检测到 turn 边界（用户消息后第一个 assistant 响应完成）
AND 距上次 nudge ≥ nudgeFrequency 次 LLM 调用
THEN 注入 soft nudge（建议考虑压缩已完成的任务段落）

#### Scenario: iteration 超阈值 soft nudge

WHEN 距上次用户消息的 assistant 消息数 ≥ iterationNudgeThreshold (默认 15)
THEN 注入 iteration nudge（长迭代提示）

#### Scenario: 超过 maxContextLimit strong nudge

WHEN currentTokens > maxContextLimit
THEN 注入 strong nudge（MUST compress now）
AND 最近 3 条消息含 compress 调用时抑制（防循环）

---

### Requirement: Token 监控（含 provider 差异修复）

The system MUST read token usage from the most recent assistant message and SHALL fix provider-specific token counting discrepancies.

#### Scenario: 正常 token 计数

WHEN 最近 assistant 消息含 token metadata
THEN currentTokens = input + output + reasoning + cacheRead + cacheWrite

#### Scenario: provider 差异修复

WHEN cacheRead > input AND input > 0
THEN currentTokens = cacheRead（避免非 Anthropic provider 双倍计数）

#### Scenario: 无 token metadata

WHEN 最近 assistant 消息无 token metadata
THEN currentTokens 估算为 0，不触发 maxContextLimit nudge（降级）

---

### Requirement: 手动触发 directCompressMessages

The system MUST provide a manual compression function (directCompressMessages) callable by user commands such as `/dcp-compress`.

#### Scenario: 手动压缩除最近 N 条外的所有消息

WHEN 调用 directCompressMessages
THEN 取除最近 N 条外的所有消息
AND 每条取前 180 字符做粗摘要
AND 建 range 压缩块
AND 返回压缩结果

---

### Requirement: 状态持久化

DCP compression state (compression blocks, stats) MUST be persisted to the session and SHALL support recovery across turns.

#### Scenario: 压缩后持久化

WHEN compress 工具执行成功
THEN saveSessionState 将 compression blocks 和 stats 保存

#### Scenario: 恢复时加载状态

WHEN DCP extension 初始化
THEN 加载已保存的 compression blocks 和 stats 到 holder

