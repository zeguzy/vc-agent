## ADDED Requirements

### Requirement: 发现并加载项目级 AGENTS.md

系统 SHALL 在启动时从当前工作目录（cwd）向上遍历目录树，查找第一个存在的 `AGENTS.md` 文件，并将其内容注入 system prompt。

#### Scenario: 项目根存在 AGENTS.md
- **WHEN** cwd 或任一祖先目录中存在 `AGENTS.md`
- **THEN** 系统 SHALL 读取该文件内容
- **AND** 将其以 `Instructions from: <filePath>` 为前缀注入 system prompt
- **AND** 不再搜索更上层的 `AGENTS.md`（首个匹配即停）

#### Scenario: 项目无 AGENTS.md 但有 CLAUDE.md
- **WHEN** 目录树中不存在 `AGENTS.md`，但存在 `CLAUDE.md`
- **THEN** 系统 SHALL 回退读取 `CLAUDE.md`，行为同 AGENTS.md

#### Scenario: 两者都不存在
- **WHEN** 目录树中既无 `AGENTS.md` 也无 `CLAUDE.md`
- **THEN** 系统 SHALL 不注入任何项目级上下文文件

### Requirement: 发现并加载全局 AGENTS.md

系统 SHALL 检查 `~/.config/openagent/AGENTS.md`，若存在则注入 system prompt。

#### Scenario: 全局 AGENTS.md 存在
- **WHEN** `~/.config/openagent/AGENTS.md` 文件存在
- **THEN** 系统 SHALL 读取并注入，优先级低于项目级 AGENTS.md（追加在其后）

#### Scenario: 全局不存在但 ~/.claude/CLAUDE.md 存在
- **WHEN** `~/.config/openagent/AGENTS.md` 不存在，但 `~/.claude/CLAUDE.md` 存在
- **THEN** 系统 SHALL 回退读取 `~/.claude/CLAUDE.md`

### Requirement: config.json instructions 字段

系统 SHALL 支持 `config.json` 中的 `instructions` 字段，允许显式指定额外的上下文文件路径、glob 模式和 HTTP(S) URL。

#### Scenario: 相对路径文件
- **WHEN** `instructions` 包含相对路径如 `"docs/standards.md"`
- **THEN** 系统 SHALL 从 cwd 向上搜索该文件（`findUp`），读取并注入

#### Scenario: ~/ 展开
- **WHEN** `instructions` 包含 `~/` 开头的路径如 `"~/my-rules.md"`
- **THEN** 系统 SHALL 将 `~` 展开为用户 home 目录，读取并注入

#### Scenario: glob 模式
- **WHEN** `instructions` 包含 glob 如 `"packages/*/AGENTS.md"`
- **THEN** 系统 SHALL 展开 glob，读取所有匹配文件，按路径排序后逐一注入

#### Scenario: HTTP(S) URL
- **WHEN** `instructions` 包含 `http://` 或 `https://` 开头的 URL
- **THEN** 系统 SHALL 通过 HTTP GET 获取内容（5 秒超时），失败则静默跳过
- **AND** 注入时标注 `Instructions from: <URL>`

#### Scenario: 路径不存在
- **WHEN** `instructions` 指定的文件路径不存在
- **THEN** 系统 SHALL 静默跳过，不阻塞启动

### Requirement: 目录层级动态上下文注入

系统 SHALL 提供 `resolve(filePath)` 方法，当读取某个文件时，从该文件所在目录向上遍历，查找每个父目录中的 `AGENTS.md` 并注入上下文。

#### Scenario: 文件路径关联的 AGENTS.md
- **WHEN** agent 读取 `/project/src/auth/login.ts`
- **THEN** 系统 SHALL 依次检查 `src/auth/AGENTS.md`、`src/AGENTS.md`、`AGENTS.md`
- **AND** 对每个存在的 `AGENTS.md`（非已加载的根 AGENTS.md 且非重复），读取内容并返回

#### Scenario: 同消息去重
- **WHEN** 同一 message ID 内多次触发 resolve
- **THEN** 系统 SHALL 不重复注入同一文件

### Requirement: system prompt 组装

系统 SHALL 将基础 prompt、全局 rules、项目 rules、instructions 文件按固定顺序组装为最终 system prompt。

#### Scenario: 完整组装
- **WHEN** 以上所有来源均存在内容
- **THEN** 最终 system prompt SHALL 按以下顺序拼接：
  1. Base system prompt（当前硬编码内容）
  2. 全局 AGENTS.md（如存在）
  3. 项目级 AGENTS.md（如存在）
  4. instructions 文件内容（按数组顺序）
- **AND** 每个外部来源以 `\n\nInstructions from: <path>\n` 为前缀
