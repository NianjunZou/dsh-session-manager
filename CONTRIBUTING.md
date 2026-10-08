# 贡献指南 — dsh-session-manager

欢迎提 Issue 与 PR。本文件约定开发环境、代码规范与提交流程。

## 环境准备

```bash
git clone <repo-url>
cd dsh-session-manager
npm install                                   # 开发依赖（playwright，用于 browser 回归）
```

## 本地验证

```bash
npm run verify        # node --check + npm test + 插件契约检查
npm run test:browser  # 独立临时 Chrome 下的 DOM/服务回归
```

- 新增行为需补测试：`test/plugin.test.js`（静态/契约）与 `test/browser.test.js`（DOM 回归）。
- 不要提交构建产物、`node_modules`、`*.tgz`、日志（见 `.gitignore`）。

## 代码规范

- 遵守 [`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md)：UI 覆盖层、宿主数据唯一真相源、`apply → render → action → cleanup` 可逆、缺服务 fail open。
- 只操作 `[data-slot="sidebar.workspaces"]` 左侧会话区；不接管右侧 sidebar，不改 DSH/Harness 源码或 ASAR。
- 插件 DOM 一律带 owned 标记，`cleanup` 全部移除并恢复被改过的原生节点。
- 保持改动聚焦，一个 PR 只做一件事。

## 提交信息（Conventional Commits）

```
feat:     新功能
fix:      缺陷修复
docs:     文档
test:     测试
refactor: 重构（不改外部行为）
chore:    构建/杂项
```

## 分支与 PR

1. 从 `main` 切分支：`git switch -c feat/<topic>`。
2. 小步提交，保持历史清晰。
3. PR 填写变更摘要、测试情况、风险/回滚（见 PR 模板）。
4. 不直接推 `main`；force push 等破坏性操作需仓库所有者授权。

## 安全与隐私红线

- 禁止提交本机绝对路径、内部主机名/端口、公司标识、DSH/Codex 内部构建信息、密钥/令牌。仓库 CI 的 `leak-scan` 会在 push/PR 时拦截；建议本地也装一个 `.git/hooks/pre-commit` 作为提交前第一道闸。
- 安全漏洞请按 [`SECURITY.md`](SECURITY.md) 私下反馈。
