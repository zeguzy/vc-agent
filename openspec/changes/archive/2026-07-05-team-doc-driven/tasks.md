## 1. 类型与接口定义

- [ ] 1.1 创建 `src/teams/types-v2.ts`：定义 TeamManagerLike 接口、MemberState、TaskState、MemoryType（user/feedback/project/reference）、TopicFileMeta、TeamDirectoryPaths 等核心类型
- [ ] 1.2 创建 `src/teams/memory-types.ts`：定义 MemoryType enum、TopicFileFrontmatter 接口、parseFrontmatter/serializeFrontmatter 工具函数、估算 token 数的 estimateTokens 函数

## 2. 文件系统层（.openagent/team/ 读写）

- [ ] 1.3 创建 `src/teams/files.ts`：TeamFiles 类——封装 `.openagent/team/` 目录的文件读写操作，包含 initTeamDir()、readTeamMd()/writeTeamMd()、readMemberIndex()/writeMemberIndex()、readTopicFile()/writeTopicFile()、listTopicFiles()、archiveMember() 方法
- [ ] 1.4 在 TeamFiles 中实现 TEAM.md 的结构化读写：parseTeamMd() 解析 Mission/Members/Active Tasks/Important Notes/Shared Memory Index 各段落，serializeTeamMd() 反序列化
- [ ] 1.5 在 TeamFiles 中实现 member .md 索引的结构化读写：parseMemberIndex() 解析 Profile/Active Context/Memory Index/Recent Activity 各段落，serializeMemberIndex() 反序列化
- [ ] 1.6 在 TeamFiles 中实现 topic 文件读写：读写含 YAML frontmatter 的 .md 文件，frontmatter 包含 type/created/updated/tokens 四字段

## 3. 索引压缩

- [ ] 2.1 创建 `src/teams/compress.ts`：compressMemberIndex() 函数——当索引 > 200 行时，保留 Profile + Memory Index + Recent Activity（最近 20 条），Active Context 压缩为最近 compaction summary 前 500 字符

## 4. TeamManager 核心实现

- [ ] 3.1 创建 `src/teams/manager-v2.ts`：TeamManager 类实现 TeamManagerLike 接口，构造函数接收 ResolvedTeamConfig + SubagentServices + cwd，初始化 TeamFiles + 创建/读取 TEAM.md
- [ ] 3.2 实现 TeamManager.createMember()：通过 createAgentSession() 创建 member session，注入 L1+L2+L3（appendSystemPrompt），创建 member .md 索引 + 目录，更新 TEAM.md Members 表
- [ ] 3.3 实现 TeamManager.removeMember()：dispose member session，archive 目录到 _archived/，更新 TEAM.md
- [ ] 3.4 实现 TeamManager.assignTask()：steer/prompt 注入 L4（Tasks），更新 TEAM.md Active Tasks + member .md Active Context
- [ ] 3.5 实现 TeamManager 事件订阅：订阅所有 member session 事件，agent_end 时更新 TEAM.md + 通知 leader，compaction_end 时触发记忆写入流程
- [ ] 3.6 实现 TeamManager.dispose()：dispose 所有 member session，保留 .openagent/team/ 目录

## 5. 分层上下文注入

- [ ] 4.1 修改 `src/agent/session.ts`：扩展 appendSystemPromptFor() 支持 member 模式——返回 L1(Identity) + L2(Memory Index) + L3(TEAM.md Summary) 的拼接数组
- [ ] 4.2 创建 `src/teams/context.ts`：buildMemberSystemPrompt() 函数——读取 member .md 索引 + TEAM.md summary，拼接为 L2+L3 文本块；buildTaskPrompt() 函数——构造 L4 任务注入文本
- [ ] 4.3 修改 `src/server/index.ts`：member agent_end 事件处理改为注入 L2+L3 重新注入（而非原始 summary）；TEAM.md 变更时通知所有 active member

## 6. 自动记忆管理

- [ ] 5.1 创建 `src/teams/auto-memory.ts`：handleCompactionEnd() 函数——解析 compaction summary，按类型提取记忆，写入 topic 文件，更新 member .md 索引，触发索引压缩
- [ ] 5.2 实现 compaction summary 解析：从 summary 中提取 Goal/Progress/Learnings/Next Steps 段落，将 Learnings 按 user/feedback/project/reference 分类
- [ ] 5.3 实现 compaction 后重新注入：compaction_end 后通过 steer() 注入 `[Memory Index Re-injected]` + `[TEAM Summary Re-injected]`

## 7. 新工具集实现

- [ ] 6.1 创建 `src/tools/team-read.ts`：team-read 工具——读取 TEAM.md 全文，member 调用时过滤私有信息
- [ ] 6.2 创建 `src/tools/team-edit.ts`：team-edit 工具——编辑 TEAM.md 指定段落（mission/members/active-tasks/important-notes），仅 leader 可用
- [ ] 6.3 创建 `src/tools/member-read.ts`：member-read 工具——读取 member .md 索引 + topic 文件，member 只能读自己
- [ ] 6.4 创建 `src/tools/member-edit.ts`：member-edit 工具——leader 编辑 member .md 索引
- [ ] 6.5 创建 `src/tools/self-edit.ts`：self-edit 工具——member 编辑自己的 .md 索引
- [ ] 6.6 创建 `src/tools/memory-write.ts`：memory-write 工具——写入 topic 记忆文件（含 YAML frontmatter），更新 member .md Memory Index

## 8. 工具注册与集成

- [ ] 7.1 修改 `src/agent/session.ts`：在 initServices() 中注册 6 个新工具替代旧 team 工具；leader 模式注册 team-read + team-edit + member-read + member-edit + memory-write，member 模式注册 team-read + member-read + self-edit + memory-write
- [ ] 7.2 修改 `src/agent/session.ts`：activeToolsFor() 更新——team 模式 active tools 包含新工具集而非旧 team 工具
- [ ] 7.3 修改 `src/context-files.ts`：更新 TEAM_ORCHESTRATOR_PROMPT 内容，指导 leader 使用新工具集管理团队

## 9. AgentServer 适配

- [ ] 8.1 修改 `src/server/index.ts`：将 WorkerSessionPool 替换为 TeamManager，poolRef 类型改为 TeamManagerLike
- [ ] 8.2 修改 `src/server/index.ts`：handleSpawnWorker/handleCancelWorker 等方法适配 TeamManager 接口
- [ ] 8.3 修改 `src/server/index.ts`：ensureSubscribed() 适配 TeamManager 事件订阅，member 事件（agent_end/compaction_end）走新的处理逻辑
- [ ] 8.4 修改 `src/server/index.ts`：handleSetAgentMode() 中 team/orchestrator 模式的 steer 内容适配新架构

## 10. Client 接口适配

- [ ] 9.1 修改 `src/client/types.ts`：AgentClient 接口更新——listWorkers → listMembers，spawnWorker → createMember，cancelWorker → removeMember 等
- [ ] 9.2 修改 `src/client/in-process.ts`：InProcessClient 适配新 AgentClient 接口
- [ ] 9.3 修改 `src/client/http.ts`：HttpClient 适配新 AgentClient 接口 + HTTP API 路径变更

## 11. TUI 适配

- [ ] 10.1 修改 `src/tui/components/WorkersView.tsx` → MembersView：适配 member 概念（name 替代 workerId，role 替代 agent）
- [ ] 10.2 修改 `src/tui/commands.ts`：/team 和 /workers 命令适配新接口
- [ ] 10.3 修改 `src/tui/hooks/useSessionEvents.ts`：team 事件类型适配

## 12. 旧代码清理

- [ ] 11.1 删除 `src/teams/storage.ts`（TeamStorage 类）
- [ ] 11.2 删除 `src/teams/manager.ts`（WorkerSessionPool 类）
- [ ] 11.3 删除 `src/tools/team.ts`（旧 team 工具）
- [ ] 11.4 清理 `src/teams/types.ts` 中不再使用的 V1 类型（WorkerId、WorkerStatus、WorkerSnapshot、WorkerEventEnvelope、WorkerSessionPoolLike 等）

## 13. 测试

- [ ] 12.1 创建 `tests/team-files.test.ts`：TeamFiles 的单元测试——目录初始化、TEAM.md 读写、member 索引读写、topic 文件读写、frontmatter 解析
- [ ] 12.2 创建 `tests/team-memory-types.test.ts`：MemoryType 分类、frontmatter 序列化/反序列化、token 估算
- [ ] 12.3 创建 `tests/team-compress.test.ts`：索引压缩逻辑——超限压缩、保留段落验证
- [ ] 12.4 创建 `tests/team-manager-v2.test.ts`：TeamManager 集成测试——创建/移除 member、分配任务、事件处理、dispose
- [ ] 12.5 创建 `tests/team-context.test.ts`：分层上下文注入测试——L1+L2+L3 构建、L4 任务注入、L5 topic 读取
- [ ] 12.6 创建 `tests/team-auto-memory.test.ts`：自动记忆管理测试——compaction 触发写入、记忆分类、索引压缩触发
- [ ] 12.7 创建 `tests/team-tools-v2.test.ts`：6 个新工具的测试——参数验证、权限控制、文件读写

## 14. 最终验证

- [ ] 13.1 运行 `bun run check` 确保 typecheck + lint + test 全通过
- [ ] 13.2 手动验证 TUI 中 /team 和 /members 命令可用
