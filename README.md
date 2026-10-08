# dsh-session-manager

A local DSH plugin that gives the left workspace a Codex-style session list.
它只接管左侧工作区中的会话行与会话菜单，不修改 DSH/Harness 源码，不接管右侧 sidebar。

本插件是一个**可关闭的左侧 UI 覆盖层**，不会成为 DSH 会话数据的第二真相源：会话、工作区归属、置顶、归档、当前选择等状态始终由 DSH 宿主服务读写，插件只做投影与宿主服务调用。详见 [`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md)。

## 功能

- 保留原生 workspace 分组、展开/折叠和工作区级操作。
- 用插件自己的 Codex 风格会话行替换原生会话行。
- 统一提供固定/取消固定、重命名、分叉、归档/取消归档、复制 Session ID、复制工作目录。
- 隐藏原生会话行及原生重复置顶入口，避免第三方插件互相覆盖。
- 独立“置顶会话”区 + “项目会话”分块；运行/等待/完成未读状态区分。

## 安装

把本仓库放到任意本地目录，在 DSH desktop profile 的 `dependencies` 与 `dsh.profile.bundles` 中加入 `dsh-session-manager`，重启 DSH。完整步骤见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

## 开发与验证

```bash
npm test              # 静态 + fixture/contract 回归
npm run test:browser  # 独立临时 Chrome 下的 DOM/服务回归
npm run verify        # node --check + npm test + 插件契约检查
```

仓库的 CI（`.github/workflows/ci.yml` 的 `leak-scan`）会在 push/PR 时扫描本机路径与密钥，防止敏感内容进入仓库。本地可另装一个 pre-commit 防护（放在 `.git/hooks/pre-commit`，不随仓库分发）作为提交前的第一道闸。

## 文档

- [`docs/USAGE.md`](docs/USAGE.md) — 使用说明
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — 安装 / 部署 / 卸载
- [`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md) — 本地 DSH 插件契约

## 边界

本插件只操作 `[data-slot="sidebar.workspaces"]` 左侧会话区；不修改或接管右侧功能区。

## License

MIT — 见 [`LICENSE`](LICENSE)。
