# dsh-session-manager

[![CI](https://github.com/NianjunZou/dsh-session-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/NianjunZou/dsh-session-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)
English: [`README_EN.md`](README_EN.md)

A local DSH plugin that gives the left sidebar a Codex-style session list, durable
session ordering, and a layered status indicator.
它在官方 `sidebar.workspaces` slot 上占位渲染左侧会话区，不修改 DSH/Harness 源码，不接管右侧 sidebar。

本插件不会成为 DSH 会话数据的第二真相源：会话、工作区归属、置顶、归档、当前选择、会话顺序等状态始终由 DSH 宿主服务读写，插件只做投影与宿主服务调用。禁用或卸载后，slot 注册随插件生命周期消失，官方会话区自动恢复。详见 [`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md)。

## 目录

- [功能](#功能)
- [兼容性](#兼容性)
- [前置条件](#前置条件)
- [范围与限制](#范围与限制)
- [安装](#安装)
- [开发与验证](#开发与验证)
- [文档](#文档)
- [边界](#边界)
- [License](#license)

## 功能

- **动态调整会话顺序**：拖动行（指针手势，不是 HTML5 拖放：原生拖动会被行/分组上的
  `draggable` 继承并触发 `pointercancel`，把手势打断）、`Alt+↑/↓`、或行菜单「上移 / 下移」，统一调用宿主
  `workspaces.insertSessionBefore`，顺序写入宿主耐久顺序（不是浏览器本地表）。
- **一行一个状态点**：主点用官方 `StateDot` 词表（等待 / 执行中 / 已完成未读 / 空闲），每行恒定一个；
  子会话、后台任务等构成不额外画标记，而是拼进主点的悬停说明与读屏文案。
  **不显示失败态**：客户端 `SessionStatus` 没有失败位，两个可用代理（后台任务 roster、
  `subagentTiming.lastTurnCompleted`）在真实使用中都会误报，详见「状态取舍」。
- **置顶区可拖动重排**：置顶区顺序由宿主 pin 集合决定（`pin` 是前插、没有 move API），
  插件按“改动的最小后缀”把它重写成目标顺序，拖动过程中置顶区直接显示目标顺序。
- **工作区拖动排序**：与官方目录行一样拖标题，调用 `workspaces.insertBefore`。
- **分区与目录分层 + 三级缩进**：置顶会话 / 项目会话是标题带（32px、14px 半粗、次级色、
  抬升底色 + 细线），工作区是缩进一级的目录行（+ 文件夹图标），会话再缩进一级、标题与工作区名
  对齐；直接挂在分区标题下的行（置顶区、搜索结果）用浅缩进贴着标题，不与项目区对齐（同 Codex）。
- **两个分区都可折叠、表头定格**：置顶会话 / 项目会话各自折叠（项目会话一次收起全部工作区分组）；
  滚动时表头钉在顶部，进入某个工作区分组由该分组表头接管（对齐 Codex 会话列表）。
- **优先级视图 + 批量修改**（头部 P 徽标进入，勾选框固定在行首）：按等级分区列出已标记的会话，勾选后一次改/清优先级
  （一次存储写入），空等级不占位，未标记分区默认折叠。
- **优先级标记 P1–P4（带色分档）**：行尾数字胶囊，四档同属一个强调色
  （`--dsw-alias-state-business-primary`）——P1 实心 + 反色文字、P2 45% 底色、P3 22% 底色、
  P4 灰字 + 10% 灰底。状态色（红 / 琥珀 / 绿 / 中性）只属于状态点，优先级规则里不出现。
  状态经官方 `dsh-client-store` 持久化（键 `dsh-session-manager.priority`），
  0.1.7 早期按颜色存的值会自动映射到等级。
- 结构：一级标题「工作区」→「置顶会话」标题带（宿主 `pinnedSessionIds` 顺序，与工作区分组去重）
  →「项目会话」标题带 → 各工作区分组（文件夹图标 + 展开/折叠）。
- 所有图标取官方 `dsh-client-ui-primitives` 图标集（搜索 / 筛选 / 添加工作区 / 文件夹 /
  折叠箭头 / 更多），不使用文字符号，避免字重与基线跟外壳其余部分不一致。
- 会话行折叠为单行标题 + 固定时间列；等待交互时时间列改为等待标签。
- 统一提供置顶（置顶会话 / 取消置顶）、重命名、分叉、归档（归档会话 / 取消归档）、
  上移 / 下移、复制 Session ID、复制工作目录。
- 视图选项：手动顺序 / 最近活跃、隐藏 / 显示 / 只看归档。
- **会话搜索**：标题 / 工作区名的本地匹配 + 宿主消息内容索引（`sessions.search`），
  结果按最近活跃排序并显示匹配片段，命中上限超过时提示细化查询。
- **会话分页**：每个区块默认显示 5 行，超出时提供「展开其余 N 个会话 / 收起」；
  有运行中、等待或未读状态的会话会自动抬升分页（前 50 行内），永不被折叠隐藏。

## 状态取舍（0.1.7）

DSH 客户端对"会话失败"没有权威信号：`SessionStatus` 只有 `running` / `pendingInteraction` /
`completionUnread`。0.1.x 与 0.1.7 早期版本用两个代理近似它，实测都会误报，因此 0.1.7 不再显示失败态：

| 代理 | 为什么不可靠 |
|---|---|
| `jobs.state.rows[sessionId][*].status === 'failed'` | roster 会**保留已结算的任务**用于查看；一个几天前失败的任务会让会话一直变红，而会话内容本身已正常结束 |
| `subagentTiming.lastTurnCompleted === false` | 对被打断或仍在等待输入的子会话同样为 false，与"失败"不等价 |

这两个事实仍然在 `statusOf(...).facts` 里可用（`jobsFailed` / `abnormalTurns`），
供能精确归因的界面使用。真正的失败位需要宿主提供（见 §上游建议）。

## 兼容性

针对 DSH desktop 的 web client 开发与测试，目标版本 **`dsh-v0.2.1-alpha.5`**（`client-ui-slots` /
`client-ui-sidebar` / `client-ui-workspace` / `client-ui-session` 的 `0.2.1-alpha.5` 契约）。
其它 DSH 版本可能因客户端服务/slot 契约变化而需适配。

## 与官方会话区的关系（0.1.7 已知取舍）

`sidebar.workspaces` 是**排他**的单占位 cell：占位期间由本插件渲染整个会话区，官方
`WorkspaceBrowser` 不再渲染。它的 5 个子槽由官方注册项声明，遮蔽者无法重新声明，因此启用期间
以下贡献**不会出现**：

| 子槽 | 缺失的内容 |
|---|---|
| `sidebar.workspaces.session.menu.item` | 官方 5 条菜单（本插件自实现等价菜单）+ **第三方**注册的菜单项 |
| `sidebar.workspaces.session.row.action` | 官方行内悬停按钮 + 第三方的 |
| `sidebar.session.row.leading` / `.hover` | 官方 `ui-schedule` 的定时任务标记与列表（**暂无等价实现**） |
| `sidebar.workspaces.directoryFlow` | 官方内嵌目录选择流；本插件改用宿主 `uiWorkspace.pickDirectory` 提供等价的「添加工作区」入口 |

停用或卸载插件后这些贡献立即恢复。

## 前置条件

- macOS 上的 DSH desktop。
- Node.js ≥ 20（跑测试用）。
- 对齐核验（`npm run verify:align`）需要一个 DSH 源码 checkout（默认 `~/deepseek-harness`）；
  未提供 `DSH_SOURCE` 时该 lane 自跳过，不会伪装成通过。

## 范围与限制

- 只接管左侧 `sidebar.workspaces` slot；不接管右侧 sidebar，不改 DSH/Harness 源码或 ASAR。
- 0.1.7 未实现：官方 `ui-schedule` 的定时任务标记与悬停节（该槽由官方注册，遮蔽者无法重新声明）、
  官方 5 个子槽里第三方注册的菜单项 / 行内按钮（原因见上一节）。
- 暂不提供：永久删除会话、跨工作区移动、原生“未读”状态的持久化写入——目标 DSH 版本缺少可调用的公开写接口。
- 卸载与回滚见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

## 安装

从 npm 安装：`dsh plugin --profile <profile> add @pianner/dsh-session-manager`，并在 `dsh.profile.bundles` 中加入 `@pianner/dsh-session-manager`，重启 DSH。也可 clone 本仓库（或使用 `.tgz`）做本地开发安装。完整步骤见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

npm 上是 **0.1.7**（本仓库当前版本）。发布清单见
[`docs/DEPLOY.md`](docs/DEPLOY.md)，验收记录见 [`docs/ACCEPTANCE-0.1.7.md`](docs/ACCEPTANCE-0.1.7.md)。

## 开发与验证

```bash
npm run build         # 由 src/client/{core,body}.js 生成 client/client.js（单文件 client 入口）
npm test              # 112 条 lane：core + 契约 + 产物静态断言 + a11y（对齐 lane 无源码时自跳过）
npm run verify        # build + node --check + npm test + 插件契约检查
DSH_SOURCE=~/deepseek-harness npm run verify:align   # 对着宿主源码校验 slot / Menu / StateDot / 图标 / API
```

真浏览器交互验收由维护者在本地台架（真 React + 真 DOM + 真鼠标）完成，台架不随仓库分发；
逐项结果与未验收项见 [`docs/ACCEPTANCE-0.1.7.md`](docs/ACCEPTANCE-0.1.7.md)。

`client/client.js` 是**生成物但入库**（npm 包无需消费者构建）：改动 `src/client/*` 后必须重新
`npm run build`，`test/plugin.test.js` 会守住产物与源码的一致性。

仓库的 CI（`.github/workflows/ci.yml` 的 `leak-scan`）会在 push/PR 时扫描本机路径与密钥，防止敏感内容进入仓库。本地可另装一个 pre-commit 防护（放在 `.git/hooks/pre-commit`，不随仓库分发）作为提交前的第一道闸。

## 文档

- [`docs/USAGE.md`](docs/USAGE.md) — 使用说明
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — 安装 / 部署 / 卸载 / 发布
- [`docs/ACCEPTANCE-0.1.7.md`](docs/ACCEPTANCE-0.1.7.md) — 验收记录与验证缺口
- [`docs/DESIGN-0.1.7.md`](docs/DESIGN-0.1.7.md) — 0.1.7 设计与调研
- [`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md) — 本地 DSH 插件契约

## 边界

本插件只操作 `[data-slot="sidebar.workspaces"]` 左侧会话区；不修改或接管右侧功能区。

## License

MIT — 见 [`LICENSE`](LICENSE)。
