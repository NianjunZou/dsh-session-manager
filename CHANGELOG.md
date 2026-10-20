# Changelog

## 0.1.7 - 2026-10-20

### 破坏性变更

- **接管方式改为官方 slot 占位**。0.1.x 用 DOM 投影（隐藏原生行 + `MutationObserver` + 自绘 DOM）
  实现接管；0.1.7 改为在 `sidebar.workspaces` 上以 `priority: -2` 注册一个 React 占位者
  （官方以默认 0 注册，slot 渲染最低的存活 rank）。`client/client.js` 因此从手写 DOM 代码变为由
  `src/client/{core,body}.js` 构建出的单文件模块（提交进仓库，`npm run build` 可复现）。
- **启用期间官方会话区不再渲染**，其 5 个子槽（`session.menu.item`、`session.row.action`、
  `session.row.leading`、`session.row.hover`、`workspaces.directoryFlow`）由官方注册项声明且无法被
  遮蔽者重新声明，因此官方与第三方注册到这些槽的贡献在启用期间不会出现。停用即恢复。
  已知影响：官方 `ui-schedule` 的定时任务标记/列表、第三方插件注册的会话菜单项。
- 相对时间改用宿主共享的 bucket 集合（`now|minutes|hours|days|months|years`），不再有「周」档：
  同一会话在所有 DSH 界面里读法一致。

### 新增

- **优先级视图入口改成 P 徽标；勾选框固定在最前面。** 之前用官方
  `IconChecklistOutlineRegular`（勾选清单）容易被读成"待办清单"而不是这插件的优先级；
  现在是一个带细边框的圆角 **P** 徽标（10px 粗体、16×16，视图打开时变成强调色实心 + 反白），
  徽标本身是装饰（`aria-hidden`），可访问名由按钮的 `aria-label` 给出。行内的勾选框移到
  状态点之前，成为每行的第一个子元素——选择列位置固定，不会随标题长度漂移。

- **优先级视图 + 批量改优先级。** 头部新增「优先级视图」开关（`IconChecklistOutlineRegular`，
  `aria-pressed` 表达状态）：列表按等级重排成 `P1…P4` 分区（空等级不占位），最后是「未标记」分区
  （默认折叠，需要给未标记的会话打标时再展开）。视图打开时列表上方出现批量条：**已选 N 个**、
  P1–P4、「清除标记」、「选中已标记」、「清空选择」、「完成」；每行的勾选框走原生
  `input[type=checkbox]`（点标题仍然是打开会话）。批量写入在 face 上合成**一次** store 写入
  （`setPriorities`），选中很多行也只重绘一次；退出视图恢复置顶/项目结构并清空选择。
  这一条正是为了解决"会话做完了、取消置顶时忘了清优先级，之后一个个改很麻烦"。

- **动态调整会话顺序**：拖动、`Alt+↑/↓`、行菜单「上移 / 下移」三条路径统一调用宿主
  `workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)`，写入宿主耐久顺序。
  未分组会话（无宿主账户）不参与排序，跨工作区拖动会被拒绝。
- **置顶区拖动重排**。宿主 pin 集合是前插语义且没有 move API，插件按 `pinRepinPlan` 只重写
  「与目标顺序不一致的最小后缀」（unpin 后按目标顺序逆序 pin），拖动过程中置顶区直接显示目标顺序，
  避免暴露宿主逐个写入的中间态；计划里出现归档会话时整体中止并提示。
- **工作区拖动重排**：走 `workspaces.insertBefore(workspaceId, beforeWorkspaceId)`。
- **分层状态小圆点**：主点复用官方 `StateDot` 五态；限定标记覆盖子会话执行中、后台任务执行中、
  已完成未读；后缀数量用 `--dsw-alias-state-*` token 上色。优先级改为
  `等待 > 本会话执行中 > 子会话在跑 > 后台任务在跑 > 已完成未读 > 空闲`，一个事实只给一个点。
- **优先级标记 P1–P4（带色分档）**：行菜单新增「优先级标记」——P1 最高 / P2 较高 / P3 普通 /
  P4 参考 / 清除，行尾显示数字胶囊。四档同属一个强调色
  （`--dsw-alias-state-business-primary`）：**P1** 实心 chip + 反色文字
  （`--dsw-alias-label-primary-inverted`）、**P2** 45% 底色、**P3** 22% 底色、**P4** 灰字
  （`--dsw-alias-label-secondary`）+ 10% 灰底。状态色（红 / 琥珀 / 绿 / 中性）只属于状态点，
  优先级规则里不出现，静态 lane 会拦住回归。状态经官方 `@deepseek-ai/dsh-client-store` 持久化
  （键 `dsh-session-manager.priority`），重启与重装插件均保留；宿主没有该包时退化为会话内有效。
  0.1.7 开发早期按颜色存储的值（`red|amber|green|blue`）会自动映射到等级。
- **会话搜索**：标题 / 工作区名本地匹配 + 宿主 `sessions.search` 内容索引合并，250ms 防抖、
  上一请求 abort、查询按宿主 wire 契约清洗（去 NUL、500 UTF-16 码元上限、不截断代理对），
  命中上限时提示细化查询。
- **会话分页**：每区块默认 5 行 + 「展开其余 N 个会话 / 收起」；有活动或未读状态的会话自动抬升
  分页（前 50 行内），不会被折叠隐藏。
- **视图选项菜单**：手动顺序 / 最近活跃、隐藏 / 显示 / 只看归档。
- **「添加工作区」入口**：走宿主 `uiWorkspace.pickDirectory` + `workspaces.create`。
- **两个分区可折叠、表头定格**：「置顶会话」「项目会话」各自折叠（项目会话一次收起/展开全部
  工作区分组）；表头在各自区块滚动时钉在顶部（`position: sticky` + 侧栏不透明底色
  `--dsw-specific-sidebar-fill`），进入某个工作区分组后由该分组表头接管。
- **分区 / 目录 / 会话三层视觉分离**：两个分区是 32px、14px 半粗、次级色的标题带
  （抬升底色 `--dsw-alias-bg-layer-2` + 细下边线），工作区目录缩进一级并带文件夹图标，
  会话再缩进一级、标题与工作区名对齐；直接挂在分区标题下的行（置顶区、搜索结果）用浅缩进
  贴着标题（同 Codex），不跟项目区对齐。不再使用宿主的 `--dsh-workspace-indent`
  （该变量在真实窗口里把会话推到很深的位置）。
- **工程侧**：`src/client/core.js` 为纯派生层（子会话树索引、一次后序 rollup、状态优先级、
  排序解算、分页与查询清洗）；`npm run build` 零依赖打包；`test/contract.test.js` 用假模块加载器
  驱动注册面与交互路径；`test/a11y.test.js` 断言新渲染面；`test/alignment.test.js` 对着宿主源码
  校验契约。当前 112 条 lane（无宿主源码时 11 条对齐 lane 自动跳过），见
  `docs/ACCEPTANCE-0.1.7.md`。

### 行为修订（实测反馈驱动）

- **会话行不再显示失败态。** 客户端 `SessionStatus` 没有失败位；0.1.x 起的两个代理信号都会误报：
  后台任务 roster 会保留已结算任务（几天前的失败让已正常结束的会话一直变红），
  `subagentTiming.lastTurnCompleted === false` 对被打断/仍在等待输入的子会话同样为真。
  两个计数仍保留在 `statusOf(...).facts`，由能精确归因的界面使用。
- **`jobs` 服务改为惰性解析**：原实现在 `apply` 时一次性捕获 `ctx.get('jobs')?.state`，
  若 job 控制器晚于本插件安装，就会永久丢失「后台任务在跑」的信号（表现为正在执行的会话没有圆点）。
  现在每次读取都重新解析，并把 `@deepseek-ai/dsh-api-job-controller` 声明进 `dsh.client.inject`。
- **图标全部改用官方图标集**（`dsh-client-ui-primitives`）：搜索、视图选项、添加工作区、
  文件夹、折叠箭头、行内「更多」、图钉、行内「新建会话」；此前用的文字符号
  （`⌕`/`⋮`/`▾`/`+`/`⋯`）字重与基线都和外壳不一致，是「显得廉价」的主要来源。
- **排版对齐官方会话行**（ui-workspace `Rows.module.css`）：32px 行高、16×20 前置状态格、
  标题 14px/20px、时间 10px/16px、`--dsw-radius-*` 圆角。之前标题未设字号（继承默认字级），
  列表因此显得比外壳其他部分更大、更廉价。
- **会话行加 `user-select: none`**：官方会话行有该声明，缺失时鼠标按下会先触发文本选择，
  浏览器不再启动 HTML5 拖动，表现为「无法拖动会话」。
- **头部入口常显**：搜索、视图选项、添加工作区、新建会话原先复用了行内 hover 才显示的
  `.dsm-action`，在头部永远不会变得可见（搜索与筛选因此「消失」）。
- **图钉只出现在置顶区之外。** 它不可点，且在「置顶会话」里每行都已置顶，属于纯占位；
  实测同一个标题的可用宽度从 **99px → 121px**（340px 视口）。置顶行出现在搜索结果里时仍带图钉。
- **置顶措辞统一**：菜单与标记此前混用「固定」，现在统一为「置顶会话」/「取消置顶」，
  图钉提示为「已置顶」，与分区名「置顶会话」一致（宿主侧仍是 pin 集合）。

### 性能

- **拖动期间的刷新收敛到每帧至多一次。** 之前每个 `pointermove` 都会写一次插入标记 → 整表重渲染；
  现在标记发布经 `requestAnimationFrame` 合并（无 rAF 的宿主立即发布），边缘自动滚动也从
  「每个 move 写一次 `scrollTop`」（每次都是整表强制布局）改为**按帧滚动**，指针离开边缘即停。
- **一次手势只发布一次「开始拖动」**：原先用渲染闭包里的 `drag === null` 判断，快速滑动的前几帧
  会重复写入同一个状态；现在用挂在手势对象上的 latch。
- **提交改为读取手势本身，而不是 React 状态**：这既让「同一帧内开始并结束的快速拖动」能正确落位
  （之前这种甩动会**什么都不发生**），也让标记发布可以安全地按帧合并。
- 实测（`dev/browser` 台架，360 会话/93 行）：跨 40 行的甩动 → 标记写入 **0 次**、仍然落在最后
  悬停的那一行；60 次移动跨 42 行的扫描与「原地移动」相比耗时无差异（每次标记重渲染 < 1ms，
  无 long task，帧间隔最大 23ms）。

### 修复

- **macOS 上目录行与分区带不再是一块"深色板"。** 侧栏在 macOS 上是窗口 vibrancy，宿主为此把自己的
  填充改成 `transparent`（源码注释：不透明填充会盖住 vibrancy、读起来像一块外来板）；而本插件给
  吸顶表头用的是不透明的 `--dsw-specific-sidebar-fill`，于是每一行目录都成了一块比侧栏更深的色块。
  现在 `[data-platform='darwin']` 下三个吸顶面改用宿主自己的做法——标签墨色 6% 的淡淡一层 +
  `backdrop-filter: blur(14px)`（非 macOS 仍然是原来的不透明填充，Windows/web 不受影响）。

- **重命名此前在台架里"看起来没生效"（台架缺口，已补齐）。** 插件按宿主契约走
  `ctx.sessions.using(id, {source:'workspaceOperation'}, ref => ref.binding.session.rename(title))`，
  而台架的 `sessions.using` 只 `resolve({ok:true})`、不执行回调，于是既没有宿主调用、也没有报错。
  台架现在按真实回调形状执行；真键盘输入 + Enter 实测得到 `renameSession(id, 新标题)`。
  同时台架补上 `archiveSession` / `unarchiveSession` 的状态模拟（此前归档后菜单不会变成「取消归档」）。

- **「取消置顶」其实在重新置顶（同一类缺陷也让「取消归档」失效）。** 行菜单这两个开关只换**标签**、
  不换 **id**：置顶中的行发出 `pin` + 文案「取消置顶」，而分发器按 id 分派，于是走到 `pinSession`
  （对已置顶会话是空操作，表现为「取消置顶没反应」）；归档同理，`unarchiveSession` 分支永远不可达。
  现在 id 描述动作（`unpin` / `unarchive`），并补上双向回归 lane——用旧产物跑会失败（已验证）。

- **会话拖动彻底不可用（根因已定位并修复）。** 用真实浏览器输入复现后确认：行上的
  `-webkit-user-drag: element` 会**覆盖** `draggable="false"`，而工作区容器上的
  `draggable="true"` 会被其内部的会话行**继承**；两者合起来让 Chromium 在按下并移动后启动
  **原生拖动**，紧接着抛出 `pointercancel` 取消指针流。于是任何按指针/原生拖动的实现都会在
  移动第一步就失效（也解释了此前「完全没反应」的现象）。
  现在：行与工作区标题一律**不再**声明原生拖动源（`draggable: false` + `-webkit-user-drag: none`），
  排序统一走**指针手势**（`pointerdown/move/up/cancel` + 4px 阈值 + 指针捕获），松手时按最后
  标记的目标提交同一条耐久 API；手势结束后的那次 click 被吞掉，不会顺带打开会话或折叠工作区。
  验证：真实鼠标事件在 `dev/browser/harness.html`（真 React + 真 DOM）中完成会话重排
  `insertSessionBefore('w1','w1-c','w1-a')` 与工作区重排 `insertWorkspaceBefore('w2','w1')`，
  且全程 **零** `dragstart` / `pointercancel` / `selectstart`。
- **行内「更多」按钮点不开。** 行上的 `pointerdown` 会把手势布防在整行上，按在「⋯」上也会布防：
  只要移动几像素就跨过 4px 阈值变成拖动排序，紧随其后的那次 click 又被吞掉，于是菜单永远打不开
  （在大列表里还伴随无声的会话重排）。现在按下落在行自身的控件（`button`/`a`/`input`/菜单）时
  不再布防手势；真实鼠标事件已验证点「⋯」打开菜单且不产生任何宿主调用。
- **视图筛选菜单与行内菜单此前完全打不开。** `Menu` 是受控组件（官方用法见
  `ui-workspace/WorkspaceBrowser.tsx` 的 `ViewOptionsMenu`）：必须传 `open`，并由 `anchor`
  自己的 `onClick` 切换；当前模式通过 `selectedIds` 回显。此前既没有 `open`，anchor 也没有
  `onClick`，所以点击筛选按钮没有任何反应；行内 `⋯` 同一个缺陷。两处均改为受控，并补上
  `align: 'end'` / `dense` / `portal`（region 会裁剪溢出，就地渲染的菜单会被切掉）。
- **行菜单不再给「固定/归档」打勾。** 那两个是开关，标签本身已写明当前状态，而 `Menu` 的勾选
  语义是「当前取值」，于是一个既没置顶也没归档的会话被标上两个勾；现在只有优先级这种真正的
  取值才带勾。行自身的 `onClick` 也会忽略落在 `[role="menu"] / [role="menuitem"]` 上的目标，
  菜单即使在无 portal 的宿主里就地渲染，选菜单项也不会被当成打开会话。
- **选了 P1–P4 后胶囊不刷新。** `renderRow` 是 `useCallback`，依赖数组漏了 `priorities`，
  于是记忆化的渲染函数一直用创建时的快照；宿主里因为 store 落盘、重挂载后才「看起来正常」。
  现在 `priorities` 在依赖里，写入后立刻重绘（真浏览器实测：点 P2 → 行上出现 `P2` 胶囊）。
- **「展开其余 N 个会话」在注意力展开超过一页时是死按钮。** 显示行数是
  `max(已存页码, 注意力要求)`，而「展开」从**已存页码**起跳；当注意力已经把区块撑到下一页步长
  之外，点它行数不变。现在从**生效页码**起跳（`Math.max(stored, required)`），并加了回归 lane
  （用旧产物跑会失败，已验证）。
- `dsh.client.inject` 之前声明了**不存在**的 `@deepseek-ai/dsh-client-runtime`（CHANGELOG 0.1.1
  声称已修，但 package.json 从未改到），0.1.7 换成真实包名并补 `peerDependencies`。

- **后台任务标记基本不出现**：插件读 `jobs.state.rows`，却从未调用宿主 `ctx.jobs.watchRows(sessionId)`，
  而宿主只为被订阅的会话维护任务 roster。结果只有当前打开会话（官方任务列表顺带订阅）偶尔亮出
  「后台任务执行中」标记。现在按「当前渲染出来的行 ∪ 其子树」（`watchTargets`）订阅：折叠 / 翻页的
  行不订阅，展开时补订阅，卸载或注册生命周期结束时全部释放；宿主缺少 jobs 服务时 fail open。
- **状态点无法解释、也不好吃准**：主点补 `title`（与读屏文案同源，例如
  「正在执行，1 个子会话执行中，1 个本会话的后台任务执行中」）；`.dsm-dot-slot` 用伪元素把命中区
  扩到行高（`inset:-6px -2px`，视觉与布局不变）；等待类状态的时间列在悬停 / 聚焦时不再被行尾菜单
  顶掉（`:not([data-status-label="true"])`）。
- **一行一个点**：行内不再为「子会话在跑 / 本会话任务 / 子会话任务」各画一个限定标记（含"蓝环 +
  琥珀芯"那版）。一行的四个事实由「主点 + 悬停说明」表达：有活在跑就是一个转圈，点上的 `title` 说清
  "谁在跑、几件任务、任务归谁"。四个圆点并排比一句话更难读，且容易出现"转圈 + 琥珀点"这种同一事实
  看似两件事的画法。
- **状态点与官方行完全对齐**：空闲行也画官方中性灰点（每行恒定一个点，列不会忽有忽无）；
  去掉「未读」文字胶囊（绿点 + 加粗标题已足够，额外标记只会和优先级胶囊抢宽度）；主点不再
  覆盖 `size`，大小与动画全部交给官方 `StateDot`（14px 转圈 / 10px 实心）。
- **后台任务按归属计数**：roster 按会话存，rollup 之前只留合并后的 `jobsRunning`，导致"本会话的任务"
  与"子会话的任务"只能挤进一个数字。现在 `buildRollup` 分开累计 `jobsRunningSelf` /
  `jobsRunningSubtree`，`statusOf(...).activity.jobs` 给出 `own` / `subtree`，供那一条悬停说明使用。

### 测试

- 新增 `watchTargets` 纯函数单测；contract lane 增加「每个渲染行都在订阅、子树也在订阅、卸载与折叠
  均释放」与「无 jobs 服务 fail open」用例；修好 stub 收集 effect cleanup 时吞掉返回值的问题（此前
  没有任何 lane 能证明卸载会释放自己打开的东西）。
- exact-source lane 增加 `watchRows` 契约断言（`ui-jobs` 客户端绑定与 job-controller 服务声明）。

## 0.1.6 - 2026-10-12

- Added a **red "failed" dot** for a background job in the session tree that settled as `failed` (the only failure the host exposes to the client). Precedence is now 等待(pending) > 正在执行(running) > 任务失败(failed) > 已完成未读 > 空闲; a `failed` job that settles while work is running again is superseded by the blue dot, and a user-requested `killed` job is not treated as a failure.
  - A failed main agent or subagent is deliberately NOT marked: `SessionStatus` and `SessionSummary` carry no failure flag, so "the run ended" and "the run failed" are indistinguishable on the client. Reading the session log to guess would make the plugin a second source of truth, which the plugin contract forbids.
- `client/client.js`: `statusOf` now also reports `failed`, `statusLabel` adds 任务失败, and `.dsm-dot-failed` uses `--dsw-alias-red` with a `#e5534b` fallback.

## 0.1.5 - 2026-10-12

- Published to npm as **`@pianner/dsh-session-manager`**. The unscoped name `dsh-session-manager` is already taken on npm by an unrelated package, so the package, the client module id and the `cordis.patch.yml` bundle name all moved to the `@pianner` scope; the install docs now lead with `dsh plugin --profile <profile> add @pianner/dsh-session-manager`.

- The session now shows the running (blue) dot while a subagent runs under a waiting main agent: the client re-projects the host `sessions.list` `parentId` / `origin` / `running` state (via `hasRunningDescendant`) so a parent whose own main agent is idle still reads as running while any host-projected descendant runs. No other behavior change.
- The session now also shows the running (blue) dot while **anything in its session tree is still at work**: a background job owned by the session, a still-running subagent/team member, or a background job owned by one of those subagents. The client reads the host `jobs` rosters (status `running` / `stopping`) and keeps one reference-counted `watchRows()` per session in the tree under each mounted row — including subagent rows, which are filtered out of the rendered list and would otherwise never be watched. `jobs` is an OPTIONAL injection: a DSH build without the job service still loads the plugin and falls back to the main-agent/subagent signal. Watches are read-only (no `observe()`, no output consumption) and released on cleanup.

## 0.1.4 - 2026-10-08

- Kept the package name unscoped as `dsh-session-manager` across the coupled identifiers (client module id, `cordis.patch.yml` bundle `name`, package-name test assertion) and distributed it directly as a `.tgz` package rather than publishing to npm. No behavior change.

## 0.1.3 - 2026-10-08

- Packaging prep for npm: added `publishConfig` (public access, official registry) and trimmed the published `files` to runtime + docs (dropped `test/` and `scripts/` from the tarball; the working tree and local dev scripts are unchanged).
- `docs/DEPLOY.md`: documented the `dsh plugin --profile <profile> add <plugin-dir>` CLI install as the recommended method, alongside the manual profile-edit steps, and noted the plugin is not yet on npm.

## 0.1.2 - 2026-10-08

- Documented the supported install channel (a local clone referenced from the DSH profile via `link:` / `file:` dependencies; not published to npm or dshmarket) and added a table of contents to `README.md` and `README_EN.md`.
- Centralized user-facing literals in `client/client.js` into a single `const STRINGS` table. Values are byte-identical to the previously inlined literals, so the rendered UI is unchanged.
- Added `test/a11y.test.js`: static regression assertions for the accessibility roles/aria markers used by the client (`menu`, `menuitem`, `treeitem`, `heading`, `alert`, `[role="tree"]`, `aria-selected`, `aria-expanded`, `aria-hidden`, and the visually hidden status label).
- Added an ESLint flat config (`eslint.config.js`) with a `lint` script, `eslint` / `@eslint/js` dev dependencies, and a `Lint` step in CI.
- Idle sessions no longer show a grey status dot: the base `.dsm-dot` is transparent while keeping its 7px placeholder, so only running = blue / pending = amber / done = green remain; the unread emphasis (dot halo and the "unread" badge) moved from blue to green so it can no longer be mistaken for a running session.
- Indented project-session rows one level under their expanded workspace group so the hierarchy reads more clearly; pinned-section rows stay flat.

## 0.1.1 - 2026-10-08

- Fixed `dsh.client.inject` in the plugin manifest to declare the real DSH client-module packages that provide the services the client uses (`@deepseek-ai/dsh-api-session-controller`, `@deepseek-ai/dsh-api-workspace-controller`, `@deepseek-ai/dsh-client-ui-session`, `@deepseek-ai/dsh-client-ui-workspace`, `@deepseek-ai/dsh-cordis-client-runner`), replacing the non-existent `@deepseek-ai/dsh-client-runtime` placeholder. Verified against DSH `0.2.0-rc.2` source (service providers) and a published reference plugin.

## 0.1.0 - 2026-10-08

- Implemented P0 Codex-style pinned section with host-order projection, pin de-duplication from workspace rows, unpin restoration, and independent collapse state.
- Added `uiSession.sessionStatus` projection for pending interaction, running, and completion-unread states with distinct labels/markers.
- Added workspace-header hover titles from host workspace `path` values, with cleanup restoring any pre-existing native title attribute.
- Added project-session sectioning below pinned sessions; session titles truncate on one line while timestamps use a stable right-aligned column with minute/hour/day/week/month/year formatting.
- Normalized the visible hierarchy to `工作区` → `置顶会话` → one `项目会话` block, with duplicate project headers collapsed and any temporary native-label normalization restored on cleanup.
- Reconciled native workspace rows against host membership; added bounded-scope backfill for ordinary migrated sessions on fully expanded live views, without regrouping by old `cwd` or guessing native page quotas.
- Preserved native per-workspace `overflow:<workspace>` / “展开其余会话” controls and their pagination handlers.
- Restored native pin-button cleanup and active-pin exclusion on pending/error fallbacks; empty/all-archived native trees defer backfill rather than guessing the private view filter.

- Initial local plugin skeleton and left-session takeover design.
- Kept the plugin source as the single source of truth; DSH profile and workspace reference it through symlinks only.
- Replaced fragile row projection with owned DOM markers, stable row reuse, nested-group isolation, native pin-control scoping, keyboard-safe menu handling, rename dialog, and explicit action errors.
- Added an executable `verify:contract` gate for the shared local-plugin contract.
