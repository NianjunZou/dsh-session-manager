# Local DSH Plugin Contract

## Status

Required contract for this local DSH plugin.

## Core rule

A local DSH plugin is an optional override layer. It may replace presentation and interaction, but it must not become the only source of truth for data already owned by DSH.

When a plugin is disabled, unloaded, upgraded, or replaced:

- DSH-owned data remains intact;
- native UI can render the same data without migration;
- another compatible plugin can consume the same host service contract;
- no stale DOM, event listener, timer, observer, subscription, style, storage key, or background task remains;
- the plugin does not silently undo a user action that was committed through a host service.

## Data ownership

Before implementing an override, classify every state value. If the host already exposes a value, the host remains its canonical owner even when the plugin renders a replacement UI:

| State | Owner | Plugin rule |
|---|---|---|
| Session/workspace records | DSH host | Read through host service/store; never duplicate as private truth |
| Workspace membership/order | DSH host | Use host operation/service; no plugin-only membership table |
| Pin/archive flags | DSH host | Use host pin/archive services and host projections |
| Current selection | DSH host/UI service | Read host selection; do not infer from stale DOM |
| Plugin-only visual preference | Plugin | May use namespaced storage, with cleanup/versioning |
| Rendered DOM | Plugin while enabled | Mark every node as owned and remove it on cleanup |

If the host contract is unavailable, fail open: retain native behavior and do not write a shadow store.

## Lifecycle and rollback

Every plugin must have an explicit lifecycle:

1. `apply`: verify required host services; if unavailable, do nothing except a diagnostic warning.
2. `render`: project host state into owned DOM; never treat plugin-owned nodes as native nodes.
3. `action`: call host services; surface failures instead of swallowing them.
4. `cleanup`: unsubscribe, stop timers, disconnect observers, remove listeners/menus/dialogs/styles, restore modified native DOM, and remove owned nodes.

DOM edits must be reversible. Before hiding/changing a native node, record the previous class/style/attribute value. Restoration must be scoped to nodes changed by this plugin only.

Do not delete or rewrite host data from cleanup. Cleanup is a UI/lifecycle rollback, not a data migration.

## Storage and interoperability

- Never use plugin-private storage for a state that DSH already persists.
- If plugin-only storage is unavoidable, namespace it (`dsh-plugin:<plugin-id>:`), document ownership, and make missing storage a valid state.
- A replacement/native implementation must be able to ignore plugin-only storage and still render all host-owned data.
- Stable identifiers must be host identifiers; do not invent a second ID for sessions/workspaces.

## Required regression cases

At minimum, test:

- repeated renders do not hide/delete/duplicate custom rows;
- nested groups or unrelated UI remain untouched;
- action invokes the host service with the host ID;
- cleanup restores native DOM and leaves host state unchanged;
- plugin can start with missing optional services without breaking native UI;
- menu/dialog/keyboard/outside-click handlers are removed on cleanup;
- a second render after cleanup does not resurrect plugin DOM.
