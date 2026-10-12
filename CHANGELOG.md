# Changelog

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
