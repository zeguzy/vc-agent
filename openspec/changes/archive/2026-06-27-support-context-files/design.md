## Context

当前 openagent 的 system prompt 完全硬编码在 `SkillManager.initialize()` 中，不读取任何外部上下文文件。opencode 生态已建立 `AGENTS.md`/`CLAUDE.md` 作为标准的项目行为配置约定，大量项目已有这些文件。本设计将这些能力引入 openagent。

## Goals / Non-Goals

**Goals:**
- 从项目目录树和全局路径自动发现 `AGENTS.md`（含 `CLAUDE.md` fallback）
- `config.json` 新增 `instructions` 字段支持显式引用文件、glob、URL
- 按目录层级动态注入:读取文件时自动附带其父目录的 `AGENTS.md`
- 加载后的内容合并到 Pi SDK system prompt，替换硬编码

**Non-Goals:**
- 不支持 `.cursorrules`、`.windsurfrules` 等 IDE 规则格式
- 不解析 `AGENTS.md` 内部的 `@file:` 引用语法（由 agent 自己 read 文件）
- 不做 token 预算管理或 context compaction

## Decisions

### Decision 1: 新建独立模块 `src/context-files.ts`

```
┌─────────────────────────────────────────────────────┐
│                  src/context-files.ts                │
│                                                     │
│  loadSystemContext(cwd, config) → string            │
│                                                     │
│  ┌──────────────┐   ┌──────────────┐               │
│  │findUp("AGENTS│   │resolveInstruc│               │
│  │.md" | "CLAUDE│   │tions(config) │               │
│  │.md")         │   │              │               │
│  │              │   │ • file paths │               │
│  │ cwd → ~/.    │   │ • globs      │               │
│  │ config/      │   │ • ~/ expand  │               │
│  │ openagent/   │   │ • http(s)    │               │
│  └──────┬───────┘   └──────┬───────┘               │
│         │                  │                        │
│         └────────┬─────────┘                        │
│                  ▼                                  │
│         ┌───────────────┐                           │
│         │ concat + base │                           │
│         │ system prompt │                           │
│         └───────────────┘                           │
└─────────────────────────────────────────────────────┘
```

**理由**: 将上下文加载逻辑与 SkillManager 解耦，职责单一，便于测试。
**替代方案**: 直接改 SkillManager → 耦合太重，不可测试。

### Decision 2: 使用 `findUp` 而非递归遍历

opencode 源码中 `instructionFiles` 遍历是 "首个匹配即停"（`break`）。我们保持一致：
- 从 cwd 向上遍历目录，找第一个存在的 `AGENTS.md`
- 若无，再找 `CLAUDE.md`
- 全局 `~/.config/openagent/AGENTS.md` 独立查找，不与项目级互斥

**理由**: 与 opencode 行为一致，避免祖先目录的 rules 意外叠加。

### Decision 3: `instructions` 字段支持 glob 和 URL

```
config.json:
{
  "instructions": [
    "docs/coding-standards.md",     // 相对路径 → 用 findUp
    "~/my-rules.md",                // ~/ → 展开为 $HOME
    "packages/*/AGENTS.md",         // glob → fs.glob
    "https://example.com/rules.md"  // URL → HTTP GET
  ]
}
```

glob 用 Bun 原生的 `Bun.Glob`，URL 用 `fetch()` 超时 5 秒。
**理由**: 对标 opencode 的 `instructions` 字段功能，零额外依赖。

### Decision 4: 目录层级动态注入在 `resolve()` 中实现

当 agent 读取 `src/auth/login.ts` 时：
```
src/auth/login.ts
  → 检查 src/auth/AGENTS.md     ✅ 存在 → 注入
  → 检查 src/AGENTS.md          ❌ 无
  → 检查 AGENTS.md              已加载（跳过）
```

通过 `resolve()` 方法接收文件路径，向上遍历父目录，发现 `AGENTS.md` 后返回内容供调用方注入到当前消息的 context 中。去重：同一 message ID 内的同一文件只注入一次。

**理由**: opencode 的核心特性之一，对大型 monorepo 项目价值巨大。

### Decision 5: system prompt 组装顺序

```
1. Base system prompt（保留当前硬编码作为 fallback/base）
2. + 全局 AGENTS.md（~/.config/openagent/AGENTS.md）
3. + 项目级 AGENTS.md 或 CLAUDE.md
4. + instructions 文件内容
```

每个来源标注 `Instructions from: <path>` 前缀。保持 base prompt 的存在感，用户 rules 作为追加层。

## Risks / Trade-offs

- **Token 膨胀**: 用户可能写很长的 AGENTS.md → 占用 context window
  → 缓解：不做自动限制，用户自行控制长度；instructions 字段可引用多个小文件
- **HTTP URL 阻塞**: 网络不可用时 URL fetch 可能拖慢启动
  → 缓解：5 秒超时，失败静默跳过
- **`resolve()` 调用时机**: Pi SDK 的 `read` 工具何时触发 resolve？
  → 当前 Pi SDK 工具钩子不够细粒度，MVP 先实现 `ContextFiles` 类暴露方法，后续在 session 事件中注册调用
