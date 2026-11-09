# 0.2.0 验收记录（P0 实现）

> 状态：**P0 自动化 lane 全绿；真实应用窗口与多窗口尚未人工验收**。
> 分支：`feat/0.2.0-virtual-folders`（从 `d2ed52a` 的 HEAD 开出的独立 worktree）。
> 原 checkout 的三处未提交改动没有动，也不在本记录的验证范围内。

## 1. 环境

| 项 | 值 |
|---|---|
| DSH App | `0.2.2-rc.1` |
| 精确源码 | `dsh-v0.2.2-rc.1`，工作树 clean（本地校验，不写 commit） |
| 插件分支 | `feat/0.2.0-virtual-folders` |
| 插件版本 | `0.2.0`（开发中，未发布） |
| 基线 | HEAD `d2ed52a`；worktree 初始 `node --test`：127 tests / 116 pass / 0 fail / 11 skipped |

## 2. 自动化结果

```bash
node scripts/build-client.mjs
DSH_SOURCE=<dsh-checkout> node --test
# 152 tests / 152 pass / 0 fail / 0 skipped
node scripts/check-plugin-contract.mjs .
# PASS（全部检查项）
```

覆盖：

- `core`：folder schema 分类/净化/原型污染、名称校验、增删改移、pruneAssign、buildFolderView(s)、
  workspaceOfSession、目录内 moveAnchor；既有 49 条纯函数用例保持绿。
- `contract`：空目录回归、目录树与 FolderSection、折叠目录不写宿主、行菜单子目录与当前项、
  只读 v2、跨目录拖动拒绝、创建弹窗归置、表头创建目录、既有拖动/分页/搜索/优先级/job watch 回归。
- `static`：命名空间键、无 Web Storage 字样、FolderSection 不带 `data-dsm-group`、表头不 sticky、
  依赖表、声明面（5 个服务 / 0 个包边）。
- `align`：slot、service、primitives（含 `Menu.submenu` / 两个图标）、store persist、
  `includePrerelease`、peer 范围覆盖 0.2.2-rc.1 且排除 0.3.0-alpha.0。

## 3. 未验证 / 验证缺口

| 项 | 状态 | 原因 |
|---|---|---|
| 真实应用窗口的视觉与交互 | **部分** | profile 临时软链到本 worktree，plugin_manager 报 0.2.0；agent 仍无法连入渲染进程，视觉/点击需用户完成 |
| `dsh-app://app` 下 localStorage 跨重启 | **未实测** | 需人工重启桌面版；同 origin 的优先级键已有先例 |
| 多窗口 `storage` 收敛 | **未实测** | contract 只覆盖监听注册/派发；真实双窗口未开 |
| 桌面 vs 浏览器 Web GUI 各自独立 | **未实测** | 两个 origin 的预期行为，需人工确认 |
| 340px 侧栏目录树标题 / 深浅主题 | **未验收** | 需台架/人眼 |
| 拖动会话到目录标题归置（原 P1） | **已移出 0.2.0** | 行菜单归置已覆盖能力；拖动只是快捷方式 |
| 目录拖拽排序（原 P2） | **已移出 0.2.0** | 目录菜单上移/下移已覆盖能力 |

## 4. 人工验收清单

1. 无目录时列表与 0.1.7 一致；行菜单只多「移到子目录」。
2. 从行菜单新建目录 A，并把该会话归入；目录条出现「全部 / A / 未分类」。
3. 建目录 B，切换 A/B/未分类；「全部」按 A、B、未分类分小节。
4. 重命名、上移/下移、删除 A（会话回未分类）；刷新/重启后 B 与归属仍在。
5. 目录内拖动 / `Alt+↑↓`；刷新后宿主顺序保持。
6. 置顶行归置 → 取消置顶 → 回到目录。
7. 归档筛选三态、优先级视图、搜索、分页、折叠均无回退。
8. 深/浅主题、340px 侧栏；目录小节计数与 attention 点可读。
9. 停用插件 → 原生列表完整；重新启用 → 目录恢复。
10. 双窗口：A 建目录，B 不刷新能看到；B 改名，A 收到。

## 5. 已知降级

- 仅后台 job 在跑、且所在目录被折叠时，目录标题的 attention 点不会亮（job roster 只为被 watch 的行
  建流）；P0 接受，见 DESIGN §4.6。
- 子目录数据按 origin 隔离，不跨设备；桌面与浏览器各一份。
- 未知 schema 版本只读，入口隐藏，不覆盖新数据。


## 6. 2026-11-09 真浏览器台架补充

为补足「只有 VM 桩、没有真 DOM」的缺口，本轮把维护者的 `dev/browser` 台架复制到 worktree（`dev/` 被 .gitignore 忽略、不随包发布），
给台架补了文件夹字典、图标桩和一份种子状态（w1 两个目录：设计 / 排查，w1-a/w1-b 各归一个，w1-c 未分类），
用真实 React 18 + 真实 DOM + Playwright 跑了一遍。

已验证：

- 目录区是树：`设计 1 / 排查 1 / 未分类 1` 三个可折叠小节，无 `.dsm-folder-strip` / `.dsm-folder-chip`；
  有 attention 的目录显示 6px 圆点，标题只带一个计数。
- 收起「设计」后 `aria-expanded` 变 false，w1-a 从 DOM 消失；`排查` / `未分类` 与其他工作区不受影响。
- 目录小节标题为 28px、14px/20px 的 caption（chevron + 名称 + 一个计数），不再像第二个工作区标题。
- 从工作区表头 folder-plus 新建目录：树里出现空目录小节和「空目录」提示；表头按钮保留（树没有 chip 条）。
- `?empty=1` 的空目录变体：两个工作区表头都出现 folder-plus；在 w1 创建后 w1 出现目录小节，w2 仍没有小节；
  表头按钮仍在；只建目录，不写 `assign`。
- 目录 `⋯` → 重命名 → 提交：标题更新；目录 `⋯` → 删除 → 确认：小节消失。
- 修正台架图标桩后，页面无 React 错误 / 无无效 element type。

未覆盖：应用外壳的真实观感、双窗口 `storage` 收敛、重启后的持久化；这些仍需人工。

### 临时 profile 状态

- desktop profile 的 `node_modules/@pianner/dsh-session-manager` 已临时指向本 worktree；
  `package.json` 的依赖仍是原 checkout 的 `link:`，没有手改。
- `plugin_manager` 的 `list_bundles` 已显示该 bundle 版本 `0.2.0`；`set_bundle(false)`→`true` 返回 `applied`。
- 注意：该切换只改 `node_modules` 软链，应用下次触发 pnpm 安装/重装时可能按 profile 的 `package.json` 还原为原 checkout。
  若真机验收时看不到子目录，先确认软链目标，或改用 managed remove/install 或合并分支。
- 备份在本地临时目录（package.json / pnpm-lock / 原软链目标），不随仓库。


## 7. 原 checkout 残留审计（2026-11-09）

原 checkout（`main`）曾有 4 类未提交内容；它们没有被带入本 worktree，并在 2026-11-09 按用户确认全部丢弃。当前原 checkout 已 clean：

| 内容 | 实际改动 | 处置 |
|---|---|---|
| `src/client/core.js` + `client/client.js`：blank 可见性 | `row.blank === true && id !== currentId && !row.title && !row.displayTitle` | **已丢弃（2026-11-09）**：宿主 `displayTitle` 由 `displayTitleOf(...)` 兜底到 id，永远非空，所以条件恒为 false，所有 blank 行都会显示。 |
| `core.js` + bundle：`SESSION_PAGE_BASE` | 5 → 50 | **已丢弃（2026-11-09）**：保持 5；50 会基本关掉分组分页。若未来要更多行，应以 5/10/20 的可选设置实现，而不是写死常量。 |
| `client/client.js`：macOS 表头 CSS | 玻璃 `color-mix` + `backdrop-filter` → 不透明 `--dsw-alias-bg-layer-2,#1e1e1e` | **已丢弃（2026-11-09）**：源码 `body.js` 的玻璃效果保留；不透明只改 bundle 会在下次构建丢失，也不跟主题。 |
| 未跟踪 `client/client.js.bak-20261029021744` | 本地备份 | **已删除（2026-11-09）**；不应入库 |
| 未跟踪 `docs/DESIGN-0.2.0.md` | 11-08 的旧设计稿 | **已删除（2026-11-09）**；正式版已在本仓 `docs/DESIGN-0.2.0.md` |

结论：4 项已全部丢弃，原 checkout 工作树 clean；50 行分页未保留，当前仍为 5。
