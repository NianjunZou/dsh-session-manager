/**
 * Host half for the client-only left session manager.
 *
 * The DSH bundle loader uses this package entry to register the plugin; all
 * left-session behavior is intentionally isolated in client/client.js.
 */
export const name = 'dsh-session-manager'
export function apply() {}
