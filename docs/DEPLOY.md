# 部署

## 受支持范围

- macOS DSH desktop profile。
- 仅修改 profile 配置与本地插件软链接，不修改 DSH/Harness 源码或 ASAR。

## 安装位置约定

- 插件源码：把本仓库 clone 到任意本地目录，记为 `<plugin-dir>`。
- DSH profile：`~/.dsh/profiles/<profile>/`（`<profile>` 为你实际使用的 profile 名，桌面版常见为 `desktop`）。
- 安装方式用软链，不要把源码复制进 DSH 配置目录；profile 只负责登记与链接。

## 安装（命令行，推荐）

clone 本仓库到 `<plugin-dir>` 后，用 DSH CLI 一行把它装进 profile：

```bash
dsh plugin --profile <profile> add <plugin-dir>
```

该命令会在 profile 里登记依赖、生成软链接。随后在 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 中加入 `"dsh-session-manager"`（若未自动加入），重启 DSH desktop 即可。

> 本插件尚未发布到 npm；因此用本地 clone（`link:`/`file:`）安装。日后若发布，可直接 `dsh plugin --profile <profile> add <包名>` 从 registry 安装。

## 安装（手动编辑 profile）

在 `~/.dsh/profiles/<profile>/package.json` 中：

1. `dependencies` 增加 `"dsh-session-manager": "link:<plugin-dir>"`（或 `file:<plugin-dir>` / 已发布版本号）；
2. `dsh.profile.bundles` 增加 `"dsh-session-manager"`；
3. 确保 `node_modules/dsh-session-manager` 是指向 `<plugin-dir>` 的软链（`pnpm install` / `npm install` 会据 `link:` 生成）；
4. 重启 DSH desktop。

启动后 DSH 使用的 bundle entry 是本插件 package 的 `dsh.client` 与 `client/client.js`。`package.json` 里的 dependency 和 `dsh.profile.bundles` 只是运行登记，不应再复制一份插件源码。

## 安全关闭

从 profile 的 `dsh.profile.bundles` 移除 `dsh-session-manager`（也可同时移除 dependency 后重启）。不要删除 DSH 的 session/workspace 数据，也不需要任何迁移脚本：宿主状态仍由 DSH 保存，原生 UI 或下一款兼容插件可继续读取。

## 卸载 / 回滚

删除上述 dependency 与 bundle 条目后重启 DSH。插件 cleanup 会恢复已隐藏的原生会话行；宿主 session/workspace 数据不做任何清理或迁移。
