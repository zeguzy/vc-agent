---
name: harness
description: OpenSpec 驱动的开发流水线。当用户提出非平凡的开发需求时自动进入，七步推进（探索→提案→审核→实施→归档→验收→合并清理）。用户只在提案和验收环节介入，其余自动流转。
license: MIT
metadata:
  author: openagent
  version: "1.1"
---

# Harness：OpenSpec 驱动开发流水线

以 OpenSpec 为核心的端到端开发流程。七步推进，用户只在**提案**和**验收**环节介入。

---

## 流水线概览

```
 用户需求
     │
     ▼
┌─────────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ 1.探索      │──▶│ 2.提案  │──▶│ 3.审核  │──▶│ 4.实施  │──▶│ 5.归档  │──▶│ 6.验收  │
│ 自动        │   │ ★用户   │   │ 自动    │   │ 自动    │   │ 自动    │   │ ★用户   │
│ +并行建环境 │   └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘
└─────────────┘                                                        │
                                                                        ▼
                                                                 ┌──────────┐
                                                                 │ 7.合并   │
                                                                 │ +清理    │
                                                                 │ 自动     │
                                                                 └──────────┘
```

★ = 需要用户参与

---

## 触发条件

当用户提出非平凡的开发需求（新功能、重构、架构调整、非琐碎 bug 修复）时进入 harness 流程。

**不触发**（直接做）：拼写修正、格式化、依赖升级、文档错别字等纯机械改动。

---

## 前置检查

进入流程时快速确认：

```bash
git status                    # 工作区干净
openspec list --json          # 无未归档 active change
git worktree list             # 清理陈旧 worktree
```

有脏数据先处理；有残留 worktree 先 `git worktree remove`。

---

## 步骤详解

### 步骤 1：探索（explore）— 自动

调用 `/opsx-explore`，理清需求本质。

**做什么**：
- 理解用户意图，调研代码库现状
- 评估可行性和技术方案
- 必要时用 AskUserQuestion 澄清模糊点

**意图明确后，并行创建开发环境**：

一旦从用户描述中提炼出 change 名称（kebab-case），立即创建 worktree（与后续探索并行）：

```bash
git fetch origin
git worktree add .git/worktree/<change> -b change/<change-id> origin/main
cd .git/worktree/<change>
bun install
```

创建后确认身份：
```bash
pwd                                 # 必须在 .git/worktree/<change>
git branch --show-current           # 必须在 change/<change-id>
```

后续所有操作在 worktree 内进行。若发现自己回到主目录，立即停手切回。

**约定**：
- worktree 路径：`.git/worktree/<change>`（不污染项目目录）
- 分支命名：`change/<openspec-change-id>`
- 一个 worktree 对应一个需求，用完即删

**自动流转**：探索有结论 + worktree 就绪 → 进入提案。
**回退**：需求根本不清晰 → 提问澄清后继续探索。

---

### 步骤 2：提案（propose）— ★ 用户参与

调用 `/opsx-propose`，生成完整变更提案。

**做什么**：
- 生成 proposal.md（做什么 & 为什么）、design.md（怎么做 + ASCII 架构图）、tasks.md（任务拆解）、spec delta
- 与用户讨论：需求细节、技术选型、范围边界、Non-goals

**用户参与点**：
- 展示提案摘要，与用户确认方向
- 用户可能调整范围、否决方案、提出新约束
- **用户确认后才能继续**

**自动流转**：所有 apply-required artifacts 就绪 + 用户确认 → 进入审核。

---

### 步骤 3：审核（review）— 自动

对提案做质量门禁检查，**不等用户**。

**检查清单**：

| # | 检查项 | 标准 | 不通过处理 |
|---|--------|------|------------|
| 1 | 完整性 | proposal/design/tasks 全部生成，无占位符或 TODO | 补全后重新审核 |
| 2 | Non-goals | proposal.md 包含明确的 Non-goals 段落 | 自动补充后重新审核 |
| 3 | 任务粒度 | 每个 task 可在 ≤ 2h 内完成 | 拆分过粗的 task |
| 4 | 设计合理性 | design.md 技术方案可行，无明显风险 | 回到提案与用户讨论 |
| 5 | 规范一致 | spec delta 与 proposal/design 不矛盾 | 修正矛盾项 |
| 6 | 覆盖完整 | tasks 覆盖 proposal 中的所有需求 | 补充遗漏 task |

**自动流转**：全部通过 → 进入实施。
**回退规则**：
- 检查项 1/2/3/5/6 不通过 → 自动修正提案，重新审核
- 检查项 4 不通过（设计硬伤）→ 回到提案步骤与用户讨论

---

### 步骤 4：实施（implement）— 自动

调用 `/opsx-apply`，逐项执行 tasks.md。

**做什么**：
- 按 tasks.md 顺序逐项实现
- 每完成一项：勾选 `- [x]` + 运行 `bun run check`
- 全部完成后：运行完整 `bun run check` 确认全绿

**自动流转**：所有 task 完成 + `bun run check` 通过 → 进入归档。

**暂停条件**（停下来处理，不跳过）：

| 情况 | 处理 |
|------|------|
| task 描述不清晰 | 回到提案补充 tasks.md，再继续 |
| 实现中发现设计问题 | 暂停，更新 design.md，必要时与用户讨论 |
| `bun run check` 失败 | 立即修复，修复不了则暂停报告 |

---

### 步骤 5：归档（archive）— 自动

调用 `/opsx-archive`。

**做什么**：
- 将 change 归档到 `openspec/changes/archive/YYYY-MM-DD-<name>/`
- 如有 delta specs，同步到主规格 `openspec/specs/`

**自动流转**：归档完成 → 进入验收，不停顿。

---

### 步骤 6：验收（accept）— ★ 用户参与

向用户展示变更全貌，请求确认。

**展示内容**：

```
## 验收：<change-name>

**变更摘要**：<一句话描述做了什么>

**完成任务**：
- [x] Task 1: ...
- [x] Task 2: ...
- ...

**验证结果**：
- bun run check：✓ typecheck + lint + test 全通过
- 变更文件：<git diff --stat 摘要>

**当前 worktree**：<pwd 输出>

请确认是否通过验收。
```

**用户确认通过** → 进入合并清理。
**用户要求修改** → 回到步骤 4 实施修正。

---

### 步骤 7：合并清理（merge & cleanup）— 自动

验收通过后，合并回 main 并清理 worktree 环境。

**做什么**：

1. **合并到 main**（回主 worktree 操作）：
   ```bash
   cd <主项目目录>
   git checkout main && git pull --ff-only
   git merge --no-ff change/<change-id>
   bun run check                         # 合并后再次确认全绿
   git push origin main
   ```

2. **清理 worktree + 分支**：
   ```bash
   git worktree remove .git/worktree/<change>
   git branch -d change/<change-id>
   ```

3. **确认清理干净**：
   ```bash
   git worktree list                     # 不应有残留
   git branch --list "change/*"          # 不应有残留
   ```

**自动流转**：合并 + 推送 + 清理完成 → 流程结束。

---

## 自动流转规则

核心原则：**只在两个点停顿等用户——提案确认和验收确认。**

| 流转 | 触发条件 | 是否停顿 |
|------|----------|----------|
| 探索 → 提案 | 探索有结论 + worktree 就绪 | 否 |
| 提案 → 审核 | artifacts 就绪 + **用户确认** | ★ 是 |
| 审核 → 实施 | 质量检查全通过 | 否 |
| 实施 → 归档 | task 全完 + check 全绿 | 否 |
| 归档 → 验收 | 归档完成 | 否 |
| 验收 → 合并清理 | **用户确认** | ★ 是 |
| 合并清理 → 结束 | merge + push + 清理完成 | 否 |

---

## 状态追踪

使用 **TodoWrite** 追踪流水线进度：

```
☐ 1. 探索需求（并行创建 worktree）
☐ 2. 生成提案（需用户确认）
☐ 3. 审核提案质量
☐ 4. 实施变更
☐ 5. 归档 change
☐ 6. 用户验收
☐ 7. 合并清理（merge + worktree 删除）
```

进入步骤时标记 `in_progress`，完成时标记 `completed`。用户可随时查看进度。

---

## 护栏

- **不跳过审核**——即使变更很小，质量门禁必过
- **不跳过验收**——必须用户确认才合并代码
- **不在验收前提交到 main**——代码在验收通过后才 merge
- **check 失败必须修复**——不得 `--no-verify` 绕过钩子
- **探索和提案阶段不写业务代码**——只读代码库、生成 artifact
- **一个 worktree 对应一个 change**——不并行多个 change
- **worktree 用完即删**——不堆积陈旧 worktree
- **所有开发操作在 worktree 内**——主目录仅做最终 merge
<!-- OMO_INTERNAL_INITIATOR -->