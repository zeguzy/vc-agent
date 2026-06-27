## 1. 工具函数提取（无依赖，优先执行）

- [x] 1.1 创建 `src/utils/content.ts`：从 `agent/session.ts` 移入 `extractAssistantContent`、`extractAssistantText`、`summarizeArgs`
- [x] 1.2 创建 `src/utils/formatError.ts`：实现 `formatError(err: unknown): string` 统一错误格式化
- [x] 1.3 更新 `agent/session.ts`：从 `utils/content.ts` 导入工具函数，移除原定义；添加 re-export 保持向后兼容
- [x] 1.4 更新所有 `extractAssistantContent` / `extractAssistantText` 的调用方：`session/render.ts`、`tui/App.tsx` → 改为从 `utils/content.ts` 导入

## 2. 重命名 store.ts → message.ts（无依赖）

- [x] 2.1 重命名文件：`src/store.ts` → `src/message.ts`
- [x] 2.2 更新所有 import 路径：`tui/App.tsx`、`tui/commands.ts`、`session/render.ts`、`commands/registry.ts`、`tests/store.test.ts` → `../message.js`
- [x] 2.3 重命名测试文件：`tests/store.test.ts` → `tests/message.test.ts`
- [x] 2.4 验证：`bun run check` 通过

## 3. config.ts 去冗余（与任务 1/2 并行）

- [x] 3.1 删除 `loadConfig` 别名函数，将 `index.tsx` 中的调用改为 `readConfig`
- [x] 3.2 删除未使用的 `defaultConfig` 导出
- [x] 3.3 验证：`bun run check` 通过

## 4. settings/ 合并（与任务 1/2 并行）

- [x] 4.1 创建 `src/settings/definitions.ts`：合并所有 Setting 定义
- [x] 4.2 更新 `src/settings/registry.ts`：从 `definitions.ts` 导入各 Setting
- [x] 4.3 删除 5 个原始文件
- [x] 4.4 无需更新测试文件（无 `tests/settings.test.ts`）
- [x] 4.5 验证：`bun run check` 通过

## 5. tui/ 目录重组

- [x] 5.1 创建 `src/tui/hooks/` 和 `src/tui/utils/` 目录
- [x] 5.2 移动工具文件到 `tui/utils/`
- [x] 5.3 更新 `tui/App.tsx` 中对工具文件的导入路径
- [x] 5.4 更新 `tui/components/` 中各组件对工具文件的导入路径
- [x] 5.5 验证：`bun run check` 通过

## 6. App.tsx 提取自定义 Hook（依赖任务 5）

- [x] 6.1 创建 `src/tui/hooks/useStreamingBuffer.ts`：提取流式缓冲逻辑
- [x] 6.2 创建 `src/tui/hooks/useSessionPicker.ts`：提取会话选择器状态和回调
- [x] 6.3 创建 `src/tui/hooks/useSessionEvents.ts`：提取事件订阅和消息映射逻辑
- [x] 6.4 重构 `tui/App.tsx`：482 行 → 322 行
- [x] 6.5 验证：typecheck + tests 通过

## 7. 错误处理标准化（依赖任务 1.2）

- [x] 7.1 全量替换 `err instanceof Error ? err.message : String(err)` 为 `formatError(err)`：涉及 10+ 文件
- [x] 7.2 修复静默吞错：`tui/commands.ts` 中 `/model` 命令的 `.catch(() => {})` 改为显示错误消息
- [x] 7.3 验证：typecheck + tests 通过

## 8. 最终验证

- [x] 8.1 typecheck 通过，173 tests pass
- [x] 8.2 `tests/message.test.ts`（原 `store.test.ts`）导入路径已更新
- [x] 8.3 无残留旧导入路径引用（grep `store.js`、`loadConfig` 均无结果）
