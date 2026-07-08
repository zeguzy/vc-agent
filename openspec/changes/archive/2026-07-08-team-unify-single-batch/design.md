## 背景

`src/tools/team.ts` 当前有三对 handler，每对的核心逻辑重复：

| 单条 | 批量 | 共享的核心操作 |
|------|------|----------------|
| `handleCreate` | `handleCreateBatch` | `createMember` (+ 可选 `assignTask`) |
| `handleAssign` | `handleAssignBatch` | `assignTask` |
| `handleDirect` | `handleDirectBatch` | `directMember` |

重复部分：调 `TeamManager`、异常转字符串。
**不重复**部分（已在现状核实）：
- 必填字段校验：仅单条 handler 做（`name/role/goal` 等，返回特定字面量 `"X is required for Y"`）；批量循环内**不做 per-item 字段校验**，靠 `createMember`/`assignTask`/`directMember` 抛异常进 `failed` 桶
- 批量专属：数组非空校验、容量前置检查、软上限、per-item 失败隔离、汇总文本格式

## 设计目标

1. **核心调用逻辑只有一份** —— 每对 handler 共享一个私有核心函数
2. **外部行为完全不变** —— spec `team-orchestration` 对单条/批量各自的返回格式、错误语义、字面量都有 Scenario 锁定
3. **批量外壳保留** —— 容量检查、软上限、失败隔离继续在 batch handler 里

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│ createTeamTool().execute(args)                              │
│   外层 try/catch（不变）                                     │
│   switch(args.action) {                                     │
│     case "create":        handleCreate(manager, args)       │
│     case "create-batch":  handleCreateBatch(manager, args)  │
│     ...                                                     │
│   }                                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 核心函数（私有，单一职责：对单个目标调一次 Manager）          │
│ 【不做字段校验】—— 字段校验是调用方的责任                    │
│                                                              │
│  createOneMember(manager, spec) → CreateOneResult            │
│    spec: {name, role, goal, constraints?, tools?, skills?,  │
│           mcps?, taskTitle?, taskDescription?,               │
│           taskPriority?}                                    │
│    - try { state = await createMember({...直接赋值}) }       │
│      catch → {ok:false, error}                              │
│    - if taskTitle: try { task = assignTask({...}) }          │
│      catch → {ok:true, state, taskId:null, taskWarn}        │
│    - 成功 → {ok:true, state, taskId: task?.id ?? null}      │
│                                                              │
│  assignOneTask(manager, spec) → CoreResult                  │
│    - try { task = assignTask({...}) } catch → {ok:false}    │
│    - 成功 → {ok:true, taskId: task.id}                      │
│                                                              │
│  directOneMessage(manager, spec) → CoreResult               │
│    - try { directMember(...) } catch → {ok:false}           │
│    - 成功 → {ok:true}                                       │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
┌──────────────────────┐                ┌──────────────────────┐
│ 单条 handler          │               │ 批量 handler          │
│ 1. 字段校验（原字面量）│                │ 1. 数组非空校验       │
│ 2. 调核心 1 次        │                │ 2. 软上限校验         │
│ 3. 失败 → err()       │                │ 3. 容量前置（create） │
│ 4. taskWarn → err()   │                │ 4. 循环调核心 N 次    │
│   （复现原冒泡 isError）│               │ 5. per-item 填桶      │
│ 5. 成功 → 单行格式    │                │ 6. taskWarn → succeeded│
└──────────────────────┘                └──────────────────────┘
```

## 关键设计决策

### D1：为什么是「提取核心函数」而不是「单条直接调批量 handler」或「保持重复」

四个候选方案对比：

| 方案 | 说明 | 否决/采纳理由 |
|------|------|---------------|
| **A. 单条直接调批量 handler** | 单条包成单元素数组调 batch handler | ❌ 否决。① batch handler 返回列表式（`Created N member(s):\n  ✓ ...`），单条是简洁单行（`Member "x" created...`），spec 双向锁定，不能合并；② batch 入口的容量前置（`currentCount + len > maxWorkers`）和软上限（`> 20`）对单条语义错误，会产生 "Batch rejected: capacity exceeded" 错误消息；③ batch 的 per-item 失败隔离对单条无意义 |
| **B. 批量 handler 内部判断 length===1 走单条分支** | hack | ❌ 否决。batch 入口的容量/软上限检查仍会先执行，污染单条语义 |
| **C. 保持重复** | 不动 | ❌ 否决。当前三对重复约 100 行（调 Manager + 异常转换），历史已出过漏改坑（`constraints` 字段后补到两边各一次）。保持重复=持续债务 |
| **D. 高阶函数（makeHandler）** | `definePairedHandler({core, singleFmt, batchFmt})` | ❌ 暂不采纳。3 对 handler 的格式化逻辑差异足够大，强行抽象成高阶函数会让参数列表变长、可读性下降。提取普通核心函数已消除主要重复（Manager 调用 + 异常转换），ROI 合适 |
| **✅ E. 提取私有核心函数** | 本设计 | 采纳。消除"调 Manager + 异常转 CoreResult"的重复，单条/批量各自保留格式化逻辑，职责清晰 |

### D2：核心函数的返回类型

assign/direct 用通用判别联合：

```typescript
type CoreResult =
  | { ok: true; taskId?: string }      // assign 需要 taskId；direct 不需要
  | { ok: false; error: string };
```

create 因为有"成员成功 + 任务失败"的部分成功语义，用独立类型承载 `taskWarn`：

```typescript
type CreateOneResult =
  | { ok: true; state: MemberState; taskId: string | null }                             // 全成功
  | { ok: true; state: MemberState; taskId: null; taskWarn: string }                    // 成员成功 + 任务失败
  | { ok: false; error: string };                                                       // 成员失败
```

`taskWarn` 不污染通用 `CoreResult`（assign/direct 无部分成功），保持判别性。

### D3：必填字段校验——【核心函数不校验，留在单条 handler】

**原 design 草案曾提议"必填校验收敛到核心函数"，经 Oracle 评审 + 代码核实后废弃**。

**废弃理由**（基于实际代码 line 300-302, 466-467, 538-540）：
- 单条 handler 做字段校验，返回特定字面量：`"name is required for create"`、`"title is required for assign"`、`"kind is required for direct"` 等
- 批量循环内**不做 per-item 字段校验**，字段缺失靠 `createMember`/`assignTask`/`directMember` 抛异常进 `failed` 桶
- 两边校验机制和错误来源完全不同。若收敛到核心函数，要么改变单条字面量，要么改变批量错误来源，**都会破坏外部行为**

**新约定**：
- 核心函数契约：**调用方保证字段已校验**。核心函数仅负责「调 TeamManager + 异常转 CoreResult」
- 单条 handler：保留原字段校验（字面量逐字不变），校验通过后调核心函数
- 批量 handler：保留原"数组非空 + 软上限 + 容量前置"，循环内不做字段校验（与原行为一致），靠核心函数转异常为 CoreResult

### D4：`createMember` 传参统一为「直接赋值」

**原 design 草案曾说"保持完全相同传参"，经 Oracle 评审后发现单条和批量原本传参写法就不同，无法"完全相同"**。

现状差异：
- 单条（line 316-318）：条件展开 `...(tools ? { tools } : {})` —— tools 为 undefined 时不传该字段
- 批量（line 403-405）：直接赋值 `tools: m.tools` —— tools 为 undefined 时传 `tools: undefined`

**已验证 TeamManager.createMember 对 `undefined` 和字段缺失等价处理**（manager-v2.ts:175-177）：
```typescript
const assignedTools = filterMemberTools(opts.tools);      // 接受 undefined
const assignedSkills = (opts.skills ?? []).filter(...);   // ?? 处理 undefined
const assignedMcps = this.resolveMcps(opts.mcps);         // 接受 undefined
```

**新约定**：核心函数统一用直接赋值（`tools: spec.tools, skills: spec.skills, mcps: spec.mcps`），与批量写法一致。因 TeamManager 侧对 undefined 等价，单条外部行为不变。

其他固定占位参数逐字复制：`constraints: spec.constraints`、`model: undefined`、`services: {} as never`、`parentModel: undefined`（不趁机清理 `as never` 技术债，超范围）。

### D5：taskWarn 单条语义——【复现原异常冒泡 → isError:true】

**原 design 草案曾说"单条 taskWarn 转整体 ok"，经代码核实后纠正为相反语义**。

**现状**（line 321-332）：单条 `handleCreate` 的 `assignTask` 调用**没有 try/catch**。assignTask 失败时异常冒泡到外层 `execute` try/catch，最终返回 `isError: true`。

即原行为：**单条 create 带任务且任务失败 → isError:true（整体失败）**。

**新约定**：
- 核心函数 `createOneMember` 把 `assignTask` 包在 try/catch 里，成员已成功 → 返回 `{ok:true, state, taskId:null, taskWarn: error}`（不丢失"成员已创建"的副作用信息）
- **单条 handler** 收到 `taskWarn` → 用 `err()` 包装返回 `isError:true`（复现原冒泡语义，错误消息用 taskWarn 字符串）
- **批量 handler** 收到 `taskWarn` → 填 succeeded 桶带 taskWarn（原行为，line 426-432）

### D6：tool description 不改

`createTeamTool` 返回的 `description` 字段是 LLM 看到的工具说明。本次是纯内部重构，description 字面量一个字不改，避免 LLM 的 action 选择行为漂移。

## 风险与边界（已逐条核实）

| 风险 | 应对（已落实） |
|------|------|
| 重构后单条返回字面量变了 | 新增单测逐字断言单条返回文本（见 tasks 5.1） |
| 必填校验字面量错位 | D3 已废弃收敛，字段校验留单条 handler，字面量逐字不变 |
| taskWarn 单条语义反转 | D5 已纠正：单条收 taskWarn → isError:true（复现原冒泡） |
| createMember 传参差异 | D4 已验证 TeamManager 对 undefined 等价，统一用直接赋值 |
| 核心函数吞了原本应抛的异常 | 核心函数 try/catch 转 CoreResult.error（`e instanceof Error ? e.message : String(e)`，与原 line 408/430/508 等处写法一致），单条用 err() 包装，批量填 failed 桶，语义等价 |
| 批量容量检查被误移入核心 | 核心函数不接收数组，物理上无法做容量检查 |

## 性能

无影响。核心函数是同步内联调用（`directOneMessage`/`assignOneTask`）或单次 await（`createOneMember`），与原 handler 调用次数完全一致。批量场景仍是顺序循环，无并行化（`createMember` 有容量状态依赖，`directBatch` spec 明确要求串行）。

## 可维护性收益

- 三对逻辑从 6 份降到 3 份核心 + 6 个薄外壳
- 未来给 create 加字段（如新的透传字段）只改 `createOneMember` 一处，单条/批量同时生效，消除「漏改另一边」的整类 bug
- `CoreResult` / `CreateOneResult` 判别联合让单条/批量的分支处理类型安全
