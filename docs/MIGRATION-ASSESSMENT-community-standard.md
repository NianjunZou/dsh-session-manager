# 社区标准可迁移性评估（dsh-session-manager × dsh-community-standard Draft v0.15）

> 评估口径：`dsh-plugin-dev` v0.3.0 的「可迁移性」要求（`references/community-standard.md` §5/§6）
> × `oh-my-dsh/dsh-community-standard` @ `34bffb18c4162987db9d429e8e44d8ada50efeba`（Draft v0.15，**非官方**，2026-08-20 快照）。
>
> 对象：`@pianner/dsh-session-manager` v0.1.7（本仓库，client-only 插件）。
> 方法：只读静态分析 + 本机验证（`DSH_SOURCE=<dsh-checkout> npm test` 124 通过，宿主 checkout `dsh-v0.2.1-alpha.5`）。
> 性质：**评估报告，不改代码**；下文「建议」均未执行。

## 0. 结论摘要

| 维度 | 现状 | 标准对应 | 迁移成本 |
|---|---|---|---|
| 数据真相源 | 全部读写宿主 service/store，零私有持久化 | 无冲突（标准的 storage 隔离精神已满足） | 无 |
| 生命周期/可逆 | `ctx.effect` + disposer，2 处 effect 全返回清理函数 | 对齐 effect ledger 语义 | 无 |
| patch 点 | 无源码 patch / 无内部事件名 / 无私有通道 | 标准已消灭的对象本就不存在 | 无 |
| UI 覆盖方式 | 占宿主根 slot `sidebar.workspaces`，不编辑宿主 DOM | ≈ `views.dsh`（v0.16 目标条目） | 中（等 views 条目定稿） |
| 身份 | npm scope `@pianner/dsh-session-manager` | `dsh-plugin.json#id` 要求反向域名 | 高（三元耦合 + profile + 发布身份） |
| 兼容声明 | `peerDependencies` 包名 + 版本区间 + `dsh.client.inject` | facet `apiVersion` + 契约坐标精确匹配 | 高（结构性差异，需契约层出现） |
| 静态可协商性 | 无 `dsh-plugin.json` | manifest + 协商纯函数 | 高（当前宿主不消费，只能预置） |

**判断**：代码结构对标准是友好的（无 patch 流派历史包袱，宿主角色的边界已经切开），迁移的主要成本不在代码，而在**身份坐标**与**契约声明机制**——而这两项依赖标准/宿主真正落地。现在做「预置准备」收益有限、破坏面大（见 §7）。

## 1. patch 点清单（标准 migration 指南的六类）

| # | 类别 | 本插件现状 | 证据 | 标准对应 |
|---|---|---|---|---|
| 1 | patch / monkey patch 宿主源码 | **无** | 无源码 patch、无 host 文件改动；`src/index.js` 仅导出空 `apply()` | 无合法对应物（本就不需要） |
| 2 | 硬编码内部事件名订阅 | **无** | 无 `ctx.on(…)` / 事件字符串订阅；状态经宿主 hook 绑定（`props.useSessionStatus` 等） | `messages.dsh/v1alpha1`（用不上，因为不观察事件） |
| 3 | 内部服务探测（`ctx.get` 反射） | **1 处，且是有意的可选服务**：`ctx.get('jobs')` | `src/client/body.js:1734`（`useJobs` 兜底）、`:1799`（`watchRows` 每次重取）；另有 `inject` 声明的必需服务 `slots/sessions/workspaces/uiWorkspace/uiSession/locale`（`:1708`） | 标准暂无「可选服务降级」条目；宿主角色的 contract 化在 RFC 0006 / `requirements.contracts` |
| 4 | 直接读写文件 / 宿主目录 | **无** | 无 `fs`、无 `localStorage`/`indexedDB`；插件私有状态 `priorityStore` 仅在内存（`body.js:117`、`:1758`） | 若将来要持久化 → `storage.dsh/v1alpha1`（LocalStorage），现在不适用 |
| 5 | 内部 UI / 命令注册 | 占根 slot + 用宿主 primitives + 注册 locale | `ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({…}))`（`:1786`）；`require('@deepseek-ai/dsh-client-ui-primitives')` 取 `Menu/StateDot/Modal/icons`（`:22-34`）；`ctx.locale.register`（`:1715`）；自建 `<style data-dsh-session-manager>`（`:1717-1722`，随 effect 清理） | slot/视图 → `views.dsh/v1alpha1`（登记记录指向 v0.16）；primitives/locale → 标准暂无；DOM/样式归属已符合「effect 可枚举、可清理」 |
| 6 | 自建通道（HTTP/WS/私 RPC/observer） | **无** | 无 `fetch`/`WebSocket`/`MutationObserver`/`postMessage` | 不适用 |

补充：`dsh.bundle.patch`（`cordis.patch.yml`）与 `dsh.client`（platform/inject）是当前宿主的加载面，标准里对应 `facets` + `webseeds` 的一部分，但**安装/打包/加载机制标准未定义**（`spec/manifest.md` §1 明确不在范围）。

## 2. 身份映射（改 id 的连带面）

| 项 | 当前值 | 标准要求 | 若迁移 |
|---|---|---|---|
| `package.json.name` | `@pianner/dsh-session-manager` | `dsh-plugin.json#id` 反向域名（如 `com.nianjunzou.dsh-session-manager`，示意） | 改 name = 破坏性（已发 npm 0.1.7；标准也要求「发布过的版本不可覆盖」） |
| client 模块 id | `@pianner/dsh-session-manager`（构建常量 `PLUGIN_ID`） | 与 manifest id 同源 | `scripts/build-client.mjs` 单点改 |
| bundle `name` | `@pianner/dsh-session-manager`（`cordis.patch.yml`） | 同上 | 同步改 |
| profile 登记 | `<profile>/package.json` 依赖键 + `dsh.profile.bundles` | 标准未定义安装机制 | 需 pnpm 收敛 + 重启验证 |

三元耦合在构建期由 `PLUGIN_ID` 单点保证，测试有断言（`identity is one thing across package, client module id and bundle name`）。**结论：技术上易改，生态上代价高**——npm 名前缀是已发布身份，反向域名 id 只能作为未来 `dsh-plugin.json#id` 的并列声明，不宜现在改包名。

## 3. 能力面映射

| 标准条目（Draft） | 本插件是否用到 | 说明 |
|---|---|---|
| `views.dsh/v1alpha1`（ViewContribution） | **是（形态最接近）** | 根 slot `sidebar.workspaces` 的替换区域 + 自绘行/分组；但标准 view 模型指向声明式 contributions，宿主侧尚未实现 |
| `webseeds.dsh/v1alpha1`（SeedModules） | **部分** | 只 `require` 3 个种子：`react`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`；未打包宿主种子（build 脚本有纯度门禁） |
| `commands.dsh/v1alpha1` | 否 | 行菜单动作是插件内部 UI，不是全局命令；未注册宿主命令 |
| `storage.dsh/v1alpha1` | 否（内存态） | 若未来要跨会话记住置顶分组显示偏好，再落 storage；当前内存即弃，符合「可清理」 |
| `messages.dsh/v1alpha1` | 否 | 不观察消息事件 |
| `themes.dsh` / `urlstate.dsh` | 否 | 不开主题、不写 URL 状态 |

## 4. 兼容声明差异（最实质的架构差异）

- 现在：`peerDependencies` 用宿主**包名 + 版本区间**表达兼容（`>=0.2.0-alpha.0 <0.3.0`），另有 `dsh.client.inject` 列出 11 个宿主包；判定由 npm/pnpm 与宿主加载器做，粒度是「包 + 版本」。
- 标准：兼容 = facet `apiVersion` 支持 + `requires.contracts` 的 `apiVersion+kind` **精确**匹配，`peerDependencies` 式产品版本区间**不参与**兼容判断（`VERSIONING.md` §1.1）。
- 影响：本插件当前把「宿主能力」表达成「11 个包名依赖 + slot/primitives 名字」，这是实现面耦合；alignment lane 已把这些耦合变成**可发现、可失败**的断言（11 条测试），因此「靠版本区间漂移而不自知」的风险已被工程化控制。标准落地后需要额外一层「契约坐标声明」，但这一步依赖宿主实现协商器，**现在无法验证**。

## 5. 生命周期 / effect ownership 对照

| 标准语义（`spec/lifecycle.md`） | 本插件 | 差距 |
|---|---|---|
| eager activation（组装即激活） | 是：`apply` 注册 region，随 entry 生命周期 | 无 |
| effect ledger（每个 effect 可归属、可查清理） | 部分：2 处 `ctx.effect` 均具名并返回 disposer；DOM 样式带 `data-dsh-session-manager` 标记 | 无「账本」可查询性（宿主未提供），但归属语义已满足 |
| cleanup 可重复执行 | 是 | 无 |
| activation 状态机 / 协商 / 授权 | 宿主当前无此阶段 | 不适用（宿主未实现标准） |

## 6. 若未来要迁移：建议的目标形态（示意，未生效）

```json
{
  "$schema": "https://dsh-std.example/schemas/dsh-plugin/v0.16.json",
  "id": "com.nianjunzou.dsh-session-manager",
  "name": "DSH Session Manager",
  "version": "0.1.7",
  "manifestVersion": "0.16",
  "facets": { "client": { "apiVersion": "…" } },
  "requires": { "contracts": [{ "apiVersion": "views.dsh/v1alpha1", "kind": "ViewContribution" }] },
  "contributes": { "views": ["sidebar.workspaces"] }
}
```

> 以上字段名/坐标按 Draft v0.15 写法示意，以 Registry 定案为准；**当前宿主不会读取该文件**，落地前不得宣称「已符合标准」。

## 7. 迁移顺序与工作量（建议，不执行）

| 优先级 | 动作 | 前置条件 | 规模 |
|---|---|---|---|
| P0（可做，低风险） | 维持现有 alignment lane 作为「耦合可见性」证据；在 README 记录本评估 | 无 | 小 |
| P1（等标准） | 预置 `dsh-plugin.json`（标未生效）+ 在 CI 上加 schema 校验 | views/webseeds 条目定稿；schema 冻结 | 中 |
| P2（等宿主） | 把 `peerDependencies` 区间映射为契约坐标声明，双轨过渡 | 宿主实现协商器 + Host Descriptor | 大 |
| P3（等生态） | 包名/id 改反向域名并重发大版本 | 有迁移工具/共存策略 | 大，破坏性 |

**不建议现在做的**：为「合规」改包名、提前改 `cordis.patch.yml` 身份、把 `dsh.client.inject` 改名成标准坐标（宿主不认，纯造漂移）。

## 8. 判定边界

- 本评估不能证明「符合标准」：标准要求 Host conformance / Plugin validation 证据，当前宿主未实现标准，**无法产生该证据** → `verification-gap`。
- 本评估未验证运行时行为变化（未改代码）；124 条测试是**当前宿主**下的回归证据，不是标准兼容证据。
- id 反向域名、views 条目字段均为**示意**，以 Registry 定案为准。

## 附：证据命令（只读）

```bash
cd <plugin-checkout>
DSH_SOURCE=<dsh-checkout> npm test            # 全绿（含 alignment lane）
git -C <dsh-checkout> describe --tags --always  # dsh-v0.2.1-alpha.5
git clone --depth 1 <community-standard-repo> <tmp>/dsh-community-standard
git -C <tmp>/dsh-community-standard rev-parse HEAD   # 34bffb18…
```

## 9. `dsh.client.inject` 声明收窄：影响面验证（2026-10-20）

### 9.1 宿主语义（`deepseek-harness` @ `dsh-v0.2.1-alpha.5` 源码实证）

`dsh.client.inject` 是**包名依赖边**，不是服务依赖、也不参与 apply 时序：

| 消费点 | 行为 | 证据 |
|---|---|---|
| 浏览器端工厂到达 | 本行 materialize 前，先让已组成（composed）的 inject 包行到达；**包不存在于 graph 时静默跳过** | `packages/client/modules/src/client/system.ts:273-276`（`graphRows.get` 未命中即跳过） |
| 模块表保留 | `prune` 沿 external + inject 边保留行，避免被驱逐 | `system.ts:448-455` |
| 申请顺序 | 仅 `external` 参与 `orderByModuleGraph` 排序，`inject` 不参与 | `packages/client/modules/src/index.ts:508-547` |
| 激活/apply 时序 | **明确不参与**：「`dsh.client.inject` edges are informational (loading/prefetch metadata, never apply sequencing)」 | `packages/client/ui-workspace/src/client/index.ts:94-99` |
| 组成（哪些插件加载） | 由 Loader 表中的行决定（`compose()` 扫 `this.table`），inject 不新增行 | `packages/client/modules/src/index.ts:774-780` |
| 平台种子 | 种子模块由 shell 直接提供，inject 边指向种子不构成行依赖 | `packages/client/web/src/platform.ts:8-16`、`test-support/client-runtime/src/assembly/roster.ts`（`PLATFORM_SEED`） |

新增行的失败连带：被声明包行若**已组成但到达失败**，本插件行会以 `"... not loaded because dependency ... failed"` 失败（`system.ts:283-296`）——即声明一条自己并不使用的边，会把别人的加载失败转成本插件不可用。

### 9.2 本插件真实需要

`client/client.js` 的 `require` 只有 3 个，且**全部是平台种子**：

| 实际 require | 是否平台种子 |
|---|---|
| `react` | 是（`PLATFORM_MODULES`） |
| `@deepseek-ai/dsh-client-store` | 是 |
| `@deepseek-ai/dsh-client-ui-primitives` | 是 |

数据 hooks（`useSessions`/`useWorkspaces`/`useSessionStatus`/`useJobs`/`useNotice`）与动作全部经 slot 注册的 props 注入（`src/client/body.js:958-975`、`:1790-1845`），不靠 `require` 宿主包；`jobs` 走 `ctx.get` 懒取、缺服务即降级。

→ **严格按需，`dsh.client.inject` 可以为 `[]`**（种子由 shell 提供，无需边）。

### 9.3 当前 11 条声明分类

| 声明 | 宿主是否有 client 行 | 本插件是否 require | 说明 |
|---|---|---|---|
| `dsh-api-remotes` | 有 | 否 | 仅到达序/保留 |
| `dsh-api-job-controller` | 有 | 否 | **与 fail-open 相悖**：把可选 jobs 变成到达依赖 |
| `dsh-api-session-controller` | 有 | 否 | 仅到达序 |
| `dsh-api-workspace-controller` | 有 | 否 | 仅到达序 |
| `dsh-client-connection` | 有 | 否 | 仅到达序 |
| `dsh-client-locale` | 有 | 否 | locale 服务由 cordis 注入，非模块 require |
| `dsh-client-ui-primitives` | **无（平台种子）** | 是 | 边是 no-op |
| `dsh-client-ui-renderer` | 有 | 否 | 仅到达序 |
| `dsh-client-ui-session` | 有 | 否 | 仅到达序（hooks 走 props） |
| `dsh-client-ui-sidebar` | 有 | 否 | slot 所有者，靠 `slots.inject` 等待，不靠边 |
| `dsh-client-ui-workspace` | 有 | 否 | 仅到达序 |

### 9.4 实测：收窄到 `[]` 的副本

在 `<tmp>/<plugin>-narrow`（仓库副本，`dsh.client.inject: []`）跑插件自身测试 + 源码对齐：

```text
当时口径（124 条）：pass 123 / fail 1
✖ the client manifest declares the real packages it loads
```

- 唯一失败是**有意把声明集钉住的断言**（`test/plugin.test.js:28-42`，理由写作 “factory arrives first”），其余 123 条（含 alignment 11 条）全绿；构建产物与源码一致、契约测试、a11y 均通过。
- 结论：收窄在**静态与插件测试层面可行**，但需要同步修改该断言并把「为什么声明」的理由重写（或删掉整条声明）。

### 9.5 判定与建议

> **2026-10-20 已实施选项 B**（工作树，未提交）：`dsh.client.inject` 11 → 0、移除未使用的
> `uiSession` 服务声明、测试改为理由断言 + 新增服务使用断言。`npm test` 125/125、`npm run verify`
> 通过、preflight 声明面检查干净。**真机验证仍待 DSH 重启窗口**（见 §9.6）。


| 选项 | 收益 | 代价/风险 | 判定 |
|---|---|---|---|
| A 维持现状 | 零改动；作者意图的“到达保障”保留 | 无关包到达失败会连带本插件；多等/多保留 10 行；jobs 的 fail-open 被声明削弱 | 可接受，但需在注释里写清“为什么这些边不是依赖” |
| B 收窄到 `[]` | 恢复真实依赖面；去掉失败连带与保留开销；与 `ctx.get('jobs')` 的 fail-open 一致 | 需改 `test/plugin.test.js` 断言；真机未验证 | 推荐（先改测试再验证） |
| C 收窄到“slot 所有者的 2–3 个包” | 折中 | 仍需理由；hooks 并非经 require 获得，折中收益不明 | 不推荐 |

另外：cordis 服务声明 `inject = ['slots','sessions','workspaces','uiWorkspace','uiSession','locale']` 中，**`uiSession` 在代码里没有任何直接使用**（仅注释/测试注释提及 `uiSession.sessionStatus`，实际状态经 props 的 `useSessionStatus`）。它是“必需服务等待”的过宽声明，候选收窄；但会影响 `apply` 时机，必须在真机窗口验证。

### 9.6 验证边界（verification-gap）

本节结论来自**宿主源码静态语义 + 插件测试**；未做真机验证：

- 收窄后 DSH 启动、region 渲染、作业红点、locale 切换的行为未在真实应用窗口复测；
- 本会话运行在 DSH 宿主进程内，重启宿主才能验证，故标注 `verification-gap`；
- 建议验证流程：临时副本改声明 → 装到测试 profile（可回滚）→ 重启 → 检查 region/菜单/拖拽/作业点/locale/console → 再决定是否落仓库。

> 宿主未来若用这些边做 composition（`manifest.ts` 注释提到 Cordis 也消费同样的包边），收窄需重新评估；升级宿主时把本条列入复核清单。
