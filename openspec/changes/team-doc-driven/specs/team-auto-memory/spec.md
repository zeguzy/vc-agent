## ADDED Requirements

### Requirement: compaction 触发记忆写入

系统 SHALL 在 member session 触发 `compaction_end` 事件时，后台启动记忆写入流程：解析 compaction summary，分类写入 topic 文件，更新 member .md 索引。

#### Scenario: compaction 后写入记忆
- **WHEN** member session 触发 `compaction_end` 事件，compaction summary 包含结构化内容
- **THEN** SHALL 后台启动记忆写入任务（不阻塞 member 下一轮对话）
- **AND** SHALL 解析 summary，提取 user/feedback/project/reference 类型的信息
- **AND** SHALL 将提取的信息写入对应的 topic 文件（已有则追加，新类型则创建）
- **AND** SHALL 更新 member .md 索引的 Memory Index 和 Recent Activity 段落

#### Scenario: compaction summary 无结构化内容
- **WHEN** member session 触发 `compaction_end` 事件，但 compaction summary 为空或无法解析
- **THEN** SHALL 仅更新 member .md 索引的 Recent Activity 段落（记录 compaction 发生）
- **AND** SHALL NOT 创建新的 topic 文件

### Requirement: 索引超限自动压缩

系统 SHALL 在 member .md 索引超过 200 行时自动压缩，保证索引始终可加载到 system prompt。

#### Scenario: 记忆写入后索引超限
- **WHEN** 记忆写入完成后 member .md 索引行数 > 200
- **THEN** SHALL 触发索引压缩：保留 Profile + Memory Index + Recent Activity（最近 20 条）
- **AND** Active Context 段落 SHALL 被压缩为最近 compaction summary 的前 500 字符
- **AND** 压缩后 SHALL ≤ 200 行

### Requirement: compaction summary 结构化模板

系统 SHALL 定义轻量 compaction summary 模板，指导 LLM 生成结构化记忆。

#### Scenario: compaction summary 模板
- **WHEN** member session 触发 compaction
- **THEN** compaction instructions SHALL 包含以下模板段落：
  - **Goal**: 当前任务目标
  - **Progress**: 已完成的工作
  - **Learnings**: 发现的模式、偏好、注意事项
  - **Next Steps**: 待完成的工作
- **AND** Learnings 段落 SHALL 是记忆写入的主要来源（按 type 分类）
