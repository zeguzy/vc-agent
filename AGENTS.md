# AGENTS.md

openagent —— 基于 Pi SDK 的全屏 TUI 代码 Agent。
技术栈：TypeScript（strict）+ Bun 运行时 + @earendil-works/pi-coding-agent + @opentui/react。
项目上下文与设计理念见 `openspec/config.yaml`。

---

## 开发工作流：OpenSpec 驱动（默认强制）

所有非平凡变更**必须**通过 OpenSpec 工作流驱动，禁止未经提案直接改代码。

### 标准流程

1. **探索 / 澄清**（需求模糊时）—— `/openspec-explore`
   先理清意图、调研可行性，输出探索结论再决定是否提案。

2. **提案**（动手前必做）—— `/openspec-propose`
   一次性生成：`proposal.md`（含 Non-goals）、`design.md`（ASCII 架构图 + 关键技术决策及理由）、`tasks.md`（每任务 ≤ 2h，按依赖顺序排列）、spec 增量（delta）。
   提案规则见 `openspec/config.yaml`：MVP ≤ 5 个核心功能，必须包含 Non-goals。

3. **实现** —— `/openspec-apply-change`
   按 `tasks.md` 顺序逐项执行并勾选，每完成一项跑 `bun run check` 验证。

4. **归档** —— `/openspec-archive-change`
   实现完成、`bun run check` 全绿后，归档到 `openspec/changes/archive/`。

### 规格位置

- 主能力规格：`openspec/specs/`（`agent-session` · `cli-entry` · `tui-input` · `tui-layout` · `tui-messages`）
- 变更对应已有规格时，在提案里写 **spec 增量（delta）**，不要直接改主规格。主规格由归档时同步。

### 例外（可暂不走 OpenSpec）

- 纯机械改动：拼写、格式化、依赖升级、文档错别字
- 紧急修复线上故障（事后补提案）

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
