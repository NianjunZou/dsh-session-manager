/**
 * Exact-source alignment lane.
 *
 * Every host touchpoint this plugin depends on — declared client inject rows,
 * peer ranges, the slot it occupies, the services it calls, the primitives it
 * renders, the standard hooks it reads and the state tokens it paints with — is
 * checked against a real DSH checkout. It is the only lane that can distinguish
 * "our tests pass" from "we are aligned with the release we claim".
 *
 * It is opt-in and self-skipping: the repository stays self-contained, and the
 * lane runs where a checkout exists.
 *
 *   DSH_SOURCE=~/deepseek-harness npm test
 *
 * Without `DSH_SOURCE` the lane reports itself skipped, so an unverified claim
 * is visible instead of silently green.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const source = process.env.DSH_SOURCE ? resolve(process.env.DSH_SOURCE) : undefined
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const code = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

const skip = source === undefined
  ? 'set DSH_SOURCE=<dsh checkout> to run the exact-source alignment lane'
  : false

/** Read one file under the checkout. */
const read = relative => readFileSync(join(source, relative), 'utf8')

/** Concatenate every file matching a predicate under a checkout subtree. */
function scan(relativeDir, predicate = () => true) {
  const root = join(source, relativeDir)
  if (!existsSync(root)) return ''
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'lib' || entry === 'tests') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (predicate(entry)) out.push(readFileSync(full, 'utf8'))
    }
  }
  walk(root)
  return out.join('\n')
}

/** Every workspace package in the checkout, as `name -> package.json`. */
function workspacePackages() {
  const packages = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (!statSync(full).isDirectory()) continue
      const manifest = join(full, 'package.json')
      if (existsSync(manifest)) {
        try {
          const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
          if (parsed.name) packages.set(parsed.name, { path: full, manifest: parsed })
        } catch { /* a malformed manifest is not this lane's business */ }
      }
      walk(full)
    }
  }
  for (const top of ['packages', 'apps', 'vendor']) {
    const dir = join(source, top)
    if (existsSync(dir)) walk(dir)
  }
  return packages
}

test('the claimed DSH release is the checkout under test', { skip }, () => {
  // The declared range must *cover* the release we verified against.
  const range = pkg.peerDependencies['@deepseek-ai/dsh-client-ui-slots']
  assert.match(range, /^>=0\.2\.0-alpha\.0 <0\.3\.0$/)
  const slots = workspacePackages().get('@deepseek-ai/dsh-client-ui-slots')
  assert.ok(slots, 'the checkout must contain the slots package')
  assert.equal(slots.manifest.version, '0.2.1-alpha.5')
  // A range that covers the release must also be the version we write down.
  assert.match(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-slots'], /0\.2\.0-alpha\.0/)
})

test('every declared client inject row resolves to a real package', { skip }, () => {
  const packages = workspacePackages()
  for (const name of pkg.dsh.client.inject) {
    assert.ok(packages.has(name), `dsh.client.inject lists ${name}, which no workspace package provides`)
  }
  // The placeholder that never existed must stay gone.
  assert.equal(packages.has('@deepseek-ai/dsh-client-runtime'), false)
})

test('every peer range accepts the checkout it claims to support', { skip }, () => {
  const packages = workspacePackages()
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (name === 'react' || name === 'react-dom') continue
    const found = packages.get(name)
    assert.ok(found, `peer ${name} is not a workspace package`)
    if (name === '@deepseek-ai/cordis') {
      // Cordis versions on its own line; the DSH packages share the release.
      assert.match(found.manifest.version, /^4\./, 'cordis major moved')
      continue
    }
    assert.equal(found.manifest.version, '0.2.1-alpha.5', `${name} version moved`)
    assert.equal(range, '>=0.2.0-alpha.0 <0.3.0', `${name} range changed`)
  }
})

test('the occupied cell is still a single root slot the shipped browser fills', { skip }, () => {
  const sidebar = read('packages/client/ui-sidebar/src/client/contract/slots.ts')
  assert.match(sidebar, /'sidebar\.workspaces':\s*\{\s*kind: 'single'[;,]/)
  assert.match(sidebar, /scope: 'root'/)
  const workspace = read('packages/client/ui-workspace/src/client/index.ts')
  assert.match(workspace, /ctx\.slots\.register\(\s*\{\s*name: 'sidebar\.workspaces'/)
  // Our registration must shadow it, and must not collide with the other
  // published occupant of the same cell.
  assert.match(code, /const SLOT_PRIORITY = -2/)
})

test('the child slots we intentionally orphan still exist where we say they do', { skip }, () => {
  const workspace = read('packages/client/ui-workspace/src/client/index.ts')
  for (const child of ['sidebar.workspaces.session.menu.item', 'sidebar.workspaces.session.row.action']) {
    assert.ok(workspace.includes(child), `${child} is no longer declared by ui-workspace`)
  }
  const workspaceContract = read('packages/client/ui-workspace/src/client/contract/slots.ts')
  for (const child of ['sidebar.session.row.leading', 'sidebar.session.row.hover']) {
    assert.ok(workspaceContract.includes(child), `${child} is no longer declared by ui-workspace`)
  }
  // A shadowing entry cannot re-declare them: the registry throws on a child
  // that is already declared, which is why the README documents the orphaning.
  const slots = read('packages/client/ui-slots/src/index.ts')
  assert.match(slots, /is already declared \(by/)
})

test('every host service method we call exists with the arity we use', { skip }, () => {
  // The `uiWorkspace` actions live on the client service class, not on the
  // workspace-controller facade.
  const navigation = read('packages/client/ui-workspace/src/client/navigation.ts')
  for (const method of ['openSession', 'pinSession', 'unpinSession', 'archiveSession',
    'unarchiveSession', 'forkSession']) {
    assert.ok(navigation.includes(`${method}(`), `uiWorkspace.${method} is gone`)
  }
  const service = read('packages/api/workspace-controller/src/client/service.ts')
  assert.match(service, /insertSessionBefore\(\s*workspaceId: WorkspaceId,\s*sessionId: SessionId,\s*beforeSessionId\?: SessionId,?\s*\): Promise<WorkspaceView>/)
  // The directory flow is a service call, so owning the region does not cost it.
  assert.match(navigation, /pickDirectory\(\): Promise<string \| null>/)
  const controller = read('packages/api/workspace-controller/src/client/service.ts')
  assert.match(controller, /create\(input: \{ path: string \}\): Promise<WorkspaceView>/)
  // Search and paging read two published facts: the bounded host search and the
  // result cap the browser must honour.
  const sessionService = read('packages/api/session-controller/src/client/sessions/service.ts')
  assert.match(sessionService, /search\(\s*query: string,\s*signal: AbortSignal,?\s*\): Promise<RemoteResult<\{ items: SessionSearchResultItem\[\]; hasMore: boolean \}>>/)
  assert.match(sessionService, /readonly searchResultLimit = SESSION_SEARCH_RESULT_LIMIT/)
  const manager = read('packages/api/session-controller/src/client/sessions/manager.ts')
  assert.match(manager, /export interface SessionSearchResultItem \{\s*sessionId: SessionId\s*snippet: string\s*\}/)
  // The generation-scoped accessor is generic, hence `using<T>(`.
  const sessions = read('packages/api/session-controller/src/client/sessions/service.ts')
  assert.match(sessions, /async using<T>\(/)
  assert.match(code, /reference\.binding\.session\.rename\(title\)/)
})

test('the hooks and primitives we bind are still exported', { skip }, () => {
  const primitives = read('packages/client/ui-primitives/src/index.ts')
  for (const exported of ['StateDot', 'Menu', 'Modal']) {
    assert.ok(new RegExp(`export \\{[^}]*\\b${exported}\\b`).test(primitives), `${exported} is gone`)
  }
  const stateDot = read('packages/client/ui-primitives/src/StateDot.tsx')
  assert.match(stateDot, /export type StateDotState = 'done' \| 'warning' \| 'ongoing' \| 'error' \| 'idle'/)
  const session = read('packages/client/ui-session/src/client/index.ts')
  for (const hook of ['useSessions', 'useSessionStatus']) {
    assert.ok(session.includes(hook), `${hook} is no longer published by ui-session`)
  }
  const workspace = read('packages/client/ui-workspace/src/client/index.ts')
  assert.match(workspace, /useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>/,
    'useWorkspaces is no longer published by ui-workspace')
})

test('the state tokens we paint with are the ones the primitives define', { skip }, () => {
  const css = read('packages/client/ui-primitives/src/StateDot.module.css')
  for (const token of ['state-success-primary', 'state-warn-primary', 'state-error-primary', 'state-idle-primary']) {
    assert.ok(css.includes(`--dsw-alias-${token}`), `${token} is no longer used by StateDot`)
  }
  // The row paints no state colour of its own for the dot any more: the status
  // dot is the shipped component, and the only state tokens the bundle still
  // names are the ones it paints itself (drag insertion line, notice border).
  for (const token of ['--dsw-alias-state-business-primary', '--dsw-alias-state-warn-primary']) {
    assert.ok(code.includes(token), token)
  }
  // Whatever the theme defines, any mark colour we might reintroduce must exist.
  const tokens = scan('packages/client', name => name.endsWith('.css'))
  for (const token of ['--dsw-alias-state-business-primary', '--dsw-alias-state-warn-secondary',
    '--dsw-alias-state-error-secondary']) {
    assert.ok(tokens.includes(token), `${token} is not defined anywhere in the client styles`)
  }
})

test('the status and projection fields we read are still published', { skip }, () => {
  const status = read('packages/client/ui-session/src/client/index.ts')
  for (const field of ['running', 'pendingInteraction', 'completionUnread']) {
    assert.ok(status.includes(field), `SessionStatus.${field} is gone`)
  }
  const summary = read('packages/api/session-controller/src/client/sessions/service.ts')
  for (const field of ['displayTitle', 'parentId', 'retainedBy', 'updatedAt', 'projectionsBySession']) {
    assert.ok(summary.includes(field), `SessionSummary.${field} is gone`)
  }
  const projection = read('packages/subagent/subagent/src/projection-types.ts')
  assert.match(projection, /subagentCatalog: SubagentCatalogEntry\[\]/)
  assert.match(projection, /subagentTiming: SubagentTimingProjection/)
  assert.match(projection, /lastTurnCompleted\?: boolean/)
  for (const mode of ['one-shot', 'external', 'continuable', 'unknown']) {
    assert.ok(projection.includes(`mode: '${mode}'`), `subagent mode ${mode} is gone`)
  }
})

test('the job roster shape we fold is unchanged', { skip }, () => {
  const view = read('packages/jobs/jobs/src/view.ts')
  assert.match(view, /export type JobStatus = 'running' \| 'stopping' \| 'completed' \| 'killed' \| 'failed'/)
  for (const field of ['readonly id', 'readonly label', 'readonly owner', 'readonly status', 'readonly progress', 'readonly detail']) {
    assert.ok(view.includes(field), `JobView.${field} is gone`)
  }
  // The roster is read exactly the way the shipped jobs surface reads it.
  // `ctx.jobs` is installed by the job controller's client half; that package
  // must therefore arrive before this plugin's factory.
  const jobController = read('packages/api/job-controller/src/client/index.ts')
  assert.match(jobController, /installs `ctx\.jobs`/)
  const jobsClient = read('packages/client/ui-jobs/src/client/index.ts')
  assert.match(jobsClient, /inject = \[\s*'jobs'/)
  assert.match(jobsClient, /hooks: \{ jobs: ctx\.jobs\.state \}/)
  const jobList = read('packages/client/ui-jobs/src/client/JobListAction.tsx')
  assert.match(jobList, /useJobs\(state => state\.rows\[sessionId\]\)/)
  // The roster is materialized per watched session, so a surface that folds
  // `rows` without opening a watch sees an empty roster forever. The call this
  // plugin makes is the one the shipped control makes.
  assert.match(jobList, /useEffect\(\(\) => watchRows\(sessionId\), \[sessionId, watchRows\]\)/)
  assert.match(jobsClient, /watchRows: sessionId => ctx\.jobs\.watchRows\(sessionId\)/)
  assert.match(read('packages/api/job-controller/src/client/service.ts'),
    /watchRows\(sessionId: SessionId\): \(\) => void/)
  assert.match(code, /jobsSnapshot\?\.rows/)
})

test('the locale registration shape we use is the documented one', { skip }, () => {
  const locale = read('packages/client/locale/src/client/index.ts')
  assert.match(locale, /register\(/)
  assert.match(code, /ctx\.locale\.register\(NS, \{ zh, en \}\)/)
  assert.match(code, /locale: NS/)
})
