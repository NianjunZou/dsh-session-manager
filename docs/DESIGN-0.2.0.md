# dsh-session-manager 0.2.0：虚拟子目录设计方案

> 状态：**设计稿，未实现**（已经过一轮独立评审，修订记录见 §11）。目标是在一个工作区
> （项目目录）的会话列表下增加**一级虚拟子目录**：可建、可改名、可删、可排序，会话可归入
> 子目录，列表可在「全部 / 各子目录 / 未分类」之间切换。子目录是插件自有的展示分组，
> 不复制宿主会话数据，不写宿主字段；停用插件后原生界面无需迁移。
>
> 基线：DSH App **0.2.2-rc.1**；源码 `<dsh-checkout>`，tag `dsh-v0.2.2-rc.1`，
> 工作树 clean。下文 `<dsh-checkout>/…`
> 均指该 checkout。插件：`@pianner/dsh-session-manager@0.1.7`（HEAD `d2ed52a`）。
>
> ⚠️ 开工前有一个**非功能阻塞**：插件工作树不是干净基线（2 个改动文件 + 1 个未跟踪备份，
> `npm test` 6 条红，构建产物含源码里没有的 CSS）。详见 §1.4 与 §9.1，先收口再动功能。

> **2026-11-09 实施修正（目录树）**：按实机反馈选择 B，目录区不再用「chip + 小节」双导航，
> 改为 **工作区 → 可折叠目录 → 会话** 的树：删除 `FolderStrip` / active 过滤 / chip 计数；
> 工作区表头 folder-plus 常驻（只建目录）；目录小节标题 28px、14px/20px（chevron + 名称 + 一个计数 +
> attention 点），未分类仅在有会话时显示。下文出现 chip / active / 切换条的段落是历史方案，
> 以本节、§4.2/§5.2 的树注记和代码为准。

---

## 0. 结论摘要

| # | 结论 | 级别 |
|---|---|---|
| C1 | **交互形态（2026-11-09 改为树）**：工作区分组展开后，有子目录时直接出现可折叠目录小节（工作区 → 目录 → 会话）；没有 chip 条、没有 active 过滤；无子目录时列表结构与 0.1.7 相同。 | P0 |
| C2 | **数据归属**：宿主没有会话级目录/标签字段，`WorkspaceView` 也不能表达嵌套（§1.3）。子目录定义与会话归属只能是**插件独占数据**，经 `dsh-client-store` 的 `createSnapshotStore({ persist })` 存入浏览器 localStorage，键带命名空间与 schema 版本。 | P0 |
| C3 | **宿主真相不变**：会话、工作区归属、手动顺序、置顶、归档、当前选择仍全部读写宿主。子目录只改变显示分组，不写 `workspace.sessionIds`；目录内排序仍走 `workspaces.insertSessionBefore`。 | P0 |
| C4 | **声明面不扩**：cordis `inject` 仍为 5 项，`dsh.client.inject` 仍为空，不新增外部模块或宿主 API。用到的 `MenuItem.submenu`、`IconCheckOutlineRegular`、`createSnapshotStore({ persist })` 在 0.2.1-alpha.5 与 0.2.2-rc.1 源码中都存在（§1.5）。 | P0 |
| C5 | **契约需修订（已拍板：保留）**：现行 `PLUGIN-CONTRACT.md` 只允许插件私有存储保存「视觉偏好」，并要求停用后不残留 storage key（:16、:29）。子目录是耐久的用户组织数据，停用时删除会丢数据。**2026-11-08 仓库所有者已确认「保留数据」策略**；§6.2 的修订文本在实施 P0 时同步落到 `PLUGIN-CONTRACT.md`。 | P0（已拍板） |
| C6 | **多窗口**：`createSnapshotStore` 的持久化是整值写入且不监听 `storage` 事件，第二个窗口的任何一次写入都会用旧快照覆盖第一个窗口的全部改动。因此 `storage` 事件收敛放进 **P0**，原稿放在后续。 | P0 |
| C7 | **版本**：插件升 **0.2.0**。DSH 运行时用 `includePrerelease: true` 校验 peer 范围（这是 runtime 检查语义，不是 npm 默认语义），现有 `>=0.2.0-alpha.0 <0.3.0` 在运行时**匹配** 0.2.2-rc.1，真正的缺陷是它也匹配 `0.3.0-alpha.*`。改为 **`>=0.2.0-alpha.0 <0.3.0-0`**：下限不动，保留 0.2.1-alpha.5 兼容（§1.5、§6.1）。 | P0 |
| C8 | **分期**：0.2.0 只做「工作区表头目录入口 + 行菜单归置 + 目录树 + 目录管理 + 多窗口收敛」；拖动会话入目录、目录拖拽排序**已移出 0.2.0**（它们是菜单动作的快捷方式，不新增能力）；会话拖动/键盘排序只在**同一目录内**生效。 | P0 |
| C9 | **不做**：真实磁盘目录、多级嵌套、跨工作区移动会话、跨设备/跨客户端同步、让原生 UI 显示子目录、自动把新会话归入当前目录。 | 边界 |

一句话：**子目录是插件的「展示层分组表」，会话与排序仍是宿主的。**

---

## 1. 现状与证据（先对齐，再设计）

### 1.1 运行时 / 源码 / 插件

| 项 | 值 | 证据 |
|---|---|---|
| DSH App | `0.2.2-rc.1` | App `Info.plist` 的 `CFBundleShortVersionString` |
| 精确源码 | `dsh-v0.2.2-rc.1`，工作树 clean | `git -C <dsh-checkout> describe --tags --always` / `status --short` |
| 插件安装态 | desktop profile 以 `link:` 指向本仓库 | `~/.dsh/profiles/desktop/package.json`（只读查看） |
| 插件 HEAD | `d2ed52a`，version `0.1.7` | `git log -1` |
| alignment lane（对 0.2.2-rc.1） | **11 条：9 pass / 2 fail**。失败的 `alignment.test.js:76`、`:96` 都是硬编码版本 `0.2.1-alpha.5` 与范围字面量，不是契约漂移 | `DSH_SOURCE=<dsh-checkout> node --test test/alignment.test.js`（评审时在临时副本复跑，结果一致） |
| 全量测试（当前工作树） | **127 tests：110 pass / 6 fail / 11 skipped**（skipped 为未设 `DSH_SOURCE` 的 alignment） | `npm test`（评审时在临时副本复跑）；失败归因见 §1.4 |
| 只读预检 | 原稿记录 PASS=6；本轮未复跑 | 维护者本地预检脚本（不随仓库分发），`verification-gap` |

alignment 通过项覆盖 slot 名与 `priority`、`uiWorkspace` / `workspaces` 方法签名、`Menu` /
`StateDot` / `Modal` 导出、状态与投影字段、locale 注册形状、`jobs` roster。它**没有**覆盖本设计
新增依赖的 `submenu`、图标、`persist` 形状，这些在 §1.5 手工核对，并在 §7.3 补成 lane。

### 1.2 插件当前结构（代码事实）

| 事实 | 位置 |
|---|---|
| 整体接管 `sidebar.workspaces`（single/root），`priority: -2` 遮蔽官方注册者（官方默认 0，最低 rank 渲染） | `src/client/body.js:49`、`:1806-1810`；`<dsh-checkout>/packages/client/ui-slots/src/index.ts:775` |
| 分组树由纯函数 `computeGroups()` 生成：置顶区 + 每个工作区 + 未分组桶。成员来自 `workspace.sessionIds`，顺序为宿主手动顺序或 `updatedAt`；未归档的置顶会话从工作区组里移除；**成员为 0 的组整个不输出** | `src/client/core.js:560-618`（`:592` 空组跳过）；调用处 `src/client/body.js:1049` |
| 行、行菜单、`Section`、region | `src/client/body.js:715`（`SessionRow`）、`:723-745`（行菜单 items）、`:894`（`Section`）、`:982`（region） |
| `Section` 外层 div **无条件**带 `data-dsm-group={sectionKey}`；工作区拖动用 `closest('[data-dsm-group]')` 找目标 | `src/client/body.js:940-951`、`:309-318`（`elementUnder`）、`:918` |
| 工作区表头行 `.dsm-section-row` 是 `position:sticky;top:0` | `src/client/body.js:519` |
| 拖动/键盘重排统一解析为 `beforeSessionId`（`moveAnchor`），目标不在传入 `order` 中时返回 `undefined`（静默不写） | `src/client/core.js:419-442`；`src/client/body.js:1107-1116`（`move`）、`:1184-1192`（`drop`） |
| 会话拖动只比较「源行与事件所在行」的 `accountId`，不比较目录 | `src/client/body.js:800-803` |
| `renderRow` 是 `useCallback`，依赖表手写；`priorities` 漏写曾导致 P1–P4 不刷新 | `src/client/body.js:1220-1273` |
| 分页：`pages[group.key]`、`requiredPageLimit` 保证 attention 与当前会话不被分页藏起 | `src/client/body.js:1163-1175`、`:1325-1332`、`:1635-1648`；`src/client/core.js:725-747` |
| 可见行 → `watchTargets` → `jobs.watchRows` | `src/client/body.js:1309-1355` |
| 插件自有状态先例：`createSnapshotStore({}, { persist: { name: 'dsh-session-manager.priority' } })`；store 本体经 registration 的 `inject` 面暴露，写操作 `setPriority(ies)` 也放在面上而不在组件里 | `src/client/body.js:117-124`、`:1861-1880` |
| 静态测试禁止 bundle 出现 `localStorage` / `sessionStorage` / `indexedDB` / `BroadcastChannel` 字样 | `test/plugin.test.js:130-133` |
| contract lane 的 `require` 只提供 `react` 与 primitives 桩；`dsh-client-store` 会抛错，store 走 `observable` 回退；`useMemo` / `useCallback` 桩不看依赖；`window` 桩没有 `addEventListener` | `test/contract.test.js:100-101`、`:134-164` |

### 1.3 宿主能力边界（为什么必须插件自存）

| 需要的能力 | 宿主现状（0.2.2-rc.1） | 结论 |
|---|---|---|
| 会话级目录/标签/分组 | `SessionSummary` 字段为 `id / title? / displayTitle / cwd? / parentId? / origin? / formatStatus? / running / retainedBy / blank / updatedAt / projectionValues?`，没有 folder/tag/group（`packages/api/session-controller/src/client/sessions/service.ts:27-58`）。`projectionValues` 是宿主 projection 的摘要，插件无法在客户端声明新 projection | 宿主不提供 |
| 工作区嵌套 | `WorkspaceView` 只有 `workspaceId / path / title / sessionIds / createdAt / updatedAt`（`packages/api/workspace-controller/src/types.ts:18-30`） | 一个工作区对应一个目录，不能表达逻辑子目录 |
| 会话耐久顺序 | `insertSessionBefore(workspaceId, sessionId, beforeSessionId?): Promise<WorkspaceView>`，省略 anchor = 追加到末尾；会话或 anchor 不在该工作区 `sessionIds` 时抛 `workspace/move-invalid`（`workspace-controller/src/client/service.ts:104-114`、`:178-186`；`packages/workspace/workspace/src/entity.ts:152-169`） | 可复用；只表达线性顺序 |
| 工作区 id 稳定性 | 新建与启动期补建都用 `randomUUID()`（`packages/workspace/workspace/src/index.ts:518`、`:682`）；删除后同路径重建会得到新 id | 按 `workspaceId` 存的目录数据在重建后成为孤儿 |
| 项目目录内写插件状态 | `@deepseek-ai/dsh-api-workspace-files` 的 Remote 只有 `read / readBytes / stat / list / changes(stream)`（`packages/api/workspace-files/src/index.ts:233-341`），无写接口；本插件也未声明它 | 不能在项目里落文件 |
| 客户端持久化 | `createSnapshotStore(init, { flush?, persist?: { name } })` 返回 `{ getSnapshot, subscribe, update, set }`；持久化为整值 `JSON.stringify` 写 localStorage，启动时 `JSON.parse` 原样回填、**不校验**，解析失败只 `console.error` 并保留 `init`；没有 `storage` 事件监听（`packages/client/store/src/index.ts:27-38`、`:103-137`、`:139-167`） | 可用，但校验、版本、多窗口收敛都要插件自己做 |
| 存储作用域 | localStorage 按 origin 隔离。桌面版加载 `dsh-app://app/`（`apps/desktop/src/main.ts:473`、`apps/desktop/src/ipc.ts:101`）；浏览器访问 Web GUI 是 `http://127.0.0.1:<port>`，是另一个 origin，端口不同也互不相通 | 桌面与浏览器里的子目录互不可见 |
| 槽位 | `'sidebar.workspaces': { kind: 'single'; scope: 'root' }`（`packages/client/ui-sidebar/src/client/contract/slots.ts:45`）；官方 `ui-workspace` 以默认 priority 注册（`packages/client/ui-workspace/src/client/index.ts:330-345`） | 目录 UI 全在自有 region 内 |

> 设计含义：子目录是插件新增的概念，不是宿主已有状态的副本，因此不违反「不得为宿主已持久化的状态
> 另建私有存储」（`PLUGIN-CONTRACT.md:49`）。但它也不是契约现有分类里的「视觉偏好」，需要在契约里
> 新增一类「插件自有组织数据」（§6.2）。原生 UI 不知道子目录；禁用插件后所有会话仍按工作区完整显示。

### 1.4 当前工作树不是干净基线（必须先知）

```
 M client/client.js
 M src/client/core.js
?? client/client.js.bak-20261029021744
?? docs/DESIGN-0.2.0.md        ← 本文
```

在途改动（不属于本设计，评审未修改、未回退）：

- `src/client/core.js`：`SESSION_PAGE_BASE` 5 → 50（`:695`）；blank 会话可见性在 `isVisibleMember`
  （`:542`）与 `buildSearchNodes`（`:797`）里改为「blank 且无 `title` 且无 `displayTitle` 才隐藏」。
  注意宿主把 `displayTitle` 定义为必有字段（「durable title, project basename, then session id」，
  `session-controller/src/client/sessions/service.ts:31-32`），所以新判断在真实数据上**基本等于不再隐藏
  任何 blank 会话**。这是否是想要的行为，属于基线收口要确认的事。
- `client/client.js`：除上述两处外，macOS 表头 CSS 被改成
  `background:var(--dsw-alias-bg-layer-2,#1e1e1e);backdrop-filter:none`，而 `src/client/body.js:524`
  仍是 `color-mix(...) 6%` + `backdrop-filter:blur(14px)`。这条 CSS **只存在于产物**，`npm run build`
  会把它覆盖掉；CI 的「Build and check the committed client bundle is current」也会拦（`.github/workflows/ci.yml:41-44`）。
- `client/client.js.bak-20261029021744`：未跟踪的手工备份，说明有人直接改过产物。

`npm test` 的 6 条红（评审在临时副本复跑确认）：

| 归因 | 用例 |
|---|---|
| 分页（page base 5 → 50），4 条 | `test/core.test.js:556`（`pageRows`）、`:564`（`nextPageLimit`）；`test/contract.test.js:825`（show more）、`:1364`（block pages） |
| blank 可见性，1 条 | `test/core.test.js:579`（`buildSearchNodes merges local title matches`：结果多出 `'blank'`） |
| 产物 CSS，1 条 | `test/plugin.test.js:170`（断言 macOS 表头仍是 `backdrop-filter:blur(14px)`） |

收口步骤见 §9.1。三项改动各自要先确认归属与意图，再决定「改测试」还是「回退」。

> **实现基线说明（2026-11-08）**：0.2.0 在从 HEAD `d2ed52a` 开出的独立 worktree
> `feat/0.2.0-virtual-folders` 中实现；上面这三处未提交改动保留在原 checkout，未被带入、未被修改。
> worktree 初始 `node --test` 为 127 tests / 116 pass / 0 fail / 11 skipped；P0 实现后为
> 152 tests / 152 pass（含 13 条 alignment）。

### 1.5 版本对齐细节

**peer 范围的两套语义**：

| 语义 | 谁在用 | `>=0.2.0-alpha.0 <0.3.0` 对 `0.2.2-rc.1` | 对 `0.3.0-alpha.0` |
|---|---|---|---|
| npm 默认（不含 prerelease） | `npm install` 的 peer 提示 | 不匹配 | 不匹配 |
| `includePrerelease: true` | **DSH 插件兼容检查**：先看 `engines.dsh`，没有则逐个检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` peer，不满足会阻止安装/激活（`<dsh-checkout>/packages/boot/app-boot/src/plugin-compatibility.ts:51-75`） | **匹配** | **匹配**（缺陷） |

原稿「旧写法在运行时不匹配 0.2.2-rc.1」的说法不成立：插件当前能在 0.2.2-rc.1 激活正是因为运行时
带 prerelease 比较。真正要修的是上限：`<0.3.0` 在 `includePrerelease` 下放行 `0.3.0-alpha.*`。
用 `<dsh-checkout>` 内的 semver 7.7.4、`includePrerelease: true` 实测：

| 范围 | 0.2.1-alpha.5 | 0.2.2-rc.1 | 0.2.3-rc.0 | 0.3.0-alpha.0 |
|---|---|---|---|---|
| `>=0.2.0-alpha.0 <0.3.0`（现状） | ✓ | ✓ | ✓ | ✓ |
| **`>=0.2.0-alpha.0 <0.3.0-0`（采用）** | ✓ | ✓ | ✓ | ✗ |
| `>=0.2.2-rc.1 <0.3.0`（原稿候选） | ✗ | ✓ | ✓ | ✓ |

原稿候选既丢掉 0.2.1-alpha.5 用户，又没修上限，因此不采用。`@deepseek-ai/cordis` 不以 `dsh` 前缀命名，
不参与该检查，保持 `^4.0.2`。

**新增 UI 依赖逐项核对**（0.2.2-rc.1 = `<dsh-checkout>`；0.2.1-alpha.5 = 维护者本地 `dsh-v0.2.1-alpha.5` checkout）：

| 依赖 | 0.2.2-rc.1 证据 | 0.2.1-alpha.5 |
|---|---|---|
| `MenuItem.submenu?: readonly MenuEntry[]` | `packages/client/ui-primitives/src/Menu.tsx:16-29` | 存在（grep 命中） |
| submenu 行为：父项 hover/focus/click 打开；子项点击调用同一个 `onSelect(sub.id)`；子项**不渲染** `selectedId(s)` 勾选、不支持 `danger`、无 `aria-checked`；有 submenu 的菜单**取消高度上限**（不滚动）；方向键只有 ↑/↓/Home/End，按 DOM 顺序走进子项，**没有 →/←** | `Menu.tsx:474-476`、`:480-541`、`:425-438` | 未逐行比对，`verification-gap` |
| `IconCheckOutlineRegular` | `ui-primitives/src/icons/index.tsx:70`，经 `src/index.ts:129` 的 `export *` 导出 | 存在 |
| `IconProjectAddOutlineRegular` | `icons/index.tsx:334`；**插件已用它做「添加工作区」**（`src/client/body.js:1461`） | 存在 |
| 无「新建文件夹」专用图标 | `icons/index.tsx` 只有 `IconFolderOpen*` / `IconFolderClose*`（`:340-355`） | — |
| `createSnapshotStore(init, { persist: { name } })` | `packages/client/store/src/index.ts:103-110` | 存在 |

结论：本设计不需要 0.2.2 才有的能力；0.2.2-rc.1 的 `ui-workspace` 改动（rows、context menu、archive
流程）不触及本插件使用的 slot / service / primitives / store 契约，alignment 的 9 条通过项支持这一点。

---

## 2. 目标与非目标

### 2.1 目标（0.2.0）

1. 每个工作区可建**一级**虚拟子目录，可改名、删除、上移/下移。
2. 会话可从行菜单归入某个子目录，或移回「未分类」。
3. 有子目录的工作区内提供「全部 / 子目录 / 未分类」切换；「全部」视图按子目录分小节。
4. 子目录定义与会话归属在同一 origin 内跨重启保留；多窗口之间收敛（§3.6）。
5. 不影响置顶、归档、搜索、优先级、分页、状态点、job watch 的既有行为（例外在 §4.6 逐条写明）。
6. 停用/卸载后宿主数据零变化；原生 UI 完整显示所有会话。
7. 键盘可达、读屏可理解、深色/浅色主题都成立。
8. 无子目录时**列表结构**与 0.1.7 一致；唯一可见差异是行菜单多一个「移到子目录」子菜单（入口，见 §4.4）。

### 2.2 非目标

- 不在磁盘创建真实目录；不与 Finder/文件树同步。
- 不支持子目录嵌套。
- 不支持跨工作区移动会话（宿主无此 API）。
- 不让官方 UI 或其他插件读取/显示子目录。
- 不做跨设备、跨客户端（桌面 vs 浏览器）同步。
- 不自动把新建会话归入当前目录（后续；`startSession` 不返回新会话 id）。
- 不改变宿主 `sessionIds` 顺序来表达目录归属。
- 不改 Harness / ASAR / 宿主源码，不改 profile。

---

## 3. 数据模型

### 3.1 所有权矩阵

| 数据 | 唯一 owner | 插件行为 | 作用域 |
|---|---|---|---|
| 会话记录、标题、状态 | DSH 宿主 | 只读 | 宿主决定 |
| 工作区成员/顺序 | DSH 宿主 | 读 `workspace.sessionIds`；排序写 `insertSessionBefore` | 宿主决定 |
| 置顶 / 归档 / 当前选择 | DSH 宿主 | 调宿主服务 | 宿主决定 |
| 子目录定义（名称、顺序） | **本插件** | 自有 store（持久化） | 本机、同 origin |
| 会话 → 子目录归属 | **本插件** | 自有 store（持久化） | 本机、同 origin |
| 目录小节折叠 | **本插件（UI 状态）** | React state，**不落盘** | 当前窗口、当前挂载 |
| 优先级标签 | 本插件（既有） | 自有 store（持久化） | 本机、同 origin |

规则：

- 子目录数据**永不**影响 `workspace.sessionIds`、pin、archive、selection、session title。
- 原生 UI 忽略该存储键即可完整工作；插件也只把子目录当显示分组，不当成宿主归属。
- 会话/工作区 id 全部用宿主 id；子目录 id 是插件生成的稳定 id（重命名不改 id），不用名称做键。
- 目录树没有 active 过滤；折叠状态**只在 React state**。若未来恢复目录过滤，再评估持久化，
  届时应单独存一个键，不混进 v1 schema。

### 3.2 持久化 Schema v1

存储键（按 `PLUGIN-CONTRACT.md:50` 的 `dsh-plugin:<plugin-id>:` 命名空间）：

```
dsh-plugin:dsh-session-manager:folders
```

既有优先级键 `dsh-session-manager.priority` 不符合该命名空间；0.2.0 **不迁移**（迁移本身有丢数据风险），
只在契约修订里记为历史例外。

值：

```json
{
  "v": 1,
  "workspaces": {
    "ws_7f3c": {
      "folders": [
        { "id": "f-m3k2-8a1c", "name": "设计" },
        { "id": "f-m3k2-91de", "name": "排查" }
      ],
      "assign": {
        "sess_abc": "f-m3k2-8a1c",
        "sess_def": "f-m3k2-91de"
      }
    }
  }
}
```

- `folders` 数组顺序 = 目录显示顺序；上移/下移只改数组。
- `assign` 只存归属；没有条目 = 未分类。不存会话顺序，顺序永远来自宿主 `workspace.sessionIds`（或 `orderBy` 派生）。
- folder id：`crypto.randomUUID()` 可用时用 `f-<uuid>`，否则 `f-<base36 time>-<base36 random>`；测试注入固定 id。
  id 以 `f-` 开头，保证不会与菜单动作 id `folder:none` / `folder:new` 冲突（§5.2）。
- **任何字段增减都必须升 `v`**。v1 的读取是白名单，未知字段会在下一次写入时被丢弃；若在 v1 里悄悄加字段，
  旧版插件一次写入就会抹掉它。

**默认值（缺键 / 空值 / 插件未加载）**：

| 场景 | 默认行为 |
|---|---|
| localStorage 无该键、值为 `null`、或值不可解析 | store 使用 `{ "v": 1, "workspaces": {} }`；不显示任何目录 |
| 工作区没有任何子目录 | 该组走 0.1.7 原路径：会话按宿主顺序直接列出，不出现切换条/目录小节 |
| 会话在 `assign` 里没有条目 | 归入「未分类」 |
| 插件被停用 / 未加载 / 读取为 `readonly` | 原生 `sidebar.workspaces` 接管；该键被忽略，全部会话按工作区与宿主顺序显示 |

这就是「关闭插件则不用」的含义：原生界面不依赖这份数据；**关闭时保留该键**（2026-11-08 已拍板，见 §6.2），
重新启用即恢复目录。

### 3.3 不变量

1. `folders[].id` 非空、唯一、以 `f-` 开头；`name` 去首尾空白后长度 1–40（UTF-16 code units），不含控制字符。
2. 同一工作区内名称按 `toLocaleLowerCase()` 去重；拒绝当前语言与另一语言的保留名（「全部」「未分类」「All」「Unfiled」），
   否则切换条上会出现无法区分的同名 chip。
3. 每个工作区最多 **20** 个子目录（`FOLDER_MAX_PER_WORKSPACE`）。理由：带 submenu 的 `Menu` 取消高度上限、不滚动
   （`Menu.tsx:474-476`），目录过多时行菜单会超出窗口。数值可调，但必须有上限。
4. `assign` 的值必须指向同一工作区 `folders` 中存在的 id；否则按未分类处理。
5. 会话不在该工作区 `sessionIds` 中（未分组、子会话、已转到别的工作区）时，`assign` 条目被忽略、不渲染。
6. 删除目录 = 删除 `folders` 条目 + 删除指向它的 `assign` 条目；不触碰宿主任何状态。
7. 孤儿数据：
   - 写某个工作区时（且 `workspaceState.phase === 'ready'`），顺带删除该工作区 `assign` 中不在其 `sessionIds` 里的条目
     （`pruneAssign`）。归档会话仍在 `sessionIds` 里，不会被删。
   - 宿主删除的工作区，其 `workspaces[workspaceId]` 整块保留但不渲染，不自动清理：自动删除是用户看不见的数据丢失，
     而这块数据很小。同路径重建会得到新 id（§1.3），旧数据不迁移（按 `path` 提示找回需 schema 升级，后续评估）。
8. 子会话（`origin === 'subagent'`）从不作为顶层行渲染，也不出现在目录里。
9. 未归档的置顶会话只出现在置顶区（`computeGroups` 已从工作区组中移除，`core.js:591`）；其 `assign` 保留，取消置顶后回到原目录。
10. 归档会话保留 `assign`；「显示归档 / 只看归档」时出现在原目录。
11. 任何非法/未知结构都按 §3.5 分类处理，不崩溃、不写宿主。

### 3.4 纯函数（`src/client/core.js` 新增）

与现有 `computeGroups(input)` / `moveAnchor(input)` 一致，派生函数用单个 `input` 对象：

```js
export const FOLDER_SCHEMA_VERSION = 1
export const FOLDER_ALL = '__all__'
export const FOLDER_UNFILED = '__unfiled__'
export const FOLDER_NAME_MAX = 40
export const FOLDER_MAX_PER_WORKSPACE = 20

readFolderState(raw)                              // -> { mode: 'empty'|'ok'|'readonly', reason?, state }，state 恒为净化后的 v1
foldersOf(state, workspaceId)                     // -> { folders, assign }（净化后、不可变）
folderNameError(name, folders, { reserved, exceptId }) // -> 'empty'|'tooLong'|'invalid'|'duplicate'|'reserved'|undefined
createFolder(state, workspaceId, { id, name })    // 超过上限返回原 state
renameFolder(state, workspaceId, folderId, name)
deleteFolder(state, workspaceId, folderId)        // 同时清 assign
moveFolder(state, workspaceId, folderId, direction) // 'up' | 'down'
assignSession(state, workspaceId, sessionId, folderId /* null = 未分类 */)
pruneAssign(state, workspaceId, memberIds)        // 只动这一个工作区
workspaceOfSession(workspaces)                    // -> Map<sessionId, workspaceId>，按 items 顺序首个命中
buildFolderView({ groupKey, sessionIds, entry, activeId }) // 单个工作区组的渲染派生
buildFolderViews({ groups, state, active })       // -> { [group.key]: view | null }
```

- 所有写函数在无变化时**返回同一引用**（幂等：重复删除、移到原位、归到当前目录），调用方据此跳过 `set`。
- `buildFolderView` 是唯一的单组派生；`buildFolderViews` 只是对 `tree.groups` 逐个调用它的薄包装，供 region 一次 memo。
  原稿中 `buildFolderView` / `buildFolderViews` / `folderViewsFor` 三个名字混用，统一为以上两个。
- `group.workspaceId === undefined`（未分组桶）或该工作区没有目录时，`buildFolderViews` 给 `null`，region 走 0.1.7 路径。

`buildFolderView` 返回：

```js
{
  hasFolders: true,
  activeId,                  // 输入非法/已删除时回落 FOLDER_ALL
  chips: [
    { id: FOLDER_ALL, kind: 'all', count },
    { id: folderId, kind: 'folder', name, count }, ...,
    { id: FOLDER_UNFILED, kind: 'unfiled', count },
  ],
  sections: [                // 「全部」视图用；folders 顺序 + 未分类
    { key: `${groupKey}:f:${folderId}`, id: folderId, kind: 'folder', name, sessions: [...] }, ...,
    { key: `${groupKey}:u`, id: FOLDER_UNFILED, kind: 'unfiled', sessions: [...] },
  ],
  active: { key, sessions } | null, // activeId !== ALL 时的单目录视图；ALL 时为 null；key 与 sections 中同目录一致
}
```

- `sessionIds` 传入 `group.sessions`，即已经过归档筛选、blank 过滤、置顶移除和 `orderBy` 排序的结果；
  计数因此只统计这些行，**不含置顶区里的会话**。`全部 = 各目录 + 未分类`。
- 空目录保留在 `sections`（`sessions: []`）；「未分类」为空时也保留小节，显示空态，避免小节随归置操作跳动。
- 目录内顺序 = 输入顺序；不建插件侧排序表。
- 一次线性扫描：按 `assign` 分桶，再按 `folders` 输出。

### 3.5 版本、读取分类与降级

`readFolderState(raw)` 对 store 快照分类（快照可能是任意 JSON，`dsh-client-store` 不校验）：

| 快照 | `mode` | 行为 |
|---|---|---|
| `undefined` / `null` / 与 `init` 同一引用 | `empty` | 可写 |
| 普通对象且 `v === 1` | `ok` | 净化后使用；单条非法 folder（无 id、空名、重复 id）跳过，指向它的 `assign` 按未分类 |
| 普通对象且 `v` 为大于 1 的整数 | `readonly`（`newer`） | 不渲染任何目录 UI，行菜单子菜单换成一条禁用项「子目录数据来自更新版本，当前只读」；**禁止一切写入**；`console.warn` 一次 |
| 其他（数组、原始值、`v` 缺失或非法） | `readonly`（`unrecognized`） | 同上，文案为「子目录数据无法识别」；文档给出手动清理方法 |

原稿把「`v` 缺失」归为只读、又在不变量里写「降级为空 state」，两处矛盾；现统一为只读，理由是空 state 可写会在下一次写入时覆盖原值。

已知限制：

- **JSON 解析失败**时，store 保留 `init`（`store/src/index.ts:151-157`），插件无法与「键不存在」区分（插件不直接读 Web Storage，
  见 `test/plugin.test.js:130-133`）。第一次写入会覆盖这条损坏的原值；宿主已在控制台打出 `rehydration failed`。接受该限制。
- 写入是整值：第一次用户写入会把净化后的形状落盘，被跳过的非法条目随之消失。只读模式下不会发生。
- `dsh-client-store` 不可用（`require` 抛错，contract lane 即如此）：回退 `observable`，本次挂载可用、重启丢失，与 `priorityStore` 一致。
- 未来 v2 必须写显式迁移；0.2.0 对未知版本只读，避免覆盖。

### 3.6 多窗口 / 多客户端

- `createSnapshotStore` 每个窗口各持一份快照，`set()` 把**整份**快照写回存储（`store/src/index.ts:159-166`），且不监听
  `storage` 事件。两个窗口都开着时，窗口 A 的任何一次写入都会用 A 启动时的旧快照覆盖窗口 B 之后的全部改动。
  这不是「偶尔丢一次写入」，因此收敛机制放进 **P0**。
- P0 方案：`apply()` 里用 `ctx.effect` 注册 `window.addEventListener('storage', onStorage)`，cleanup 中移除。
  `onStorage` 只处理 `event.key === 'dsh-plugin:dsh-session-manager:folders'`：`newValue === null` 视为键被清空，
  `set(init)`；否则 `JSON.parse` 后 `set`（解析失败忽略）。之后由 `readFolderState` 分类，另一窗口写入 v2 时本窗口会转入只读。
  写回存储的是同一个 JSON 串，按 Web Storage 规范值相同不再触发事件，不会回环。
- 写操作在面上执行，且每次都读 `folderStore.getSnapshot()` 的**当前值**再应用纯函数（§5.2），不用渲染时闭包里的旧值。
- 剩余竞争：两个窗口在事件送达前几乎同时写入，后写者赢（last write wins）。不做合并。
- 实现约束：bundle 里不能出现 `localStorage` 等字样（`test/plugin.test.js:131`），监听 `storage` 事件与读 `event.newValue`
  不需要这些标识符。contract lane 的 `window` 桩没有 `addEventListener`，注册前要判断 `typeof window?.addEventListener === 'function'`。
  这偏离了 `body.js:108-110` 注释里「插件不碰浏览器存储」的表述，实现时同步改注释：插件仍不读写存储本身，只监听变更事件。
- 跨客户端不同步：桌面 `dsh-app://app` 与浏览器 `http://127.0.0.1:<port>` 是不同 origin（§1.3）。宿主自己的视图偏好
  `dsh.workspace.view.v5`（`packages/client/ui-workspace/src/client/stores.ts:91`）有同样局限。

---

## 4. 交互设计

### 4.1 信息架构与「切换」

```
项目会话
└─ ▾ 📁 dsh-workspace                              [＋]
     [全部 14] [设计 5] [排查 3] [未分类 6] [＋ 子目录]   ← 切换条（仅当该工作区有子目录）
     ▾ 🗀 设计 5                                     [⋯]
        ● 会话 A                                   2h
        ● 会话 B                                   1d
     ▸ 🗀 排查 3                                     [⋯]
     ▾ 未分类 6
        ● 会话 C                                   3h
```

```
     [全部 14] [设计 5 ✓] [排查 3 •] [未分类 6]          ← 选中「设计」；「排查」里有需要关注的会话
     ● 会话 A                                       2h
     ● 会话 B                                       1d
```

规则：

- 默认是「全部」；点击 chip 切换到该目录，再点「全部」返回。
- 「全部」视图中子目录是**可折叠小节**，「未分类」是最末小节。
- 没有子目录时不出现切换条与小节，列表结构与 0.1.7 一致。
- 切换条在工作区分组内部，跟随分组折叠；**不吸顶**。
- active 按工作区独立保存在 React state（键 = `group.key`）。region 组件在 registration 生命周期内不卸载，侧栏收窄成 rail
  时也不卸载（`body.js:1363-1368` 只换渲染内容），所以切到别处再回来仍保持；刷新、停用再启用、HMR 后回到「全部」。
- 计数随归档筛选变化，不随运行状态变化；不含置顶区里的会话（§3.4）。
- chip 上的 `•`：该目录里有被当前过滤藏起来的 attention 会话（运行中 / 等待输入 / 未读完成）或当前会话。数据来自 region 已有的
  `attention` 集合与 `currentId`（`body.js:1164-1175`、`:1036-1039`），不新增 watch。读屏文案「含需要关注的会话」。见 §4.6「分页」行。

### 4.2 「全部」视图（历史方案）

> 2026-11-09 起 chip 条与「全部」视图已删除；目录区改为树（见顶部实施修正）。本节保留评审时的推导。

- 顺序：子目录按定义顺序在前，「未分类」在最后。
- 目录小节用**独立的 `FolderSection` 组件**，不复用工作区 `Section`（原因见 §5.2 第 4 条）：chevron + 名称 + 折叠 +
  分页 + `⋯` 目录菜单（重命名 / 上移 / 下移 / 删除）。
- 空目录小节显示一行「空目录」提示；0.2.0 不做拖动归置，空目录不是 drop target。
- 「未分类」小节没有 `⋯`，可折叠、可分页，不能改名/删除。
- 置顶区仍在最上方，不按目录分组。

### 4.3 子目录视图（切换后）

- 只渲染该目录的会话行，不再加目录标题（chip 选中态已表达）；行缩进、状态点、时间列、行菜单不变。
- 空目录显示「空目录」+「从会话菜单「移到子目录」把会话放进来」。
- 「未分类」视图同理。
- `Alt+↑/↓` 与拖动在**当前目录的完整过滤后顺序**（含被分页隐藏的行）内解析 anchor，写宿主顺序（§4.5）。

### 4.4 目录管理

| 操作 | 入口 | 行为/约束 |
|---|---|---|
| 新建 | ① **工作区表头 folder-plus**（常驻；只建目录，不归置会话）；② 行菜单「移到子目录 → 新建子目录…」（新建后**同时把该会话归入**） | `FolderDialog` 输入名称，说明「只用于分类，不会在磁盘创建目录」；校验见 §3.3；新建后保持当前视图，不自动切到新目录 |
| 重命名 | 目录小节 `⋯` → 重命名 | 预填当前名；id 不变；重名报错 |
| 删除 | 目录小节 `⋯` → 删除 | 确认弹窗「N 个会话会回到未分类，会话本身不会被删除」；目录树里没有 active 可回落 |
| 排序 | 目录小节 `⋯` → 上移 / 下移 | 只改 `folders` 数组；首项无「上移」、末项无「下移」（disabled） |
| 归置会话 | 行菜单「移到子目录」子菜单 | 子项：未分类 / 各目录（当前项带勾与读屏文本）/ 分隔线 / 新建子目录…；达到 20 个上限时「新建」禁用 |
| 拖动归置（已移出 0.2.0） | — | 归置一律走行菜单；拖动入目录不再排期 |

评审最初撤掉了工作区表头的 `⊞`，把首个目录的入口放到会话菜单；实机反馈认为这不可发现。0.2.0 改为：**不论有没有目录**，工作区表头都常驻 folder-plus（`IconFolderCloseRegular` + CSS 小加号，不依赖 hover，不复用 `IconProjectAddOutlineRegular`，避免与「添加工作区」同形）；它只调 `openCreateFolder(workspaceId)`，不碰会话归置；目录树没有 chip 条，表头座位常驻，同时负责第一个和后续目录。

新建/重命名共用 `FolderDialog`，删除用 `FolderDeleteDialog`，都基于 `Modal`，结构仿照现有 `RenameDialog`（`body.js:1693-1725`）。

### 4.5 归置与顺序的边界

- **归置 = 只写 `assign`**，不改 `workspace.sessionIds`，不触发宿主写。
- **目录内排序 = 宿主顺序**。`SessionRow` 收到的 `accountOrder` 必须是**该目录小节（或单目录视图）的完整过滤后顺序**
  （含被分页隐藏的行；不是 `group.sessions`，也不是分页后的可见行）。`moveAnchor` 在这个顺序里算出的 anchor 仍是同一工作区的会话，
  `insertSessionBefore` 合法；宿主顺序里夹着别的目录的会话不影响目录内相对顺序。拖到目录末尾时 anchor 可能是 `null`
  （追加到整个工作区末尾），目录内仍是最后一位，符合预期。
- **P0 不支持跨目录拖动**。现状下，「全部」视图里把行拖到同工作区另一个目录的行上：源行与目标行 `accountId` 相同，会画出插入线，
  但 `moveAnchor` 在目录顺序里找不到目标，返回 `undefined`，松手什么也不发生。P0 必须把手势作用域从 `accountId` 收窄为
  `accountId + folderId`（`pointerGesture.scope`），其他目录的行不画插入线（§5.4）。
- 0.2.0 不支持跨目录拖动；跨目录归置用行菜单。目录内精确位置用拖动或 `Alt+↑/↓`。
- 置顶行不参与目录内排序（宿主 pin 集合没有 move API）；其 `assign` 可在行菜单里改。
- 未分组桶没有目录功能，其行的菜单也没有「移到子目录」。

### 4.6 与既有功能的关系

| 功能 | 行为 |
|---|---|
| 置顶区 | 不按目录分组。置顶行的菜单有「移到子目录」，所属工作区由 `workspaceOfSession` 查得；查不到（未分组）则不显示。 |
| 归档三态 | 归档会话出现在原目录；计数随筛选变化。 |
| 空工作区 | `computeGroups` 不输出成员为 0 的组（`core.js:592`）：工作区全部会话都置顶或被归档筛选掉时，整个组连同切换条消失。目录数据保留，行菜单仍可归置。接受。 |
| 搜索 | P0 不变：扁平结果，搜索行不传 `folderOptions`（搜索行不经 `renderRow`，`body.js:1507-1534`）。结果显示「工作区 / 目录」属后续可选项，不排期。 |
| 优先级视图 | 不变。`orderedIds` / `priorityLevels` 从 `tree.groups` 派生（`body.js:1277-1295`），目录派生不修改 `tree`，因此覆盖面不变。优先级视图的行有「移到子目录」（按 `workspaceOfSession`）。 |
| 分页 | 每个目录小节、「未分类」小节、单目录视图各自分页，键为 §3.4 的 `section.key`；`requiredPageLimit` 按小节成员各算一次。工作区组本身有目录时不再分页。无目录时沿用 `pages[group.key]`。 |
| attention / 当前会话 | 「全部」视图里每个小节仍保证 attention 与当前会话不被分页藏起；**折叠的小节**与折叠的工作区一样会藏起它们（现状如此）。**单目录视图是显式过滤**：其他目录里的 attention / 当前会话不渲染，只在对应 chip 上标 `•`。是否改为「强制显示」待拍板（§9.3）。 |
| 状态点 / job watch | `visibleIds` 改为：有目录时，「全部」视图取各展开小节的 `pageRows(...).visible`，单目录视图取 `active` 的分页可见行；无目录时原逻辑。被过滤掉的行不 watch，因此其 job 驱动的运行态不会进入 rollup；chip 上的 `•` 只依据宿主状态（`statuses`）与已 watch 的 rollup。**明确降级**：仅由后台任务驱动、且所在目录被折叠或过滤的会话不会点亮 chip；P0 接受该降级，若要求全覆盖必须扩大 watch 集合（每个被隐藏目录的会话都开一条 roster，成本高，另评估）。 |
| `attention` 集合 | 仍按 `tree.groups` 全量计算（`body.js:1164-1175`），不受目录过滤影响。 |
| 会话菜单 | 新增「移到子目录」子菜单；其余项顺序与语义不变。 |
| 工作区拖动排序 | 不变，前提是目录小节不带 `data-dsm-group`（§5.2 第 4 条）。 |
| 窄栏 rail | 不变。 |

### 4.7 键盘与无障碍

- 目录树没有 chip 条；每个目录小节标题是 `button` + `aria-expanded`，Tab 逐个小节到达，Enter/Space 折叠/展开。
- 目录小节标题：`button` + `aria-expanded`，名称含目录名，右侧一个计数与 attention 点；Enter/Space 折叠/展开。
- 目录 `⋯`：受控 `Menu`，复用其 Esc / 外部点击 / 焦点回归。
- 会话行子菜单：父项获得焦点即打开子菜单；**↓/↑ 按 DOM 顺序进入子项**，没有 →/←（`Menu.tsx:425-438`）。子项不支持勾选态，当前目录用
  `IconCheckOutlineRegular` 作 leading icon；该图标容器是 `aria-hidden`，所以 label 必须是 ReactNode，附一段视觉隐藏文本「（当前）」。
- 弹窗：`Modal` 负责焦点圈定；输入框有 label；错误文本 `role="alert"`；校验失败不关闭。
- 删除确认默认焦点在「取消」。
- 文案明确「虚拟子目录，不会在磁盘创建目录」。
- 已知存量问题（不在本版修）：行是 `role="treeitem"`，但外层没有 `role="tree"` / `group` 结构。目录层级会加深这个问题，记入 §8。

### 4.8 视觉规格（只用官方 token）

| 元素 | 规格 |
|---|---|
| 切换条 | `padding-inline-start:20px`；`display:flex;flex-wrap:wrap;gap:4px`；上下 2px/4px；**不 sticky** |
| chip | 22px 高、`padding:0 8px`、`border-radius:var(--dsw-radius-sm)`、12px/18px、次级文字色；hover `--dsw-alias-interactive-bg-hover`；选中 `--dsw-alias-bg-layer-2` + 主文字色 + 1px `--dsw-alias-border-l1` |
| 计数 | 11px/16px、`--dsw-alias-label-tertiary`，与名称间距 4px |
| 目录小节标题 | 新 class `.dsm-folder-row` / `.dsm-folder-header`，**不使用** `.dsm-section-row`（后者 sticky，`body.js:519`）。28px 高、`padding-inline-start:38px`、chevron 10px、14px/20px 半粗次级色；右侧**只放一个计数与 attention 点**，不再有 chip 条或第二套目录图标 |
| 目录 `⋯` | 复用 `.dsm-workspace-action` 的 24×20 尺寸与 hover / `:focus-within` 显现，选择器挂在 `.dsm-folder-row` 上 |
| 未分类标题 | 同高，无图标，tertiary 文字 |
| 空目录 | 32px 行、12px/16px tertiary |
| 会话行 | 不变（32px、14px/20px） |
| 焦点环 | `outline:2px solid var(--dsw-alias-focus-ring);outline-offset:-2px` |

目录小节**默认不 sticky**：工作区表头已 sticky 在 `top:0`，第二层 sticky 需要 `top:32px` 并处理 macOS 玻璃背景与 z-index，
收益小、风险大。若要做，作为待拍板项（§9.3），单独一条 plugin 静态断言锁定 `top` 值。
深色/浅色都靠 alias token；不用状态色表达目录（状态色只属于状态点）。

---

## 5. 技术实现设计

### 5.1 `src/client/core.js`（纯派生层，无 DOM）

- 新增 §3.4 的函数，全部可单测。
- `readFolderState` 用白名单构造：只读 `v`、`workspaces.<id>.folders[]`（`id`/`name`）、`assign`（string→string）；
  用 `Object.create(null)` 或 `Map` 建字典并跳过 `__proto__` / `constructor` / `prototype` 键，防原型污染；不 `Object.assign` 原对象。
  快照在开发模式下被 `devFreeze` 冻结（`store/src/index.ts:170`），任何函数都不得原地修改输入。
- `computeGroups`、`orderMembers`、`moveAnchor` 不改。目录派生发生在 `computeGroups` 之后、只读 `tree.groups`，不改它的返回形状；
  因此置顶提升、`orderedIds`、`attention` 不受影响（§4.6）。受影响的只有渲染与 `visibleIds`，它们改为读 `folderViews`。

### 5.2 `src/client/body.js`（视图层）

1. **`folderStore(require)`**：与 `priorityStore` 同构。
   ```js
   const FOLDER_KEY = 'dsh-plugin:dsh-session-manager:folders'
   const FOLDER_INIT = Object.freeze({ v: 1, workspaces: {} })
   createSnapshotStore(FOLDER_INIT, { persist: { name: FOLDER_KEY } })   // 失败回退 observable(FOLDER_INIT)
   ```
   `readFolderState` 用「快照 === `FOLDER_INIT`」判断 `empty`。
2. **`apply()`**：创建 store；`ctx.effect` 注册 `storage` 监听（§3.6，返回 remove）；registration 的 `inject` 面新增：
   - `folderStore`（region 用 `useSyncExternalStore(folderStore.subscribe, folderStore.getSnapshot)` 订阅）；
   - `folderActions: { create, rename, remove, move, assign }`。每个动作：读 `getSnapshot()` 当前值 → `readFolderState`，非 `ok`/`empty`
     直接返回 → 应用纯函数（写入的工作区顺带 `pruneAssign`）→ 引用未变则不 `set` → 否则 `set(next)`。
     写操作放在面上，与 `setPriority(ies)` 的既有约定一致（`body.js:1862-1880`）；原稿让组件自己 `store.set`，与该约定相反。
   - `pruneAssign` 需要该工作区当前成员与 `phase`，由 region 调用时传入 `{ memberIds, ready }`。
3. **`SessionManagerRegion`**：
   - `const folderSnapshot = useSyncExternalStore(folderStore.subscribe, folderStore.getSnapshot)`
   - `const folderRead = useMemo(() => readFolderState(folderSnapshot), [folderSnapshot])`
   - `const workspaceOf = useMemo(() => workspaceOfSession(workspaces), [workspaces])`
   - `const [folderCollapsed, setFolderCollapsed] = useState({})`（`section.key → true`）
   - `const [folderDialog, setFolderDialog] = useState(null)`（`{ mode: 'create'|'rename'|'delete', workspaceId, folderId?, sessionId? }`）
   - `const folderViews = useMemo(() => folderRead.mode === 'readonly' ? {} : buildFolderViews({ groups: tree.groups, state: folderRead.state }), [tree, folderRead])`
4. **工作区 `Section` 不承载目录小节**。证据：`Section` 外层 div 无条件写 `data-dsm-group`（`body.js:942`），工作区拖动用
   `closest('[data-dsm-group]')` 找目标（`:309-318`）。若目录小节复用 `Section`，指针在展开的工作区内部移动时最近命中的是目录小节，
   目标 key 不在工作区顺序里，`moveAnchor` 返回 `undefined`，工作区拖动静默失效且没有插入线。另外 `.dsm-section-row` 是
   `position:sticky;top:0`（`:519`），嵌套后两层表头会叠在同一位置。做法：
   - `Section` 只增加一个 `body` 覆盖 prop（ReactNode）：存在时替代 `page.visible.map(renderRow)` 与分页按钮；工作区组有目录时传
     `sections.map(FolderSection)`（目录树）。`data-dsm-group`、sticky、`onStart` 座位、工作区拖动全部保持原样。
   - 新组件 **`FolderSection`**：不写 `data-dsm-group`，改写 `data-dsm-folder={section.key}`（预留标记，0.2.0 无拖动行为）；不挂任何 workspace
     手势；表头 class 为 `.dsm-folder-row`，不 sticky；右侧座位放 `FolderMenu`（未分类不放）。因为不复用 `Section`，原稿「给 `Section`
     加 `action` prop、与 `onStart` 共用座位」的方案作废，也就不存在两个按钮争座位的问题。
5. **`FolderStrip`（已删除）**：2026-11-09 改为目录树，不再有 chip 条。
6. **`FolderMenu`**：受控 `Menu`，`portal: true`、`align: 'end'`、`dense: true`（同行菜单）；items：rename / up / down / delete（`danger: true`）。
7. **`FolderDialog` / `FolderDeleteDialog`**：仿 `RenameDialog`；提交前 `folderNameError`。`folderActions.create` 在一次写入里完成
   create +（可选）assign + pruneAssign，返回新目录 id 或 `undefined`；达到 20 个上限/校验失败时不写，弹窗保持并显示错误。
8. **`SessionRow`**：
   - 新 prop `folderOptions`：`{ current: folderId|null, folders: [{ id, name }], canCreate, readonly }` 或 `undefined`；
   - `Section` 新增可选 `onNewFolder` / `newFolderLabel`：工作区表头的目录入口，注册工作区且非只读时始终传入。
   - `menuItems` 的 `useMemo` 依赖加上 `folderOptions`（region 侧要 memo 该对象，否则每次渲染都重建菜单）；
   - 在 `sep-move` 前插入 `{ id: 'folder', label: t('folders.moveTo'), submenu }`，子项 id 为 `folder:none` / `folder:<id>` / `folder:new`；
     只读模式下子菜单只有一条 `disabled` 说明项；
   - `folderOptions === undefined` 时不加（未分组、搜索行）。
9. **`renderRow`**：新增参数 `layout.folderScope`（`folderId | FOLDER_UNFILED | undefined`），并在内部按 `workspaceOf.get(sessionId)` 与
   `folderEntries` / `folderReadonly` 构造 `folderOptions`。`useCallback` 依赖表**必须**加入 `folderEntries`、`folderReadonly`、
   `workspaceOf`、`folderActions`、`setFolderDialog`；
   contract lane 的 `useCallback` 桩不看依赖（`test/contract.test.js:101`），这类遗漏只能靠 `test/plugin.test.js` 的静态断言拦（同 `priorities` 先例，`body.js:1270-1273`）。
10. **`selectAction`**：加 `folder:*` 分支。`folder:none` / `folder:<id>` → `folderActions.assign(workspaceOf.get(sessionId), sessionId, …)`；
    `folder:new` → `setFolderDialog({ mode: 'create', workspaceId, sessionId })`。依赖表同步更新。
11. **`visibleIds` / 分页**：见 §4.6；依赖表加入 `folderViews`、`folderCollapsed`。`pages` 键按 §3.4 的 `section.key`，与无目录时的 `group.key` 不冲突（含 `:`）。
12. **工作区折叠**：折叠时整组不渲染（现状），切换条随之消失；目录折叠只影响小节。

### 5.3 持久化与写入

- 每个用户动作一次 `set`（新建并归置也在同一次 `folderActions.create` 内完成）；无变化不 `set`。
- `readFolderState` 在每次快照变化时跑一次（memo），写入前在面上再跑一次。
- store 同步通知（未用 `flush: 'raf'`），归置后立即重渲染，不等宿主快照。
- 不写宿主：`folderActions` 内没有任何 `ctx.*` 调用；只有目录内排序仍走 `insertSessionBefore`。

### 5.4 拖动手势

**P0（必须）**：把会话手势的作用域从 `accountId` 收窄到「工作区 + 目录」。

- `gestureDown('session', …, { accountId, order, scope })`，`scope = ${accountId}:${folderScope ?? ''}`；`pointerGesture` 增加 `scope` 字段。
- `SessionRow.onPointerMove` 的判断从 `pointerGesture.accountId !== accountId`（`body.js:803`）改为比较 `scope`（保留，作为非 capture 环境的兜底）。
- 由于 `gestureDown` 对源行 `setPointerCapture`（`body.js:229-230`），`pointermove` 始终派发到源行，`:803` 比较的实际上是源行自己的
  `accountId`，恒等；目标由 `elementUnder` 按坐标命中。所以真正的过滤要放在命中之后：行上加 `data-dsm-scope`，`onDragOverRow`
  丢弃 scope 不同的目标。推论：**现有代码可能本来就会在其他工作区的行上画出无效插入线**（松手时 `moveAnchor` 返回 `undefined`，不写宿主）。
  这是从代码推出的，未在浏览器验证，`verification-gap`；P0 的 scope 过滤会顺带修掉。
- 无目录时 `scope` 退化为 `${accountId}:`，行为与 0.1.7 相同。

**不在 0.2.0：拖到目录（已移出）。** 归置走行菜单即可；若未来恢复，才需要同时识别 `[data-dsm-session]` 与
`[data-dsm-folder]`、`data-drop="into"` 和「拖到目录只写 store、不写宿主」的用例。

### 5.5 清理与生命周期

- store 订阅随 `useSyncExternalStore` 释放；`storage` 监听在 `ctx.effect` 的 cleanup 中移除。
- `Modal` / `Menu` 随组件树卸载。
- **cleanup 不写宿主、不删除存储键**：停用后重新启用应恢复目录。**2026-11-08 已确认保留策略**；现行
  `PLUGIN-CONTRACT.md:16` 的「不残留 storage key」按 §6.2 的修订执行，契约文件在实施 P0 时同步更新。
- 样式仍挂在 `apply` 的 `<style data-dsh-session-manager>` effect 上。

### 5.6 声明面与打包

- cordis `inject` 仍为 `['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale']`（`body.js:1728`）；`dsh.client.inject` 仍为 `[]`。
- 不新增 `require`：`@deepseek-ai/dsh-client-store` 已被 `priorityStore` 使用；`IconCheckOutlineRegular`、`IconFolderOpenOutlineRegular`
  只是从已 require 的 primitives 多解构两个名字。
- `files` 不变。
- bundle 内 `zh` / `en` 字典同步新增 `folders.*` 键（现有测试已断言两套键一致）；`locale/*.json` 只改 `meta.description`。

---

## 6. 版本、契约与发布

### 6.1 版本与兼容声明

- `package.json.version`：`0.1.7` → **`0.2.0`**（新持久化 schema + 新界面层级）。
- `peerDependencies`：全部 `@deepseek-ai/dsh-*` 从 `>=0.2.0-alpha.0 <0.3.0` 改为 **`>=0.2.0-alpha.0 <0.3.0-0`**；`@deepseek-ai/cordis` 保持 `^4.0.2`。
  这里按 DSH 运行时的 `includePrerelease: true` 语义设计（§1.5）。npm 默认语义下 `0.2.2-rc.1` 仍不满足该范围，`npm install` 可能给出
  peer 提示；这些 peer 都是 `optional`，不影响 DSH 激活。
- `test/alignment.test.js`：
  - `:79`、`:84`、`:108` 的范围字面量改为新范围；
  - `:82`、`:107` 的期望版本 `0.2.1-alpha.5` 改为 lane 所对的 checkout 版本（本次 `0.2.2-rc.1`）。建议改成「范围在 `includePrerelease`
    下覆盖 checkout 版本」的断言，不再把单一版本写死；alignment lane 不能 import semver 时可内联一个最小比较；
  - 新增断言见 §7.3。
- `README.md` / `README_EN.md` 兼容段落写 0.2.2-rc.1 为已验证基线，并写明子目录为本机插件数据。
- `package-lock.json` 的 `version` 同步（`npm version 0.2.0 --no-git-tag-version`）。

### 6.2 插件契约修订（已拍板：保留；已同步到 `PLUGIN-CONTRACT.md`）

**决策**：2026-11-08 仓库所有者确认「关闭插件时保留子目录数据」。因此现行契约中「不得残留 storage key」
与「只允许视觉偏好」两条需要修订；下面是待落到 `PLUGIN-CONTRACT.md` 的文本（策略已定，契约文件待同步）。

冲突点：

- `PLUGIN-CONTRACT.md:16`：停用/卸载/升级/替换后不得残留 storage key。cleanup 也会在升级与 HMR 时运行；照此删除，用户每次升级都会丢失目录。
- `PLUGIN-CONTRACT.md:29`：插件私有存储只列了「Plugin-only visual preference」。子目录是用户建立的组织数据，不是视觉偏好。
- 既有优先级标签（`dsh-session-manager.priority`）已经在这两条上越界，且键名不符合 `:50` 的命名空间；修订应一并覆盖。

推荐修订文本（**已确认保留策略，已同步到契约文件**）。区分两类插件私有状态：

```markdown
<!-- 替换 :16 -->
- no stale DOM, event listener, timer, observer, subscription, style, or background task remains, and no
  **transient** storage key remains (see "Storage and interoperability"); durable plugin user data is
  retained by design;

<!-- 数据所有权表新增两行，替换 "Plugin-only visual preference" 一行 -->
| Plugin-only transient UI state (open menus, drag markers, caches) | Plugin | In memory, or namespaced storage removed by `cleanup` |
| Plugin-only durable user data (e.g. virtual folders, priority labels) | Plugin | Namespaced key `dsh-plugin:<plugin-id>:<name>`, versioned schema, documented owner and manual removal; retained on disable/upgrade; never removed by `cleanup`; unknown versions are read-only |

<!-- "Storage and interoperability" 追加 -->
- Durable plugin user data must not duplicate, shadow, or reinterpret host-owned state; disabling the
  plugin must leave every host-owned value renderable by native UI without migration.
- Legacy key `dsh-session-manager.priority` predates the namespace rule and is kept as-is.
```

### 6.3 文档与文案

- 本文 `docs/DESIGN-0.2.0.md`；实现后新增 `docs/ACCEPTANCE-0.2.0.md`（验收记录）。
- `docs/USAGE.md` 增加「虚拟子目录」：建/改名/删/排序/归置/切换/数据归属/只读模式/手动清理。
  手动清理写法：DevTools → Application → Local Storage → 删除 `dsh-plugin:dsh-session-manager:folders`；桌面与浏览器各自一份。
  注意 `USAGE.md:114` 现有「不使用 localStorage」的表述只针对宿主动作，需改写避免误读。
- `README.md` / `README_EN.md`：功能列表加一条；「范围与限制」写明一级、本机同 origin、不写磁盘、原生 UI 不显示。
- `CHANGELOG.md` 顶部加 0.2.0。
- `PLUGIN-CONTRACT.md`：按 §6.2，仅在批准后修改。
- 文档不得出现本机绝对路径（CI leak-scan 会拦截 macOS / Linux 用户主目录的绝对路径，`.github/workflows/ci.yml:20`；`docs/` 随 npm 包发布）。

### 6.4 降级与回滚

- 回滚到 0.1.7：旧代码不读该键，会话按工作区正常显示；数据留在本地，重装 0.2.0 即恢复。
- 停用 / 卸载：键保留（已拍板并同步契约）；宿主数据零变化。
- 未来 schema v2：必须显式迁移；0.2.0 遇到 v2 只读，不覆盖。

### 6.5 发布

按仓库既有流程 `npm run verify` → `npm pack --dry-run` → 审计 → 发布。`npm publish` 需要维护者本人完成 2FA，不在本设计任务内执行。

---

## 7. 测试与验收设计

本节是**待实现的用例清单**，一条都还没写、没跑。lane 说明：`core` = `test/core.test.js` 纯函数；`contract` = `test/contract.test.js`
渲染契约（fake React + stub primitives，store 走 `observable` 回退，`useMemo`/`useCallback` 不看依赖）；`static` = `test/plugin.test.js`
对产物的字符串断言；`align` = `test/alignment.test.js`（需 `DSH_SOURCE`）；`browser` = 维护者台架（不随仓库分发）；`manual` = 实机人工。

### 7.1 core

| ID | 断言 |
|---|---|
| CO-1 | `readFolderState`：`undefined`/`null`/init → `empty`；`{v:1,…}` → `ok`；`{v:2}` → `readonly/newer`；数组、字符串、`{}`、`{v:'1'}` → `readonly/unrecognized` |
| CO-2 | `readFolderState` 净化：重复 id、空名、超长名、非字符串 assign 值被跳过；`{"__proto__":{"x":1}}` 等输入不污染 `Object.prototype`；输入对象 `Object.freeze` 后不抛错 |
| CO-3 | `folderNameError`：空、仅空白、41 个字符、控制字符、大小写重名、四个保留名、重命名时与自身同名不报错（`exceptId`） |
| CO-4 | `createFolder` 第 21 个返回原引用；`deleteFolder` 清掉指向它的 assign；重复删除 / 移到边界 / 归到当前目录都返回原引用 |
| CO-5 | `moveFolder` 上移/下移只改顺序，不改 assign |
| CO-6 | `pruneAssign` 只删该工作区里不在 `memberIds` 的条目，不动其他工作区 |
| CO-7 | `buildFolderView`：归属分桶正确；输入顺序保持；空目录与空「未分类」都保留小节；非法 `activeId` 回落 `ALL`；chip 计数之和等于输入长度 |
| CO-8 | `buildFolderViews`：未分组桶与无目录工作区给 `null`；`section.key` 形如 `${groupKey}:f:${id}` / `${groupKey}:u` |
| CO-9 | `moveAnchor` 用目录可见顺序：上下移动与拖动 before/after 给出的 anchor 都在该目录内，末尾给 `null` |
| CO-10 | `workspaceOfSession`：同一会话出现在两个工作区时取 `items` 中第一个 |

### 7.2 contract

| ID | 断言 |
|---|---|
| CT-1 | 无目录：渲染树中无 `FolderSection`；工作区分页键仍为 `group.key`（0.1.7 回归） |
| CT-2 | 有目录：出现各目录小节；`FolderSection` 节点不带 `data-dsm-group`，工作区 `Section` 仍带；无 `FolderStrip` / chip |
| CT-3 | 点目录小节标题只改变该小节的展开/折叠，宿主调用记录为空 |
| CT-4 | 行菜单 `items` 中 `id:'folder'` 的 `submenu`：当前目录项带 check icon 与「（当前）」文本；`onSelect('folder:<id>')` 后 `folderStore` 快照变化、宿主调用为空；`folder:none` 清 assign；`folder:new` 打开弹窗 |
| CT-5 | 弹窗：校验错误不关闭、取消不写、删除确认后会话回到「未分类」，宿主调用中没有 `insertSessionBefore` / pin / archive；**工作区表头 folder-plus 在有/无目录时都出现，建完后仍在，且不写 `assign`** |
| CT-6 | 折叠某个目录小节后，该目录的行从渲染树消失；其他目录和宿主调用不受影响 |
| CT-7 | 「全部」视图中，A 目录的行拖到 B 目录的行：`dropTarget` 保持 `null`，无宿主调用（P0 scope 过滤） |
| CT-8 | 置顶行与优先级视图行有「移到子目录」；未分组行与搜索行没有 |
| CT-9 | `visibleIds`：折叠的目录小节与被过滤的目录不进入 `watchRows` 调用集合 |
| CT-10 | 只读：注入 `folderStore` 快照 `{v:2}` 后无目录小节、无表头创建入口，子菜单只有一条 disabled 项，调用 `folderActions.*` 后快照引用不变 |
| CT-11 | `storage` 监听：给 sandbox `window` 补 `addEventListener`/`removeEventListener` 桩，cleanup 后监听集合为空；派发 `{key:FOLDER_KEY,newValue:…}` 后快照更新 |
| CT-12 | 既有 lane（归档三态、优先级、搜索、分页、折叠、job watch、cleanup 宿主快照不变）全部保持绿 |

### 7.3 static 与 align

| ID | lane | 断言 |
|---|---|---|
| ST-1 | static | `persist: { name: 'dsh-plugin:dsh-session-manager:folders' }` 存在；bundle 仍不含 `localStorage` 等四个字样 |
| ST-2 | static | `renderRow` 的 `useCallback` 依赖表包含 `folderEntries`、`folderReadonly`、`workspaceOf`（防止重演 `priorities` 漏依赖） |
| ST-3 | static | `.dsm-folder-row` 规则不含 `position:sticky`；`FolderSection` 源码不出现 `data-dsm-group` |
| ST-4 | static | `inject` 仍是 5 项；`pkg.dsh.client.inject` 仍为 `[]` |
| AL-1 | align | peer 范围在 `includePrerelease` 下覆盖 checkout 版本，且不覆盖 `0.3.0-alpha.0` |
| AL-2 | align | `Menu.tsx` 含 `submenu?: readonly MenuEntry[]`；icons 含 `IconCheckOutlineRegular`、`IconFolderOpenOutlineRegular` |
| AL-3 | align | `store/src/index.ts` 含 `persist?: { name: string }` 与 `localStorage.setItem(name, JSON.stringify(state))`（整值写的前提） |
| AL-4 | align | `plugin-compatibility.ts` 仍用 `includePrerelease: true`（范围设计的前提） |

### 7.4 browser（台架，可由 agent 驱动）

| ID | 步骤与断言 |
|---|---|
| BR-1 | 无目录时与 0.1.7 截图对比：仅行菜单多一项 |
| BR-2 | 建 2 个目录 → 目录树出现 → 折叠/展开各小节 → 会话按目录分组显示 |
| BR-3 | 工作区表头拖动跨过一个展开且有目录的工作区：插入线出现、松手后顺序改变 |
| BR-4 | 长列表滚动：只有工作区表头 sticky，目录小节表头随内容滚走 |
| BR-5 | 同一 origin 开两个标签页：A 建目录，B 不刷新即可看到；B 再改名，A 收到 |
| BR-6 | 340px 侧栏宽度下目录树标题不挤占会话标题，深浅主题对比度可读 |

### 7.5 manual（只能实机人工）

| ID | 步骤与断言 |
|---|---|
| MA-1 | 归置后重启 DSH 桌面版，归属仍在（验证 `dsh-app://app` origin 的持久化，`verification-gap`） |
| MA-2 | 目录内拖动 / `Alt+↑/↓` 后刷新，宿主顺序保持；原生 UI（停用插件）里顺序一致 |
| MA-3 | 置顶行归置 → 取消置顶 → 回到目录 |
| MA-4 | 读屏（VoiceOver）：chip 的按下状态、计数、`•` 文本，子菜单当前项「（当前）」可读 |
| MA-5 | 停用插件 → 原生列表完整；重新启用 → 目录恢复 |
| MA-6 | 桌面版与浏览器 Web GUI 各自独立（预期不同步），文档描述与实际一致 |

验证缺口：agent 无法连接真实应用渲染进程（0.1.7 验收已记录），MA 项只能由用户完成；台架与 lane 只证明调用与 DOM 形状。

---

## 8. 风险与取舍

| 风险 | 影响 | 处理 |
|---|---|---|
| 契约未同步就实现 | 设计与仓库契约冲突，cleanup 语义无法自洽 | §6.2 已拍板保留；实施 P0 时同步契约文件 |
| 多窗口整值覆盖 | 不收敛时，一个窗口的写入会抹掉另一个窗口的全部改动 | P0 `storage` 监听 + 面上读最新快照；剩余竞争 last write wins |
| 存储按 origin 隔离 | 桌面与浏览器、不同端口之间看不到彼此的目录；换机器也看不到 | 文档写明；与宿主 `dsh.workspace.view.v5` 同等局限 |
| 损坏 JSON | 第一次写入覆盖原值 | 接受；宿主已打 `rehydration failed` 日志 |
| 版本降级 | 新版本写入的 v2 在旧版里只读、看不到目录 | 只读 + 说明文案，不覆盖 |
| 卸载后孤儿键 | 少量本地数据残留 | 命名空间键 + 手动清理说明；不自动删 |
| 工作区重建 id 变化 | 旧目录数据不再显示 | 文档说明；不按路径猜身份 |
| 用户把子目录当宿主归属 | 换客户端或停用插件后「目录消失」 | 入口与弹窗文案、README 边界；图标与层级轻于工作区 |
| 单目录视图藏起 attention 会话 | 运行中/等待输入的会话不在眼前 | chip `•` 标记；是否强制显示待拍板 |
| 隐藏目录的后台任务不点亮 chip | 只有后台 job 在跑、且目录被折叠/过滤时，`•` 不会亮 | P0 接受；需要全覆盖时扩大 watch 集合，成本单列 |
| submenu 菜单不滚动 | 目录多时行菜单超出窗口 | 每工作区 20 个上限 |
| 嵌套表头与拖动 | 复用 `Section` 会破坏工作区拖动与 sticky | 独立 `FolderSection`（§5.2 第 4 条） |
| 依赖表漏项 | 菜单/行显示旧目录 | ST-2 静态断言 |
| 树形 ARIA 不完整（存量） | 读屏层级表达弱 | 不在本版修；单独立项 |
| 性能 | 每次快照变化重算 `buildFolderViews` | 线性扫描，成本与 `computeGroups` 同级；不另做优化 |

**宿主侧存储（不是当前能力）**：若要跨窗口一致、跨客户端同步，需要宿主提供插件可写的持久化。可选路径是插件 host 半（`src/index.js`，
当前空 `apply`）注册一个 Remote 命名空间并落宿主存储，客户端经 `ctx.remote` 读写。代价：新增 host 侧声明与 Remote 契约、
`dsh.client.inject` 可能要声明对应客户端模块、要处理离线与冲突、要从 localStorage 迁移；且需确认宿主是否允许插件注册 Remote
命名空间（本轮未核实，`verification-gap`）。`settings-controller` 面向配置与凭据（`packages/api/settings-controller/README.md`），
不适合承载会话分组。0.2.0 不走这条路，记为上游需求。

---

## 9. 分期与待确认

### 9.1 开工前（必须先做，不属功能）

1. 契约：保留策略已拍板（2026-11-08），§6.2 文本已同步到 `PLUGIN-CONTRACT.md`。
2. 基线三项分别确认归属与意图：
   - `SESSION_PAGE_BASE=50`：保留 → 更新 4 条分页用例（§1.4）；回退 → 恢复 5。
   - blank 可见性：确认「displayTitle 恒有 → 实际不再隐藏 blank」是否为预期；保留 → 更新 `core.test.js:579`；否则回退。
   - macOS 表头 CSS：要保留就改进 `src/client/body.js:524` 并更新 `plugin.test.js:170`；否则 `npm run build` 覆盖产物。
3. 处理 `client/client.js.bak-20261029021744`（移出仓库），`npm run build` 后 `git diff --exit-code -- client/client.js` 为空。
4. `npm test` 全绿，记录 commit 作为 0.2.0 起点。若这批改动要单独发布，先按 0.1.8 收口，再开 0.2.0 分支。

### 9.2 分期

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0（0.2.0 必须）** | schema / 读取分类 / 纯函数；store + `folderActions` 面；`storage` 收敛；目录树；`FolderSection`；新建/改名/删除/上移/下移；行菜单归置；手势 scope 过滤；版本/范围/文档/契约 | 已实现：152 tests / 152 pass（含 13 条 alignment）；§7 未写到的用例待补；BR/MA 未做 |
| **P1（已移出 0.2.0）** | 拖动会话到目录；目录树 roving focus；搜索结果显示「工作区 / 目录」 | 不排期；P0 的行菜单已覆盖归置能力 |
| **P2（已移出 0.2.0）** | 拖动目录排序；新建会话自动归入当前目录；目录图标/颜色；宿主侧存储 | 按需另立，不纳入 0.2.0 |

### 9.3 默认决策与待拍板

默认决策（无异议按此实现）：

1. 一级目录，不嵌套；每工作区上限 20。
2. 「全部」为默认视图；active 只在 React state。
3. 存储键 `dsh-plugin:dsh-session-manager:folders`，v1，未知版本只读。
4. 归置用行菜单；不做拖动入目录；P0 拖动只在同一目录内。
5. 置顶区不按目录分组；未分组桶没有目录。
6. 版本 `0.2.0`，peer 范围 `>=0.2.0-alpha.0 <0.3.0-0`。

**已拍板**：

1. **契约修订 / 关闭策略**（§6.2）：2026-11-08 确认「保留数据」；契约文本在实施 P0 时同步。

**待用户拍板**（无定论前按括号内默认值写进实现计划）：

2. **目录小节表头是否 sticky**：（默认否）。若要，`top:32px` 并补 macOS 玻璃背景与静态断言。

另有一项需产品确认、但不阻塞开工：单目录视图下 attention / 当前会话是否强制显示（默认不强制，只在 chip 标 `•`）。

---

## 10. 证据附录

```bash
DSH=<dsh-checkout>          # dsh-v0.2.2-rc.1 源码
PLUGIN=<plugin-checkout>    # 本仓库

git -C "$DSH" describe --tags --always     # dsh-v0.2.2-rc.1
git -C "$DSH" rev-parse HEAD               # 只在本地核对，不写入仓库
git -C "$DSH" status --short               # (empty)

# 在临时副本里跑，避免产物写回仓库
TMP=$(mktemp -d) && rsync -a --exclude node_modules "$PLUGIN"/ "$TMP"/repo/ && cd "$TMP"/repo
npm test                                                   # tests 127 / pass 110 / fail 6 / skipped 11
DSH_SOURCE="$DSH" node --test test/alignment.test.js       # tests 11 / pass 9 / fail 2

# peer 范围（DSH 运行时语义）
node -e "const s=require('$DSH/node_modules/.pnpm/semver@7.7.4/node_modules/semver');
  for (const v of ['0.2.1-alpha.5','0.2.2-rc.1','0.3.0-alpha.0'])
    console.log(v, s.satisfies(v, '>=0.2.0-alpha.0 <0.3.0-0', { includePrerelease: true }))"
```

宿主源码（相对 `<dsh-checkout>`）：

- `packages/api/session-controller/src/client/sessions/service.ts:27-58`（`SessionSummary`）
- `packages/api/workspace-controller/src/types.ts:18-30`（`WorkspaceView`）
- `packages/api/workspace-controller/src/client/service.ts:104-114`、`:178-186`（`insertSessionBefore`）
- `packages/api/workspace-controller/src/client/model.ts:29-41`（`WorkspaceSnapshot.phase: 'pending'|'ready'`）
- `packages/workspace/workspace/src/entity.ts:152-169`（anchor 校验与 `move-invalid`）
- `packages/workspace/workspace/src/index.ts:518`、`:682`（`randomUUID` 工作区 id）
- `packages/api/workspace-files/src/index.ts:233-341`（只读 Remote）
- `packages/client/store/src/index.ts:103-167`（`createSnapshotStore`、`attachPersistence`）
- `packages/client/ui-primitives/src/Menu.tsx:16-29`、`:425-438`、`:474-541`（`submenu` 数据与行为）
- `packages/client/ui-primitives/src/icons/index.tsx:70`、`:334`、`:340-355`
- `packages/client/ui-sidebar/src/client/contract/slots.ts:45`（`sidebar.workspaces` single/root）
- `packages/client/ui-slots/src/index.ts:775`、`:1215-1218`（priority：升序、最低渲染、同 rank 抛错）
- `packages/client/ui-workspace/src/client/index.ts:330-345`（官方注册，默认 priority）
- `packages/client/ui-workspace/src/client/stores.ts:91`（`dsh.workspace.view.v5`）
- `packages/boot/app-boot/src/plugin-compatibility.ts:51-75`（`includePrerelease: true`）
- `apps/desktop/src/main.ts:473`、`apps/desktop/src/ipc.ts:101`（`dsh-app://app/`）

插件源码：

- `src/client/body.js`：`:49`（`SLOT_PRIORITY`）、`:117-124`（priority store）、`:214-231`（`gestureDown` + pointer capture）、
  `:309-318`（`elementUnder`）、`:519`（sticky 表头）、`:715-882`（`SessionRow`）、`:894-969`（`Section`，`:942` `data-dsm-group`）、
  `:1049`（`computeGroups` 调用）、`:1220-1273`（`renderRow`）、`:1309-1355`（`visibleIds` → watch）、`:1728`（`inject`）、`:1806-1883`（注册与注入面）
- `src/client/core.js`：`:419`（`moveAnchor`）、`:538-547`（`isVisibleMember`）、`:560-618`（`computeGroups`）、`:695`（`SESSION_PAGE_BASE`）、`:725-747`（分页）
- `test/plugin.test.js:130-133`（禁止 Web Storage 字样）、`test/contract.test.js:100-164`（桩）、`test/alignment.test.js:76-110`（版本硬编码）
- `PLUGIN-CONTRACT.md:16`、`:29`、`:49-52`；`.github/workflows/ci.yml:20`、`:41-44`

---

## 11. 评审修订记录

评审范围：本文全文对照 `<dsh-checkout>`（dsh-v0.2.2-rc.1）与插件工作树；只改本文，未改代码、测试、配置、契约，未提交。
测试只在临时副本中运行。

### 11.1 事实修正

| 原稿主张 | 修正 | 证据 |
|---|---|---|
| peer 范围 `>=0.2.0-alpha.0 <0.3.0` 不匹配 0.2.2-rc.1，需改为 `>=0.2.2-rc.1 <0.3.0` | DSH 运行时用 `includePrerelease: true`，现范围**匹配**；缺陷是上限放行 `0.3.0-alpha.*`。改为 `>=0.2.0-alpha.0 <0.3.0-0`，保留 0.2.1-alpha.5 | `plugin-compatibility.ts:51-52`；§1.5 实测表 |
| 6 条红 = 5 条分页 + 1 条 CSS | 4 条分页 + 1 条 blank 可见性（`core.test.js:579`）+ 1 条 CSS | 临时副本复跑 |
| `SessionSummary` 只有 id/title/cwd/…/projectionValues | 漏了 `displayTitle`、`formatStatus`、`retainedBy`；结论（无目录字段）不变 | `service.ts:27-58` |
| workspace-files 有 stat/read/list/watch | 实为 `read / readBytes / stat / list / changes(stream)`；只读结论不变 | `workspace-files/src/index.ts:233-341` |
| `createSnapshotStore` 用 localStorage 持久化 | 补充：整值写、回填不校验、解析失败保留 init、无 `storage` 监听；这些直接决定了 §3.5 与 §3.6 | `store/src/index.ts:139-167` |
| 多窗口「可能丢一次写入」，原稿放后续 | 整值写使旧窗口一次写入就覆盖另一窗口全部改动；收敛升为 P0 | 同上 |
| 只说「不跨设备」 | 补充按 origin 隔离：桌面 `dsh-app://app` 与浏览器 Web GUI 不共享 | `apps/desktop/src/main.ts:473` |
| `Menu` 子菜单「方向键进入」 | 只有 ↑/↓ 按 DOM 顺序进入，无 →/←；子项无勾选态；含 submenu 的菜单不滚动 | `Menu.tsx:425-438`、`:474-541` |
| 契约只需在所有权表加一行 | 与 `:16`（无残留 storage key）和 `:29`（仅视觉偏好）冲突；2026-11-08 已拍板保留并同步契约 | `PLUGIN-CONTRACT.md` |
| `IconProjectAddOutlineRegular` 可用于「新建子目录」 | 已用于「添加工作区」，复用会同形异义；撤掉表头新建按钮 | `body.js:1461` |
| 文档引用本机绝对路径 | 全部换成 `<dsh-checkout>` / `<plugin-checkout>` / `~/.dsh/...`；否则 CI leak-scan 失败，且随 npm 包发布 | `ci.yml:20`；`package.json` `files` 含 `docs` |
| 已核实（无需修正） | `WorkspaceView` 无嵌套；`insertSessionBefore` 签名；`sidebar.workspaces` single/root；`priority:-2` 遮蔽默认 0；`submenu`、两个图标、`persist` 在 0.2.1-alpha.5 与 0.2.2-rc.1 均存在 | §1.3、§1.5 |

### 11.2 设计改动与理由

| 章节 | 改动 | 理由 |
|---|---|---|
| §3.4 | 统一为 `buildFolderView`（单组）+ `buildFolderViews`（包装）；单 `input` 对象；写函数无变化返回原引用 | 原稿三名混用；与 `computeGroups` 风格一致；便于跳过 `set` |
| §3.5 | 读取分类表：`empty` / `ok` / `readonly(newer|unrecognized)` | 原稿「v 缺失只读」与「非法降级为空 state」矛盾 |
| §3.3 | 每工作区 20 个上限；保留名含双语；写入时 `pruneAssign` | submenu 不滚动；切换语言后仍可区分；限制孤儿增长 |
| §3.1 / §4.1 | active 与折叠明确只在 React state，全文一致 | 原稿已基本一致，补齐 rail / HMR 场景 |
| §4.4 | 工作区表头常驻 folder-plus；行菜单仍可新建并归置；目录树没有 chip 条 | 实机反馈首个目录不可发现；树去掉双导航 |
| §4.5 / §5.4 | P0 加手势 scope（工作区 + 目录）与命中后过滤 | 否则跨目录拖动画出无效插入线；pointer capture 使 `:803` 检查失效 |
| §4.6 | 补空工作区组消失、attention 在单目录视图的处理、`visibleIds` 与 watch 的精确定义 | 原稿未覆盖 |
| §5.2 | 不复用 `Section` 承载目录；新 `FolderSection` 不带 `data-dsm-group`、不 sticky；`Section` 只加 `body` 覆盖 prop | `body.js:942`、`:519` |
| §5.2 | 写操作移到注入面 `folderActions`，读最新快照 | 与 `setPriority` 约定一致；避免闭包旧值覆盖 |
| §5.2 | 明确 `renderRow` / `menuItems` / `selectAction` 依赖表，补静态断言 | contract lane 的 hook 桩查不出漏依赖 |
| §6.2 | 契约修订文本；2026-11-08 所有者确认保留策略 | 设计成立的前提 |
| §7 | 改为带 ID 的可执行用例清单，分 lane，标明人工项 | 原稿是描述性列表 |

### 11.3 仍未解决

见 §9.3「待用户拍板」两项（active 是否持久化、目录小节是否 sticky）。关闭策略已拍板为「保留」。

### 11.4 未执行 / 未验证

- 只读预检脚本本轮未复跑。
- 0.2.1-alpha.5 的 submenu 行为细节未逐行比对，只确认了字段与导出存在。
- 「现有代码会在其他工作区行上画出无效插入线」由代码推出，未在浏览器验证。
- 桌面版 `dsh-app://app` 的 localStorage 跨重启持久化未实测（MA-1）。
- 宿主是否允许插件 host 半注册 Remote 命名空间未核实（§8）。
- §7 的所有用例均未编写、未运行。
