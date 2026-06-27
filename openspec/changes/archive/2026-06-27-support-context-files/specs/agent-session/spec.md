## MODIFIED Requirements

### Requirement: Skill 自动发现

系统 SHALL 在创建 Agent 会话时自动扫描并加载技能（Skills），将可自动调用的技能注入到系统提示中。系统提示 SHALL 由基础 prompt 和上下文文件内容组装而成（详见 context-files 规格），不再使用硬编码字符串。

#### Scenario: 全局技能扫描
- **WHEN** 系统启动
- **THEN** 创建 `DefaultResourceLoader`，配置 `agentDir=~/.config/openagent`
- **AND** 自动扫描 `~/.config/openagent/skills/` 目录下的 SKILL.md 文件
- **AND** systemPrompt 由 `ContextFiles.loadSystemContext(cwd, config)` 生成，非硬编码

#### Scenario: 项目技能扫描
- **WHEN** 系统启动
- **THEN** 自动扫描 `<cwd>/.openagent/skills/` 目录下的 SKILL.md 文件

#### Scenario: 额外技能路径
- **WHEN** `config.skills.paths` 配置了额外的路径
- **THEN** 这些路径 SHALL 被加入 `additionalSkillPaths` 传入 `DefaultResourceLoader`

#### Scenario: 禁用自动加载
- **WHEN** `config.skills.autoLoad` 为 `false`
- **THEN** 系统 SHALL 不扫描默认技能目录（但额外路径仍可配置）

#### Scenario: 排除特定技能
- **WHEN** `config.skills.disabled` 列出了技能名称
- **THEN** 这些技能 SHALL 通过 `skillsOverride` 从加载结果中过滤掉

#### Scenario: 上下文文件注入 system prompt
- **WHEN** 系统启动并初始化 SkillManager
- **THEN** systemPrompt SHALL 调用 `loadSystemContext(cwd, config)` 生成
- **AND** 结果包含 base prompt + 全局 rules + 项目 rules + instructions 文件
