## Context

当前团队系统基于 `WorkerSessionPool`（`src/teams/manager.ts`）+ `TeamStorage`（`src/teams/storage.ts`）构建，使用内存 Map + JSON 文件管理 member/task/message 状态。该架构有以下局限：

1. **无记忆**：member 完成任务后上下文丢失，每次 spawn 都是"白板"启动
2. **状态与代码耦合**：member/task/message 状态分散在 `Map<MemberId, TeamMember>` + `Map<string, TeamTask>` + JSON 文件中，难以审计
3. **上下文注入粗糙**：仅靠 `appendSystemPromptFor()` 返回的 system prompt 段落 + `steer()/prompt()` 注入原始 summary，无法按需加载细粒度信息

参考实现：Claude Code CLI 的三层记忆系统（`~/code/claude-code-cli/memdir/`）验证了"文档即状态"的可行性。

## Goals / Non-Goals

**Goals:**
- 用 Markdown 文件替代 JSON 持久化，使团队状态可直接阅读和调试
- 实现 member 级别的记忆积累，跨任务保留经验
- 实现分层上下文注入，按需加载信息而非全量灌入
- 实现框架自动记忆管理，compaction 时自动写入记忆并重新注入

**Non-Goals:**
- 跨进程/跨机器团队协作
- member 间直接通信（mailbox/inbox）
- git worktree 隔离
- 记忆版本控制或语义搜索
- 旧数据迁移

## Decisions

### D1: 文档即状态（Document-as-State）

**选择**：Markdown 文件是团队状态的唯一真相来源，替代 JSON 持久化。

**理由**：
- Markdown 可直接阅读和编辑（调试时 `cat TEAM.md` 即可）
- 与 git 友好（diff 可读、可 revert）
- Claude Code CLI 已验证此模式可行

**替代方案**：
- SQLite：查询能力强但不可读、与 git 不友好 → 否决
- JSON 文件：结构化但不可读 → 当前方案，被替换

**目录结构**：
```
.openagent/team/
├── TEAM.md              # 团队索引（leader 维护）
├── members/
│   ├── lysosome.md      # 成员索引（≤200 行，始终加载）
│   ├── ribosome.md
│   └── nucleus.md
│   └── <name>/
│       ├── preferences.md   # user 记忆（私有）
│       ├── feedback.md      # feedback 记忆（私有）
│       ├── project-*.md     # project 记忆（团队共享）
│       └── reference-*.md   # reference 记忆（团队共享）
└── shared/
    ├── conventions.md       # 团队共享 project 记忆
    └── architecture.md      # 团队共享 reference 记忆
```

### D2: Member ≈ Agent Session

**选择**：Member 就是一个 Agent Session，生命周期与 main agent 相同，区别仅为工具集 + 可见性。

**理由**：
- 避免为 member 发明新概念——Pi SDK 的 Agent Session 已提供完整生命周期
- member 可复用所有现有 session 能力（compaction、tool execution、abort 等）
- 工具集差异通过 `appendSystemPrompt` + `tools` + `disallowedTools` 控制

**替代方案**：
- 独立进程 per member：隔离性强但通信复杂 → 否决
- 简化 worker（无 compaction）：实现简单但无记忆 → 当前方案，被替换

### D3: 索引 + Topic 文件

**选择**：member .md 是始终加载的索引文件（≤200 行），详细记忆存放在独立 topic .md 文件中。

**理由**：
- 索引文件保证 member 在每次对话开始时都能看到自己的核心信息
- Topic 文件按需加载（通过 `member-read` 工具），避免上下文浪费
- 索引超 200 行时自动压缩（保留最新、移除过期），保证始终可加载

**YAML frontmatter 格式**（topic 文件）：
```yaml
---
type: user | feedback | project | reference
created: 2025-07-05T10:30:00Z
updated: 2025-07-05T15:45:00Z
tokens: ~500
---
```

### D4: 四类记忆类型

**选择**：参考 Claude Code 的四类分类。

| 类型 | 可见性 | 写入者 | 示例 |
|------|--------|--------|------|
| user | 私有 | member 自己 | "我喜欢简洁代码"、"避免 any" |
| feedback | 私有 | leader/其他 member | "你的 PR 缺少测试"、"日志太多" |
| project | 团队共享 | 任意 member | "项目用 tab 缩进"、"biome 配置" |
| reference | 团队共享 | 任意 member | "API 文档链接"、"架构图路径" |

**理由**：
- 私有/共享分离避免 member 间信息污染
- feedback 类型让 leader 可以给 member 写反馈，member 下次任务时能看到
- project/reference 共享让团队知识自然积累

### D5: 分层上下文注入

**选择**：6 层注入管道，每层有明确的加载时机和容量控制。

```
┌─────────────────────────────────────────────────────┐
│ Layer 1: Identity                                    │
│   时机: session 创建时（appendSystemPrompt）          │
│   内容: agent 定义的 systemPrompt + 角色说明          │
│   容量: 无限制（system prompt 的一部分）               │
├─────────────────────────────────────────────────────┤
│ Layer 2: Memory Index                                │
│   时机: session 创建时 + compaction 后重新注入         │
│   内容: member .md 索引文件全文（≤200 行）             │
│   容量: ≤200 行 / ~25KB                              │
├─────────────────────────────────────────────────────┤
│ Layer 3: TEAM.md Summary                             │
│   时机: session 创建时 + TEAM.md 变更时 steer         │
│   内容: TEAM.md 的 Members 表 + Active Tasks 段       │
│   容量: ~50 行                                       │
├─────────────────────────────────────────────────────┤
│ Layer 4: Tasks                                       │
│   时机: 每轮对话（steer/prompt）                      │
│   内容: 当前分配给 member 的 task 描述 + 上下文        │
│   容量: 单个 task ~500 tokens                        │
├─────────────────────────────────────────────────────┤
│ Layer 5: Topic Files                                 │
│   时机: 按需（member-read 工具）                      │
│   内容: topic .md 文件全文                            │
│   容量: 单文件 ~2000 tokens                          │
├─────────────────────────────────────────────────────┤
│ Layer 6: Nearby AGENTS.md                            │
│   时机: 文件读取时自动附加                             │
│   内容: 文件路径祖先目录中的 AGENTS.md                 │
│   容量: 继承现有 loadSystemContext 逻辑               │
└─────────────────────────────────────────────────────┘
```

**数据流**：
```
                    创建 Member Session
                          │
                    ┌─────▼─────┐
                    │ L1:Identity│ ← appendSystemPrompt
                    └─────┬─────┘
                    ┌─────▼─────┐
                    │L2:MemIndex │ ← appendSystemPrompt
                    └─────┬─────┘
                    ┌─────▼─────┐
                    │L3:TEAM.md │ ← appendSystemPrompt
                    └─────┬─────┘
                          │
               ┌──────────▼──────────┐
               │  Member 运行中...    │
               │  L4:Tasks → steer() │
               │  L5:Topics → 工具    │
               │  L6:Nearby → 自动   │
               └──────────┬──────────┘
                          │
               ┌──────────▼──────────┐
               │  compaction_end 事件 │
               │  → 写入记忆到 .md    │
               │  → 重新注入 L2+L3   │
               └─────────────────────┘
```

### D6: 框架自动记忆管理

**选择**：compaction 触发后台写入 member .md + topic 文件。

**流程**：
1. Pi SDK 触发 `compaction_end` 事件
2. TeamManager 收到事件，提取 compaction summary
3. 后台任务：解析 summary，分类写入 topic 文件（user/feedback/project/reference）
4. 更新 member .md 索引（添加新的 topic 行，移除过期行）
5. 如果索引 > 200 行：自动压缩（保留最新 150 行 + 重写 summary）
6. 重新注入 L2（Memory Index）到 member session 的 system prompt

**理由**：
- compaction 是自然的记忆写入时机——此时 LLM 已整理好结构化 summary
- 后台写入不阻塞 member 的下一轮对话
- 自动压缩保证索引始终可加载

### D7: 新工具集

**选择**：6 个工具替代现有单一 `team` 工具。

| 工具 | 用途 | 可用者 |
|------|------|--------|
| `team-read` | 读取 TEAM.md | leader, member |
| `team-edit` | 编辑 TEAM.md | leader only |
| `member-read` | 读取 member .md + topic 文件 | leader, member（自己） |
| `member-edit` | 编辑 member .md（仅索引） | leader only |
| `self-edit` | member 编辑自己的 .md 索引 | member only |
| `memory-write` | 写入 topic 记忆文件 | leader, member（自己） |

**理由**：
- 细粒度工具让 LLM 更精确地表达意图（vs `team` 工具的 action 参数路由）
- 权限控制通过工具可用性实现（leader 有 `team-edit`，member 没有）
- `self-edit` 让 member 能主动更新自己的索引，增强自主性

**替代方案**：
- 保持单一 `team` 工具 + action 参数：实现简单但 LLM 经常选错 action → 否决
- REST API 风格（team/members/tasks）：与 Pi SDK 工具系统不匹配 → 否决

### D8: TEAM.md 格式

**选择**：TEAM.md 由 leader 维护，包含团队全局信息。

```markdown
# Team: <name>

## Mission
<当前任务/目标>

## Members
| Name | Role | Status | Current Task |
|------|------|--------|--------------|
| lysosome | reviewer | active | review src/auth |
| ribosome | implementer | idle | — |

## Active Tasks
- [ ] T1: review src/auth → @lysosome
- [x] T2: fix login bug → @ribosome

## Important Notes
<leader 认为所有 member 都应知道的信息>

## Shared Memory Index
- `shared/conventions.md` — 项目编码规范
- `shared/architecture.md` — 系统架构文档
```

**理由**：
- 表格格式让 leader 一目了然地看到 member 状态
- Markdown checkbox 让 task 状态可读
- Shared Memory Index 让 member 知道有哪些共享资源

### D9: Member .md 索引格式

```markdown
# <name> — <role>

## Profile
- Role: <role>
- Goal: <goal>
- Model: <model-name>

## Active Context
<当前任务的关键上下文，每次 compaction 后更新>

## Memory Index
- `preferences.md` [user] — 我的偏好和习惯
- `feedback.md` [feedback] — 收到的反馈
- `project-style.md` [project] — 项目代码风格
- `reference-api.md` [reference] — API 文档参考

## Recent Activity
- 2025-07-05: 完成了 src/auth 的 review
- 2025-07-05: 发现 SQL 注入问题，已报告
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| 索引文件频繁重写导致信息丢失 | 每次写入前保留前版本到 `.bak`，索引压缩时保留关键信息 |
| compaction 触发的记忆写入可能不准确 | 记忆写入后让 member 在下一轮确认，不准确时可 `self-edit` 修正 |
| 6 个工具增加 LLM 选择负担 | 工具描述中明确使用场景 + 示例，减少误选 |
| 文件 I/O 在高频操作时可能成为瓶颈 | 索引文件小（≤200 行），topic 文件按需加载，I/O 量可控 |
| leader 自动提示循环（leader→assign→member done→auto-prompt→assign→...） | leader 的 system prompt 明确指导"只在有新任务时分配"，防无限循环 |
| compaction 后重新注入 L2+L3 可能导致上下文膨胀 | 索引限制 200 行 + TEAM.md summary 限制 50 行，总增量 < 5KB |
| 两个 member 同时写 shared/ 文件 | 写入加文件锁（`proper-lockfile` 已在依赖中） |
| 进程崩溃 mid-write 导致文件半写 | Atomic write：写入临时文件 + `rename()`，保证原子性 |
| member .md 被删或损坏 | 读取失败时从 session 重建空索引，日志告警 |
| member 通过 read/write/edit 工具直接操作 `.openagent/team/` | member session 的 `disallowedTools` 包含 `write`、`edit`（已有约束），read 工具内屏蔽 `.openagent/` 路径 |
| topic 参数路径穿越（`../../../etc/passwd`） | topic 参数校验：只允许 `[a-z0-9-]+` 格式，拒绝 `..`、`/`、绝对路径 |
| LLM 在 compaction 中产生垃圾记忆 | 后台写入校验 frontmatter 完整性，无效则丢弃；member 可 `self-edit` 修正 |

## D10: 安全与健壮性约束

### 文件写入原子性

所有通过 TeamFiles 的写入操作 SHALL 使用 atomic write 模式：
1. 写入到同目录下的临时文件（`<name>.tmp.<random>`）
2. 调用 `fs.rename(tmp, target)` 原子替换

### 共享文件并发保护

`shared/` 目录下的文件写入 SHALL 使用 `proper-lockfile`（已在项目依赖中）加文件锁：
```typescript
import lockfile from "proper-lockfile";
const release = await lockfile.lock(sharedPath, { retries: 3 });
try { await atomicWrite(sharedPath, content); } finally { await release(); }
```

### 路径校验

所有接受 topic/member name 参数的工具 SHALL 校验：
- `name`：匹配 `/^[a-z0-9-]+$/`，长度 ≤ 64
- `topic`：匹配 `/^[a-z0-9-]+$/`，长度 ≤ 64
- 拒绝任何包含 `..`、`/`、`\`、绝对路径的输入

### 工具权限边界

- Leader session：可使用全部 6 个 team 工具 + 所有内置工具
- Member session：`disallowedTools` 包含 `write`、`edit`（继承现有约束），仅可使用 `team-read`、`member-read`（自己）、`self-edit`、`memory-write`（自己）
- Member 的 `read` 工具 SHALL 屏蔽 `.openagent/team/` 路径（避免绕过 `member-read` 直接读取其他 member 的私有记忆）

### 损坏恢复

- member .md 读取失败（文件不存在或格式损坏）→ 重建空索引文件，日志 `[team] rebuilt empty index for <name>`
- TEAM.md 读取失败 → 重建空 TEAM.md，日志 `[team] rebuilt empty TEAM.md`
- topic 文件 frontmatter 缺失或无效 → 视为 `type: user`，日志 `[team] defaulting broken frontmatter in <topic>`

## Open Questions

1. **topic 文件命名规范**：是否需要强制 `<type>-<name>.md` 格式，还是允许自由命名 + frontmatter 分类？→ 倾向后者（自由命名 + frontmatter），更灵活
2. **member 离场后文件处理**：member 被移除后其 .md 和 topic 文件是否保留？→ 倾向保留（归档到 `members/_archived/`），历史经验有价值
3. **compaction summary 结构化提取**：是否需要定义固定的 summary 模板（如 Claude Code 的 Title/Current State/Task Spec/...），还是让 LLM 自由组织？→ 倾向定义轻量模板（Goal/Progress/Learnings/Next Steps），与 OpenCode compaction 对齐
