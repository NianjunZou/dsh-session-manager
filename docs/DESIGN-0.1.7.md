# dsh-session-manager 0.1.7 设计方案

> 目标：在**不引入第二真相源**、**可逆可停用**的前提下，补齐会话拖动排序，并把会话状态从"一个点"升级为"分层来源 + 归属标签"。
> 输入：Codex 最新会话管理调研（本地实测 `codex --version`）+ DSH 近 14 天真实会话数据 + DSH `dsh-v0.2.1-alpha.5` 宿主契约核对。
> 结论先行见 §0；每条差距都有 §7 的可复现证据。

---

## 0. 结论摘要

| # | 结论 | 级别 |
|---|---|---|
| C1 | **插件接管会话区后，会话拖动排序完全不可用**——原生拖动是 HTML5 拖拽，只作用于可见的原生行；插件把原生行 `display:none` 后换成自己的 `.dsm-session-row`，这些行没有 `draggable`。这是当前最严重的功能回退。 | P0 |
| C2 | 宿主**已有**耐久排序 API `workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId?)`；但**原生 Web UI 没用它**——原生拖动只写浏览器本地视图存储 `dsh.workspace.view.v5`。插件用这个 API 可以做到比原生更耐久（跨设备/跨客户端）的排序。 | P0 |
| C3 | 宿主原生状态在 `0.2.1-alpha.5` 已经比插件更丰富：`runningSubagentCount`（"N 个子智能体正在执行"）、pending 的紧凑尾标签、hover card、定时任务节。插件目前只有 5 态单点，**在状态表达上已经落后于原生**。 | P0 |
| C4 | 主/子会话的精确真相在 `sessions.list.getSnapshot().projectionValues.subagentCatalog` / `projectionValues.subagentTiming`，**不需要**现在这种每行向上遍历全部会话的 O(N) 扫描。 | P1 |
| C5 | `subagentTiming.lastTurnCompleted === false` 且无 `active` 时，含义是"该子会话最近一个已结束回合**非正常结束**"——这是宿主自带的、耐久的子会话失败/中断信号。插件 0.1.6 声明"主子会话失败没有任何字段可读"这一结论**对子会话已不再成立**。 | P1 |
| C6 | 后台任务失败目前靠 `jobs.state.rows` 瞬时推导，任务被 owner 释放后红点消失，**不耐久**；且 `killed` 与 `failed` 的区分只对 job 有效。 | P1 |
| C7 | 渲染性能有明确隐患：`descendantIds()` 对每一行遍历全部会话，且 `render()` 由 900ms 定时器全量驱动，叠加 `MutationObserver`。近 14 天 368 个会话中 244 个（66%）是子会话，`byId` 规模会持续变大。 | P1 |
| C8 | 插件与原生在**置顶区、状态点、原生 pin 按钮**上重叠实现。宿主已原生支持 pin/archive/rename/fork 与分组顺序（`groupBy` / `orderBy` / `archivedFilter`），需要一次明确的"退让 / 叠加 / 接管"决策。 | P2 |
| C9 | **本节最关键**：会话区接管有官方路径——占用 `sidebar.workspaces` slot（`priority: -1` 即可遮蔽官方注册者，slots 规则"最低者渲染"）。本插件现在走的 DOM 覆盖是非正规路径，且会破坏 5 个依赖原生行的已发布插件。 | P1（0.3 架构） |
| C10 | **拖动会话顺序没有现成替代品**：`@dsh-xhl/workspace-groups@0.4.2` 的拖动是**工作区/分组**层级（会话行不是 drag source，它从官方拿到的 `insertSessionBefore` prop 在组件内**没有调用点**）；`dsh-session-drag-move@0.1.3` 确实调 `insertSessionBefore`，但那是**跨工作区移动**的落位步骤。→ 会话级排序仍需自研。而"子会话/后台任务状态"生态已覆盖多个切片（`dsh-subagent-progress`、`dsh-task-console`、`dsh-session-radar`、`dsh-job-progress`），需差异化，详见 §8。 | P1 |

**推荐路线**：0.2 只做两件必须做的事——**（A）拖动排序走宿主耐久 API**、**（B）状态模型升级为带归属的分层合成**；同时把 O(N) 扫描改成一次索引聚合。重叠实现（C8）先记录债务，不在 0.2 里改，避免一次动太多。

---

## 1. 基线与证据（先对齐版本，再谈设计）

### 1.1 版本对齐

| 项 | 值 | 证据 |
|---|---|---|
| DSH 应用版本 | `0.2.1-alpha.5` | `<app bundle> 的 CFBundleShortVersionString` |
| DSH 源码 checkout | `<dsh-checkout>` | — |
| 源码版本 | tag `dsh-v0.2.1-alpha.5`，工作树 **clean** | `git describe --tags` / `git status --short` |
| 插件源码 | 本仓库 `main`，version `0.1.7`（commit 见 `git log -1`） | `git log -1` |
| 安装态 | desktop profile 依赖 `@pianner/dsh-session-manager` = `0.1.6`（registry 版本，非 `link:`） | `~/.dsh/profiles/desktop/package.json` |
| 插件测试基线 | `npm test` → 46/46 pass（9.2s） | 本地运行 |
| Codex 运行时 | 桌面 App 内置 codex-cli | `codex --version` |

> ⚠️ 上一版插件契约速查表基于 `0.2.0-rc.2`。本文所有宿主结论都已在 `dsh-v0.2.1-alpha.5` 源码上重新查证。跨版本差异（`0.2.0-rc.2` → `0.2.1-alpha.5`）本身需要一次专项核对，本文只覆盖设计用到的部分。

### 1.2 插件 0.1.6 现状（关键实现事实）

- 左会话区**整体接管**：`nativeEntries()` 找到原生 `[data-row-key^="session:"]` 行，把其外层 wrapper 加 `.dsm-native-hidden`（`display:none!important`），再渲染自己的 `.dsm-session-row`。
- 状态：`statusOf(id, summary)` → `{ running, failed, pending, unread }`，然后 `primary = pending > running > failed > unread > idle`，投影成**单点 + 一条 a11y 文案**。
- `running` 合成三个来源：`uiSession.sessionStatus.running`（自己）∪ 任意后代 `byId[*].running`（子会话）∪ `jobs` roster 中 `running|stopping`（后台任务）。三者被压成同一个蓝点，**不可区分**。
- `failed` 仅来自 `jobs` roster 的 `status === 'failed'`，且要求 `!running`。
- `descendantIds(id)`：**对每一行**遍历 `byId` 全部会话并沿 `parentId` 上溯；`treeIds()` 在其上再包一层。`statusOf` 和 `reconcileJobWatches` 每轮渲染都会调用。
- 刷新：`timer.interval(render, 900)` + 4 个 store 订阅 + `MutationObserver`，全部汇到 `requestRender()` → 全量 `render()`。

### 1.3 宿主 `0.2.1-alpha.5` 已具备、而插件未使用的契约

| 宿主契约 | 位置 | 价值 |
|---|---|---|
| `workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId?)` | `packages/api/workspace-controller/src/client/service.ts:178` | **耐久**会话排序（DOM-insertBefore 语义，省略 anchor 即追加） |
| `workspaces.insertBefore(workspaceId, beforeWorkspaceId?)` | 同上 `:153` | 耐久工作区排序（原生**已经**在用） |
| `SessionSummary.projectionValues.subagentCatalog` | `packages/subagent/subagent/src/projection-types.ts` | 父会话的**直接子会话目录**，带 `mode`（one-shot / external / continuable / unknown）与 `label` |
| `SessionSummary.projectionValues.subagentTiming` | 同上 | `active`（当前未关闭回合的起止）+ `settledMs` + `lastTurnCompleted` |
| `sessions.list.getSnapshot().projectionsBySession` | `packages/api/session-controller/src/client/sessions/service.ts:691` | 未打开会话也有的投影值 |
| `uiSession.sessionStatus`（`SessionStatus`） | `packages/client/ui-session/src/client/index.ts:60` | 只有 `running` / `pendingInteraction` / `completionUnread`，**仍无失败位** |
| 原生 `SessionNode` 字段 | `packages/client/ui-workspace/src/client/tree.ts:44` | 已有 `runningSubagentCount`、`pendingInteraction`、`completed`、`pinned`、`archived` |
| 原生状态呈现 `sessionStatuses()` | `.../rows/Rows.tsx:347` | 主子双点：主点 + "N 个子智能体正在执行"；pending 有 `trailingLabel` 取代时间列 |
| 原生拖动 | `.../rows/WorkspaceBrowser.tsx:207`、`Rows.tsx:574` | `draggable`，同账户同 pinned 块内可拖，落点写**浏览器本地** store |
| `SessionActivity`（turn / subagent / job / schedule 家族） | `packages/workspace/workspace/src/types.ts:56` + 各 provider merge | 宿主最完整的"这个会话在忙什么"聚合，但**只在归档被拒时的错误 details 里**暴露给客户端 |

### 1.4 近 14 天真实使用画像

| 指标 | 数值 | 来源 |
|---|---|---|
| 会话日志总数 | 404 | `~/.dsh/sessions/**/session.v4.jsonl.zstd` |
| 近 14 天活跃会话 | 368 | `-newermt 2026-10-03` |
| **其中子会话（`delegationDepth > 0`）** | **244（66%）** | 解压各日志首行 JSON |
| 根会话（`delegationDepth == 0`） | 124 | 同上 |
| 计入 workspace 账户的会话 | 154 / 10 个工作区 | `~/.dsh/storages/workspace.json` |
| 置顶会话 | 19 | `global.pinnedSessionIds` |
| 归档会话 | 34 | `global.archivedSessionIds` |
| 单工作区最大账户 | dsh-workspace 61（另有 105 份日志） | 同上 |
| 含后台任务事件的日志 | 11 / 40 抽样 | `"type":"job/` 计数 |
| 单会话后台任务事件峰值 | 308 | 同一抽样 |

**结论**：主/子会话比例 1:2，后台任务在某些会话中高频且密集。当前"一个蓝点"的表达能力与真实使用强度严重不匹配。

---

## 2. Codex 最新会话管理调研

### 2.1 CLI 面（`0.162.0-alpha.17.2`）

```
agents     Browse all agent sessions on the shared local app-server daemon
resume     --last | --all | --include-non-interactive
fork, archive, unarchive, delete, queue, migrate-rollouts, cloud, app-server
```

要点：`codex agents` 的存在说明**会话已从"CLI 进程私有"升级为"本地 app-server daemon 上的共享资源"**；`migrate-rollouts` 对应 `history_mode: legacy → paginated` 的历史分页迁移。

### 2.2 数据模型（`~/.codex/state_5.sqlite`，本地 892 行实测）

```sql
threads(id, rollout_path, created_at, updated_at, title, cwd, source, model_provider,
        tokens_used, has_user_event, archived, archived_at,
        git_sha, git_branch, git_origin_url, agent_nickname, agent_role, agent_path,
        preview, first_user_message, name,
        recency_at, recency_at_ms,          -- 排序键，独立于 updated_at
        history_mode,                        -- legacy | paginated
        is_pinned, thread_section_id,        -- 分节
        section_position, section_entered_at_ms,
        project_id, originator, thread_source, daybreak_enabled)

thread_sections(id, name, appearance)        -- 用户可分节
projects(id, name, metadata, position, ...)  -- 项目有 position
thread_spawn_edges(parent_thread_id, child_thread_id, status)  -- 主子边
```

实测分布：

| 观测 | 值 |
|---|---|
| threads / archived | 892 / 56 |
| `recency_at != updated_at` | **831 / 892** |
| `history_mode` | paginated 823 / legacy 69 |
| `thread_section_id` 非空 | 17（全部落在唯一一节 `Pinned`） |
| `section_position` 非空 | 17 |
| `is_pinned` | 0（已被 section 取代） |
| `thread_spawn_edges.status` | open 38 / closed 61 |
| `thread_source` | user 719、subagent ~25、agent_created_thread 13、agent_forked_thread 1 |
| `tokens_used` 峰值 | 1,573,562,585 |

### 2.3 协议面（从打包产物提取的 RPC 名）

```
thread/list, thread/read, thread/search, thread/searchOccurrences
thread/archive, thread/archived, thread/delete, thread/name/set
thread/section/move, threadSection/list, createSection, listSectionThreadIds
thread/fork, thread/resume, thread/revert, thread/rollback
thread/goal/{get,set,clear,updated}
thread/queue/{add,list,update,delete,reorder,start,changed}
thread/backgroundTerminals/clean, thread/items/list
thread/compact/start, thread/compacted
thread/environment/{connected,disconnected}, thread/memoryMode/set
thread/project/updated, thread/metadata/update, thread/loaded/list
thread/realtime/*
```

### 2.4 可借鉴 vs 已不具备借鉴价值

| Codex 做法 | 对 DSH 的意义 |
|---|---|
| **排序键与"最近活动"解耦**（`recency_at` ≠ `updated_at`，93% 行不同） | DSH 的 `SessionSummary.updatedAt` 同时承担"显示时间"和"排序键"。**插件无权改这个**——属宿主改造建议，只能记为上游缺口。 |
| **分节 + 节内位置**（section + section_position） | DSH 的 `pinnedSessionIds` 等价于"预置一节"，但**没有节内位置写接口**（`pinSession` 只能前插）。要支持"置顶区内部排序"必须新增宿主 API 或接受不排序。 |
| **主子会话是一等公民**（spawn edges + status + `agent_role`/`agent_nickname`） | DSH **更强**：`parentId` + `origin` + `subagentCatalog`（含 mode/label）+ `subagentTiming`（含 active 回合与 lastTurnCompleted）。这是插件最该吃下的宿主红利。 |
| **每会话 token 计量**（`tokens_used`） | DSH 客户端 `SessionProjectionMap` 只有 `sessionListMetadata / imageLimits / modelSelection / workingDirectory / turnOutline / subagent*`，**无 token/上下文占用**。属宿主缺口，插件不能伪造。 |
| **可重排消息队列**（`thread/queue/reorder`） | DSH 有 `agent/inbox/spliced`，无队列 UI。超出本设计范围。 |
| **历史分页**（paginated 823/892） | DSH 已有 session v4 + 分页，无需借鉴。 |

---

## 3. 差距矩阵

| ID | 差距 | 级别 | 可复现证据 |
|---|---|---|---|
| **G1** | 插件接管后会话无法拖动排序；原生拖动对隐藏行不可达 | P0 | 插件 `hideNative()` 加 `display:none!important`；原生 `Rows.tsx:574 draggable={...}` 只作用于渲染中的原生行 |
| **G2** | 排序只写浏览器本地 store，跨设备/跨客户端不生效 | P0 | `WorkspaceBrowser.tsx:431 setSessionOrder(...)` → `stores.ts setSessionOrder` 只改 `dsh.workspace.view.v5`；`insertSessionBefore` 全仓库无 UI 调用方 |
| **G3** | 状态只有一个点，不能表达"谁在忙"（自己 / 子会话 / 后台任务） | P0 | 插件 `statusOf` 把三个来源压成 `running: boolean` |
| **G4** | 子会话没有归属信息（数量、mode、label、当前是否在跑） | P1 | 插件把 `origin === 'subagent'` 的行直接过滤掉，且不读 `subagentCatalog` |
| **G5** | 后台任务不可辨：看不到有几个、几个在 stopping、label 是什么 | P1 | 插件只用 `.some(...)`，丢弃 `JobView.label/progress/detail` |
| **G6** | 失败信号弱且不持久：任务被释放后红点消失；子会话失败被声明为"无字段可读" | P1 | 插件 CHANGELOG 0.1.6 声明；但 `subagentTiming.lastTurnCompleted` 对子会话可用 |
| **G7** | O(N) 扫描 + 900ms 全量重渲染 | P1 | `descendantIds()` 每行遍历 `byId`；`timer.interval(render, 900)` |
| **G8** | 拖动无键盘等价路径（原生也缺）→ 纯 a11y 增量 | P1 | 插件行只有 Enter/Space 打开 |
| **G9** | 与原生重复实现（置顶区、状态点、隐藏原生 pin 按钮、`会话→工作区` 改标签） | P2 | `hideNativePinButtons()`、`renderPinned()`、`normalizeWorkspaceSectionLabel()` |

---

## 4. 设计方案

### 4.1 设计原则（不变量，全部沿用 PLUGIN-CONTRACT.md）

1. **零第二真相源**：排序、pin、archive、选择一律走宿主；插件不落任何会话业务数据。
2. **无乐观写**：拖动后不立刻改 DOM，等宿主快照回来再渲染 → 天然无回滚逻辑，失败只需报错。
3. **fail open**：`jobs`、`projectionsBySession`、`subagentCatalog` 任一缺失都退回到更弱的表达，不报错、不插空数据。
4. **可停用**：cleanup 释放订阅 / watch / observer / timer / 自有 DOM，宿主快照前后深比较不变。
5. **不做宿主缺口**：token 用量、`updatedAt` 排序键解耦之类**不伪造**，只写进上游建议。

### 4.2 状态模型：`SessionStatusV2`（带归属的分层合成）

替换现有 `statusOf()` 的返回形状：

```js
{
  primary: 'pending' | 'running' | 'failed' | 'unread' | 'idle',
  pending: 'approval' | 'plan-review' | 'question' | undefined,
  // 归属明细：回答"谁在忙"
  activity: {
    self:      boolean,   // 本会话主 agent
    subagents: { running: number, total: number },   // 直接子会话
    jobs:      { running: number, stopping: number },
  },
  // 失败明细：回答"什么地方坏了"
  failure: {
    jobs:      number,    // 已结算为 failed 的后台任务
    lastTurnAbnormal: number,  // 子会话 lastTurnCompleted === false 且无 active
  },
  unread: boolean,
}
```

**数据来源映射（每格唯一可信来源，禁止发明）**

| 字段 | 唯一来源 | 备注 |
|---|---|---|
| `pending` | `uiSession.sessionStatus.get(id).pendingInteraction` | 最高优先级，不变 |
| `activity.self` | `uiSession.sessionStatus.get(id).running`，缺失时回落 `summary.running` | 保持现有回落顺序 |
| `activity.subagents` | `summary.projectionValues.subagentCatalog`（迭代子 id），逐个读 `byId[childId].running`；`total` = catalog 长度 | **新增**；`mode === 'external'` 不计数（宿主自己也不为它建行） |
| `activity.jobs` | `jobs.state.rows[sessionId][*].status` ∈ `running` / `stopping` | 复用现有 `watchRows`，但要**按会话+子树汇总计数**而不是 `.some()` |
| `failure.jobs` | 同上，`status === 'failed'` | `killed` 明确不算失败（用户主动中止） |
| `failure.lastTurnAbnormal` | `byId[childId].projectionValues.subagentTiming`：`active === undefined && lastTurnCompleted === false` | **新增**；耐久，不依赖 job 存活 |
| `unread` | `uiSession.sessionStatus.get(id).completionUnread` | 不变 |
| 主 agent / 根会话失败 | **仍无字段** | 继续明确声明为宿主缺口（§6 R1） |

**优先级与视觉**（单一 `primary`，写死在一处）

```
pending > running > failed > unread > idle
```

- 主点颜色：pending 琥珀 / running 蓝 / failed 红 / unread 绿 / idle 透明占位（保持 0.1.6 语义与 7px 占位，行不跳）。
- **归属徽标**（新增，主点右侧小字，仅在非 idle 时出现）：
  - `subagents.running > 0` → `N 子会话`（复用宿主"子智能体"词汇）
  - `jobs.running + jobs.stopping > 0` → `N 任务`
  - 两者同时存在则两枚徽标并列，顺序固定（子会话在左），避免布局抖动。
- **失败 tooltip**（新增）：`后台任务失败 N` / `子会话回合异常 N`，两者都进 `aria-label`。
- **pending 紧凑标签**（对齐原生）：pending 时把时间列换成"待批准 / 待计划 / 待回答"，与原生 `trailingLabel` 语义一致（插件不读原生 DOM，自己渲染同一语义）。

### 4.3 拖动排序设计（G1 / G2 / G8）

**能不能拖（全部满足才启用 `draggable`）**

1. 会话属于**真实 workspace 账户**：`workspaces.list.items` 中能找到 `workspaceId` 且 `sessionIds` 含该 id。
   - 未分组（插件 `key === ""` 分支）**不可拖**：`insertSessionBefore` 需要 `WorkspaceId`，宿主无"未分组账户"概念。
2. 非 `blank`（新建空会话由宿主置顶，不参与手动排序）。
3. 非归档（`archivedSessionIds` 不含）。
4. 落点与起点**同一账户**：宿主无"跨 workspace 移动会话"API，原生也限制同账户。

**拖拽交互**

- `dragstart`：记录 `{ accountKey, sessionId }`，行加 `.dsm-dragging`；`dataTransfer.effectAllowed = 'move'`。
- `dragover`：按行 `getBoundingClientRect()` 中线判定 `before` / `after`，渲染 2px 插入线（`.dsm-drop-before` / `.dsm-drop-after`）。
- `drop` / `dragend`：解算 anchor
  ```
  anchor = (half === 'after') ? nextAccountMemberId(targetId) : targetId
  if (anchor === sessionId || anchor === nextOf(sessionId)) → 空操作，直接结束
  await workspaces.insertSessionBefore(workspaceId, sessionId, anchor)   // anchor 为 null ⇒ 追加末尾
  ```
- **无乐观写**：不手动移动 DOM，等 `workspaces.list` 快照回流后由 `render()` 重排（宿主模型已做"局部重排请求 vs 流式顺序"的代际仲裁，见 `model.ts` 的 `orderRequestGeneration`／`orderFrameGeneration`）。
- 失败：走现有 `reportError()`，额外识别 `workspace/move-invalid`（会话或 anchor 不在该 Workspace 的手动顺序中，错误 details 带 `workspaceId` / `sessionId` / `beforeSessionId`）给出具体文案。

**键盘等价路径（a11y 增量）**

- 行上 `Alt + ArrowUp` / `Alt + ArrowDown` → 与拖放走**同一个** `insertSessionBefore` 调用（上移 = `insertSessionBefore(anchor = 前一个成员)`；下移 = `anchor = 后两个成员`）。
- 行菜单增加两项：「上移」「下移」，禁用条件与 `draggable` 一致，并带 `aria-keyshortcuts`。
- 原生只有鼠标拖拽，这条是插件可以**超过原生**的地方。

**置顶区（明确不做）**

- 宿主 `pinnedSessionIds` 是数组但**只有 `pinSession` 前插**，没有"移动 pin"API。插件不发明置顶区内部顺序，置顶区行**不可拖**，顺序 = 宿主数组顺序。
- 若产品上必须要，只能走"插件命名空间本地顺序"（`dsh-plugin:@pianner/dsh-session-manager:pinned-order`），代价是停用后顺序丢失。**默认关闭**，列为待确认项（§6 Q2）。

**与原生的互操作声明（必须写进 README）**

- 插件写的是**宿主耐久顺序**（`workspace.sessionIds`）。
- 原生 Web UI 在 `orderBy === 'manual'` 且本地已存过手动顺序时，`reconcileManualOrder()` 会让**本地顺序整体优先**（本地已保存的成员按保存顺序前置，新成员才按 recency/fork 补位），此时看不到插件的排序结果；`orderBy === 'updated'`（视图 store 的 init 默认值，实机持久值可能已被用户改成 `manual`）则一律按 `updatedAt` 排序。
- 即：停用插件后原生 UI 显示的是它自己的本地顺序，**不是数据丢失**；宿主数据完好。这一条同时应作为上游改进建议提交（§6 R2）。

### 4.4 索引与性能改造（G7）

把"每行 O(N) 上溯"换成"每次快照变更一次聚合"。

```js
// 每次 sessions/jobs 快照变化时重建一次，缓存按 snapshot 身份失效
buildIndex(listSnapshot, jobsSnapshot) -> {
  children:  Map<SessionId, SessionId[]>,   // 来源：byId[*].parentId ∪ projectionValues.subagentCatalog
  rollup:    Map<SessionId, { subagentsRunning, subagentsTotal,
                              jobsRunning, jobsStopping, jobsFailed,
                              lastTurnAbnormal }>,   // 自底向上一次后序聚合
}
```

- `statusOf(id)` 变成 `rollup.get(id)` 的 **O(1) 查表**；`treeIds(id)` 不再需要。
- 索引重建成本 O(N)，且只在快照身份变化时发生（不是每行 × 每 tick）。
- `jobs` 的 `watchRows` 集合改为从 `children` 图取子树，与索引共用一次遍历。
- **去掉 900ms 全量 `render()`**：保留订阅驱动 + `MutationObserver`；相对时间另设 60s 低频 tick，且 tick 只更新 `.dsm-time` 文本，不触发 `render()`。
- 保留 `requestRender()` 的 `setTimeout(0)` 合帧，避免订阅风暴。

### 4.5 与原生能力的去重决策（G9，0.2 只记录）

三个选项，**建议 0.2 不做改动**，仅在 README 标注现状：

| 重叠点 | 选项 A 退让 | 选项 B 叠加 | 选项 C 接管（现状） |
|---|---|---|---|
| 置顶区 | 去掉插件置顶区，用原生组内 pin 前置 | 保留但只在 `orderBy === 'manual'` 时显示 | 保留全域置顶区 |
| 状态点 | 用原生点，插件不画 | 原生点 + 插件归属徽标 | 插件自绘单点 |
| 原生 pin 按钮 | 不隐藏，用原生按钮 | — | `hideNativePinButtons()` |
| 节标签 `会话→工作区` | 不改 | — | 改文案 |

**推荐**：0.2 保留接管（现状），把"状态点"从自绘单点升级为 §4.2 的分层表达——即选项 B 的思路，但仍在插件自有 DOM 内实现，不依赖原生节点。这样 0.2 的改动面收敛在插件内部。

---

## 5. 分期落地计划

### P0（0.1.7）

| # | 工作项 | 验收标准 |
|---|---|---|
| P0-1 | 拖动排序：`draggable` 判定 + 插入线 + `workspaces.insertSessionBefore` + 失败报错 | 在 dsh-workspace 拖 2 个会话换序，刷新后顺序保持；`workspaces.list` 快照的 `sessionIds` 顺序确实改变；停用插件后原生 UI 正常、宿主数据不变 |
| P0-2 | 键盘排序：`Alt+↑/↓` + 菜单「上移/下移」 | 纯键盘可完成一次换序，`aria-keyshortcuts` 存在，焦点不丢 |
| P0-3 | 索引聚合替换 `descendantIds`/`treeIds` | 静态断言无 O(N²) 路径；相同快照下 `statusOf` 调用不重建索引 |
| P0-4 | 状态模型升级为 `SessionStatusV2`（含归属徽标、失败 tooltip、pending 紧凑标签） | 主子会话同时运行时，父行显示"正在执行"+"N 子会话"；后台任务运行显示"N 任务"；任务 `failed` 显示红点且 tooltip 说明来源 |
| P0-5 | 去掉 900ms 全量 render | 空闲时无持续重渲染；相对时间仍每分钟更新 |

### P1（0.2.x）

| # | 工作项 | 验收标准 |
|---|---|---|
| P1-1 | 吃下 `subagentCatalog`：子会话数、mode、label | 父行可显示子会话数量；`external` 子会话不计数 |
| P1-2 | 吃下 `subagentTiming`：耐久"回合异常"失败信号 | 子会话异常回合结束后，父行失败态在任务释放后仍保留 |
| P1-3 | `jobs` 明细：`label` / `progress` / `stopping` 计数进 tooltip | tooltip 能列出正在跑的任务 label |
| P1-4 | 广播/回读 `fail open` 覆盖测试 | 缺 `jobs`、缺 `projectionsBySession`、缺 `subagentCatalog` 三种主机都能加载且原生 UI 完好 |
| P1-5 | 上游建议：`SessionStatus` 增失败位；`uiWorkspace` 暴露会话活动聚合 | 作为 issue/文档提交，不在插件内绕过 |

### P2（0.3，需先确认）

- 重叠实现的去重（§4.5）。
- 自定义分节 / 节内位置（依赖宿主新增写接口）。
- 未分组账户的本地排序（需明确是否接受插件本地存储）。

---

## 6. 风险、未决项与上游缺口

| ID | 类型 | 内容 | 处置 |
|---|---|---|---|
| R1 | 宿主缺口 | **根会话 / 主 agent 失败仍无任何客户端字段**（`SessionStatus` 只有 running / pendingInteraction / completionUnread） | 明确声明不猜；`subagentTiming` 只能覆盖子会话。提上游。 |
| R2 | 宿主缺口 | 原生 Web UI 不使用 `insertSessionBefore`，手动顺序是浏览器本地（`dsh.workspace.view.v5`），且默认 `orderBy === 'updated'` | 插件写耐久顺序即可；README 说明差异；提上游建议原生改用耐久 API。 |
| R3 | 宿主缺口 | 无"置顶集内部排序"API（`pinSession` 只能前插） | 置顶区不排序；如需则走插件本地存储（默认关闭）。 |
| R4 | 宿主缺口 | 客户端无 token/上下文占用投影（Codex 有 `tokens_used`） | 不实现，不伪造。 |
| R5 | 设计约束 | `insertSessionBefore` 要求会话与 anchor 均在该 Workspace 的手动顺序中，失败码 **`workspace/move-invalid`**（details: `workspaceId` / `sessionId` / `beforeSessionId?`） | 拖动前置条件已收敛（§4.3）；错误文案区分该码。 |
| R6 | 设计约束 | `projectionValues` 对冷会话可能缺失或过期（宿主注释明示 "partial, possibly stale hints"） | 一切投影读取都做存在性判断，缺失即降级，不抛错。 |
| R7 | 验证缺口 | 本设计未在真实 DSH 窗口做过拖动/状态的行为验收；未对齐 `0.2.0-rc.2 → 0.2.1-alpha.5` 的全部契约漂移 | 落地时按 `dsh-plugin-dev` 五层验证执行，browser lane + live lane 必须补；未跑完标 `verification-gap`。 |
| Q1 | 待确认 | 0.2 是否接受"置顶区不可拖" | 待定 |
| Q2 | 待确认 | 未分组会话是否允许插件本地排序 | 待定 |
| Q3 | 待确认 | `orderBy === 'updated'` 时拖动是否自动提示用户"将切换到手动顺序" | 待定 |

---

## 7. 证据清单（可复现）

```bash
# 版本对齐
<app bundle> 的 CFBundleShortVersionString
git -C <dsh-checkout> rev-parse HEAD && git -C <dsh-checkout> status --short
git -C <plugin-dir> log -1 --format='%H %ci %s'

# 宿主契约
sed -n '100,190p' ~/deepseek-harness/packages/api/workspace-controller/src/client/service.ts   # insertSessionBefore
sed -n '340,400p' ~/deepseek-harness/packages/client/ui-workspace/src/client/rows/Rows.tsx     # sessionStatuses / 双点
sed -n '405,435p' ~/deepseek-harness/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx  # 落地只写本地 store
sed -n '168,215p' ~/deepseek-harness/packages/client/ui-workspace/src/client/tree.ts            # reconcileManualOrder
cat ~/deepseek-harness/packages/subagent/subagent/src/projection-types.ts                       # subagentCatalog / subagentTiming

# 使用画像
find ~/.dsh/sessions -maxdepth 3 -name session.v4.jsonl.zstd | wc -l
find ~/.dsh/sessions -maxdepth 3 -name session.v4.jsonl.zstd -newermt 2026-10-03 | wc -l
zstd -dc ~/.dsh/sessions/<ws>/<id>/session.v4.jsonl.zstd | head -1   # delegationDepth
node -e 'const d=require(process.env.HOME+"/.dsh/storages/workspace.json");console.log(d.global.pinnedSessionIds.length, d.global.archivedSessionIds.length)'

# Codex
codex --version
sqlite3 ~/.codex/state_5.sqlite ".schema threads"     # 只读；建议先 cp 到临时目录
rg -a -o '"thread/[a-zA-Z/]+"' <app-asar> | sort -u
```

---

## 8. 现成插件调研（生态盘点）与路线修正

调研范围：npm registry `keywords:dsh-plugin` 前 2000 条 + `awesome-dsh-plugin.com/plugins.json`（5704 条，分页抓取未完成，仅取到头部）+ 对 12 个最相关包做了**源码探针**（下载 tarball，检查是否调用 `insertSessionBefore` / `draggable` / `data-row-key` / `slots.register`）。

### 8.1 最重要的发现：会话区接管有**正规路径**，本插件走的是非正规路径

| 事实 | 证据 |
|---|---|
| `sidebar.workspaces` 是官方的 `kind: 'single', scope: 'root'` slot | `packages/client/ui-workspace/src/client/index.ts:292` |
| 官方 `ui-workspace` 以**默认 priority 0** 注册它 | 同上，注册项无 `priority` 字段 |
| slots 规则：**priority 升序，最低者渲染**；同 priority 二次注册**抛错** | `packages/client/ui-slots/src/index.ts:775`、`:1218` |
| 因此插件可用 `priority: -1` **遮蔽**官方会话区，成为正规渲染者 | 实证：`@dsh-xhl/workspace-groups@0.4.2` `lib/client.js:4142` |
| 正规渲染者能拿到官方注入的 action，**包括 `insertSessionBefore`** | 实证：同上 `:4131` `insertSessionBefore: (w,s,b) => ctx.workspaces.insertSessionBefore(w,s,b)` |

**结论**：`@pianner/dsh-session-manager` 目前用「隐藏原生行 + MutationObserver + 自绘 DOM」实现接管，这是**非正规路径**。正规路径是占用 `sidebar.workspaces` slot。

这条修正有连带影响：

1. 现在隐藏原生行会**破坏依赖原生行的第三方插件**。已证实依赖 `data-row-key` 的有：`dsh-session-drag-move`、`dsh-pinned-sessions`、`dsh-session-icons`、`dsh-session-colorful-unread-pin-jobs`、`dsh-session-radar`。
2. slot 占用天然可逆（注销即恢复），比手工记录/还原原生 `class`/`style` 更可靠。
3. 但 slot 渲染器是 React 组件，当前 777 行 vanilla DOM 需要重写 → **属于架构升级，不宜塞进 0.2**。
4. ⚠️ 若将来占用 slot，**不能也用 `priority: -1`**——与 `@dsh-xhl/workspace-groups` 同优先级会抛错，需要另取（如 `-2`）或与用户确认二选一。

### 8.2 生态清单（按与本设计的关系分类）

| 能力面 | 已有插件（版本） | 与本设计的关系 |
|---|---|---|
| **侧栏会话区接管 + 多级树（分组/项目/会话）** | **`@dsh-xhl/workspace-groups@0.4.2`** | **唯一的 `sidebar.workspaces` 竞争占位者**，与本插件互斥。但**它不做会话级排序**：拖动的 dataTransfer 类型是 `DND_CATEGORY_TYPE` / `DND_WORKSPACE_TYPE`（分组排序、工作区归类与排序），`wgSessionRow` 不是 drag source；它从官方注入拿到的 `insertSessionBefore` prop 在组件内只被解构、**无调用点**。排序结果写入**它自己的 overlay**（`dsh.workspace.groups.*`），不入宿主 `workspace.sessionIds`。 |
| 跨工作区拖拽移动（改写会话日志 header 的 `cwd`） | `dsh-session-drag-move@0.1.3`、`dsh-session-xc@0.11.4`、`dsh-workspace-mover@2.3.0`、`dsh-session-manager@0.7.2` | 另一问题域。`dsh-session-drag-move` 确实调用宿主实体 `Workspace.insertSessionBefore(sessionId, beforeSessionId)`，但**只作为移动的落位步骤**（`lib/index.js:145/200`），语义是"移入目标工作区并放到某位置"，不是同一列表内换序。同时它是**文档级 drag listener + 原生行 `data-row-key`** 的范式，佐证隐藏原生行的代价（§8.1 第 1 点） |
| 会话状态染色 / 未读 | `dsh-session-colorful-unread-pin-jobs@2.0.0`、`@cowwo/dsh-icon-custom@0.20.1`、`dsh-web-icon-indicator@0.6.0`、`dsh-pinned-sessions@0.2.0` | **G9「退让」路线的实证**：前者 README 明确写"置顶、归档与排序由 DSH 官方提供，本插件不再重复实现" |
| **子会话 / 后台任务状态原点** | **`dsh-subagent-progress@0.7.9`**（折叠子会话事件成 `subagentProgress` 投影：turn/step、最后工具）、**`dsh-task-console@0.24.0`**（jobs + subagents + session overview 浮层）、**`dsh-job-progress@1.0.5`**（每会话后台任务 done/total）、**`dsh-session-radar@1.5.0`**（六项状态读数 + 按状态键盘跳转） | **我们的「状态原点升级」若只做"点 + tooltip"，是重复劳动**；必须差异化（见 §8.3） |
| 会话管理面板（归档/删除/移动/标签/优先级/批量） | `dsh-session-manager@0.7.2`、`dsh-sessions-manager@3.7.6`、`dsh-session-kit@5.7.0`、`dsh-session-steward@0.5.3`、`@michengai/dsh-archive-manager`、`@mlgbnb/dsh-archive-manager`、`dsh-chat-manager` | 不在本设计范围 |
| 侧栏整区替换（非官方 slot 或官方 slot） | `dsh-multi-root-explorer@0.1.8`、`dsh-better-workspace@0.30.0`、`dsh-left-panel@0.2.6` | 同上；`dsh-better-workspace` 是"接管 + 让位官方补齐的能力"的成熟范例 |

> 与用户当前已装插件（`dsh-better-sidebar`、`dsh-context`、`@dingyi222666/dsh-session-notification`、`@kaoshi/dsh-preset-kaoshi`）**未发现直接冲突**；唯一硬冲突是「两个 `sidebar.workspaces` 占位者同优先级」。

### 8.3 对 §4/§5 的修正

| 原设计 | 修正 |
|---|---|
| §4.3 P0-1 从零实现拖动排序 | **维持自研，但范围收窄**：核实后确认生态里**没有**会话级同列表换序的现成实现（§8.2）。可借鉴 `dsh-session-drag-move` 的落地方式（文档级 drag listener + 读原生行 id），但写顺序必须用宿主 client service `workspaces.insertSessionBefore`——**它才是耐久源**。workspace-groups 的 overlay 排序**不能**作为我们的源（会变成第二真相源）。 |
| §4.5 G9「0.2 保留接管」 | 保留，但把「迁移到 slot 占位」正式列为 **0.3 架构升级项**（理由见 §8.1）；0.2 期间必须在 README 声明"本插件会隐藏原生会话行，可能影响依赖原生行的其他插件" |
| §4.2 状态原点升级 = 点 + 归属徽标 + tooltip | **降级为最低目标**（生态已覆盖大半）。真正稀缺、建议作为 0.2 卖点的是：<br>① **父行合成三层归属**（self / 子会话 / 后台任务同时可辨，生态里做的是独立浮层或列表，不是父行内合成）；<br>② **耐久失败**（`subagentTiming.lastTurnCompleted === false`）——12 个探针包里**没有一个**用它；<br>③ **索引化 rollup**（把 O(N) 上溯换成一次聚合）——生态里未见讨论，是纯工程质量收益 |

### 8.4 新识别的问题

| ID | 问题 | 级别 |
|---|---|---|
| G10 | 架构级：DOM 覆盖 vs 官方 slot 占位（`sidebar.workspaces` + `priority`） | P1（0.3） |
| G11 | 生态互斥：本插件隐藏原生行会破坏 `dsh-session-drag-move` 等 5 个已知插件 | P1 |
| G12 | 生态重复：若只做"状态点/tooltip/未读"，与 `dsh-session-radar`、`dsh-subagent-progress` 高度重叠 | P1 |
| G13 | 与 `@dsh-xhl/workspace-groups` 的 `priority: -1` 冲突（单 cell 同优先级抛错） | P2 |
| Q4 | 待确认 | 0.3 是否做 `sidebar.workspaces` slot 架构迁移（React 重写，一劳永逸解决互斥与可逆性）？ |
| Q5 | 待确认 | 状态侧是否接受"只做自研独有的两点"（父行三层归属合成 + `subagentTiming` 耐久失败），其余不重复生态已有能力？ |
| Q6 | 待确认 | 是否需要在 README 明确声明"本插件会隐藏原生会话行，与依赖原生行的插件（已知 5 个）不兼容"？ |

### 8.5 「投影式覆盖」vs「slot 占位」的可逆性辨析

本插件选投影式覆盖（隐藏原生行 + 自绘 DOM）的理由是"避免插件启用对 DSH 造成不可恢复的影响"。**目标正确，但推理需要修正**——两种方案都不写宿主数据、都只改内存，刷新/重启都回到原生；差别在另外两处。

| 事实 | 证据 |
|---|---|
| `single` 槽位的胜出者是"priority 升序的**第一个存活条目**" | `packages/client/ui-slots/src/index.ts:1281-1284`（"a cell's winner is its first occurrence"） |
| 因此插件注册项一旦注销/停用/重载，官方 `priority: 0` 的注册**自动回位**，无需任何还原代码 | 同上；对位实证见 `@dsh-xhl/workspace-groups` 的 `priority: -1` |
| 投影式覆盖是**唯一需要手工还原**的一方：隐藏 wrapper、改节标签、隐藏 pin 按钮、写 `title`，全靠 `cleanup()` 逐一还原，且要先记录原值 | 本插件 `hideNative` / `hideNativePinButtons` / `normalizeWorkspaceSectionLabel` / `decorateWorkspacePaths` |
| 遮蔽 `sidebar.workspaces` 的代价：官方把 4 个子槽作为**它自己注册的 children** 声明，遮蔽者必须自己重渲染，否则官方菜单项与悬停按钮消失（"declaring is claiming"） | `ui-slots/src/index.ts:800-802`；官方声明的 children 见 `ui-workspace/src/client/index.ts:292-303` |

**结论**：投影方案的优势只在"插件自身渲染抛错时不自伤"；在**退出恢复的确定性**和**对外影响面**上都不如 slot 占位。

| 比较项 | slot 占位 | DOM 投影（现状） |
|---|---|---|
| 退出恢复 | 注销即回位，零还原代码 | 依赖 cleanup 完整还原；未跑则原生行残留 `display:none`（刷新恢复） |
| 插件自身坏掉 | 会话区整体空白（设置页 / CLI 仍可停用） | 部分原生行残留隐藏 |
| 对外影响 | 官方子槽需自行重渲染 | **已知影响生态**：≥5 个插件依赖原生会话行 DOM，其中 4 个直接读 `data-row-key`（`dsh-session-drag-move`、`dsh-pinned-sessions`、`dsh-session-colorful-unread-pin-jobs`、`dsh-session-radar`），另有 `dsh-session-icons` 依赖原生标题 DOM |
| 实现代价 | React 重写 + 重新声明子槽 | 现状 |

**处置**：经官方文档核对（见 §8.6），投影方案**不符合** DSH 客户端组件的扩展面要求，而 slot 占位是文档承认的替换点且天然可逆。因此原"0.2 保留投影"的建议**撤回**，改为：

1. 只要动会话区接管，就走 `sidebar.workspaces` slot（`priority` 取小于 0 且与 `@dsh-xhl/workspace-groups` 的 `-1` 不冲突的值）。
2. 迁移期间若仍需保留投影作为过渡，必须在 README 声明"使用非文档化 DOM 投影"，并列明受影响的 4+1 个插件（对应 Q6）。
3. `cleanup()` 幂等 + `error` / `unhandledrejection` / `pagehide` 兜底 restore —— 迁移完成后这条降级为过渡态要求。

### 8.6 文档合规判定（`dsh-v0.2.1-alpha.5` 官方 docs + 生成的 slot catalog）

| 判定项 | 结论 | 依据 |
|---|---|---|
| 用 `priority` 遮蔽 `sidebar.workspaces`（占用官方 single cell）替换会话区 | **符合** | 生成的 slot catalog 把该 key 标为 `kind: 'single'`、`occupants: ['client-ui-workspace WorkspaceBrowser']`、`replaceRisk: 'shadows-shipped-ui'`，并直接给出 `ctx.slots.register({ name: 'sidebar.workspaces' }, …)` 的示例 → 替换是**被编目、被承认**的操作，风险需声明而非禁止（`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:4465-4494`） |
| 遮蔽后的可逆性 | **符合，且优于投影** | `docs/subsystems/slots.zh.md`：「复用已有 cell 表示**有意替换其展示**」「将 `single` 和已有 occupant 的 keyed cell 视为**替换点**」；「注册和声明遵循 Cordis effect 生命周期。**销毁一个 entry 会移除其贡献**，并递归折叠它声明的 child slots」 |
| DOM 投影（`querySelector` 找原生行 + `MutationObserver` + 隐藏原生行 + 自绘 DOM） | **不符合** | `docs/defensive-patterns/client-components.zh.md`「每层共享代码各有自己的隔离度」表：对 `ui-renderer` 及其他渲染机制，「业务代码不产生值依赖；**只经文档化的注册面扩展——slots、provide/inject 绑定的 hooks、声明的 store**」；同文正例写明"功能自己拥有行渲染与排序规则"（即应作为 slot occupant 自渲染）。全 `docs/` 目录检索 `MutationObserver` / `querySelector` **无任何条款许可**改写官方渲染 DOM |
| 跨插件协作 | **不符合** | 同表：「另一个功能插件 \| **不运行时导入、也不重新导出它的值**。UI 经 slots 跨越」。投影式隐藏原生行属于对其它 occupant 渲染结果的运行时干预 |

**迁移到 slot 后仍需满足的其它文档要求**（当前实现均不满足）：

| 要求 | 依据 | 当前状态 |
|---|---|---|
| 注册物是**模块作用域稳定 function component** | client-components §"slot 注册物是稳定的 function component" | 现在是 vanilla DOM 自绘，无组件身份 |
| 状态经**注册项 `inject` 面**到达；裸 observable 放保留的 `hooks` 隔间 | client-components §"状态经 Injection 到达" / slots §"开发者提供的 injection" | 现在直接读全局 service/store 快照 |
| 组件**绝不接收 `ctx`**；`ctx` 只活在 `apply` 闭包 | client-components §"组件绝不接收 Cordis context" | 不适用（无组件），迁移后必须遵守 |
| 用户可见文案走注册项 **`locale` namespace**（`t`） | slots §"组件输入" | 现在是硬编码中文 `STRINGS` 表 |
| 样式走 **CSS Module**，TSX 不内联大文本 | client-components §"构建与样式各归其主" | 现在把整段 CSS 作为 JS 字符串注入 `<style>` |

### 8.7 顺带查出的 manifest 合规问题（与重构路线无关，应独立修复）

| 问题 | 证据 | 影响 |
|---|---|---|
| `dsh.client.inject` 声明了**不存在的包** `@deepseek-ai/dsh-client-runtime` | 全 DSH 仓库检索该字符串为空；已发布的 0.1.6（profile 内装机副本）仍是该值 | 客户端模块的**加载顺序依赖未声明**，目前只是"碰巧能跑"；CHANGELOG 0.1.1 声称已改为真实包名，但改动未落到 `package.json` |
| 官方正确写法 | `packages/client/ui-workspace/package.json` 列 12 个真实包（`@deepseek-ai/dsh-client-ui-session`、`@deepseek-ai/dsh-api-session-controller`…） | 本插件至少应声明 `dsh-client-ui-session`、`dsh-api-session-controller`、`dsh-api-workspace-controller`、`dsh-client-locale` |

---

## 9. 0.1.7 架构决策（ADR）

### 9.1 决策

0.1.7 不做 DOM 投影，改为**占位官方 `sidebar.workspaces` slot**（`kind: 'single'`，宿主 `priority` 默认 0，占位者取更小的值；**不能取 `-1`**——`@dsh-xhl/workspace-groups` 已用该值，同 cell 同优先级注册会抛错，本插件取 `-2`）。

### 9.2 为什么必须是"渲染者"而不是"叠加者"

| 需求 | 只有渲染者能做 | 证据 |
|---|---|---|
| 可见的动态会话排序 | 是 | 原生 `reconcileManualOrder` 的序列来自「浏览器本地已保存顺序 + 置顶 + 最近活跃」，**从不把宿主 `workspace.sessionIds` 当序列读**（`packages/client/ui-workspace/src/client/tree.ts:168-215`）。所以写 `insertSessionBefore` 在原生 UI 里几乎不可见——要让人看见，必须自己排。 |
| 非 idle 行的额外状态点 | 是 | 官方唯一给"行内额外标记"的座位 `sidebar.session.row.leading` **仅在行 primary 状态为 idle 时挂载**（`ui-workspace/src/client/contract/slots.ts:122-131`），running/pending 行无法追加标记。 |

### 9.3 必须接受的代价：5 个子槽被孤儿化

`sidebar.workspaces` 的 occupant 是排他的。这 5 个子槽由 **ui-workspace 的注册项**声明，遮蔽者**无法重新声明**——`register({children})` 对已声明的 child 直接抛 `slot "X" is already declared`（`packages/client/ui-slots/src/index.ts:1245-1252`），因此它们既不会被官方渲染，也不会被我们渲染：

| 子槽 | 启用插件期间消失的内容 | 注册方 |
|---|---|---|
| `sidebar.workspaces.directoryFlow` | 官方目录流（原生选择器 + 应用内目录浏览器） | `ui-directory-picker-native` / `-browse` |
| `sidebar.workspaces.session.menu.item` | 官方 5 条菜单（pin/rename/fork/archive/session-id）+ **第三方**注册的菜单项 | `ui-workspace` / 第三方 |
| `sidebar.workspaces.session.row.action` | 官方行内悬停按钮（归档 / 置顶）+ 第三方的 | `ui-workspace` / 第三方 |
| `sidebar.session.row.leading` | 官方 `ui-schedule` 的定时任务标记 | `ui-schedule` |
| `sidebar.session.row.hover` | 官方 `ui-schedule` 的定时任务列表 | `ui-schedule` |

**缓解**：

1. 官方 5 条菜单与"复制工作目录 / 上移 / 下移"由本插件自实现（0.1.6 本就自实现菜单，能力不倒退）。
2. 目录流（添加工作区）自实现：复用官方目录服务（`ctx.remote.directoryPicker` 或 workspace 的 `create({path})`）。
3. **定时任务标记不可复刻**：`ui-schedule` 的标记读它自己 manager 的内部 `hooks.catalog`，客户端没有等价公开投影（`ui-schedule/src/client/index.ts:231-243`）。这是 0.1.7 的**已知缺口**，写进 README 与 CHANGELOG；若之后 `@deepseek-ai/dsh-schedule/client` 暴露公开目录，再补。
4. 装/卸行为**不可能完全一致**——差异来自屏蔽他人贡献，不是来自我们画得好不好。README 必须写明。

### 9.4 交付形态与构建

宿主的 `require(spec)` **只解析平台 seed、已物化模块与已注册的包工厂**，不支持同步相对路径（`packages/client/modules/src/client/system.ts:325-338`），所以 client 入口必须是**单文件**。

- `src/client/core.js` — 纯派生层（ESM，`node --test` 直接单测，无 DOM/无 React）
- `src/client/body.js` — client 主体（CJS 风格：`require('react')` 等外部件 + 全部组件与 `apply`）
- `scripts/build-client.mjs` — 零依赖打包：剥离 `core.js` 的 `export ` 前缀后与 `body.js` 一起包进 `window.__ModuleLoader__.load({ id, factory })` 外壳，产出 `client/client.js`
- `client/client.js` 为**生成物但入库**（npm 包无需消费者构建）；`verify` 先构建，并用一条「产物与新鲜构建一致」的测试守住漂移
- 构建守卫：`core.js` 出现 `import` / `export default` / `export {` 时构建直接失败

### 9.5 状态点设计（一行一个点 + 悬停说明）

主点复用官方 `StateDot` 的五态词汇，一行只画一个。点只回答"这行有没有在动、是不是在等我、有没有
完成没看"，不试图在一行里塞下四个圆点：

| 语义 | 视觉 | token / 组件 |
|---|---|---|
| 等待用户（批准 / 计划 / 回答） | `StateDot` `warning` + 尾标签 | `--dsw-alias-state-warn-primary` |
| 有活在跑（本会话 agent / 子会话 / 后台任务，任一） | `StateDot` `ongoing` | 官方 `StateDot` 自带 |
| 已完成未读 | `StateDot` `done` | `--dsw-alias-state-success-primary` |
| 空闲 | `StateDot` `idle`（官方中性灰点，每行恒有） | `--dsw-alias-state-idle-primary` |

优先级唯一：`pending > running > unread > idle`。运行中时"谁在跑、跑了几件"不画图形，而是由
`statusOf(...).activity` 拼成一句话放进主点的 `title`（与读屏文案同源）：

```
正在执行，1 个子会话执行中，1 个本会话的后台任务执行中，2 个子会话的后台任务执行中
```

后台任务在 rollup 里按归属拆成 `jobs.own` / `jobs.subtree`，所以这一句话能说清"是谁的任务"。
**为什么不做限定标记**：0.1.7 早期在行内给每类活动各画一个点（含"蓝环 + 琥珀芯"），实测四个圆点
并排比一句话更难读，且同一事实容易看起来像两件事（转圈 + 琥珀点）。失败态同理不画（见 §9.6 与
USAGE 的说明）。

### 9.6 有意为之的行为变化

- 相对时间改用宿主共享的 bucket 集（`now|minutes|hours|days|months|years`，**无 `weeks`**），替换 0.1.6 的「周」档：同一会话在所有 DSH 界面里读法一致。单元测试锁死该行为。
- 状态色不再使用 0.1.6 的 `--dsw-alias-blue/green/red` + 硬编码回退，改用官方 `--dsw-alias-state-*`。

---

## 附：与 0.1.6 CHANGELOG 声明的一处修正

CHANGELOG 0.1.6 写：

> A failed main agent or subagent is deliberately NOT marked: `SessionStatus` and `SessionSummary` carry no failure flag

**前半句对主 agent 仍然成立；后半句对 subagent 已不成立。** `SessionSummary.projectionValues.subagentTiming.lastTurnCompleted === false`（且 `active === undefined`）是宿主自带的、耐久的"最近一个已结束回合非正常结束"信号，不需要解析会话日志。P1-2 即为此项。
