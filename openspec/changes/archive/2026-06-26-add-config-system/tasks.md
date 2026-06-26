## 1. 配置系统核心

- [x] 1.1 创建 `src/config.ts`：定义 Config 接口（类型定义）
- [x] 1.2 实现 `readConfig()`：读取全局 `~/.config/openagent/config.json` + 项目 `.openagent/config.json`
- [x] 1.3 实现 `deepMerge(global, project)`：递归合并两层配置
- [x] 1.4 实现 `loadConfig(cwd)`：组合读取+合并，返回最终配置对象，配置不存在时返回默认值

## 2. 集成到启动流程

- [x] 2.1 修改 `src/index.tsx`：启动时调用 `loadConfig(cwd)`，传递给 `createSession` 和 `<App>`
- [x] 2.2 修改 `src/agent/session.ts`：`createSession` 接受 config 参数
  - providers.apiKey → `authStorage.setRuntimeApiKey()`
  - providers 自定义（有 baseUrl/api/models）→ `registry.registerProvider()`
  - model → `resolveModel()` 时使用配置中的值
  - thinking.level → 创建 SettingsManager 后 `setThinkingLevel()`
- [x] 2.3 CLI `--model` 参数优先级高于配置文件

## 3. TUI 配置集成

- [x] 3.1 修改 `src/tui/App.tsx`：从 config 初始化 `thinkingCollapsed` 和 `contextDisplay` 状态

## 4. 验证

- [x] 4.1 无配置文件时正常启动（回退默认行为）
- [x] 4.2 全局配置可正确设置 API key 和模型
- [x] 4.3 项目配置可覆盖全局配置
- [x] 4.4 自定义 provider（Ollama/vLLM）可正常注册和通信
