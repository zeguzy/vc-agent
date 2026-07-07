## ADDED Requirements

### Requirement: 历史消息导航

系统 SHALL 在 INSERT 模式下，当 slash command 建议列表**不可见**时，支持通过 ↑↓ 键在已发送的用户消息历史中导航。

#### Scenario: ↑ 键加载上一条消息

- **WHEN** 用户在 INSERT 模式下，slash command 建议列表不可见，且存在已发送的用户消息
- **AND** 用户按下 ↑ 键
- **THEN** 系统 SHALL 将当前输入框内容保存为草稿
- **AND** 系统 SHALL 将输入框内容替换为最近一条已发送的用户消息文本
- **AND** 再次按 ↑ 时 SHALL 加载更早的消息

#### Scenario: ↑ 键到达历史边界

- **WHEN** 用户在历史导航中已到达最早的消息
- **AND** 用户再次按 ↑ 键
- **THEN** 输入框内容 SHALL 保持不变（停留在最早消息）

#### Scenario: ↓ 键加载下一条消息

- **WHEN** 用户正在历史导航中（historyIndex >= 0）
- **AND** 用户按下 ↓ 键
- **THEN** 系统 SHALL 将输入框内容替换为下一条更新的消息

#### Scenario: ↓ 键退出历史导航恢复草稿

- **WHEN** 用户在历史导航中已到达最新消息
- **AND** 用户再次按 ↓ 键
- **THEN** 系统 SHALL 退出历史导航模式
- **AND** 输入框内容 SHALL 恢复为进入历史导航前保存的草稿（若无草稿则为空）

#### Scenario: 手动编辑退出历史导航

- **WHEN** 用户正在历史导航中
- **AND** 用户键入或删除字符
- **THEN** 系统 SHALL 退出历史导航模式
- **AND** 输入框内容 SHALL 从用户编辑后的状态继续

#### Scenario: Agent 运行期间历史导航可用

- **WHEN** Agent 正在运行（`isRunning === true`）
- **AND** 用户在 INSERT 模式下，slash command 建议列表不可见
- **THEN** ↑↓ 历史导航 SHALL 同样可用

#### Scenario: 排队消息不纳入历史

- **WHEN** 系统构建已发送消息历史列表
- **THEN** 标记为 `queued: true` 的用户消息 SHALL 被排除

#### Scenario: 空历史时 ↑ 键无效果

- **WHEN** 当前会话无已发送用户消息
- **AND** 用户按下 ↑ 键
- **THEN** 输入框内容 SHALL 保持不变

## MODIFIED Requirements

### Requirement: Slash Command

系统 SHALL 支持以 `/` 开头的命令输入，提供自动补全建议列表和命令分发。↑↓ 键在建议列表可见时用于选择建议项，在建议列表不可见时用于历史消息导航（见「历史消息导航」requirement）。

#### Scenario: 命令建议

- **WHEN** 用户输入 `/` 开头的内容
- **THEN** 系统 SHALL 在输入框上方显示匹配的命令建议列表（命令名 + 描述），当前选中项用 `▶` 标记

#### Scenario: 建议导航

- **WHEN** 建议列表可见且用户按 `↑`/`↓`
- **THEN** 系统 SHALL 上下移动选中项

#### Scenario: Tab 补全

- **WHEN** 建议列表可见且用户按 Tab
- **THEN** 系统 SHALL 将选中命令补全到输入框（`/command ` 格式）

#### Scenario: 命令执行

- **WHEN** 用户在 `/` 开头时按 Enter
- **THEN** 系统 SHALL 执行匹配的选中命令（通过 `matchCommands` 解析），不发送给 Agent
- **AND** 支持的命令：`/clear`、`/compact`、`/model`、`/thinking`、`/context`、`/exit`、`/help`、`/setting`

#### Scenario: /setting 打开设置页面

- **WHEN** 用户执行 `/setting` 命令
- **THEN** 系统 SHALL 触发 App 顶层 `view` 切换为 `"settings"`，整屏渲染设置页面（详见 `settings` capability 的 "/setting 设置页面" requirement）
