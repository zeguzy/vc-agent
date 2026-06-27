# AGENTS.md

openagent — your terminal coding assistant.
项目上下文与设计理念见 `openspec/config.yaml`。

---

## 开发工作流：OpenSpec 驱动（默认强制）

所有非平凡变更**必须**通过 OpenSpec 工作流驱动，禁止未经提案直接改代码。

### 标准流程

> **铁律**：OpenSpec 流程**必须**跑在隔离 worktree 内。各 openspec skill 本身不含 worktree 逻辑，由本节强制约束——执行任何 `/openspec-*` 之前，先确认当前 worktree 与分支身份。建 worktree 后所有操作在 worktree 目录内进行，**主目录保持不动**，仅归档阶段做一次性合并。

> **工作目录确认**：每次执行 `/openspec-*` 或代码编辑前，必须先验证当前目录和分支：
> ```bash
> pwd    # 必须在 ../vc-agent-<change>
> git branch --show-current  # 必须在 change/<change-id>
> ```
> 若发现自己回到了主目录（`vc-agent`），立即停手并切回 worktree。

0. **前置门禁**（开新需求必做，在任何 `/openspec-*` 之前）
   - **工作区干净**：`git status` 无未提交改动、无 untracked 的 `openspec/changes/`。有脏数据先提交、归档或询问用户，**不得带脏开新需求**。
   - **无未归档 active change**：`openspec list` 若有未归档 change，先 `/openspec-archive-change` 或与用户确认它确实已完成；禁止把多个 change 叠在同一分支。
   - **无残留 worktree**：`git worktree list` 不应有陈旧 worktree；有的话先 `git worktree remove` 清理。

1. **建 worktree + 探索 / 澄清**（需求模糊时）—— `/openspec-explore`
   先建 worktree 再探索（命名见下文「工作树隔离开发」）：
   ```bash
   git fetch origin
   git worktree add ../vc-agent-<change> -b change/<change-id> origin/main
   cd ../vc-agent-<change>
   ```
   在新 worktree 内理清意图、调研可行性，输出探索结论再决定是否提案。

2. **提案**（动手前必做，必须在 worktree 内）—— `/openspec-propose`
   一次性生成：`proposal.md`（含 Non-goals）、`design.md`（ASCII 架构图 + 关键技术决策及理由）、`tasks.md`（每任务 ≤ 2h，按依赖顺序排列）、spec 增量（delta）。
   提案规则见 `openspec/config.yaml`：MVP ≤ 5 个核心功能，必须包含 Non-goals。

3. **实现**（必须在对应 worktree 内）—— `/openspec-apply-change`
   开工前核对：当前目录 = `../vc-agent-<change>`、当前分支 = `change/<change-id>`；不符则**停手**并引导用户切到正确 worktree。
   按 `tasks.md` 顺序逐项执行并勾选，每完成一项跑 `bun run check` 验证。

4. **归档 + 合并 + 清理** —— `/openspec-archive-change`
    实现完成、`bun run check` 全绿后：先归档到 `openspec/changes/archive/`，再回主 worktree 合并并清理 worktree（命令见「工作树隔离开发 → 流程」）。

5. **创建 MR**（合并到 main 后）
    合并通过、`bun run check` 全绿后，推送 main 并创建 MR 供 review：
    ```bash
    git push origin main
    gh pr create --base main --head main --title "<mr 标题>" --body "<mr 描述>"
    ```
    如果分支尚未合并，也可以直接从 worktree 分支创建 MR：
    ```bash
    git push -u origin change/<change-id>
    gh pr create --base main --head change/<change-id> --title "<标题>" --body "<描述>"
    ```

### 规格位置

- 主能力规格：`openspec/specs/`（`agent-session` · `cli-entry` · `tui-input` · `tui-layout` · `tui-messages`）
- 变更对应已有规格时，在提案里写 **spec 增量（delta）**，不要直接改主规格。主规格由归档时同步。

### 例外（可暂不走 OpenSpec）

- 纯机械改动：拼写、格式化、依赖升级、文档错别字
- 紧急修复线上故障（事后补提案）

---

## 工作树隔离开发（git worktree）

每个新需求（OpenSpec change 或独立任务）在独立的 git worktree 中开发，与 main 物理隔离。完成后合并回 main 并清理，不在本地堆积长期分支。

> **何时触发**：见上文「标准流程」第 0（前置门禁）、1（创建）、4（合并+清理）步。本节给出 worktree 的具体命令与约定。

### 流程

1. **创建**（基于最新 main）：
   ```bash
   git fetch origin
   git worktree add ../vc-agent-<change> -b change/<change-id> origin/main
   ```
   worktree 放项目同级目录（`../vc-agent-<change>`），不嵌套进主目录。

2. **开发**：进入 worktree，按 OpenSpec 流程（propose → apply）或直接实现；期间正常 `bun run check` 验证、提交到 `change/<change-id>` 分支。

3. **合并**（回主 worktree）：
   ```bash
   git checkout main && git pull --ff-only
   git merge --no-ff change/<change-id>
   bun run check
   git push origin main
   ```

4. **清理**（合并通过 + 推送后）：
   ```bash
   git worktree remove ../vc-agent-<change>
   git branch -d change/<change-id>
   ```

### 约定

- **隔离铁律**：建 worktree 后，所有开发操作（`/openspec-*`、编辑代码、`bun run check`、`git commit`）**都在 worktree 目录内进行**，不得在主目录改动代码或跑 `openspec-*`。主目录（main 分支）在整个开发期间保持不动，**仅**在归档阶段做一次性 `git merge`（见「流程 → 合并」）。若发现自己回到了主目录，立即停手并切回 worktree。
- 分支命名：`change/<openspec-change-id>`；无 OpenSpec 时用 `feat|fix|chore/<slug>`
- 一个 worktree 对应一个需求，用完即删；禁止复用旧 worktree 跑新需求
- 所有 worktree 共享同一 `.git`，不要重复 clone
- 每个 worktree 的 `node_modules` 独立，需各自 `bun install`

---

## 开发工具链（Harness）

| 命令 | 作用 |
|---|---|
| `bun run dev` | 启动 TUI 开发 |
| `bun run typecheck` | tsc 类型检查（strict，noEmit） |
| `bun run lint` | biome check（只读，报告问题） |
| `bun run lint:fix` | biome check --write（自动修复 + 格式化） |
| `bun run format` | biome format --write |
| `bun run test` | bun test（扫描所有 `*.test.ts`） |
| `bun run check` | **typecheck && lint && test 一键全检** |

提 PR / 合并前必须 `bun run check` 通过。

### 提交前钩子（lefthook）

`git commit` 自动触发 pre-commit（配置见 `lefthook.yml`）：
- 对暂存文件跑 biome 修复并重新加入暂存区
- 有 TS/TSX 改动时跑全量 typecheck

钩子失败即拒绝提交。**禁止用 `--no-verify` 绕过**。

### 代码风格（Biome）

配置见 `biome.json`，核心约定：
- 缩进 **tab**，字符串 **双引号**，语句末 **分号**，尾逗号 **all**，行宽 100
- import 自动整理（organizeImports 开启）
- 规则集：recommended

已知技术债（与历史代码风格冲突，已降级为 warn，不阻塞提交，后续逐步收紧）：
`noExplicitAny`、`noArrayIndexKey`、`noImplicitAnyLet`、`noFallthroughSwitchClause`。
**新代码应避免再引入上述模式**，不要让债务增长。

---

## 测试约定

- 框架：**bun test**（`bun:test`），无需额外配置
- 纯函数测试放 `tests/`，命名 `*.test.ts`（参考 `tests/{config,store,session}.test.ts`）
- 优先测纯函数（无副作用、无外部依赖）；带副作用或重依赖的模块，先抽出可注入的纯逻辑再测
- 修改 `src/` 里的纯函数时，同步补充或更新对应测试

---

## 依赖与锁文件

- 包管理器：**Bun**。`bun.lock` 是唯一被跟踪的 lockfile
- `package-lock.json` 已加入 `.gitignore` —— **不要提交它**
- 安装依赖优先 `bun add`；若 Bun 网络异常临时改用 npm，产出的 `package-lock.json` 不得提交，并在事后用 `bun install` 同步 `bun.lock`

---

## 验收规范

每次让用户验收变更时，**必须**告知以下信息：

1. **当前工作目录**：用 `pwd` 显示完整路径，让用户确认在正确的 worktree 内
2. **验证命令**：给出可执行的验证命令（如 `bun run check`、`bun run test`），让用户能自行跑一遍确认通过
