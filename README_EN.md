# dsh-session-manager

[![CI](https://github.com/NianjunZou/dsh-session-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/NianjunZou/dsh-session-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)
中文: [`README.md`](README.md)

A local DSH plugin that gives the left workspace a Codex-style session list. It only
takes over the session rows and session menu in the left workspace; it does not modify
DSH/Harness source and does not touch the right sidebar.

The plugin is a **toggleable left-side UI overlay** and never becomes a second source of
truth for DSH session data: sessions, workspace membership, pinned/archived state and the
current selection are always read from and written through host services. See
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

- Keeps native workspace grouping, expand/collapse and workspace-level actions.
- Replaces native session rows with the plugin's Codex-style rows.
- Pin/unpin, rename, fork, archive/unarchive, copy Session ID, copy working directory.
- Hides native rows and duplicate native pin entries to avoid plugins overwriting each other.
- Dedicated "pinned" section + "project sessions" block; running / awaiting / unread status.

## Compatibility

Developed and tested against the DSH desktop web client, target line `0.2.0-rc.2`.
Other DSH versions may need adjustment if the client DOM/service contract changes.

## Prerequisites

- DSH desktop on macOS.
- Node.js >= 20 (for tests).
- The browser regression (`npm run test:browser`) needs a local Playwright browser
  (`npx playwright install chromium`).

## Install

Install from npm: `dsh plugin --profile <profile> add @pianner/dsh-session-manager`,
add `@pianner/dsh-session-manager` to your DSH desktop profile's `dsh.profile.bundles`,
and restart DSH. You can also clone this repo for a local dev install. Full steps in
[`docs/DEPLOY.md`](docs/DEPLOY.md).

The only supported install channel today is a local clone of this repo referenced from the
DSH profile as a `link:` / `file:` dependency (or a plain local directory). The plugin is not
published to npm or dshmarket yet.

## Develop & verify

```bash
npm test              # static + fixture/contract regression
npm run test:browser  # DOM/service regression in a throwaway Chrome
npm run verify        # node --check + npm test + plugin-contract check
```

## Scope & limitations

- Operates only on `[data-slot="sidebar.workspaces"]`; does not take over the right sidebar.
- Not yet provided: permanent delete, cross-workspace move, native "unread" persistence —
  the target DSH version exposes no callable public write API for these.

## License

MIT — see [`LICENSE`](LICENSE).
