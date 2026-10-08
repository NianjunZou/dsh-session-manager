# AGENTS.md — dsh-session-manager

本文件是 AI 编码代理（Claude / Codex / DSH 等）在本仓库工作的操作说明。人类贡献者请读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 项目背景

A local DSH plugin that gives the left workspace a Codex-style session list.
它只接管左侧工作区中的会话行与会话菜单，不修改 DSH/Harness 源码，不接管右侧 sidebar。详见 [`README.md`](README.md) 与 [`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md)。

- 运行时：DSH web client plugin（`client/platform: web`，宿主注入 `@deepseek-ai/dsh-client-runtime`）。
- 关键文件：`client/client.js`（client 入口与全部行为）、`src/index.js`（host 半，空 apply）、`cordis.patch.yml`（bundle 登记）。

## 构建与验证

```bash
npm test              # node --test：静态 + fixture/contract 回归
npm run test:browser  # 独立临时 Chrome 下的 DOM/服务回归（需本地 playwright 浏览器）
npm run verify        # node --check client/client.js + npm test + 插件契约检查
```

- 改完 `client/client.js` 后至少跑 `npm run verify`。
- 新增行为补测试（`test/plugin.test.js` 静态/契约，`test/browser.test.js` DOM 回归）。

## 硬性红线

1. **遵守插件契约**（[`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md)）：插件是可关闭的 UI 覆盖层，不得成为 DSH 会话数据的第二真相源；会话/工作区/置顶/归档/选择状态只读写宿主服务，`cleanup` 必须可逆、无副作用。
2. **不泄露本地 / 公司 / 密钥信息**：禁止把本机绝对路径、公司内部标识、内部主机名/端口、DSH/Codex 构建号与 ASAR 哈希、逆向笔记、密钥/令牌写进仓库。仓库 CI 的 `leak-scan` 会在 push/PR 时拦截；本地建议装 `.git/hooks/pre-commit` 作为提交前第一道闸。
3. **自包含**：文档不链接仓库外文件；需要的内容放进仓库。
4. **不改 Harness**：只动插件源码，不编译/修改 DSH/Harness 或 ASAR。
5. **提交身份**：使用作者个人 git 身份，不使用公司邮箱/用户名。

## 提交与分支

- 提交信息用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:` / `fix:` / `docs:` / `chore:` / `test:` / `refactor:`。
- 不直接推 `main`（除非仓库所有者本人明确允许）；特性走分支 + PR。
- 破坏性操作（删数据、改历史、force push）需人类明确授权。
