---
name: team-test-writing
description: Team 模式测试编写规范。三层架构（unit/integration/E2E）+ 已知坑清单 + ASTRON 配置 + 断言策略。当需要为 team 功能写测试、补 E2E 覆盖、或调试 team 测试环境问题时触发。
license: MIT
metadata:
  author: openagent
  version: "1.0"
---

# team-test-writing：Team 模式测试编写规范

为 team 功能（member/task/message/coordinator/discussion）编写测试的步骤、要求、已知坑。

---

## 触发条件

- 为 team 功能新增单元/集成/E2E 测试
- 调试 team 测试环境问题（LLM 连接、session 卡住、日志找不到）
- review team 相关 PR 的测试覆盖

---

## 三层测试架构

| 层 | 文件命名 | 默认运行 | LLM 依赖 | 用途 |
|---|---|---|---|---|
| **Unit** | `tests/team-*-unit.test.ts` | ✅ 运行 | 无 | 纯函数（coordinator prompt 构造、JSON 解析、inbox 聚合） |
| **Integration** | `tests/team-*-integration.test.ts` | ✅ 运行 | mock | manager 内部方法（evaluateDiscussion、assignTask），用 `mock.module` + `@ts-expect-error` 直调 private |
| **E2E** | `tests/team-*-e2e.test.ts` | ❌ skip | 真 LLM | 完整 HTTP 链路（HttpClient → server → manager → coordinator → LLM） |

E2E 门控：`describe.skipIf(process.env.RUN_LLM_TESTS !== "1")`。跑：`RUN_LLM_TESTS=1 bun test tests/team-*-e2e.test.ts`。

---

## Unit 测试要求

1. **不依赖** LLM、网络、文件系统（`collectRecentMessages` 除外，用 `mkdtempSync` 隔离）
2. **不 import** manager-v2 / server / http（避免触发模块加载副作用）
3. 测纯函数的各种输入边界：正常 JSON / 非法 JSON / 缺字段 / 空值 / 大量数据

---

## Integration 测试要求

### mock.module 与真实 import 冲突

`mock.module("...coordinator.js", ...)` 注册后，**该测试文件内所有** coordinator import 都拿 mock 版本。如果同一文件还要测真实 coordinator 纯函数 → **必须拆成独立文件**。

### 直调 private 方法

`evaluateDiscussion` 等 private 方法无法从外部调用。用 `@ts-expect-error` 穿透：

```typescript
// @ts-expect-error: evaluateDiscussion is private
await manager.doEvaluateDiscussion(task);
```

注意：`evaluateDiscussion` 是 wrapper（串行化锁），实际逻辑在 `doEvaluateDiscussion`。测 wrapper 用 `evaluateDiscussion`，测逻辑用 `doEvaluateDiscussion`。

### mock session 模式

参考 `tests/team-messages-e2e.test.ts` 的 `injectMember` + `fakeSession`：

```typescript
function spySession(streaming = false) {
    return {
        isStreaming: streaming,
        steerCalls: [],
        promptCalls: [],
        steer(text) { this.steerCalls.push(text); },
        prompt(text) { this.promptCalls.push(text); },
        subscribe() { return () => {}; },
        dispose() {},
        abort() {},
    };
}

// @ts-expect-error: reaches into private members map
manager.members.set(name, { name, role, status: "idle", session, currentTaskId: null, ... });
```

### mock.module 注册位置

必须在测试文件**顶层**（所有 import 之前）注册：

```typescript
import { mock } from "bun:test";
let nextDecision = { action: "complete", reason: "default" };
mock.module("../src/teams/coordinator.js", () => ({
    runCoordinator: async () => nextDecision,
    collectRecentMessages: () => [],
}));
```

---

## E2E 测试要求

### 环境配置：ASTRON provider

**`createRealServer()` 不传 config** → model registry 为空 → `createAgentSession` 挂起。E2E 测试必须用共享 helper `tests/helpers/astron-config.ts` 初始化带 provider config 的 server：

```typescript
import { ASTRON_KEY, buildAstronConfig } from "./helpers/astron-config.js";

// beforeAll:
if (!ASTRON_KEY) throw new Error("...");
const { runtime, skillManager } = await createRuntime({
    cwd: process.cwd(),
    mode: "new",
    config: buildAstronConfig(),
});
const { createServer } = await import("../src/server/index.js");
server = createServer({ runtime, skillManager, cwd: process.cwd() });
```

### API Key 切换

`tests/helpers/astron-config.ts` 支持两个 key，**默认用低级模型**（省钱）：

| 优先级 | 环境变量 | 用途 |
|---|---|---|
| 1（默认） | `ASTRON_INFINITY_API_KEY` | 低级模型/无限套餐，日常 E2E 默认 |
| 2 | `ASTRON_API_KEY` | 标准模型，fallback |
| 3 | `XUNFEI_ASTRON_KEY` | legacy 别名 |

切换方式：
```bash
# 默认（INFINITY）：两个 key 都设了时用 INFINITY
RUN_LLM_TESTS=1 bun test tests/team-*-e2e.test.ts

# 强制用标准 key：清空 INFINITY 让 fallback 生效
ASTRON_INFINITY_API_KEY= RUN_LLM_TESTS=1 bun test tests/team-*-e2e.test.ts
```

### 日志读取：LOG_DIR 固化问题

`src/teams/logger.ts` 在模块加载时固化 `LOG_DIR = join(homedir(), ...)`。`createRealServer` 运行时改 `process.env.HOME`，但 logger 已固化到原始 HOME。

**修复**：测试文件顶部缓存真实 HOME：

```typescript
const REAL_HOME = process.env.HOME ?? homedir();
// 读日志时用 REAL_HOME，不用 homedir()（已被隔离 HOME 覆盖）
```

### 断言策略：只做结构性断言

| 断言类型 | 策略 |
|---|---|
| task status 转换（in_progress → done） | **hard assert** |
| coordinator 日志事件存在（discussion_evaluated） | **hard assert** |
| HTTP 端点返回正确 status code + type 字段 | **hard assert** |
| 成员间消息交换 | **soft assert**（warn 不 fail — coordinator 可能 1 轮判定 complete） |
| LLM 输出内容质量 | **不断言** |

### per-step timeout

`createMember` 等 async 操作可能挂起。包 `Promise.race` 加 30s 超时防测试卡死。

---

## 已知坑清单（pre-existing bugs 已修复，但新测试要 aware）

### 1. MemberState.session JSON 循环引用

`POST /team/members` 返回 `MemberState`，其中 `session` 是 `AgentSession` 对象（含循环引用）。`JSON.stringify` throw → `res.end()` 不执行 → 客户端等 body 超时。

**修复已在 main**：`http.ts` 的 `stripSession()` helper 在序列化前剥离 session。新 HTTP 路由返回 MemberState 时也要 strip。

### 2. sendJson 双重发送

handler catch 块 + 外层 createServer catch 可能对同一 response 调两次 sendJson。

**修复已在 main**：`sendJson` 加 `if (res.headersSent) return` guard。

### 3. createRealServer 不传 config

`tests/helpers/real-server.ts` 的 `createRealServer()` 不接受 config 参数。E2E 测试要自己初始化 server（见上方 ASTRON 配置）。

### 4. discussion coordinator 1 轮完成

coordinator prompt 告诉 LLM "if clear consensus, complete"。LLM 经常在第一轮就判定 complete，导致 bob/carol 没机会发言。这是预期行为，测试用 soft assert 处理。

---

## 验证清单

新测试合并前确认：

- [ ] `bun run check` 全绿（含新 unit/integration 测试，E2E 默认 skip 不影响）
- [ ] `RUN_LLM_TESTS=1 bun test tests/<新 e2e 文件>` 在 ASTRON 环境跑通（如适用）
- [ ] E2E 测试有 `describe.skipIf(process.env.RUN_LLM_TESTS !== "1")`
- [ ] 无 `console.log` debug 残留（`@ts-expect-error` 注释保留，是必要的）
- [ ] 无非必要注释（hook 会警告）
