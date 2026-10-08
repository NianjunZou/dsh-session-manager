# Changelog

## Unreleased

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
