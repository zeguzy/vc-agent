## ADDED Requirements

### Requirement: 六层上下文注入管道

系统 SHALL 在 member session 创建时和运行期间按以下顺序注入上下文：

| Layer | 时机 | 内容 | 容量限制 |
|-------|------|------|----------|
| L1: Identity | session 创建时 | agent 定义的 systemPrompt + 角色说明 | 无限制 |
| L2: Memory Index | session 创建时 + compaction 后 | member .md 索引文件全文 | ≤200 行 / ~25KB |
| L3: TEAM.md Summary | session 创建时 + TEAM.md 变更时 | TEAM.md 的 Members 表 + Active Tasks | ~50 行 |
| L4: Tasks | 每轮对话（steer/prompt） | 当前分配的 task 描述 + 上下文 | ~500 tokens |
| L5: Topic Files | 按需（member-read 工具） | topic .md 文件全文 | ~2000 tokens/文件 |
| L6: Nearby AGENTS.md | 文件读取时自动附加 | 祖先目录中的 AGENTS.md | 继承现有逻辑 |

#### Scenario: 创建 member session 时注入 L1+L2+L3
- **WHEN** TeamManager 创建新的 member session
- **THEN** SHALL 通过 `appendSystemPrompt` 注入 L1（Identity）+ L2（Memory Index）+ L3（TEAM.md Summary）
- **AND** L2 内容 SHALL 为 `members/<name>.md` 的全文
- **AND** L3 内容 SHALL 为 TEAM.md 中 Members 表 + Active Tasks 段落

#### Scenario: 分配任务时注入 L4
- **WHEN** leader 通过 `team-edit` 分配任务给 member
- **THEN** SHALL 通过 `steer()` 或 `prompt()` 注入 L4（Tasks）：task 标题 + 描述 + 优先级 + 相关上下文
- **AND** member 正在 streaming 时 SHALL 用 `steer()`，idle 时 SHALL 用 `prompt()`

#### Scenario: member 读取 topic 文件时注入 L5
- **WHEN** member 调用 `member-read` 工具读取 topic 文件
- **THEN** SHALL 返回 topic .md 文件全文（含 frontmatter）
- **AND** 该内容作为工具结果注入到 member 的当前对话

#### Scenario: member 读取代码文件时注入 L6
- **WHEN** member 使用 `read` 工具读取文件
- **THEN** SHALL 自动附加该文件祖先目录中的 AGENTS.md（继承现有 `loadSystemContext` 逻辑）

### Requirement: compaction 后重新注入 L2+L3

系统 SHALL 在 member session 发生 compaction 后重新注入 L2（Memory Index）和 L3（TEAM.md Summary），因为 compaction 会丢弃之前的 system prompt 内容。

#### Scenario: compaction 后重新注入
- **WHEN** member session 触发 `compaction_end` 事件
- **THEN** SHALL 通过 `steer()` 注入 L2（更新后的 member .md 索引）+ L3（当前 TEAM.md Summary）
- **AND** 注入内容 SHALL 标记为 `[Memory Index Re-injected]` 和 `[TEAM Summary Re-injected]` 以区分

### Requirement: TEAM.md 变更时通知 member

系统 SHALL 在 TEAM.md 发生变更时，通过 `steer()` 通知所有 active member。

#### Scenario: TEAM.md 变更通知
- **WHEN** leader 通过 `team-edit` 修改 TEAM.md
- **THEN** SHALL 对每个 status=active 的 member 调用 `steer()` 注入 `[TEAM Update] <变更摘要>`
- **AND** 变更摘要 SHALL 包含 Members 表变更和 Active Tasks 变更的 diff
