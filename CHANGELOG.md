# Changelog

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
