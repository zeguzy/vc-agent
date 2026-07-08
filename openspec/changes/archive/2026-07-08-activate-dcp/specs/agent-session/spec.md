# agent-session

## ADDED Requirements

### Requirement: DCP extension 注入（opt-in）

The agent-session MUST check DCP configuration at creation time. When DCP is opt-in enabled, it SHALL inject the DCP extension (wrap transformContext + register compress tool).

#### Scenario: createRuntime 注入 DCP

WHEN createRuntime factory 创建 agent session
AND contextPruning.enabled 为 true
THEN initDcpExtension 初始化 holder（config/state/runtime）
AND customTools 数组加入 createCompressTool(deps)
AND tools 白名单加入 "compress"
AND createAgentSession 返回后 wrap session.agent.transformContext

#### Scenario: DCP 关闭时跳过

WHEN contextPruning.enabled 为 false
THEN 不调用 initDcpExtension
AND customTools 不含 compress
AND tools 白名单不含 compress
AND transformContext 不被 wrap

#### Scenario: createSession 同步注入

WHEN createSession（legacy 路径）创建 agent session
AND contextPruning.enabled 为 true
THEN 同 createRuntime 注入 DCP

#### Scenario: handleSetAgentMode 保留 compress

WHEN handleSetAgentMode 切换 agent mode，重建 tools 白名单
AND DCP 已启用
THEN 新白名单包含 "compress"

#### Scenario: transformContext 防御性降级

WHEN wrapped transformContext 执行时抛出异常
THEN catch 异常，透传原始消息（降级）
AND 记录日志（dcpDiag）

#### Scenario: DCP 与 compaction 共存

WHEN DCP 已启用 AND Pi SDK compaction 也启用
THEN DCP 优先工作（模型自主压缩）
AND compaction 在 token 超限时兜底
AND 两者不互相干扰
