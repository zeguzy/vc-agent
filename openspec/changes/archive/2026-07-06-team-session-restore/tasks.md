## 1. MemberState 与 TEAM.md 扩展

- [ ] 1.1 `MemberState` 类型新增可选 `sessionId?: string` 字段，记录成员的 session ID（JSONL 文件名 stem，不含目录前缀）
- [ ] 1.2 `TeamMdStructure.members` 数组元素新增可选 `sessionId?: string` 字段
- [ ] 1.3 `parseMembersTable()` 解析 members 表时读取第 5 列 `Session`（可选，`cells[4] ?? ""`，缺失时为空字符串）
- [ ] 1.4 `serializeTeamMd()` 序列化 members 表时写入 5 列格式（Name | Role | Status | Current Task | Session）
- [ ] 1.5 `createMember` 中创建 AgentSession 后从 `session.sessionFile` 提取 session ID（basename - .jsonl），写入 `MemberState.sessionId`，并在更新 TEAM.md 时包含 session ID

## 2. Session ID 路径解析与验证

- [ ] 2.1 新增 `resolveMemberSessionPath(sessionId: string): string` 工具函数：`join(sessionDirRoot(), sessionId + ".jsonl")`
- [ ] 2.2 新增 `validateSessionId(sessionId: string): boolean` 工具函数：验证文件名匹合法 pattern（`^\d{4}-\d{2}-\d{2}T` 或 UUID 格式）、扩展名 `.jsonl`
- [ ] 2.3 新增 `validateMemberSessionPath(resolvedPath: string): boolean` 工具函数：验证 resolvedPath 在 `sessionDirRoot()` 下（`startsWith` 检查）

## 3. createMember 改用持久化 SessionManager

- [ ] 3.1 修改 `TeamManager.createMember()`：为 `createAgentSession` 传入 `SessionManager.create(cwd, sessionDir)`，其中 `sessionDir` 为标准 `resolveSessionDir()`（与 leader 相同）
- [ ] 3.2 验证新建成员的 session 文件在 `~/.config/openagent/sessions/` 下正确创建
- [ ] 3.3 验证 `session.sessionFile` 在创建后可获取到路径，且从中提取的 sessionId 可写入 TEAM.md

## 4. restoreMembers 实现

- [ ] 4.1 在 `TeamManager` 新增 `async restoreMembers(opts: { services, parentModel })` 方法
- [ ] 4.2 `restoreMembers` 内：设置 `isRestoring=true`，在 `finally` 块中重置为 `false`
- [ ] 4.3 `restoreMembers` 内：读取 `files.readTeamMd()` → 遍历 members 表 → 对每个成员调用 `files.readMemberIndex(name)` 获取 profile
- [ ] 4.4 `restoreMembers` 内：为每个成员构建 L1+L2+L3 system prompt（复用 `buildMemberSystemPrompt`）
- [ ] 4.5 `restoreMembers` 内：解析 session ID → `resolveMemberSessionPath(sessionId)` → `validateSessionId` + `validateMemberSessionPath`
- [ ] 4.6 `restoreMembers` 内：验证通过 → `SessionManager.open(resolvedPath, sessionDir)` 恢复；验证失败 / 无 Session 列 / open 失败 → fallback 到 `SessionManager.create(cwd, sessionDir)`
- [ ] 4.7 `restoreMembers` 内：用恢复的 SessionManager 调用 `createAgentSession` 创建 AgentSession，填充 members Map + 订阅事件
- [ ] 4.8 `restoreMembers` 内：从 `activeTasks` 反向推导 `currentTaskId`（如有匹配的未完成 task 且 memberName 匹配），否则设为 null
- [ ] 4.9 `restoreMembers` 内：将所有恢复成员的 status 重置为 idle，更新 TEAM.md
- [ ] 4.10 `restoreMembers` 内：单个成员恢复失败时 try-catch + log 警告，不阻塞其他成员
- [ ] 4.11 `restoreMembers` 内：emit `members_restored` 事件

## 5. setRebindSession 回调集成

- [ ] 5.1 修改 `server/index.ts` 的 `setRebindSession` 回调：在 `cancelOrphansOnSessionChange=true` 分支创建新 TeamManager 后调用 `await this.teamManager.restoreMembers()`
- [ ] 5.2 验证 session 切换后 `listMembers()` 返回正确成员列表

## 6. 验证与测试

- [ ] 6.1 手动验证：创建 team → 添加成员 → 切换 session → 成员列表在 UI 显示
- [ ] 6.2 手动验证：成员恢复后对话上下文可用（可继续对话）
- [ ] 6.3 运行 `bun run check` 确保 typecheck + lint + test 全通过
