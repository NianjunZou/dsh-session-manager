# 部署

## 受支持范围

- macOS DSH desktop profile，目标版本线 `dsh-v0.2.1-alpha.5`。
- 仅修改 profile 配置与本地插件软链接，不修改 DSH/Harness 源码或 ASAR。

## 从源码安装时先构建

`client/client.js` 是生成物（入库，npm 包无需消费者构建）。从 clone / `link:` 安装时，
若改过 `src/client/*.js`，先跑一次：

```bash
npm run build                       # 由 src/client/{core,body}.js 生成 client/client.js
npm run verify                      # build + node --check + 全部 lane + 插件契约检查
DSH_SOURCE=~/deepseek-harness npm run verify:align   # 可选：按 DSH 源码核验宿主契约
```

## 安装位置约定

- 插件源码：把本仓库 clone 到任意本地目录，记为 `<plugin-dir>`。
- DSH profile：`~/.dsh/profiles/<profile>/`（`<profile>` 为你实际使用的 profile 名，桌面版常见为 `desktop`）。
- 安装方式用软链，不要把源码复制进 DSH 配置目录；profile 只负责登记与链接。

本插件已发布到 npm，包名 `@pianner/dsh-session-manager`。

## 安装（命令行，推荐）

从 npm 安装：

```bash
dsh plugin --profile <profile> add @pianner/dsh-session-manager
```

或用本地 clone / `.tgz` 做开发安装：

```bash
dsh plugin --profile <profile> add <plugin-dir>
dsh plugin --profile <profile> add /路径/@pianner-dsh-session-manager-<版本>.tgz
```

该命令会在 profile 里登记依赖、生成软链接。随后在 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 中加入 `"@pianner/dsh-session-manager"`（若未自动加入），重启 DSH desktop 即可。

## 安装（手动编辑 profile）

在 `~/.dsh/profiles/<profile>/package.json` 中：

1. `dependencies` 增加 `"@pianner/dsh-session-manager": "<版本号>"`（本地开发也可用 `link:<plugin-dir>` / `file:<plugin-dir>`）；
2. `dsh.profile.bundles` 增加 `"@pianner/dsh-session-manager"`；
3. 确保 `node_modules/@pianner/dsh-session-manager` 已就位（`pnpm install` / `npm install` 生成；本地开发用 `link:` 时为指向 `<plugin-dir>` 的软链）；
4. 重启 DSH desktop。

启动后 DSH 使用的 bundle entry 是本插件 package 的 `dsh.client` 与 `client/client.js`。`package.json` 里的 dependency 和 `dsh.profile.bundles` 只是运行登记，不应再复制一份插件源码。

## 安全关闭

从 profile 的 `dsh.profile.bundles` 移除 `@pianner/dsh-session-manager`（也可同时移除 dependency 后重启）。不要删除 DSH 的 session/workspace 数据，也不需要任何迁移脚本：宿主状态仍由 DSH 保存，原生 UI 或下一款兼容插件可继续读取。

## 卸载 / 回滚

删除上述 dependency 与 bundle 条目后重启 DSH。插件 cleanup 会恢复已隐藏的原生会话行；宿主 session/workspace 数据不做任何清理或迁移。

## 试用期安装（本地 `link:`，当前状态）

当前 profile 以 `link:` 指向仓库，改动立即生效（`npm run build` 后重启应用即可）：

```bash
cd <plugin-dir>
npm run build          # 生成 client/client.js
# 重启 DeepSeek Harness（⌘Q 完全退出后重新打开）
```

验收记录见 `docs/ACCEPTANCE-0.1.7.md`；试用期内不要同时安装 npm 上的旧版本，避免两个副本各自的
bundle 条目互相覆盖。

## 发布到 npm（**本次未执行**）

前置条件（缺一不可）：

1. `npm test`、`DSH_SOURCE=~/deepseek-harness npm run verify:align`、`npm run lint` 全绿。
2. `client/client.js` 已随源码构建并**提交**（`npm publish` 不会替你构建；仓库用 `prepublishOnly` 兜底）。
3. `package.json` 的 `version` 与 `CHANGELOG.md` 顶部一致；`dsh.bundle.patch`、`dsh.client.inject`
   与实际发布内容一致。
4. 在真实应用里试用数日无回归（见 `docs/ACCEPTANCE-0.1.7.md` §5）。

发布：

```bash
npm run verify                       # 最后一轮门禁
npm pack --dry-run                   # 确认打包清单（不含 dev/、test/、node_modules）
npm publish --access public          # 作用域包必须 public
```

发布后可选：把 profile 里的 `link:` 换成版本号（`dsh plugin --profile <name> add @pianner/dsh-session-manager@<version>`），
让后续升级走 npm 通道而不是本地路径。

回滚：`npm deprecate @pianner/dsh-session-manager@<version> "<原因>"`，并让 profile 回到上一个可用版本。
