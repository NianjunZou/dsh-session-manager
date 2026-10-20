# dsh-session-manager

[![CI](https://github.com/NianjunZou/dsh-session-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/NianjunZou/dsh-session-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)
中文: [`README.md`](README.md)

A local DSH plugin that gives the left sidebar a Codex-style session list, durable session
ordering, priority labels and a layered status indicator. It registers its own React occupant on
the official `sidebar.workspaces` slot: while enabled the official browsing cell does not render,
and disabling the plugin restores it. It never modifies DSH/Harness source and never touches the
right sidebar.

The plugin is a **toggleable left-side UI overlay** and is never a second source of truth for DSH
session data: sessions, workspace membership, pinned/archived state, the current selection and the
session order are always read from and written through host services. See
[`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md).

## Contents

- [Features](#features)
- [Compatibility](#compatibility)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Develop & verify](#develop--verify)
- [Scope & limitations](#scope--limitations)
- [License](#license)

## Features

- **Durable session ordering** by dragging a row (a pointer gesture, not HTML5 drag-and-drop),
  `Alt+↑/↓`, or the row menu's move up / move down. All three call the host's
  `workspaces.insertSessionBefore`; the order lands in the host's durable order, not in browser
  storage. Rows without a host account (the ungrouped bucket) and cross-workspace drags are
  refused.
- **Pinned block reordering** and **workspace reordering** (`workspaces.insertBefore`). The pin set
  is prepend-only and has no move API, so the plugin rewrites only the minimal mismatching suffix
  and shows the target order while dragging.
- **One status dot per row**: the dot reuses the official `StateDot` vocabulary (waiting / running /
  finished-unread / idle) and every row keeps exactly one, idle included; a running subagent, a
  background job and its owner are a sentence in the dot's tooltip and screen-reader text, not extra
  glyphs. Failure is *not* shown: the client `SessionStatus` has no failure bit and both available proxies false-positive
  (see the Chinese README, §状态取舍).
- **Priority view with bulk editing**: sessions grouped by level (empty levels drop out, an
  unlabelled fold sits last), a checkbox per row and a bulk bar to set or clear a level for the
  whole selection in one store write.
- **Priority labels P1–P4**, coloured in four weights of one accent: P1 solid with inverted text,
  P2 45% tint, P3 22% tint, P4 grey. Status hues (red/amber/green/neutral) stay the status
  vocabulary's own. State is persisted through the official `dsh-client-store`.
- **Two folding sections with sticky headers** ("pinned" and "project sessions", the latter folds
  every workspace group at once). Section bands, directory rows and session rows are three
  visually distinct levels; rows hanging straight off a heading keep a shallow indent, matching
  Codex.
- **Session search** (local title/workspace match merged with the host message index), paging
  ("show N more / collapse", attention rows always visible), view options (manual/recent order,
  hide/show/archived-only), add-workspace (`uiWorkspace.pickDirectory` + `workspaces.create`),
  pin/unpin, rename, fork, archive/unarchive, copy session ID / working directory.
- All icons come from the official `dsh-client-ui-primitives` set; typography follows the shipped
  session rows (32px rows, 14px/20px titles, 10px/16px time).

## Compatibility

Targets **`dsh-v0.2.1-alpha.5`**. While enabled, the official browsing cell is shadowed, so the five
child slots it declares (session menu items, row hover buttons, the schedule mark/hover seats and
the inline directory flow) do not render; they return as soon as the plugin is disabled. The inline
flow's capability is preserved through the `uiWorkspace.pickDirectory` service call. See the
Chinese README for the full table.

## Prerequisites

- DSH desktop on macOS.
- Node.js >= 20 (for tests).
- The alignment lane (`npm run verify:align`) needs a DSH source checkout (default
  `~/deepseek-harness`); without `DSH_SOURCE` it reports itself skipped instead of passing.

## Install

0.1.7 is what this repo builds; a development profile can still point at it through a `link:`
dependency:

```bash
npm run build                          # regenerate client/client.js
# then fully quit and reopen DeepSeek Harness
```

The publish checklist is in [`docs/DEPLOY.md`](docs/DEPLOY.md); the acceptance record and the
remaining verification gaps are in [`docs/ACCEPTANCE-0.1.7.md`](docs/ACCEPTANCE-0.1.7.md).

## Develop & verify

```bash
npm run build         # regenerate client/client.js from src/client/{core,body}.js
npm test              # 112 lanes: core, contract, bundle static assertions, a11y
npm run verify        # build + node --check + npm test + plugin-contract check
DSH_SOURCE=~/deepseek-harness npm run verify:align   # slot / Menu / StateDot / icons / host APIs
```

`client/client.js` is generated but committed, so the published package needs no consumer build.
Browser-level interaction acceptance runs through a maintainer-local harness (real React, real DOM,
real mouse input) that is not distributed with the repo; the itemised results are in
[`docs/ACCEPTANCE-0.1.7.md`](docs/ACCEPTANCE-0.1.7.md).

## Scope & limitations

- Operates only on `[data-slot="sidebar.workspaces"]`; does not take over the right sidebar.
- The official `ui-schedule` task marks and hover seats (and third-party contributions to the five
  child slots) do not render while the plugin is enabled — those slots are declared by official
  registrations that a shadowing plugin cannot re-declare.
- Not provided: permanent delete, cross-workspace move, native "unread" persistence — the target
  DSH version exposes no callable public write API for these.

## License

MIT — see [`LICENSE`](LICENSE).
