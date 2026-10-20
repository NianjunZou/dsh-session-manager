/*!
 * @pianner/dsh-session-manager — pure derivation core.
 *
 * No DOM, no React, no host globals: every function here is a pure projection of
 * host snapshots the client already reads. Keeping it pure is what makes the
 * session state model, the ordering rules and the subtree rollup unit-testable
 * without a browser, and it is the single place the UI layer asks "what is this
 * session's state / order / next position".
 *
 * Sources (all read-only, all owned by the Host):
 * - `sessions.list`      -> SessionListState  (ids, byId, projectionsBySession)
 * - `uiSession.sessionStatus` -> SessionStatusSnapshot (Map<SessionId, SessionStatus>)
 * - `jobs.state`         -> { rows: Record<SessionId, JobView[]> }
 * - `workspaces.list`    -> WorkspaceSnapshot (items, pinnedSessionIds, archivedSessionIds)
 *
 * Ordering follows the Host's own contract: `workspace.sessionIds` is the durable
 * manual order, and reordering is written through the Host service
 * `workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId?)`.
 * Nothing here invents a second source of truth.
 * License: MIT.
 */

/** Status dot kinds, most significant first. */
export const DOT = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  SUBAGENT: 'subagent',
  JOB: 'job',
  FAILED: 'failed',
  UNREAD: 'unread',
  IDLE: 'idle',
})

/**
 * The five primary dot states, spelled exactly like the Host's own `StateDot`
 * vocabulary so the plugin can render the shipped component instead of forking
 * it. Anything more specific is a *qualifier* rendered beside the primary dot.
 */
export const STATE_DOT = Object.freeze({
  DONE: 'done',
  WARNING: 'warning',
  ONGOING: 'ongoing',
  ERROR: 'error',
  IDLE: 'idle',
})

/**
 * Qualifier vocabulary, kept as plain strings on {@link statusOf}.activity.
 *
 * The row paints exactly **one** glyph, so these are not separate marks any
 * more: they are the sentences the dot's tooltip composes ("1 个子会话执行中，
 * 1 个子会话的后台任务执行中"). A row with four concurrent facts still shows a
 * single dot; the breakdown is one hover away instead of four extra circles.
 */

/** Session row origin the Host uses for delegated children. */
export const SUBAGENT_ORIGIN = 'subagent'

/** Archived-row visibility, mirroring the Host browser's three-way filter. */
export const ARCHIVED_FILTER = Object.freeze({ DEFAULT: 'default', SHOW: 'show', ONLY: 'only' })

/** Flat-list account key for sessions outside every workspace. */
export const UNGROUPED_KEY = ''

/** A terminal job status a user asked for is not a failure. */
const JOB_RUNNING = 'running'
const JOB_STOPPING = 'stopping'
const JOB_FAILED = 'failed'

/** Catalog modes the Host itself skips when materializing rows. */
const EXTERNAL_MODE = 'external'

/** Defensive bound on parent-chain walks; host trees are shallow, cycles are not expected. */
const MAX_DEPTH = 64

/**
 * Read one host observable/store snapshot through either accessor shape.
 * @param {unknown} store - object exposing `getSnapshot()` or `get()`.
 * @returns {any} the current snapshot, or undefined when the store is absent.
 */
export function snapshotOf(store) {
  if (!store) return undefined
  if (typeof store.getSnapshot === 'function') return store.getSnapshot()
  if (typeof store.get === 'function') return store.get()
  return undefined
}

/**
 * Normalize a pending-interaction value to its kind string.
 * @param {unknown} value - `SessionStatus.pendingInteraction` (string or object).
 * @returns {string|undefined} one of `approval` / `plan-review` / `question`.
 */
export function pendingKind(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.kind === 'string') return value.kind
  return undefined
}

/**
 * Direct children of every session, merged from the two host-published edges.
 *
 * `byId[*].parentId` covers rows the Host materialized for a child that has a
 * live scope; `projectionValues.subagentCatalog` covers the parent's own durable
 * catalog, which also survives after the child scope is gone. Rows the Host
 * itself filters out (`mode: 'external'`) are excluded, so the tree here matches
 * the tree the Host renders.
 *
 * @param {any} list - `sessions.list` snapshot.
 * @returns {Map<string, string[]>} parent id -> ordered child ids.
 */
export function buildChildren(list) {
  const children = new Map()
  const add = (parentId, childId) => {
    if (typeof parentId !== 'string' || typeof childId !== 'string' || parentId === childId) return
    const bucket = children.get(parentId)
    if (!bucket) children.set(parentId, [childId])
    else if (!bucket.includes(childId)) bucket.push(childId)
  }
  const byId = list?.byId
  if (!byId || typeof byId !== 'object') return children
  for (const row of Object.values(byId)) {
    if (!row || typeof row.id !== 'string') continue
    add(row.parentId, row.id)
  }
  for (const [parentId, projection] of Object.entries(list.projectionsBySession || {})) {
    for (const entry of projection?.values?.subagentCatalog || []) {
      if (!entry || entry.mode === EXTERNAL_MODE) continue
      add(parentId, entry.id)
    }
  }
  return children
}

/**
 * Every descendant id of one session, breadth-first and cycle-safe.
 * @param {Map<string, string[]>} children - output of {@link buildChildren}.
 * @param {string} id - root session id.
 * @returns {Set<string>} descendant ids (never includes `id`).
 */
export function descendantsOf(children, id) {
  const found = new Set()
  let frontier = children.get(id) || []
  let depth = 0
  while (frontier.length > 0 && depth++ < MAX_DEPTH) {
    const next = []
    for (const child of frontier) {
      // A malformed cyclic edge back to the root must not make the root its own
      // descendant: callers use this set as "everything below this session".
      if (child === id || found.has(child)) continue
      found.add(child)
      next.push(...(children.get(child) || []))
    }
    frontier = next
  }
  return found
}

/**
 * Aggregate one session and its whole subtree into a single record.
 *
 * The aggregation is post-order over the tree, so a subtree is folded exactly
 * once per snapshot instead of once per rendered row: `statusOf` becomes a map
 * lookup rather than the O(rows x sessions) upward walk the previous revision
 * needed.
 *
 * Every counter has exactly one host source:
 * - `subagentsTotal` / `subagentsRunning` -> `subagentCatalog` + `byId[child].running`
 * - `jobs*` -> `jobs.state.rows` for every session in the tree
 * - `abnormalTurns` -> `projectionValues.subagentTiming` with no open turn and a
 *   last closed turn that did not complete normally
 *
 * @param {any} list - `sessions.list` snapshot.
 * @param {any} jobsSnapshot - `jobs.state` snapshot, or undefined when the job service is absent.
 * @returns {{children: Map<string, string[]>, rollup: Map<string, object>}}
 */
export function buildRollup(list, jobsSnapshot) {
  const children = buildChildren(list)
  const byId = list?.byId || {}
  const projections = list?.projectionsBySession || {}
  const rows = jobsSnapshot?.rows || {}
  const rollup = new Map()

  // Projections reach the client on the list row when the Host published one,
  // and in the shared per-session map otherwise (a cold or never-opened child).
  // Both are partial, possibly stale hints, so absence degrades to "unknown".
  const projectionValuesOf = (id) => byId[id]?.projectionValues ?? projections[id]?.values

  const ownRecord = (id) => {
    const timing = projectionValuesOf(id)?.subagentTiming
    // `lastTurnCompleted === false` with no open turn is the only durable
    // "this child's last turn ended abnormally" signal the client can read.
    // `subagentTiming` is defined for descriptor-backed child sessions only; a
    // top-level session carrying it is a stale hint, not a failure.
    const isChild = byId[id]?.origin === SUBAGENT_ORIGIN
    const abnormal = isChild && timing && timing.active === undefined && timing.lastTurnCompleted === false ? 1 : 0
    let running = 0
    let stopping = 0
    // A settled failure is news only while it is the newest thing the tree did.
    // The roster keeps every settled job for inspection, so counting them all
    // would keep a long-finished session red for days.
    let newestSettledAt = -1
    let newestFailed = 0
    for (const job of rows[id] || []) {
      if (!job) continue
      if (job.status === JOB_RUNNING) { running++; continue }
      if (job.status === JOB_STOPPING) { stopping++; continue }
      const at = Number(job.finishedAt)
      if (!Number.isFinite(at)) continue
      if (at > newestSettledAt) {
        newestSettledAt = at
        newestFailed = job.status === JOB_FAILED ? 1 : 0
      } else if (at === newestSettledAt && job.status === JOB_FAILED) {
        newestFailed++
      }
    }
    return {
      selfRunning: byId[id]?.running === true,
      subagentsTotal: (children.get(id) || []).length,
      subagentsRunning: 0,
      // The roster is per session, so own and delegated jobs are counted apart:
      // "my background job" and "a subagent's background job" are different
      // news on the row, and folding them into one number hid that.
      jobsRunning: running,
      jobsStopping: stopping,
      jobsRunningSelf: running,
      jobsStoppingSelf: stopping,
      jobsRunningSubtree: 0,
      jobsStoppingSubtree: 0,
      jobsFailed: newestFailed,
      settledAt: newestSettledAt,
      abnormalTurns: abnormal,
    }
  }

  const visit = (id, guard) => {
    const cached = rollup.get(id)
    if (cached) return cached
    if (guard.has(id) || guard.size > MAX_DEPTH * MAX_DEPTH) {
      // A cycle is a host-contract violation, not a rendering input: degrade to
      // the session's own facts instead of looping.
      const leaf = ownRecord(id)
      rollup.set(id, leaf)
      return leaf
    }
    guard.add(id)
    const record = ownRecord(id)
    for (const child of children.get(id) || []) {
      const childRecord = visit(child, guard)
      record.subagentsRunning += childRecord.selfRunning ? 1 : 0
      record.subagentsRunning += childRecord.subagentsRunning
      record.jobsRunning += childRecord.jobsRunning
      record.jobsStopping += childRecord.jobsStopping
      record.jobsRunningSubtree += childRecord.jobsRunning
      record.jobsStoppingSubtree += childRecord.jobsStopping
      // The tree's newest settled job wins outright: a later success anywhere
      // in the subtree retires every earlier failure.
      if (childRecord.settledAt > record.settledAt) {
        record.settledAt = childRecord.settledAt
        record.jobsFailed = childRecord.jobsFailed
      } else if (childRecord.settledAt === record.settledAt && childRecord.settledAt >= 0) {
        record.jobsFailed += childRecord.jobsFailed
      }
      record.abnormalTurns += childRecord.abnormalTurns
    }
    guard.delete(id)
    rollup.set(id, record)
    return record
  }

  for (const id of Object.keys(byId)) visit(id, new Set())
  return { children, rollup }
}

/**
 * Session ids whose job roster must be watched to paint the given rows.
 *
 * The Host keeps a job roster only for sessions a surface asked to watch
 * (`ctx.jobs.watchRows`), and a row's status folds its whole subtree — so the
 * set is every visible row **plus** its descendants, deduplicated across rows.
 * Watching only the visible ids would drop a background job that a child session
 * owns; watching everything would open a stream per session in every collapsed
 * project.
 *
 * @param {Iterable<string>} ids - session ids of the rows about to render.
 * @param {Map<string, string[]>} children - `buildRollup` children index.
 * @returns {string[]} watch targets, first-seen order.
 */
export function watchTargets(ids, children) {
  const out = new Set()
  for (const id of ids || []) {
    if (typeof id !== 'string' || id === '') continue
    // An id reached as an earlier row's descendant already contributed its own
    // subtree, so re-walking it would only repeat work.
    if (out.has(id)) continue
    out.add(id)
    if (!children || typeof children.get !== 'function') continue
    for (const child of descendantsOf(children, id)) out.add(child)
  }
  return [...out]
}

/**
 * Layered status of one session: who, if anyone, is still at work.
 *
 * Precedence is fixed here and nowhere else:
 * `pending > running > subagent > job > unread > idle`.
 *
 * The client exposes **no** failure state for a session — `SessionStatus` has
 * only running / pendingInteraction / completionUnread — and the two proxies
 * that look like one both false-positive in real use: the job roster retains
 * every settled job for inspection, and `subagentTiming.lastTurnCompleted` is
 * false for an interrupted or still-waiting child. A row therefore never shows
 * a failure; the raw counts stay available as {@link statusOf} `facts` for
 * surfaces that can attribute them precisely.
 *
 * @param {string} id - session id.
 * @param {object} context - `{ rollup, statusSnapshot }`.
 * @returns {{dot: string, pending: (string|undefined), activity: object, unread: boolean, facts: object}}
 */
export function statusOf(id, context) {
  const status = context.statusSnapshot?.get?.(id) || {}
  const pending = pendingKind(status.pendingInteraction)
  const record = context.rollup?.get?.(id) || {
    selfRunning: false,
    subagentsTotal: 0,
    subagentsRunning: 0,
    jobsRunning: 0,
    jobsStopping: 0,
    jobsRunningSelf: 0,
    jobsStoppingSelf: 0,
    jobsRunningSubtree: 0,
    jobsStoppingSubtree: 0,
    jobsFailed: 0,
    abnormalTurns: 0,
  }
  // The session's own status is authoritative while the client has observed it;
  // the list row's `running` is the documented display fallback before that.
  const self = status.running === undefined ? record.selfRunning : status.running === true
  const jobBusy = record.jobsRunning + record.jobsStopping
  const subagentBusy = record.subagentsRunning
  const ownJobs = (record.jobsRunningSelf || 0) + (record.jobsStoppingSelf || 0)
  const unread = status.completionUnread === true
  // Raw, unattributed failure counts. They are deliberately not mapped to a
  // row state; see the doc comment above.
  const facts = { jobsFailed: record.jobsFailed, abnormalTurns: record.abnormalTurns }

  let dot = DOT.IDLE
  if (pending) dot = DOT.PENDING
  else if (self) dot = DOT.RUNNING
  else if (subagentBusy > 0) dot = DOT.SUBAGENT
  else if (jobBusy > 0) dot = DOT.JOB
  else if (unread) dot = DOT.UNREAD

  return {
    dot,
    pending,
    activity: {
      self,
      subagents: { running: subagentBusy, total: record.subagentsTotal },
      // `own` is this session's roster, `subtree` is every job owned by a
      // descendant: the row reports them as two marks, never one merged count.
      jobs: {
        running: record.jobsRunning + record.jobsStopping,
        own: ownJobs,
        subtree: jobBusy - ownJobs,
      },
    },
    unread,
    facts,
  }
}

/**
 * Order a list of session ids by current activity.
 * @param {readonly string[]} ids - member ids.
 * @param {Record<string, {updatedAt?: number}>} byId - session summaries.
 * @returns {string[]} ids sorted by `updatedAt` descending, id ascending on ties.
 */
export function orderByRecency(ids, byId) {
  return ids
    .filter(id => byId?.[id])
    .map(id => ({ id, rank: Number(byId[id].updatedAt) || 0 }))
    .sort((left, right) => (right.rank - left.rank) || (left.id < right.id ? -1 : 1))
    .map(entry => entry.id)
}

/**
 * Visible account members in the selected order.
 *
 * Manual order is the Host's durable `workspace.sessionIds`, taken as-is: the
 * plugin never keeps a private order table, so a stale browser-local order can
 * never shadow the Host's own.
 *
 * @param {object} input - `{ memberIds, orderBy, pinnedSessionIds, archivedSessionIds }`.
 * @returns {string[]} pinned members first, then the remaining members in order.
 */
export function orderMembers(input) {
  const members = (input.memberIds || []).filter(id => typeof id === 'string')
  const ordered = input.orderBy === 'updated'
    ? orderByRecency(members, input.byId)
    : [...members]
  const archived = new Set(input.archivedSessionIds || [])
  const present = new Set(ordered)
  const pinned = (input.pinnedSessionIds || []).filter(id => present.has(id) && !archived.has(id))
  const pinnedSet = new Set(pinned)
  return [...pinned, ...ordered.filter(id => !pinnedSet.has(id))]
}

/**
 * Resolve a drag or keyboard move into the Host's `beforeSessionId` anchor.
 *
 * Returns `undefined` for a no-op (so callers skip the host call entirely) and
 * `null` for "append at the end", which is exactly the Host's contract for an
 * omitted anchor.
 *
 * @param {object} input - `{ order, movingId, targetId, half }`, where `half` is `before` or `after`.
 * @returns {string|null|undefined} anchor id, `null` to append, `undefined` when nothing changes.
 */
export function moveAnchor(input) {
  const order = input.order || []
  const from = order.indexOf(input.movingId)
  if (from === -1) return undefined
  // Every index below is an index into the order WITHOUT the moving row: that
  // is the array the anchor is read from, so drag halves and keyboard steps
  // cannot drift apart by the one slot the removal shifts.
  const without = order.filter(id => id !== input.movingId)
  let insertAt
  if (input.direction !== undefined) {
    insertAt = from + (input.direction === 'up' ? -1 : 1)
  } else {
    if (input.targetId === input.movingId) return undefined
    const targetIndex = without.indexOf(input.targetId)
    if (targetIndex === -1) return undefined
    insertAt = targetIndex + (input.half === 'after' ? 1 : 0)
  }
  // Re-inserting at the source index restores the current order exactly.
  if (insertAt === from) return undefined
  if (insertAt < 0 || insertAt > without.length) return undefined
  const anchor = without[insertAt]
  // An omitted anchor is the Host's own spelling for "append".
  return anchor === undefined ? null : anchor
}

/**
 * The desired order after moving one member to an anchor, as an explicit list.
 *
 * @param {object} input - `{ order, movingId, targetId, half, direction }`, the
 *   same shape {@link moveAnchor} takes.
 * @returns {string[]|undefined} the reordered ids, or `undefined` for a no-op.
 */
export function reorderTo(input) {
  const order = input.order || []
  const anchor = moveAnchor(input)
  if (anchor === undefined) return undefined
  const without = order.filter(id => id !== input.movingId)
  const at = anchor === null ? without.length : without.indexOf(anchor)
  return [...without.slice(0, at), input.movingId, ...without.slice(at)]
}

/**
 * The Host writes that realize a pinned-block order.
 *
 * The registry's pin set is prepend-on-pin and exposes no move operation, so the
 * only durable reordering is to unpin the changed prefix and pin it back in
 * reverse — each pin lands at the front, so the last one written leads. Only the
 * part that actually differs is written: the longest agreeing tail is left
 * alone, which makes a short move cheap and a long one proportional to it.
 *
 * @param {string[]} current - pinned ids in Host order.
 * @param {string[]} desired - pinned ids in the wanted order.
 * @returns {{toUnpin: string[], toPin: string[]}} writes in the order they must run.
 */
export function pinRepinPlan(current, desired) {
  let tail = 0
  while (tail < current.length && tail < desired.length
    && current[current.length - 1 - tail] === desired[desired.length - 1 - tail]) tail++
  const changed = desired.length - tail
  return {
    toUnpin: current.slice(0, changed),
    // Prepending walks this list, so the head of the wanted order is written last.
    toPin: desired.slice(0, changed).reverse(),
  }
}

/**
 * Session ids the plugin renders, in Host order, excluding subagent rows.
 * @param {any} list - `sessions.list` snapshot.
 * @returns {string[]} top-level session ids in host list order.
 */
export function visibleTopLevelIds(list) {
  const ids = list?.ids || []
  const byId = list?.byId || {}
  return ids.filter(id => {
    const row = byId[id]
    if (!row) return false
    return row.origin !== SUBAGENT_ORIGIN
  })
}

/**
 * Translate a layered status into the row's single dot.
 *
 * One row, one glyph. The dot speaks the Host's own five-state vocabulary
 * (`StateDot`), so the plugin renders the shipped component and inherits theme,
 * animation and reduced-motion behavior:
 *
 * - waiting on the user -> `warning`;
 * - anything running, whoever runs it (this agent, a subagent, a job) -> the
 *   `ongoing` spinner;
 * - finished and unread -> `done`;
 * - nothing to say -> `idle` (the row keeps an empty slot, not a grey dot).
 *
 * The *composition* — how many subagents, how many jobs, and whose — is a
 * sentence, not a second glyph: {@link statusOf}.activity feeds the dot's
 * tooltip. Four extra circles beside the title read as noise far faster than
 * the one hover helps.
 *
 * @param {object} status - output of {@link statusOf}.
 * @returns {{primary: string}} the `StateDot` state for the row's leading cell.
 */
export function dotPlan(status) {
  const primary = status.pending ? STATE_DOT.WARNING
    : status.dot === DOT.UNREAD ? STATE_DOT.DONE
        : status.dot === DOT.IDLE ? STATE_DOT.IDLE
          : STATE_DOT.ONGOING
  return { primary }
}

/**
 * Whether one session is a visible list member under the archived filter.
 * Mirrors the Host browser: subagent rows are never listed, only the current
 * blank is listed, and the filter is three-way.
 *
 * @param {string} id - session id.
 * @param {object} input - `{ byId, currentId, archivedSessionIds, archivedFilter }`.
 * @returns {boolean} true when the row belongs in the list.
 */
export function isVisibleMember(id, input) {
  const row = input.byId?.[id]
  if (!row) return false
  if (row.origin === SUBAGENT_ORIGIN) return false
  if (row.blank === true && id !== input.currentId) return false
  const archived = (input.archivedSessionIds || []).includes(id)
  if (input.archivedFilter === ARCHIVED_FILTER.ONLY) return archived
  if (input.archivedFilter === ARCHIVED_FILTER.SHOW) return true
  return !archived
}

/**
 * Build the rendered tree: the global pinned block plus one block per workspace.
 *
 * Membership comes from `workspaces.items[*].sessionIds` (never from `cwd`, which
 * a moved session keeps), order from the Host's durable manual order or from
 * recency, and non-archived pinned sessions are lifted out of their workspace
 * block exactly as the previous revision did.
 *
 * @param {object} input - `{ list, workspaces, orderBy, archivedFilter, currentId, expandedKeys }`.
 * @returns {{pinned: string[], groups: Array<object>, total: number}}
 */
export function computeGroups(input) {
  const list = input.list
  const byId = list?.byId || {}
  const workspaces = input.workspaces || []
  const pinnedSessionIds = input.pinnedSessionIds || []
  const archivedSessionIds = input.archivedSessionIds || []
  const view = {
    byId,
    currentId: input.currentId,
    archivedSessionIds,
    archivedFilter: input.archivedFilter || ARCHIVED_FILTER.DEFAULT,
  }
  const archivedSet = new Set(archivedSessionIds)
  const pinnedSet = new Set(pinnedSessionIds)
  const accounted = new Set()
  for (const workspace of workspaces) for (const id of workspace.sessionIds || []) accounted.add(id)

  const pinned = pinnedSessionIds.filter(id => isVisibleMember(id, view) && !archivedSet.has(id))

  const groups = []
  const build = (key, workspaceId, label, cwd, memberIds) => {
    const visible = memberIds.filter(id => isVisibleMember(id, view))
    const ordered = orderMembers({
      memberIds: visible,
      orderBy: input.orderBy,
      pinnedSessionIds,
      archivedSessionIds,
      byId,
    })
    // Pinned rows live in the pinned block, so drop them here unless archived
    // (an archived pin keeps its slot, matching the archived filter's intent).
    const sessions = ordered.filter(id => !(pinnedSet.has(id) && !archivedSet.has(id)))
    if (sessions.length === 0) return
    groups.push({
      key,
      workspaceId,
      label,
      cwd,
      expanded: (input.expandedKeys || []).includes(key),
      sessions,
    })
  }

  for (const workspace of workspaces) {
    const title = workspace.title || workspace.path || String(workspace.workspaceId)
    build(
      String(workspace.workspaceId),
      workspace.workspaceId,
      title,
      typeof workspace.path === 'string' ? workspace.path : undefined,
      workspace.sessionIds || [],
    )
  }

  const ungrouped = (list?.ids || []).filter(id => byId[id] && !accounted.has(id))
  build(UNGROUPED_KEY, undefined, ungroupedLabel(input.labels), undefined, ungrouped)

  return { pinned, groups, total: (list?.ids || []).length }
}

/**
 * Label of the bucket holding sessions outside every workspace.
 * @param {object|undefined} labels - `{ ungrouped }` from the caller's dictionary.
 * @returns {string} localized label.
 */
function ungroupedLabel(labels) {
  return labels?.ungrouped || '未分组'
}

/**
 * Structured relative-time bucket for the row's fixed time column.
 *
 * Buckets match the Host's shared `relativeTime` so every surface dating the
 * same session agrees; only the words differ, and those come from the plugin's
 * own dictionary.
 *
 * @param {number} timestamp - epoch ms from the host summary.
 * @param {number} now - current epoch ms.
 * @returns {{unit: string, n: number}} `unit` is one of
 *   `now` / `minutes` / `hours` / `days` / `months` / `years`; `n` is 0 for `now`.
 */
export function relativeTime(timestamp, now) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return { unit: 'none', n: 0 }
  const diff = Math.max(0, now - timestamp)
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/**
 * Render a {@link relativeTime} bucket with the plugin's own dictionary words.
 * @param {{unit: string, n: number}} bucket - structured relative time.
 * @param {object} strings - `{ now, minutes, hours, days, months, years }` suffixes.
 * @returns {string} the row's trailing label; empty when the bucket is unknown.
 */
export function formatRelative(bucket, strings) {
  if (!bucket || bucket.unit === 'none') return ''
  if (bucket.unit === 'now') return strings.now
  const suffix = strings[bucket.unit]
  return suffix === undefined ? '' : `${bucket.n}${suffix}`
}

/**
 * Split one workspace's members into the pinned block and the ordinary block.
 * @param {object} input - `{ order, pinnedSessionIds, archivedSessionIds }`.
 * @returns {{pinned: string[], ordinary: string[]}} members of each block, in order.
 */
export function splitPinned(input) {
  const pinnedSet = new Set(input.pinnedSessionIds || [])
  const archived = new Set(input.archivedSessionIds || [])
  const pinned = []
  const ordinary = []
  for (const id of input.order || []) {
    if (pinnedSet.has(id) && !archived.has(id)) pinned.push(id)
    else ordinary.push(id)
  }
  return { pinned, ordinary }
}

/* ------------------------------------------------------------------ *
 * Paging and search
 *
 * Both are the Host's own semantics, restated as pure functions because this
 * plugin renders the region itself. Paging bounds how many rows a block shows
 * before it offers to reveal the rest; search merges the Host's message-content
 * hits with the local title/workspace matches.
 * ------------------------------------------------------------------ */

/** Rows a block shows before any session raises its page. */
export const SESSION_PAGE_BASE = 5
/** Highest page a session with live attention raises on its own. */
export const SESSION_PAGE_AUTO_MAX = 50
/** `session.search` wire bound, in JavaScript UTF-16 code units. */
export const SEARCH_QUERY_MAX_UNITS = 500

/**
 * Keep a controlled search input inside the host's query contract: NUL is not
 * representable, and the cap must not split a surrogate pair.
 * @param {string} value - raw input value.
 * @param {number} [maxUnits] - maximum UTF-16 code units.
 * @returns {string} the sanitized query.
 */
export function sanitizeQuery(value, maxUnits = SEARCH_QUERY_MAX_UNITS) {
  const withoutNul = String(value ?? '').split('\u0000').join('')
  if (withoutNul.length <= maxUnits) return withoutNul
  let end = maxUnits
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--
  return withoutNul.slice(0, end)
}

/**
 * Page a block must open at so nothing that needs attention stays hidden.
 * @param {readonly string[]} ids - the block's members, in render order.
 * @param {Set<string>} attention - sessions at work, waiting or unread.
 * @param {string|undefined} currentId - the session the app is showing.
 * @returns {number} the required page size (0 when nothing requires one).
 */
export function requiredPageLimit(ids, attention, currentId) {
  let index = 0
  let required = 0
  for (const id of ids) {
    index += 1
    if (index > SESSION_PAGE_AUTO_MAX) break
    if (attention.has(id) || id === currentId) required = index
  }
  return required
}

/**
 * Split a block into the rows it shows and the count it hides.
 * @param {readonly string[]} ids - members in render order.
 * @param {number} limit - the operator's page size.
 * @param {number} [required] - page size attention demands (see {@link requiredPageLimit}).
 * @returns {{visible: string[], hiddenCount: number}} the rendered rows and the remainder.
 */
export function pageRows(ids, limit, required = 0) {
  const effective = Math.max(Number.isFinite(limit) ? limit : ids.length, required)
  if (effective >= ids.length) return { visible: [...ids], hiddenCount: 0 }
  return { visible: ids.slice(0, effective), hiddenCount: ids.length - effective }
}

/**
 * The page size a "show more" click moves to.
 * @param {number} limit - current page size.
 * @param {number} hiddenCount - rows still hidden.
 * @returns {number} the next page size; a large sentinel means "reveal all",
 *   which stays JSON-safe (the host's own spelling is `Infinity`).
 */
export function nextPageLimit(limit, hiddenCount) {
  if (hiddenCount <= SESSION_PAGE_BASE) return Number.MAX_SAFE_INTEGER
  return (Number.isFinite(limit) ? limit : SESSION_PAGE_BASE) + SESSION_PAGE_BASE
}

/**
 * Display label of a directory: its final path segment.
 * @param {string|undefined} cwd - a session's recorded directory.
 * @returns {string} the basename, or an empty string when there is none.
 */
export function workspaceLabelOf(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return ''
  const parts = cwd.split(/[\\/]+/).filter(part => part !== '')
  return parts.length === 0 ? cwd : parts[parts.length - 1]
}

/**
 * Merge the host's content hits with local title/workspace matches into rows.
 *
 * Local matches come first (most recently active first, the same ordering the
 * list uses), then content hits the local pass did not already include. Blank
 * placeholders never match, because their canonical title is localized.
 *
 * @param {object} input - `{ list, workspaces, query, items, hasMore, limit, archivedSessionIds, archivedFilter, currentId, labels }`.
 * @returns {{nodes: Array<object>, hasMore: boolean, total: number, truncated: boolean}}
 */
export function buildSearchNodes(input) {
  const query = String(input.query ?? '').trim().toLowerCase()
  if (query === '') return { nodes: [], hasMore: false, total: 0, truncated: false }
  const list = input.list
  const byId = list?.byId || {}
  const archived = new Set(input.archivedSessionIds || [])
  const filter = input.archivedFilter || ARCHIVED_FILTER.DEFAULT

  const accountLabel = new Map()
  for (const workspace of input.workspaces || []) {
    const label = workspace.title || workspaceLabelOf(workspace.path)
    for (const id of workspace.sessionIds || []) if (!accountLabel.has(id)) accountLabel.set(id, label)
  }
  const visible = (id) => {
    const row = byId[id]
    if (!row || row.blank === true) return false
    if (row.origin === SUBAGENT_ORIGIN) return false
    const isArchived = archived.has(id)
    if (filter === ARCHIVED_FILTER.ONLY) return isArchived
    if (filter === ARCHIVED_FILTER.SHOW) return true
    return !isArchived
  }
  const titleOf = row => String(row.displayTitle || row.title || row.id)
  const labelOf = row => accountLabel.get(row.id) ?? workspaceLabelOf(row.cwd)

  const local = []
  for (const id of list?.ids || []) {
    if (!visible(id)) continue
    const row = byId[id]
    if (titleOf(row).toLowerCase().includes(query) || labelOf(row).toLowerCase().includes(query)) local.push(id)
  }

  const snippetById = new Map()
  const contentOrder = []
  for (const item of input.items || []) {
    if (!item || typeof item.sessionId !== 'string') continue
    if (snippetById.has(item.sessionId) || !visible(item.sessionId)) continue
    snippetById.set(item.sessionId, item.snippet)
    contentOrder.push(item.sessionId)
  }

  const ids = []
  for (const id of [...orderByRecency(local, byId), ...contentOrder]) if (!ids.includes(id)) ids.push(id)

  const limit = Number.isFinite(input.limit) ? input.limit : ids.length
  const shown = ids.slice(0, Math.max(0, limit))
  return {
    nodes: shown.map(id => ({
      id,
      title: titleOf(byId[id]),
      workspace: labelOf(byId[id]),
      snippet: snippetById.get(id),
    })),
    hasMore: input.hasMore === true || ids.length > shown.length,
    total: ids.length,
    truncated: ids.length > shown.length,
  }
}
