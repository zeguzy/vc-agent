## 1. 配置模板函数

- [x] 1.1 在 `src/config.ts` 实现 `export function getDefaultConfigTemplate(): Config` 纯函数。**有默认值的字段全展开**:`thinking`({ level: "medium", collapsed: false })、`compaction`({ enabled: true, reserveTokens: 4096, keepRecentTokens: 8192 })、`skills`({ paths: [], autoLoad: true, disabled: [] })、`instructions`([])、`providers`({})、`display`({})。**引用模块默认**:`teams` 用 `{ ...DEFAULT_TEAM_CONFIG }`(从 `src/teams/types.ts` 导入),`notifications` 用 `getDefaultNotificationsConfig()`(从 `src/notifications/config.ts` 导入)。**特殊处理**:`model` 字段省略该 key(无有意义默认值,`undefined` 由 `JSON.stringify` 自然丢弃,用户需要时自行添加);`contextPruning` 只放 `{ enabled: false }`(因 `DEFAULT_CONTEXT_PRUNING` 类型是 resolved `ContextPruningConfig`、与 `Config.contextPruning: ContextPruningUserConfig` 不兼容,DCP 默认 opt-out)。

## 2. /config 命令注册与处理

- [x] 2.1 在 `src/tui/commands.ts` 的 `registerBuiltinCommands()` 内注册 `/config` 命令(`name: "config"`、`description` 简洁描述"生成配置文件模板"、`usage: "/config init [project|global] [--force]"`)。handler 解析 `args.split(/\s+/).filter(Boolean)`:首个 token 为子命令(大小写不敏感,`toLowerCase()`),识别 `init`;后续 token 中取 scope(`project`/`global`,大小写不敏感,缺省 `project`)与 `--force` flag(位置无关,`includes("--force")`)。
- [x] 2.2 handler 完整逻辑:(a) 子命令非 `init` 或缺失 → 反馈"当前仅支持 init 子命令"+用法,无副作用;(b) scope 非 `project`/`global` → 报错列出合法值+用法,无副作用;(c) 按作用域算目标路径(global→`~/.config/openagent/config.json`、project→`<cwd>/.openagent/config.json`);(d) `existsSync(target)` 为真且无 `--force` → 报错提示已存在+路径+建议加 `--force`,不修改文件;(e) 否则进入**写入路径,整体 `try-catch` 包裹** `getDefaultConfigTemplate()` + `writeConfig(ctx.cwd, tmpl, scope)` + `ctx.setConfig(tmpl)`:成功时 `createAssistantMessage` 反馈(注明"已生成"或"已覆盖"+绝对路径+"按需修改字段";`scope=global` 且 `--force` 覆盖时额外提醒"全局配置已被覆盖,建议用 git 或备份恢复");`catch (e)` 时用 `formatError(e)` 格式化并通过 `createAssistantMessage` 反馈"写入失败",不中断 session。

## 3. 测试

- [x] 3.1 创建 `tests/config-template.test.ts`,断言:(a)`getDefaultConfigTemplate()` 返回对象包含所有有默认值的顶层字段(`thinking`/`providers`/`display`/`compaction`/`skills`/`notifications`/`teams`/`contextPruning`/`instructions`),且 `model` key 不存在(`!('model' in tmpl)`)、`tmpl.contextPruning` 深度等于 `{ enabled: false }`;(b) 将模板写入临时目录后用 `readConfig` 读回无 JSON 错误,且 `deepMerge({}, tmpl)` 结果与 `tmpl` 深度相等(防嵌套字段漂移);(c)`resolveTeamConfig(result.teams)` 与 `resolveNotificationsConfig(result.notifications)` 不抛异常。复用 `tests/` 下现有测试的临时目录模式。

## 4. 验证

- [x] 4.1 运行 `bun run check`(typecheck + lint + test)确认全绿,无新增 `any`/lint error。若 `check` 失败立即修复,不得 `--no-verify` 绕过。
