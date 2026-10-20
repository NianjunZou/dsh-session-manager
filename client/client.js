/*!
 * @pianner/dsh-session-manager — generated client bundle. DO NOT EDIT.
 * Source of truth: src/client/core.js (pure derivation) + src/client/body.js (view).
 * Rebuild with: npm run build
 * License: MIT.
 */
window.__ModuleLoader__.load({
  id: "@pianner/dsh-session-manager",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ---- inlined from src/client/core.js ----
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
    const DOT = Object.freeze({
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
    const STATE_DOT = Object.freeze({
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
    const SUBAGENT_ORIGIN = 'subagent'

    /** Archived-row visibility, mirroring the Host browser's three-way filter. */
    const ARCHIVED_FILTER = Object.freeze({ DEFAULT: 'default', SHOW: 'show', ONLY: 'only' })

    /** Flat-list account key for sessions outside every workspace. */
    const UNGROUPED_KEY = ''

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
    function snapshotOf(store) {
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
    function pendingKind(value) {
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
    function buildChildren(list) {
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
    function descendantsOf(children, id) {
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
    function buildRollup(list, jobsSnapshot) {
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
    function watchTargets(ids, children) {
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
    function statusOf(id, context) {
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
    function orderByRecency(ids, byId) {
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
    function orderMembers(input) {
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
    function moveAnchor(input) {
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
    function reorderTo(input) {
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
    function pinRepinPlan(current, desired) {
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
    function visibleTopLevelIds(list) {
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
    function dotPlan(status) {
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
    function isVisibleMember(id, input) {
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
    function computeGroups(input) {
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
    function relativeTime(timestamp, now) {
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
    function formatRelative(bucket, strings) {
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
    function splitPinned(input) {
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
    const SESSION_PAGE_BASE = 5
    /** Highest page a session with live attention raises on its own. */
    const SESSION_PAGE_AUTO_MAX = 50
    /** `session.search` wire bound, in JavaScript UTF-16 code units. */
    const SEARCH_QUERY_MAX_UNITS = 500

    /**
     * Keep a controlled search input inside the host's query contract: NUL is not
     * representable, and the cap must not split a surrogate pair.
     * @param {string} value - raw input value.
     * @param {number} [maxUnits] - maximum UTF-16 code units.
     * @returns {string} the sanitized query.
     */
    function sanitizeQuery(value, maxUnits = SEARCH_QUERY_MAX_UNITS) {
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
    function requiredPageLimit(ids, attention, currentId) {
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
    function pageRows(ids, limit, required = 0) {
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
    function nextPageLimit(limit, hiddenCount) {
      if (hiddenCount <= SESSION_PAGE_BASE) return Number.MAX_SAFE_INTEGER
      return (Number.isFinite(limit) ? limit : SESSION_PAGE_BASE) + SESSION_PAGE_BASE
    }

    /**
     * Display label of a directory: its final path segment.
     * @param {string|undefined} cwd - a session's recorded directory.
     * @returns {string} the basename, or an empty string when there is none.
     */
    function workspaceLabelOf(cwd) {
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
    function buildSearchNodes(input) {
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

    // ---- end src/client/core.js ----

    /*!
     * @pianner/dsh-session-manager — client body.
     *
     * This file is the authored half of the client bundle. It is not loaded by the
     * browser directly: `scripts/build-client.mjs` inlines `src/client/core.js`
     * (the pure derivation layer) above it and wraps the whole thing in the
     * `window.__ModuleLoader__.load({ id, factory })` shell that produces
     * `client/client.js`.
     *
     * Rules this file follows on purpose (DSH client-component contract):
     * - the slot registrant is a module-scope, stable function component;
     * - live values arrive through the registration's `inject` face, never through
     *   a Cordis context handed to a component;
     * - the component subscribes through the renderer-bound `use*` hooks only;
     * - user-visible copy comes from the plugin's locale namespace;
     * - every action is a Host service call, so nothing here is a second source of
     *   truth for session, workspace, pin, archive or order state.
     * License: MIT.
     */

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const {
      StateDot, Menu, Modal,
      // The shipped icon set: text glyphs read as a different weight and baseline
      // than every other affordance in the shell, which is what makes a region
      // look foreign.
      IconSearchOutlineRegular, IconSlidersTwoOutlineRegular, IconProjectAddOutlineRegular,
      IconFolderCloseRegular, IconFolderOpenRegular, IconChevronDownOutlineRegular,
      IconChevronRightOutlineRegular, IconPlusOutlineRegular, IconPinFillRegular, IconCloseFillRegular,
      IconEllipsisOutlineRegular, IconChevronsUpDownOutlineRegular, IconClockOutlineRegular,
      IconArchiveOffOutlineRegular, IconArchiveCheckOutlineRegular, IconQueueOutlineRegular,
    } = primitives
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState, useSyncExternalStore } = React

    /** Locale namespace registered by this plugin. */
    const NS = 'dsh-session-manager'

    /**
     * Shadowing rank of this registration.
     *
     * The shipped browser registers at the default 0 and the slot renders the
     * lowest live rank; this entry deliberately shadows it. `-1` is already taken
     * by another published occupant of the same cell, and two registrations at the
     * same rank on a single cell throw, so this plugin sits one step lower.
     */
    const SLOT_PRIORITY = -2

    /** Pause between the latest keystroke and a host content-search request. */
    const SEARCH_DEBOUNCE_MS = 250
    /**
     * The pinned block's reorder scope. The block spans workspaces, so it is not an
     * account; its order comes from the registry's pin set, which is written by
     * pin/unpin rather than by a move.
     */
    const PINNED_KEY = '__pinned__'
    /**
     * Priority levels, encoded as rank rather than hue.
     *
     * The theme's only hues are the four state colours (red/amber/green/business
     * blue) plus neutrals, so a colour-coded priority would always be read as a
     * session state — and the drag insertion line already owns the business blue.
     * Rank is therefore carried by a digit pill in the one non-state accent, which
     * is also the only form that stays readable without colour.
     */
    const PRIORITY = Object.freeze(['p1', 'p2', 'p3', 'p4'])
    /** The pill's ink: a raw palette step, because no alias exists for labels. */
    /** Labels stored by the first cut, before rank replaced hue. */
    const PRIORITY_LEGACY = Object.freeze({ red: 'p1', amber: 'p2', green: 'p3', blue: 'p4' })

    /**
     * Normalize a stored priority label.
     * @param {string|undefined} value - stored value.
     * @returns {string|undefined} a level id, or `undefined` for "no label".
     */
    function priorityLevel(value) {
      if (value === undefined || value === null) return undefined
      const id = PRIORITY_LEGACY[value] ?? value
      return PRIORITY.includes(id) ? id : undefined
    }

    /**
     * A tiny observable with the store contract (`getSnapshot`/`subscribe`/`set`).
     * @param {object} initial - starting snapshot.
     * @returns {object} the observable.
     */
    function observable(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(next) {
          snapshot = next
          for (const listener of listeners) listener()
        },
      }
    }

    /**
     * The priority labels, persisted through the store seat when it is composed.
     *
     * `dsh-client-store` owns the persistence contract (a JSON value under its own
     * storage key), so the plugin neither invents one nor touches browser storage
     * itself. A host without that
     * package still gets working labels for the session, they just do not survive a
     * restart — the region reads the same observable either way.
     *
     * @param {Function} require - the module loader's resolve function.
     * @returns {object} an observable of `{ [sessionId]: priorityId }`.
     */
    function priorityStore(require) {
      try {
        const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
        return createSnapshotStore({}, { persist: { name: 'dsh-session-manager.priority' } })
      } catch {
        return observable({})
      }
    }
    /** Pointer travel before a press becomes a drag rather than a click. */
    const DRAG_THRESHOLD_PX = 4
    /**
     * The active pointer gesture, shared by every row and workspace header because
     * exactly one gesture can be live at a time and it crosses elements.
     *
     * The shipped rows and project rows use native HTML5 drag-and-drop. Two things
     * make that unusable here. A native drag source is inherited by descendants:
     * `draggable` on the workspace container made *session* rows start a native drag,
     * and `-webkit-user-drag: element` overrode `draggable="false"`, so Chromium
     * fired `dragstart` and then `pointercancel` — killing whatever gesture was in
     * progress. And a native drag is invisible to the test lanes. A pointer gesture
     * is plain DOM input: it behaves identically in the harness and in the app, one
     * gesture owns the interaction, and a gesture that ends in a gap still commits
     * from the last marked target.
     */
    const pointerGesture = {
      kind: null, id: null, accountId: null, order: null,
      startX: 0, startY: 0, pointerId: null, active: false, moved: false,
      targetId: null, half: null,
    }

    /**
     * Pending marker publication, coalesced to one per animation frame.
     *
     * `pointermove` fires far faster than the display refreshes, and a published
     * marker re-renders the list, so handling each event individually repeats the
     * same work several times per frame for a result only the last one can show. A
     * page without animation frames (a hidden tab) publishes immediately.
     */
    let markFrame = null
    let markPending = null

    /**
     * Publish a marker on the next frame.
     * @param {Function} onMark - the row's marker callback.
     * @param {object|null} mark - `{id, half}`, or `null` to clear.
     * @returns {void}
     */
    function scheduleMark(onMark, mark) {
      markPending = { onMark, mark }
      if (markFrame !== null) return
      if (typeof requestAnimationFrame !== 'function') { flushMark(); return }
      markFrame = requestAnimationFrame(flushMark)
    }

    /** Publish whatever marker is pending, if any. */
    function flushMark() {
      markFrame = null
      const pending = markPending
      markPending = null
      if (pending !== null) pending.onMark(pending.mark)
    }

    /**
     * Keep the list scrolling while the pointer rests in an edge zone.
     *
     * Scrolling from `pointermove` writes `scrollTop` once per event, and every
     * write is a forced layout of the whole list; one frame loop instead scrolls at
     * the display's own rate and stops the moment the pointer leaves the zone.
     *
     * @param {object} event - the pointer event.
     * @returns {void}
     */
    function trackEdgeScroll(event) {
      const host = event.currentTarget?.closest?.('.dsm-body')
      if (!host) return
      const box = host.getBoundingClientRect()
      const EDGE = 24
      pointerGesture.scrollHost = host
      pointerGesture.edge = event.clientY < box.top + EDGE ? -1
        : event.clientY > box.bottom - EDGE ? 1 : 0
      if (pointerGesture.edge === 0 || scrollFrame !== null) return
      if (typeof requestAnimationFrame !== 'function') return
      scrollFrame = requestAnimationFrame(scrollStep)
    }

    /** One frame of edge scrolling. */
    function scrollStep() {
      scrollFrame = null
      const host = pointerGesture.scrollHost
      if (!host || pointerGesture.edge === 0 || pointerGesture.active !== true) return
      host.scrollTop += pointerGesture.edge * 8
      scrollFrame = requestAnimationFrame(scrollStep)
    }

    let scrollFrame = null

    /** Start a gesture on the element the pointer went down on. */
    function gestureDown(kind, id, event, extra) {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      pointerGesture.kind = kind
      pointerGesture.id = id
      pointerGesture.accountId = extra?.accountId ?? null
      pointerGesture.order = extra?.order ?? null
      pointerGesture.startX = event.clientX
      pointerGesture.startY = event.clientY
      pointerGesture.pointerId = event.pointerId
      pointerGesture.active = false
      pointerGesture.moved = false
      pointerGesture.targetId = null
      pointerGesture.half = null
      pointerGesture.published = false
      pointerGesture.edge = 0
      // Capture keeps the gesture alive while the pointer crosses other elements.
      event.currentTarget?.setPointerCapture?.(event.pointerId)
      // A press inside a workspace row must not also start the workspace gesture.
      event.stopPropagation?.()
    }

    /**
     * Advance a gesture: publish the marked target and return whether it is active.
     *
     * @param {string} kind - gesture family owning the pointer.
     * @param {object} event - the pointer event.
     * @param {string} attribute - data attribute naming a candidate element.
     * @param {Function} onMark - called with `{id, half}` (or `null`) on change.
     * @returns {boolean} whether this gesture is active.
     */
    function gestureMove(kind, event, attribute, onMark) {
      if (pointerGesture.kind !== kind || pointerGesture.pointerId !== event.pointerId) return false
      if (!pointerGesture.active) {
        const dx = Math.abs(event.clientX - pointerGesture.startX)
        const dy = Math.abs(event.clientY - pointerGesture.startY)
        if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return false
        pointerGesture.active = true
      }
      // Dragging to the list's edge scrolls it, so a long sidebar stays reachable.
      trackEdgeScroll(event)
      const hit = elementUnder(event, attribute)
      const targetId = hit?.getAttribute?.(attribute)
      if (targetId === undefined || targetId === null || targetId === pointerGesture.id) {
        if (pointerGesture.targetId === null) return true
        pointerGesture.targetId = null
        pointerGesture.half = null
        scheduleMark(onMark, null)
        return true
      }
      const rect = hit.getBoundingClientRect()
      const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      if (pointerGesture.targetId !== targetId || pointerGesture.half !== half) {
        pointerGesture.targetId = targetId
        pointerGesture.half = half
        scheduleMark(onMark, { id: targetId, half })
      }
      return true
    }

    /**
     * Finish a gesture. `commit` runs only when the press actually travelled, and
     * the click that follows is swallowed so a reorder never also opens a session.
     *
     * @param {string} kind - gesture family owning the pointer.
     * @param {Function} commit - called with the recorded target, if any.
     * @returns {void}
     */
    function gestureUp(kind, commit) {
      if (pointerGesture.kind !== kind) return
      const wasActive = pointerGesture.active
      // The commit is read from the gesture itself, never from React state: the
      // state exists to paint the marker, so a flick that starts and ends inside one
      // frame would otherwise commit nothing.
      const move = !wasActive || pointerGesture.targetId === null ? null : {
        accountId: pointerGesture.accountId,
        order: pointerGesture.order,
        id: pointerGesture.id,
        target: { id: pointerGesture.targetId, half: pointerGesture.half },
      }
      pointerGesture.kind = null
      pointerGesture.active = false
      pointerGesture.moved = wasActive
      pointerGesture.edge = 0
      if (!wasActive) return
      flushMark()
      commit(move)
    }

    /**
     * The element carrying `attribute` under a pointer position.
     *
     * @param {object} event - the pointer event.
     * @param {string} attribute - the data attribute to look for.
     * @returns {object|null} the element, or `null`.
     */
    function elementUnder(event, attribute) {
      if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
        const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(`[${attribute}]`)
        if (hit) return hit
      }
      const target = event.target
      if (target?.getAttribute?.(attribute) !== undefined && target?.getAttribute?.(attribute) !== null) return target
      return target?.closest?.(`[${attribute}]`) ?? null
    }



    /** Attribute marker every owned style element carries, so cleanup can find it. */
    const STYLE_MARKER = 'data-dsh-session-manager'

    /** Copy used by the region. Params are `{n}` placeholders. */
    const zh = {
      'section.workspaces': '工作区',
      'section.pinned': '置顶会话',
      'section.ungrouped': '未分组',
      'section.unmarked': '未标记',
      'section.projects': '项目会话',
      'action.newSession': '新建会话',
      'action.addWorkspace': '添加工作区',
      'sessions.expand': '展开其余 {n} 个会话',
      'sessions.collapse': '收起',
      'search.aria': '会话搜索',
      'search.placeholder': '搜索会话',
      'search.clear': '清除搜索',
      'search.none': '没有匹配的会话',
      'search.more': '结果较多，请细化查询',
      'search.failed': '搜索失败：',
      'status.approval': '等待批准',
      'status.planReview': '等待计划确认',
      'status.question': '等待回答',
      'status.running': '正在执行',
      'status.subagents': '{n} 个子会话执行中',
      'status.subagentJobs': '{n} 个子会话的后台任务执行中',
      'status.jobs': '{n} 个本会话的后台任务执行中',
      'status.unread': '已完成，未读',
      'status.idle': '空闲',
      'mark.pinned': '已置顶',
      'time.now': '刚刚',
      'time.minutes': ' 分钟',
      'time.hours': ' 小时',
      'time.days': ' 天',
      'time.months': ' 月',
      'time.years': ' 年',
      'menu.pin': '置顶会话',
      'menu.unpin': '取消置顶',
      'menu.rename': '重命名',
      'menu.fork': '分叉会话',
      'menu.archive': '归档会话',
      'menu.unarchive': '取消归档',
      'menu.moveUp': '上移',
      'menu.moveDown': '下移',
      'menu.copyId': '复制 Session ID',
      'menu.copyCwd': '复制工作目录',
      'menu.label': '会话操作',
      'view.order': '顺序',
      'view.orderManual': '手动顺序',
      'view.orderUpdated': '最近活跃',
      'view.archived': '归档',
      'view.archivedDefault': '隐藏归档',
      'view.archivedShow': '显示归档',
      'view.archivedOnly': '只看归档',
      'view.options': '视图选项',
      'dialog.renameTitle': '重命名会话',
      'dialog.nameLabel': '会话名称',
      'dialog.save': '保存',
      'dialog.cancel': '取消',
      'dialog.close': '关闭',
      'notice.sessionActive': '会话仍在运行，请先停止活动再归档。',
      'notice.failed': '会话操作失败：',
      'notice.pinArchived': '归档会话不能置顶，已跳过：',
      'menu.priority': '优先级标记',
      'priority.none': '清除标记',
      'priority.p1': 'P1 · 最高',
      'priority.p2': 'P2 · 较高',
      'priority.p3': 'P3 · 普通',
      'priority.p4': 'P4 · 参考',
      'notice.copyFailed': '无法写入剪贴板',
      'empty.none': '暂无会话',
      'view.priority': '优先级视图',
      'view.priorityExit': '退出优先级视图',
      'bulk.selected': '已选 {n} 个',
      'bulk.marked': '选中已标记',
      'bulk.none': '清空选择',
      'bulk.done': '完成',
      'bulk.hint': '勾选会话后按 P1–P4 批量设置',
      'bulk.select': '选择会话',
      'priority.empty': '还没有标记优先级的会话',
    }

    const en = {
      'section.workspaces': 'Workspaces',
      'section.pinned': 'Pinned',
      'section.unmarked': 'Unlabelled',
      'section.ungrouped': 'Ungrouped',
      'section.projects': 'Project sessions',
      'action.newSession': 'New session',
      'action.addWorkspace': 'Add workspace',
      'sessions.expand': 'Show {n} more sessions',
      'sessions.collapse': 'Collapse',
      'search.aria': 'Session search',
      'search.placeholder': 'Search sessions',
      'search.clear': 'Clear search',
      'search.none': 'No matching sessions',
      'search.more': 'More results — refine your query',
      'search.failed': 'Search failed: ',
      'status.approval': 'Waiting for approval',
      'status.planReview': 'Waiting for plan review',
      'status.question': 'Waiting for an answer',
      'status.running': 'Running',
      'status.subagents': '{n} subagent(s) running',
      'status.subagentJobs': '{n} background job(s) from subagents',
      'status.jobs': '{n} background job(s) of this session',
      'status.unread': 'Finished, unread',
      'status.idle': 'Idle',
      'mark.pinned': 'Pinned',
      'time.now': 'now',
      'time.minutes': 'm',
      'time.hours': 'h',
      'time.days': 'd',
      'time.months': 'mo',
      'time.years': 'y',
      'menu.pin': 'Pin session',
      'menu.unpin': 'Unpin session',
      'menu.rename': 'Rename',
      'menu.fork': 'Fork session',
      'menu.archive': 'Archive session',
      'menu.unarchive': 'Unarchive session',
      'menu.moveUp': 'Move up',
      'menu.moveDown': 'Move down',
      'menu.copyId': 'Copy session ID',
      'menu.copyCwd': 'Copy working directory',
      'menu.label': 'Session actions',
      'view.order': 'Order',
      'view.orderManual': 'Manual order',
      'view.orderUpdated': 'Recent activity',
      'view.archived': 'Archived',
      'view.archivedDefault': 'Hide archived',
      'view.archivedShow': 'Show archived',
      'view.archivedOnly': 'Archived only',
      'view.options': 'View options',
      'dialog.renameTitle': 'Rename session',
      'dialog.nameLabel': 'Session name',
      'dialog.save': 'Save',
      'dialog.cancel': 'Cancel',
      'dialog.close': 'Close',
      'notice.sessionActive': 'The session is still running; stop its activity before archiving.',
      'notice.failed': 'Session action failed: ',
      'notice.pinArchived': 'An archived session cannot be pinned; skipped: ',
      'menu.priority': 'Priority label',
      'priority.none': 'Clear label',
      'priority.p1': 'P1 · highest',
      'priority.p2': 'P2 · high',
      'priority.p3': 'P3 · normal',
      'priority.p4': 'P4 · reference',
      'notice.copyFailed': 'Could not write to the clipboard',
      'empty.none': 'No sessions',
      'view.priority': 'Priority view',
      'view.priorityExit': 'Leave priority view',
      'bulk.selected': '{n} selected',
      'bulk.marked': 'Select labelled',
      'bulk.none': 'Clear selection',
      'bulk.done': 'Done',
      'bulk.hint': 'Tick sessions, then pick P1–P4 to label them in bulk',
      'bulk.select': 'Select session',
      'priority.empty': 'No session carries a priority yet',
    }

    /**
     * Region styles. The plugin ships no CSS pipeline, so the sheet is one owned
     * `<style>` element removed by the same effect that added it. Every color comes
     * from a shipped `--dsw-alias-*` token, so themes (including third-party ones)
     * apply without the plugin knowing about them.
     */
    const css = `
    /* Typography and metrics follow the shipped browsing rows (ui-workspace
     * Rows.module.css / WorkspaceBrowser.module.css) so the region reads as part
     * of the shell rather than as a plugin: 32px rows, a 16x20 leading cell, a
     * 14px/20px title, a 10px/16px trailing time and the same radius tokens. */
    .dsm-region{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;-webkit-app-region:no-drag}
    .dsm-head{display:flex;align-items:center;gap:2px;flex:none;padding:0 8px;height:36px}
    .dsm-head-label{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary);padding-inline-start:4px}
    .dsm-head-spacer{flex:1}
    .dsm-head-action{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:26px;height:26px;flex:0 0 26px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
    .dsm-head-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .dsm-head-action:focus-visible{outline:2px solid var(--dsw-alias-focus-ring);outline-offset:-2px}
    .dsm-search{display:flex;align-items:center;flex:1;min-width:0}
    .dsm-search-input{box-sizing:border-box;width:100%;min-width:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;outline:none}
    .dsm-body{flex:1;min-height:0;overflow-y:auto;padding:0 8px 8px}
    .dsm-list{display:flex;flex-direction:column;gap:2px}
    .dsm-group{margin-bottom:4px;position:relative}
    .dsm-group[data-drop="before"]::before,.dsm-group[data-drop="after"]::after{content:"";position:absolute;z-index:6;left:2px;right:2px;height:2px;border-radius:1px;background:var(--dsw-alias-state-business-primary)}
    .dsm-group[data-drop="before"]::before{top:-1px}
    .dsm-group[data-drop="after"]::after{bottom:-1px}
    .dsm-group[data-dragging="true"]{opacity:.45}
    /* A section header止 stays while its own block scrolls past: the sidebar fill is
     * opaque so rows travel underneath it instead of through it. */
    /* Fixed sections are headings, not rows: a 28px band on the raised surface, in
     * caption type, so they never read as another workspace directory. */
    .dsm-heading-row,.dsm-project-header{position:sticky;top:0;z-index:1;display:flex;align-items:center;box-sizing:border-box;height:32px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}
    .dsm-heading-header{display:flex;align-items:center;flex:1;min-width:0;height:32px;padding:0 8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer}
    .dsm-heading-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-heading-header:focus-visible{outline:2px solid var(--dsw-alias-focus-ring);outline-offset:-2px}
    .dsm-heading-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-secondary)}
    .dsm-heading-count{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
    .dsm-workspace-action{margin-right:4px}
    .dsm-section-row{position:sticky;top:0;z-index:2;display:flex;align-items:center;height:32px;background:var(--dsw-specific-sidebar-fill)}
    /* macOS: the sidebar is window vibrancy and the host makes its own fill
     * transparent there, so a themed opaque fill reads as a foreign slab (its
     * comment says as much). Mirror the host's own treatment — a faint wash of the
     * label ink sitting in the glass — and blur the rows that travel underneath. */
    [data-platform='darwin'] .dsm-heading-row,[data-platform='darwin'] .dsm-project-header,[data-platform='darwin'] .dsm-section-row{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
    .dsm-section-row:hover .dsm-workspace-action,.dsm-section-row:focus-within .dsm-workspace-action{opacity:1}
    .dsm-workspace-action{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:24px;height:20px;flex:0 0 24px;margin-right:4px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);opacity:0;cursor:pointer}
    .dsm-workspace-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .dsm-section-header{display:flex;align-items:center;flex:1;min-width:0;height:32px;touch-action:none;padding:0 8px;padding-inline-start:20px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
    .dsm-section-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-section-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;margin:0 6px 0 4px}
    .dsm-section-count{flex:none;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
    .dsm-chevron{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;color:var(--dsw-alias-label-tertiary)}
    /* The 16x20 leading cell the shipped rows use for a status dot or a folder. */
    .dsm-slot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;color:var(--dsw-alias-label-tertiary)}
    /* Priority ink is one accent hue in four weights — solid for the top rank, fading
     * tints below, grey for the lowest. Status keeps red/amber/green/neutral to
     * itself, so a chip can never be read as a state. */
    .dsm-priority{flex:none;margin-left:4px;padding:0 4px;border-radius:var(--dsw-radius-xs);font-size:10px;line-height:14px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,currentColor 22%,transparent)}
    .dsm-priority[data-level="p1"]{color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-state-business-primary)}
    .dsm-priority[data-level="p2"]{background:color-mix(in srgb,currentColor 45%,transparent)}
    .dsm-priority[data-level="p3"]{background:color-mix(in srgb,currentColor 22%,transparent)}
    .dsm-priority[data-level="p4"]{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,currentColor 10%,transparent)}
    /* The priority view is an editing mode: a bulk bar above the list, a checkbox in
     * each row, and the same rows grouped by level. */
    .dsm-head-action[data-active="true"]{color:var(--dsw-alias-state-business-primary)}
    .dsm-bulk{position:sticky;top:0;z-index:4;display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
    .dsm-bulk-count{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
    .dsm-bulk-actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-left:auto}
    .dsm-bulk-action{box-sizing:border-box;height:22px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:20px;cursor:pointer}
    .dsm-bulk-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-bulk-action:disabled{color:var(--dsw-alias-label-tertiary);cursor:default;opacity:.6}
    .dsm-bulk-action[data-level="p1"]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
    .dsm-bulk-action[data-level="p4"]{color:var(--dsw-alias-label-secondary)}
    .dsm-bulk-hint{flex:1 0 100%;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary)}
    .dsm-select{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;margin-right:2px;cursor:pointer}
    .dsm-select-box{width:13px;height:13px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
    /* The priority view's entry point is a letter badge rather than one of the
     * shipped glyphs: a bold P in a hairline frame reads as "priority levels" and
     * turns accent-coloured while the view is open. */
    .dsm-pbadge{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:16px;height:16px;border:1px solid currentColor;border-radius:var(--dsw-radius-xs);font-size:10px;line-height:1;font-weight:700;letter-spacing:0}
    .dsm-head-action[data-active="true"] .dsm-pbadge{color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
    .dsm-row:has(.dsm-select-box:checked){background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-levels{display:flex;flex-direction:column}
    .dsm-pin{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;margin-left:6px;color:var(--dsw-alias-label-caption)}
    .dsm-row[data-flat="true"]{padding-inline-start:14px}
    .dsm-row{position:relative;display:flex;align-items:center;box-sizing:border-box;width:100%;height:32px;gap:0;padding:0 8px;padding-inline-start:32px;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;-webkit-user-drag:none;touch-action:none}
    .dsm-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-row[data-current="true"]{background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-row[data-archived="true"]{opacity:.6}
    .dsm-row[data-dragging="true"]{opacity:.45}
    .dsm-row[data-drop="before"]{box-shadow:inset 0 2px 0 0 var(--dsw-alias-state-business-primary)}
    .dsm-row[data-drop="after"]{box-shadow:inset 0 -2px 0 0 var(--dsw-alias-state-business-primary)}
    .dsm-dot-slot{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:20px}
    /* The painted dot is 10px inside a 16x20 cell; the overlay grows the hover /
       click target to the full row height without moving a single pixel of layout. */
    .dsm-dot-slot{position:relative}
    .dsm-dot-slot::after{content:'';position:absolute;inset:-6px -2px}
    .dsm-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font-size:14px;line-height:20px;margin:0 6px 0 4px}
    .dsm-row[data-unread="true"] .dsm-title{font-weight:600}
    .dsm-workspace{flex:none;max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
    .dsm-snippet{flex:0 1 auto;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
    .dsm-time{flex:0 0 4.5em;width:4.5em;margin-left:6px;text-align:right;white-space:nowrap;font-size:10px;line-height:16px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}
    .dsm-action{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:24px;height:20px;flex:0 0 24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);opacity:0;cursor:pointer;font:inherit;font-size:13px}
    /* Hover hands the trailing cell to the actions, exactly like the shipped rows:
     * the time and the pin marker step aside instead of competing with them. The
     * exception is a slot carrying a state label (waiting for approval / plan review
     * / an answer): that text is the only place a waiting row spells the state out,
     * so it stays put while the pointer is in the row. */
    .dsm-row:hover .dsm-time:not([data-status-label="true"]),.dsm-row:focus-within .dsm-time:not([data-status-label="true"]),
    .dsm-row:hover .dsm-pin,.dsm-row:focus-within .dsm-pin{display:none}
    .dsm-row:hover .dsm-action,.dsm-row:focus-within .dsm-action{opacity:1}
    .dsm-row:focus-visible,.dsm-action:focus-visible,.dsm-section-header:focus-visible{outline:2px solid var(--dsw-alias-focus-ring);outline-offset:-2px}
    .dsm-overflow{display:block;width:100%;height:28px;padding:0 12px;padding-inline-start:52px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}
    .dsm-overflow:hover{background:transparent;color:var(--dsw-alias-label-secondary)}
    .dsm-search-meta{padding:10px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
    .dsm-empty{display:flex;flex-direction:column;gap:8px;padding:16px 12px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
    .dsm-empty-action{align-self:center;padding:0;border:0;background:none;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-link);cursor:pointer}
    .dsm-notice{margin:8px;padding:8px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md);font-size:12px;line-height:18px}
    .dsm-rename-form{display:grid;gap:12px}
    .dsm-rename-input{box-sizing:border-box;width:100%;padding:6px 8px;font:inherit;font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg)}
    .dsm-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
    .dsm-dialog-actions button{font:inherit;font-size:13px;padding:4px 12px;cursor:pointer}
    .dsm-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    `

    /**
     * Tick the clock once a minute so relative labels stay current without
     * re-rendering the region on every host snapshot.
     * @returns {number} current epoch ms.
     */
    function useNow() {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 60_000)
        return () => window.clearInterval(id)
      }, [])
      return now
    }

    /**
     * One row's status presentation: a single dot, with the full composition as its
     * hover title and its screen-reader text.
     *
     * The row used to paint a dot per activity family; four circles beside a title
     * read as noise long before they answered anything. One dot answers "is this row
     * doing something, waiting on me, or finished unread"; the sentence says who and
     * how much.
     *
     * @param {object} props - `{ status, t }` where status is a `statusOf` record.
     * @returns {object} the row's leading cell.
     */
    function StatusCell({ status, t }) {
      const plan = dotPlan(status)
      const label = []
      if (status.pending === 'approval') label.push(t('status.approval'))
      if (status.pending === 'plan-review') label.push(t('status.planReview'))
      if (status.pending === 'question') label.push(t('status.question'))
      // The breakdown, in a fixed order: who is running, then which work they own.
      if (status.activity.self) label.push(t('status.running'))
      if (status.activity.subagents.running > 0) label.push(t('status.subagents', { n: status.activity.subagents.running }))
      if (status.activity.jobs.own > 0) label.push(t('status.jobs', { n: status.activity.jobs.own }))
      if (status.activity.jobs.subtree > 0) label.push(t('status.subagentJobs', { n: status.activity.jobs.subtree }))
      if (label.length === 0) label.push(status.unread ? t('status.unread') : t('status.idle'))
      // One description for both audiences: the screen reader reads it from the
      // hidden text, and a sighted user gets it on hover.
      const description = label.join('，')
      // Every row carries exactly one shipped dot, resting rows included: the native
      // browser paints the neutral idle step in the same slot, and a column that
      // sometimes has a dot and sometimes does not reads as broken alignment.
      return h('span', {
        className: 'dsm-dot-slot',
        title: description,
        'data-dot': plan.primary,
      },
        h(StateDot, { state: plan.primary }),
        h('span', { className: 'dsm-visually-hidden' }, description),
      )
    }

    /**
     * The trailing label: the pending kind when one is waiting, otherwise the
     * session's relative time. Replacing the time (rather than adding a badge) keeps
     * the column width stable, which is what the shipped rows do too.
     * @param {object} props - `{ status, updatedAt, now, t }`.
     * @returns {object} the time cell.
     */
    function TimeCell({ status, updatedAt, now, t }) {
      let text = formatRelative(relativeTime(Number(updatedAt) || 0, now), {
        now: t('time.now'), minutes: t('time.minutes'), hours: t('time.hours'),
        days: t('time.days'), months: t('time.months'), years: t('time.years'),
      })
      if (status.pending === 'approval') text = t('status.approval')
      else if (status.pending === 'plan-review') text = t('status.planReview')
      else if (status.pending === 'question') text = t('status.question')
      // "Waiting for approval" is the one trailing label that is a state, not a
      // timestamp: hovering used to hide it exactly when the user moved in to read
      // the row, so the state was legible only from a distance.
      return h('span', {
        className: 'dsm-time',
        title: text,
        'data-status-label': status.pending === undefined ? undefined : 'true',
      }, text)
    }

    /**
     * One session row: leading status cell, marks, title, time, and the actions menu.
     *
     * The row is the drag source and the drop target for the durable reorder: the
     * drop resolves a `beforeSessionId` anchor through the pure `moveAnchor` and
     * hands it to the Host, which owns the resulting order.
     *
     * @param {object} props - row data, account order, handlers and copy.
     * @returns {object} the row.
     */
    function SessionRow({
      sessionId, summary, status, accountId, accountOrder, currentId, archived, pinned,
      now, t, drag, dropTarget, onDragStart, onDragOverRow, onDragEnd, onOpen, onSelectAction, onMove,
      workspaceLabel, snippet, canReorder = false, priority, flat = false,
      pinnedSection = false, selectable = false, selected = false, onToggleSelect, toggleLabel,
      groupedByPriority = false,
    }) {
      const [menuOpen, setMenuOpen] = useState(false)
      const menuItems = useMemo(() => {
        const items = [
          // The id states the action, not the state: a label swap alone left the
          // unpin/unarchive items dispatching their opposite ("取消置顶" re-pinned).
          { id: pinned ? 'unpin' : 'pin', label: pinned ? t('menu.unpin') : t('menu.pin') },
          { id: 'rename', label: t('menu.rename') },
          { id: 'fork', label: t('menu.fork') },
          { id: archived ? 'unarchive' : 'archive', label: archived ? t('menu.unarchive') : t('menu.archive') },
          { type: 'separator', id: 'sep-move' },
          { id: 'moveUp', label: t('menu.moveUp') },
          { id: 'moveDown', label: t('menu.moveDown') },
          { type: 'separator', id: 'sep-copy' },
          { id: 'copyId', label: t('menu.copyId') },
        ]
        if (summary?.cwd) items.push({ id: 'copyCwd', label: t('menu.copyCwd') })
        items.push({ type: 'separator', id: 'sep-priority' })
        items.push({ type: 'label', id: 'priority-label', text: t('menu.priority') })
        for (const level of PRIORITY) {
          items.push({ id: `priority:${level}`, label: t(`priority.${level}`) })
        }
        items.push({ id: 'priority:none', label: t('priority.none') })
        return items
      }, [archived, pinned, summary?.cwd, t])

      const title = String(summary?.displayTitle || summary?.title || sessionId)
      const drop = dropTarget?.sessionId === sessionId ? dropTarget.half : null
      const row = h('div', {
        className: 'dsm-row',
        'data-priority': priority,
        role: 'treeitem',
        tabIndex: 0,
        // Reordering is a pointer gesture, not a native drag: `draggable` stays off
        // so the browser cannot start its own drag and swallow the pointer stream.
        // Only a session the Host can move takes the gesture at all — a pinned row's
        // order lives in the registry-global pin set, which has no move API, and the
        // ungrouped bucket has no workspace account to write into.
        draggable: false,
        'data-current': String(sessionId === currentId),
        'data-archived': String(archived),
        'data-unread': String(status.unread),
        'data-dragging': String(drag?.sessionId === sessionId),
        'data-drop': drop || undefined,
        'data-dsm-session': sessionId,
        // A row directly under a heading is a top-level item, not a nested one: it
        // keeps the heading's own shallow column instead of the project indent.
        'data-flat': flat ? 'true' : undefined,
        'aria-selected': String(sessionId === currentId),
        onClick: (event) => {
          // A gesture that reordered rows must not also open one.
          if (pointerGesture.moved) { pointerGesture.moved = false; event?.preventDefault?.(); return }
          // A menu surface may render inside the row (the shipped `Menu` portals, but
          // a host without portals would bubble its clicks here): never open a
          // session because an item was chosen.
          if (event?.target?.closest?.('[role="menu"], [role="menuitem"], [data-stub="menu-list"]')) return
          // Selecting for a bulk edit is not opening.
          if (event?.target?.closest?.('.dsm-select')) return
          onOpen(sessionId)
        },
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); event.stopPropagation(); onOpen(sessionId); return
          }
          // Keyboard parity for the drag: same Host write, same ordering rules.
          if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault(); event.stopPropagation()
            onMove(accountId, accountOrder, sessionId, event.key === 'ArrowUp' ? 'up' : 'down')
          }
        },
        onPointerDown: canReorder ? (event) => {
          // A press on the row's own controls — the actions menu, a future inline
          // button — is not a reorder gesture: arming one there made the menu
          // unclickable, because a few pixels of travel turned the click into a
          // reorder and the click that followed was swallowed.
          if (event.target?.closest?.('button, a, input, [role="menuitem"], [role="menu"]')) return
          gestureDown('session', sessionId, event, { accountId, order: accountOrder })
        } : undefined,
        onPointerMove: canReorder ? (event) => {
          // A session never leaves its workspace account, so a row in another one is
          // not a target at all: no marker, and nothing to commit.
          if (pointerGesture.accountId !== accountId) return
          const active = gestureMove('session', event, 'data-dsm-session', (mark) => {
            onDragOverRow(mark === null ? null : { sessionId: mark.id, half: mark.half })
          })
          // One publication per gesture: the latch lives on the gesture, so a burst
          // of moves cannot each queue the same state write.
          if (active && pointerGesture.published !== true) {
            pointerGesture.published = true
            onDragStart({ sessionId, accountId })
          }
        } : undefined,
        onPointerUp: canReorder ? () => { gestureUp('session', onDragEnd) } : undefined,
        onPointerCancel: canReorder ? () => { gestureUp('session', onDragEnd) } : undefined,
      },
      // The priority view lists rows for bulk editing: the checkbox leads the row so
      // the selection column is fixed, and the title still opens the session.
      selectable ? h('label', {
        className: 'dsm-select',
        title: toggleLabel,
        onClick: event => event.stopPropagation(),
      },
      h('input', {
        type: 'checkbox',
        className: 'dsm-select-box',
        checked: selected,
        'aria-label': `${toggleLabel}: ${title}`,
        onChange: (event) => { event.stopPropagation(); onToggleSelect?.(sessionId) },
      })) : null,
      h(StatusCell, { status, t }),
      h('span', { className: 'dsm-title', title }, title),
      // Search rows carry where the session lives and why it matched; list rows do not.
      workspaceLabel === undefined ? null : h('span', { className: 'dsm-workspace' }, workspaceLabel),
      snippet === undefined || snippet === '' ? null : h('span', { className: 'dsm-snippet', title: snippet }, snippet),
      // No "unread" chip: the native row says it with the done dot and a heavier
      // title, and a second badge beside the title only competes with the priority
      // pill for the same strip of width.
      // The badge marks a pinned session among unpinned ones. Inside the pinned
      // block every row is pinned, so it would only eat the title's width.
      pinned && !archived && !pinnedSection
        ? h('span', { className: 'dsm-pin', role: 'img', 'aria-label': t('mark.pinned'), title: t('mark.pinned') },
          h(IconPinFillRegular, { size: 14 }))
        : null,
      // The label sits opposite the status dot as text, so the two can never be
      // confused: a coloured round dot is always status, a digit pill is priority.
      // In the priority view the level is the section heading, so repeating it on
      // every row would only cost the title its width.
      priority === undefined || groupedByPriority ? null : h('span', {
        className: 'dsm-priority',
        title: t(`priority.${priority}`),
        'data-level': priority,
      }, priority.toUpperCase()),
      h(TimeCell, { status, updatedAt: summary?.updatedAt, now, t }),
      h(Menu, {
        open: menuOpen,
        anchor: h('button', {
          type: 'button',
          className: 'dsm-action',
          title: t('menu.label'),
          'aria-label': t('menu.label'),
          'aria-haspopup': 'menu',
          onClick: (event) => { event.stopPropagation(); setMenuOpen(value => !value) },
        }, h(IconEllipsisOutlineRegular, { size: 14 })),
        items: menuItems,
        // The active rows carry the shipped check mark instead of a decorated label.
        // Only a real value is checked. Pin and archive are toggles whose label
        // already spells the state (「置顶会话」/「取消置顶」), so checking them said
        // "pinned/archived" about a row that was neither.
        selectedIds: priority === undefined ? [] : [`priority:${priority}`],
        onSelect: (id) => {
          setMenuOpen(false)
          onSelectAction(id, sessionId, accountId, accountOrder)
        },
        onClose: () => setMenuOpen(false),
        align: 'end',
        dense: true,
        portal: true,
      }),
      )
      return row
    }

    /**
     * One collapsible block: the global pinned block, a workspace, or the ungrouped bucket.
     *
     * The header is a real toggle button; the "new session" seat and the workspace
     * drag source live beside it rather than inside it, so neither nests an
     * interactive control in a button.
     *
     * @param {object} props - block data, handlers and copy.
     * @returns {object} the block.
     */
    function Section(props) {
      const {
        sectionKey, label, path, count, expanded, onToggle, sessions, renderRow,
        onStart, drag, drop, dragging, onDragStart, onDragOver, onDragEnd,
        pageLimit, pageRequired, pageExpanded, onShowMore, onCollapsePage, expandLabel, collapseLabel,
        folder, heading = false,
      } = props
      // The region owns ordering, so it also owns how many rows a block shows; the
      // page never hides a session that needs attention or the current one.
      const page = pageRows(sessions, pageLimit === undefined ? sessions.length : pageLimit, pageRequired ?? 0)
      const overflowing = page.hiddenCount > 0
      const showPageControl = overflowing || pageExpanded === true
      const header = h('button', {
        type: 'button',
        className: heading ? 'dsm-heading-header' : 'dsm-section-header',
        // The host's canonical workspace directory, shown only on hover. It is a
        // tooltip, never a second name for the group.
        ...(path === undefined ? {} : { title: path }),
        'aria-expanded': String(expanded),
        // The workspace row is the gesture's source; its own click still toggles.
        onPointerDown: onDragStart === undefined ? undefined : (event) => {
          gestureDown('workspace', sectionKey, event, {})
        },
        onPointerMove: onDragStart === undefined ? undefined : (event) => {
          const active = gestureMove('workspace', event, 'data-dsm-group', (mark) => {
            onDragOver(mark === null ? null : { key: mark.id, half: mark.half })
          })
          if (active && pointerGesture.published !== true) {
            pointerGesture.published = true
            onDragStart(sectionKey)
          }
        },
        onPointerUp: onDragStart === undefined ? undefined : () => { gestureUp('workspace', onDragEnd) },
        onPointerCancel: onDragStart === undefined ? undefined : () => { gestureUp('workspace', onDragEnd) },
        onClick: () => {
          if (pointerGesture.moved) { pointerGesture.moved = false; return }
          onToggle(sectionKey)
        },
      },
      h('span', { className: 'dsm-chevron', 'aria-hidden': 'true' },
        expanded ? h(IconChevronDownOutlineRegular, { size: 12 }) : h(IconChevronRightOutlineRegular, { size: 12 })),
      folder === false ? null : h('span', { className: 'dsm-slot', 'aria-hidden': 'true' },
        expanded ? h(IconFolderOpenRegular, { size: 16 }) : h(IconFolderCloseRegular, { size: 16 })),
      h('span', { className: heading ? 'dsm-heading-label' : 'dsm-section-label' }, label),
      count === undefined ? null : h('span', { className: heading ? 'dsm-heading-count' : 'dsm-section-count' }, String(count)),
      )
      return h('div', {
        className: 'dsm-group',
        'data-dsm-group': sectionKey,
        'data-heading': heading ? 'true' : undefined,
        'data-dragging': String(dragging === true),
        'data-drop': drop || undefined,
        // A workspace row reorders by the same pointer gesture a session uses: a
        // native drag source here would wrap every session row inside it and let
        // Chromium start that drag instead of the row's own gesture.
        ...(onDragStart === undefined ? {} : {
          'data-dsm-group': sectionKey,
        }),
      },
      h('div', { className: heading ? 'dsm-heading-row' : 'dsm-section-row' }, header,
        onStart === undefined ? null : h('button', {
          type: 'button',
          className: 'dsm-workspace-action',
          title: props.startLabel,
          'aria-label': props.startLabel,
          onClick: (event) => { event.stopPropagation(); onStart(sectionKey) },
        }, h(IconPlusOutlineRegular, { size: 14 }))),
      expanded ? h('div', { className: 'dsm-list' }, page.visible.map(renderRow)) : null,
      expanded && showPageControl ? h('button', {
        type: 'button',
        className: 'dsm-overflow',
        'aria-expanded': String(!overflowing),
        onClick: () => { if (overflowing) onShowMore(); else onCollapsePage() },
      }, overflowing ? expandLabel(page.hiddenCount) : collapseLabel) : null,
      )
    }

    /**
     * The region occupant: the whole session-browsing surface.
     *
     * It is deliberately a single stable component: the slot renderer keeps one
     * instance for the registration's lifetime, and every live value it renders
     * arrives as a prop bound by the renderer (`use*` hooks) or by this
     * registration's `inject` face (actions).
     *
     * @param {object} props - owner share, standard hooks, injected actions and copy.
     * @returns {object} the browsing region.
     */
    function SessionManagerRegion(props) {
      const {
        wide, expandSidebar, useSessions, useWorkspaces, useSessionStatus, useJobs, t,
        open, startSession, pinSession, unpinSession, archiveSession, unarchiveSession,
        renameSession, forkSession, insertSessionBefore, insertWorkspaceBefore, copyText,
        pickDirectory, createWorkspace, searchSessions, searchResultLimit, useNotice, clearNotice,
        setPriority, setPriorities, priorityStore, watchRows,
      } = props

      const list = useSessions(snapshot => snapshot)
      const workspaceState = useWorkspaces(snapshot => snapshot)
      // The optional job roster: absent on a build without the job service, in which
      // case every job counter stays at zero and the rest of the region still works.
      const jobsState = useJobs(snapshot => snapshot)
      const statuses = useSessionStatus(snapshot => snapshot)
      const notice = useNotice ? useNotice(value => value) : undefined
      // Priority labels are the plugin's own state; the region subscribes to the
      // store React itself rather than asking the Host to synthesize another hook.
      const priorities = useSyncExternalStore(priorityStore.subscribe, priorityStore.getSnapshot)
      // Component-level failures are reported through the same notice channel the
      // injected actions use, so a rejected pick/create is never silent.
      const reportFailure = props.reportFailure ?? (() => {})
      const now = useNow()

      const [orderBy, setOrderBy] = useState('manual')
      const [archivedFilter, setArchivedFilter] = useState('default')
      const [viewOpen, setViewOpen] = useState(false)
      // While a pin reorder runs the block shows its target order: the Host applies
      // the change one write at a time, and the intermediate orders are not states
      // the user asked for. The override is transient — the Host order ends up
      // identical, and the override is dropped as soon as the writes settle.
      const [pinPlan, setPinPlan] = useState(null)
      // The two fixed sections each fold on their own, like the shipped browser's
      // sections: the pinned block holds what is in flight, the project block holds
      // everything else.
      const [projectsCollapsed, setProjectsCollapsed] = useState(false)
      // The priority view lists marked sessions by level for bulk edits; the normal
      // pinned/project tree returns as soon as it is switched off.
      const [priorityView, setPriorityView] = useState(false)
      const [selected, setSelected] = useState(() => new Set())
      const [levelCollapsed, setLevelCollapsed] = useState(() => ({}))
      const [collapsed, setCollapsed] = useState({})
      const [pinnedCollapsed, setPinnedCollapsed] = useState(false)
      const [drag, setDrag] = useState(null)
      const [dropTarget, setDropTarget] = useState(null)
      const [groupDrag, setGroupDrag] = useState(null)
      const [groupDrop, setGroupDrop] = useState(null)
      const [searchOpen, setSearchOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [search, setSearch] = useState({ phase: 'idle', items: [], hasMore: false })
      const [pages, setPages] = useState({})
      const [rename, setRename] = useState(null)

      const byId = list?.byId || {}
      const currentId = useMemo(() => {
        const found = Object.values(byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)
        return found?.id
      }, [byId])

      const { children, rollup } = useMemo(() => buildRollup(list, jobsState), [list, jobsState])

      const workspaces = workspaceState?.items || []
      const expandedKeys = useMemo(
        () => workspaces.map(workspace => String(workspace.workspaceId)).filter(key => collapsed[key] !== true).concat(collapsed[''] !== true ? [''] : []),
        [workspaces, collapsed],
      )

      const tree = useMemo(() => computeGroups({
        list,
        workspaces,
        orderBy,
        archivedFilter,
        pinnedSessionIds: workspaceState?.pinnedSessionIds || [],
        archivedSessionIds: workspaceState?.archivedSessionIds || [],
        currentId,
        expandedKeys,
        labels: { ungrouped: t('section.ungrouped') },
      }), [list, workspaces, orderBy, archivedFilter, workspaceState, currentId, expandedKeys, t])

      // Membership never changes here, only order, so a plain reordering is enough.
      const pinnedOrder = useMemo(() => {
        if (pinPlan === null) return tree.pinned
        const known = new Set(tree.pinned)
        return [...pinPlan.filter(id => known.has(id)), ...tree.pinned.filter(id => !pinPlan.includes(id))]
      }, [pinPlan, tree.pinned])

      const archivedSet = useMemo(() => new Set(workspaceState?.archivedSessionIds || []), [workspaceState])
      const pinnedSet = useMemo(() => new Set(workspaceState?.pinnedSessionIds || []), [workspaceState])

      /**
       * Reorder the pinned block through pin/unpin.
       *
       * The registry's pin set is prepend-on-pin with no move operation, so the
       * block is reordered by rewriting the part that differs — see
       * {@link pinRepinPlan}. The block shows the wanted order while the writes run,
       * because the Host passes through orders nobody asked for on the way.
       *
       * @param {string[]} order - pinned ids in Host order.
       * @param {string} sessionId - the moved id.
       * @param {object} input - `{ targetId, half }` or `{ direction }`.
       * @returns {Promise<void>} resolves when the Host has been told.
       */
      const reorderPinned = useCallback(async (order, sessionId, input) => {
        const desired = reorderTo({ order, movingId: sessionId, ...input })
        if (desired === undefined) return
        const plan = pinRepinPlan(order, desired)
        if (plan.toUnpin.length === 0) return
        // The registry refuses to pin an archived session, and a plan that touches
        // one cannot be expressed at all: refuse it whole rather than half-apply it.
        const blocked = [...new Set([...plan.toUnpin, ...plan.toPin])].filter(id => archivedSet.has(id))
        if (blocked.length > 0) {
          reportFailure(new Error(`${t('notice.pinArchived')}${blocked.join(', ')}`))
          return
        }
        setPinPlan(desired)
        try {
          for (const id of plan.toUnpin) await unpinSession(id)
          for (const id of plan.toPin) await pinSession(id)
        } catch (error) {
          reportFailure(error)
        } finally {
          setPinPlan(null)
        }
      }, [archivedSet, pinSession, reportFailure, t, unpinSession])

      const move = useCallback((accountId, order, sessionId, direction) => {
        if (accountId === PINNED_KEY) {
          void reorderPinned(order, sessionId, { direction })
          return
        }
        const anchor = moveAnchor({ order, movingId: sessionId, direction })
        if (anchor === undefined) return
        if (!accountId) return // the ungrouped bucket has no durable host account
        void insertSessionBefore(accountId, sessionId, anchor ?? undefined)
      }, [insertSessionBefore, reorderPinned])

      const addWorkspace = useCallback(async () => {
        // The host picker is a service call, so this works even though the region
        // owns the rendering: `pickDirectory` resolves the deployment's chooser
        // (native dialog or the in-app browser) without going through a slot.
        const path = await pickDirectory()
        if (path === null || path === undefined || path === '') return // cancelled
        await createWorkspace({ path })
      }, [createWorkspace, pickDirectory])

      // One superseded request per keystroke: the previous controller is aborted
      // before the next timer fires, and a blank query never reaches the host.
      useEffect(() => {
        const clean = sanitizeQuery(query)
        if (clean.trim() === '') {
          setSearch({ phase: 'idle', items: [], hasMore: false })
          return undefined
        }
        const controller = new AbortController()
        const timer = window.setTimeout(() => {
          setSearch(current => ({ ...current, phase: 'loading' }))
          Promise.resolve(searchSessions(clean, controller.signal))
            .then(result => setSearch({ phase: 'ready', items: result?.items ?? [], hasMore: result?.hasMore === true }))
            .catch(error => {
              if (controller.signal.aborted) return
              setSearch({ phase: 'error', items: [], hasMore: false, message: String(error?.message ?? error) })
            })
        }, SEARCH_DEBOUNCE_MS)
        return () => { window.clearTimeout(timer); controller.abort() }
      }, [query, searchSessions])

      // The box being open and a query being active are different states: open with
      // an empty box still shows the list, and only a non-blank query searches.
      const searching = query.trim() !== ''
      const results = useMemo(() => (searching ? buildSearchNodes({
        list,
        workspaces,
        query,
        items: search.items,
        hasMore: search.hasMore,
        limit: searchResultLimit,
        archivedSessionIds: workspaceState?.archivedSessionIds || [],
        archivedFilter,
        currentId,
      }) : { nodes: [], hasMore: false, total: 0 }), [searching, list, workspaces, query, search.items, search.hasMore, searchResultLimit, workspaceState, archivedFilter, currentId])

      // A session that needs attention must never be hidden behind a page.
      const attention = useMemo(() => {
        const busy = new Set()
        for (const group of tree.groups) {
          for (const id of group.sessions) {
            if (statusOf(id, { rollup, statusSnapshot: statuses }).dot !== DOT.IDLE) busy.add(id)
          }
        }
        for (const id of tree.pinned) {
          if (statusOf(id, { rollup, statusSnapshot: statuses }).dot !== DOT.IDLE) busy.add(id)
        }
        return busy
      }, [tree, rollup, statuses])

      const moveGroup = useCallback((order, movingId, target) => {
        const anchor = moveAnchor({ order, movingId, targetId: target.key, half: target.half })
        // `''` is the ungrouped bucket, which has no host registration to move.
        if (anchor === undefined || movingId === '' || anchor === '') return
        void insertWorkspaceBefore(movingId, anchor ?? undefined)
      }, [insertWorkspaceBefore])

      const drop = useCallback((accountId, order, movingId, target) => {
        if (accountId === PINNED_KEY) {
          void reorderPinned(order, movingId, { targetId: target.id, half: target.half })
          return
        }
        const anchor = moveAnchor({ order, movingId, targetId: target.id, half: target.half })
        if (anchor === undefined || !accountId) return
        void insertSessionBefore(accountId, movingId, anchor ?? undefined)
      }, [insertSessionBefore, reorderPinned])

      const selectAction = useCallback((action, sessionId, accountId, order) => {
        if (action.startsWith('priority:')) {
          setPriority(sessionId, action.slice('priority:'.length))
          return
        }
        if (action === 'rename') {
          setRename({ sessionId, title: String(byId[sessionId]?.displayTitle || byId[sessionId]?.title || sessionId) })
          return
        }
        if (action === 'moveUp' || action === 'moveDown') {
          move(accountId, order, sessionId, action === 'moveUp' ? 'up' : 'down')
          return
        }
        if (action === 'copyId') { void copyText(sessionId); return }
        if (action === 'copyCwd') {
          const cwd = byId[sessionId]?.cwd
          if (cwd) void copyText(cwd)
          return
        }
        if (action === 'pin') { void pinSession(sessionId); return }
        if (action === 'unpin') { void unpinSession(sessionId); return }
        if (action === 'fork') { void forkSession(sessionId); return }
        if (action === 'archive') { void archiveSession(sessionId); return }
        if (action === 'unarchive') { void unarchiveSession(sessionId); return }
      }, [archiveSession, byId, copyText, forkSession, move, pinSession, setPriority, unpinSession, unarchiveSession])

      const renderRow = useCallback((sessionId, accountId, accountOrder, layout = {}) => {
        const {
          flat = false, pinnedSection = false,
          selectable = false, selected = false, onToggleSelect, toggleLabel,
          groupedByPriority = false,
        } = layout
        const summary = byId[sessionId]
        if (!summary) return null
        return h(SessionRow, {
          key: sessionId,
          sessionId,
          summary,
          status: statusOf(sessionId, { rollup, statusSnapshot: statuses }),
          accountId,
          accountOrder,
          currentId,
          archived: archivedSet.has(sessionId),
          pinned: pinnedSet.has(sessionId),
          now,
          t,
          drag,
          dropTarget,
          onDragStart: setDrag,
          // `dragover` fires continuously: only a *changed* cell may re-render.
          // A pointer stream is continuous: only a *changed* cell may re-render.
          onDragOverRow: (next) => setDropTarget((current) => {
            if (next === null || next === undefined) return current === null ? current : null
            return current && current.sessionId === next.sessionId && current.half === next.half ? current : next
          }),
          onDragEnd: (move) => {
            // Commit from the last marked row: a gesture that ends in a gap, at an
            // edge, or outside the list still lands where its marker pointed.
            if (move !== null && move !== undefined) drop(move.accountId, move.order, move.id, move.target)
            setDrag(null); setDropTarget(null)
          },
          onOpen: open,
          onSelectAction: selectAction,
          onMove: move,
          // The pinned block leads the region but its order is the host's pin set,
          // which exposes no move operation; ungrouped rows have no account either.
          canReorder: typeof accountId === 'string' && accountId !== '',
          priority: priorityLevel(priorities?.[sessionId]),
          flat,
          pinnedSection,
          selectable,
          selected,
          onToggleSelect,
          toggleLabel,
          groupedByPriority,
        })
      // `priorities` belongs here: without it the memoised renderer kept writing the
      // labels it saw when it was created, so a new P1–P4 choice only showed up after
      // something else rebuilt the rows.
      }, [archivedSet, byId, currentId, drag, drop, dropTarget, move, now, open, pinnedSet, priorities, rollup, selectAction, statuses, t])

      // Priority view: the same rows, grouped by the label they carry. Order inside a
      // level follows the active ordering, so switching order still reads naturally.
      const orderedIds = useMemo(() => {
        const ids = []
        const push = (id) => { if (!ids.includes(id)) ids.push(id) }
        for (const id of pinnedOrder) push(id)
        for (const group of tree.groups) for (const id of group.sessions) push(id)
        return ids
      }, [pinnedOrder, tree])
      const priorityLevels = useMemo(() => {
        const buckets = PRIORITY.map(level => ({ level, label: t(`priority.${level}`), ids: [] }))
        const unmarked = []
        for (const id of orderedIds) {
          if (archivedFilter === 'only' ? !archivedSet.has(id) : archivedFilter === 'default' && archivedSet.has(id)) continue
          const level = priorityLevel(priorities?.[id])
          const bucket = level === undefined ? undefined : buckets.find(candidate => candidate.level === level)
          if (bucket) bucket.ids.push(id)
          else if (level === undefined) unmarked.push(id)
        }
        return { buckets, unmarked }
      }, [orderedIds, priorities, archivedSet, archivedFilter, t])
      const markedCount = priorityLevels.buckets.reduce((total, bucket) => total + bucket.ids.length, 0)
      const toggleSelected = useCallback((sessionId) => {
        setSelected((current) => {
          const next = new Set(current)
          if (next.has(sessionId)) next.delete(sessionId)
          else next.add(sessionId)
          return next
        })
      }, [])
      // The Host keeps a job roster only for sessions a surface asked to watch, so
      // the region subscribes on behalf of the rows that are actually on screen.
      // A row hidden behind a fold or a page is not watched: a stream per session in
      // every collapsed project would be a lot of traffic for pixels nobody sees.
      const visibleIds = useMemo(() => {
        const ids = []
        if (!wide) return ids
        if (searching) {
          for (const node of results.nodes) ids.push(node.id)
          return ids
        }
        if (priorityView) {
          for (const bucket of priorityLevels.buckets) {
            if (levelCollapsed[bucket.level] !== true) ids.push(...bucket.ids)
          }
          if (levelCollapsed.unmarked === true) ids.push(...priorityLevels.unmarked)
          return ids
        }
        if (pinnedOrder.length > 0 && !pinnedCollapsed) ids.push(...pinnedOrder)
        if (projectsCollapsed) return ids
        for (const group of tree.groups) {
          if (collapsed[group.key] === true) continue
          // The page a block shows is max(stored limit, attention requirement), the
          // same derivation its rows and its "show more" control use.
          const required = requiredPageLimit(group.sessions, attention, currentId)
          const limit = Math.max(pages[group.key] ?? SESSION_PAGE_BASE, required)
          ids.push(...pageRows(group.sessions, limit, required).visible)
        }
        return ids
      }, [attention, collapsed, currentId, levelCollapsed, pages, pinnedCollapsed, pinnedOrder, priorityLevels, priorityView, projectsCollapsed, results, searching, tree, wide])

      // The key rather than the array: `children` is rebuilt with every snapshot,
      // so depending on the array would re-open every stream on every job tick.
      const watchKey = useMemo(
        () => watchTargets(visibleIds, children).join('\u0000'),
        [children, visibleIds],
      )
      const jobsReady = jobsState !== undefined
      useEffect(() => {
        if (!jobsReady || typeof watchRows !== 'function' || watchKey === '') return undefined
        const releases = []
        for (const id of watchKey.split('\u0000')) {
          const release = watchRows(id)
          if (typeof release === 'function') releases.push(release)
        }
        return () => {
          for (const release of releases) {
            try { release() } catch { /* the service may already be gone */ }
          }
        }
      }, [jobsReady, watchKey, watchRows])

      const leavePriorityView = useCallback(() => {
        setPriorityView(false)
        setSelected(new Set())
      }, [])
      const priorityRow = (sessionId, options) => renderRow(sessionId, '', [], { flat: true, ...options })

      if (!wide) {
        // The rail: the shell owns the icon column; the region only needs an entry
        // that expands the sidebar back to its wide form.
        return h('div', { className: 'dsm-region' },
          h('button', { type: 'button', className: 'dsm-section-header', onClick: expandSidebar, 'aria-label': t('section.workspaces') }, '▸'))
      }

      const region = h('div', { className: 'dsm-region' },
        h('div', { className: 'dsm-head' },
          searchOpen
            ? h('span', { className: 'dsm-search' },
              h('input', {
                className: 'dsm-search-input',
                type: 'search',
                value: query,
                autoFocus: true,
                'aria-label': t('search.aria'),
                placeholder: t('search.placeholder'),
                onChange: event => setQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key !== 'Escape') return
                  event.stopPropagation()
                  setQuery('')
                  setSearchOpen(false)
                },
              }))
            : h('span', { className: 'dsm-head-label' }, t('section.workspaces')),
          h('span', { className: 'dsm-head-spacer' }),
          searchOpen ? null : h('button', {
            type: 'button',
            className: 'dsm-head-action',
            title: t('search.placeholder'),
            'aria-label': t('search.placeholder'),
            onClick: () => setSearchOpen(true),
          }, h(IconSearchOutlineRegular, { size: 16 })),
          searchOpen ? null : h('button', {
            type: 'button',
            className: 'dsm-head-action',
            'data-active': priorityView ? 'true' : undefined,
            title: priorityView ? t('view.priorityExit') : t('view.priority'),
            'aria-label': priorityView ? t('view.priorityExit') : t('view.priority'),
            'aria-pressed': String(priorityView),
            onClick: () => { if (priorityView) leavePriorityView(); else setPriorityView(true) },
          }, h('span', { className: 'dsm-pbadge', 'aria-hidden': 'true' }, 'P')),
          searchOpen ? h('button', {
            type: 'button',
            className: 'dsm-head-action',
            title: t('search.clear'),
            'aria-label': t('search.clear'),
            onClick: () => { setQuery(''); setSearchOpen(false) },
          }, h(IconCloseFillRegular, { size: 14 })) : null,
          // `Menu` owns no trigger of its own: the anchor's own click toggles the
          // controlled `open`, and the current modes come back as `selectedIds`.
          h(Menu, {
            open: viewOpen,
            anchor: h('button', {
              type: 'button',
              className: 'dsm-head-action',
              title: t('view.options'),
              'aria-label': t('view.options'),
              'aria-haspopup': 'menu',
              onClick: () => setViewOpen(value => !value),
            }, h(IconSlidersTwoOutlineRegular, { size: 16 })),
            items: [
              { type: 'label', id: 'order-label', text: t('view.order') },
              { id: 'orderManual', label: t('view.orderManual'), icon: h(IconChevronsUpDownOutlineRegular) },
              { id: 'orderUpdated', label: t('view.orderUpdated'), icon: h(IconClockOutlineRegular) },
              { type: 'separator', id: 'sep-order' },
              { type: 'label', id: 'archived-label', text: t('view.archived') },
              { id: 'archivedDefault', label: t('view.archivedDefault'), icon: h(IconArchiveOffOutlineRegular) },
              { id: 'archivedShow', label: t('view.archivedShow'), icon: h(IconQueueOutlineRegular) },
              { id: 'archivedOnly', label: t('view.archivedOnly'), icon: h(IconArchiveCheckOutlineRegular) },
            ],
            selectedIds: [
              orderBy === 'manual' ? 'orderManual' : 'orderUpdated',
              archivedFilter === 'show' ? 'archivedShow'
                : archivedFilter === 'only' ? 'archivedOnly' : 'archivedDefault',
            ],
            onSelect: (id) => {
              if (id === 'orderManual') setOrderBy('manual')
              else if (id === 'orderUpdated') setOrderBy('updated')
              else if (id === 'archivedDefault') setArchivedFilter('default')
              else if (id === 'archivedShow') setArchivedFilter('show')
              else if (id === 'archivedOnly') setArchivedFilter('only')
              setViewOpen(false)
            },
            onClose: () => setViewOpen(false),
            align: 'end',
            dense: true,
            // The region clips its overflow, so an in-place list would be cut off.
            portal: true,
          }),
          h('button', {
            type: 'button',
            className: 'dsm-head-action',
            title: t('action.addWorkspace'),
            'aria-label': t('action.addWorkspace'),
            onClick: () => { addWorkspace().catch(reportFailure) },
          }, h(IconProjectAddOutlineRegular, { size: 16 })),
        ),
        priorityView && !searching ? h('div', { className: 'dsm-bulk' },
          h('span', { className: 'dsm-bulk-count' }, t('bulk.selected', { n: selected.size })),
          h('span', { className: 'dsm-bulk-actions' },
            PRIORITY.map(level => h('button', {
              key: level,
              type: 'button',
              className: 'dsm-bulk-action',
              'data-level': level,
              disabled: selected.size === 0,
              onClick: () => setPriorities([...selected], level),
            }, level.toUpperCase())),
            h('button', {
              type: 'button',
              className: 'dsm-bulk-action dsm-bulk-clear',
              disabled: selected.size === 0,
              onClick: () => setPriorities([...selected], 'none'),
            }, t('priority.none')),
            h('button', {
              type: 'button',
              className: 'dsm-bulk-action',
              disabled: markedCount === 0,
              onClick: () => setSelected(new Set([...priorityLevels.buckets.flatMap(bucket => bucket.ids)])),
            }, t('bulk.marked')),
            h('button', {
              type: 'button',
              className: 'dsm-bulk-action',
              disabled: selected.size === 0,
              onClick: () => setSelected(new Set()),
            }, t('bulk.none')),
            h('button', {
              type: 'button',
              className: 'dsm-bulk-action dsm-bulk-done',
              onClick: leavePriorityView,
            }, t('bulk.done')),
          ),
          h('span', { className: 'dsm-bulk-hint' }, t('bulk.hint')),
        ) : null,
        h('div', { className: 'dsm-body' },
          searching ? h('div', { className: 'dsm-list' },
            search.phase === 'error' ? h('div', { className: 'dsm-search-meta' }, `${t('search.failed')}${search.message ?? ''}`) : null,
            search.phase === 'loading' ? h('div', { className: 'dsm-search-meta' }, t('search.placeholder')) : null,
            results.nodes.length === 0 && search.phase !== 'loading'
              ? h('div', { className: 'dsm-empty' }, t('search.none'))
              : null,
            results.nodes.map(node => {
              const summary = byId[node.id] ?? { displayTitle: node.title, updatedAt: 0 }
              return h(SessionRow, {
                key: node.id,
                sessionId: node.id,
                summary,
                status: statusOf(node.id, { rollup, statusSnapshot: statuses }),
                accountId: undefined,
                accountOrder: [],
                currentId,
                archived: archivedSet.has(node.id),
                pinned: pinnedSet.has(node.id),
                now,
                t,
                drag: null,
                dropTarget: null,
                onDragStart: () => {},
                onDragOverRow: () => {},
                onDragEnd: () => {},
                onOpen: open,
                onSelectAction: selectAction,
                onMove: () => {},
                workspaceLabel: node.workspace,
                snippet: node.snippet,
                canReorder: false,
                flat: true,
              })
            }),
            results.hasMore ? h('div', { className: 'dsm-search-meta' }, t('search.more')) : null,
          ) : null,
          // --- priority view: one fold per level, then the unmarked rows ----------
          searching ? null : priorityView ? h('div', { className: 'dsm-levels' },
            markedCount === 0 && priorityLevels.unmarked.length === 0
              ? h('div', { className: 'dsm-empty' }, t('priority.empty'))
              : null,
            priorityLevels.buckets.map(bucket => bucket.ids.length === 0 ? null : h(Section, {
              key: `level-${bucket.level}`,
              sectionKey: `level-${bucket.level}`,
              label: bucket.label,
              count: bucket.ids.length,
              expanded: levelCollapsed[bucket.level] !== true,
              onToggle: key => setLevelCollapsed(state => ({ ...state, [bucket.level]: state[bucket.level] !== true })),
              sessions: bucket.ids,
              renderRow: sessionId => priorityRow(sessionId, {
                selectable: true,
                selected: selected.has(sessionId),
                onToggleSelect: toggleSelected,
                toggleLabel: t('bulk.select'),
                groupedByPriority: true,
              }),
              pageLimit: Number.MAX_SAFE_INTEGER,
              folder: false,
              heading: true,
            })),
            priorityLevels.unmarked.length === 0 ? null : h(Section, {
              key: 'level-unmarked',
              sectionKey: 'level-unmarked',
              label: t('section.unmarked'),
              count: priorityLevels.unmarked.length,
              // Unmarked rows start folded: the view opens on what is labelled, and
              // the fold is there when the point is to label something new.
              expanded: levelCollapsed.unmarked === true,
              onToggle: () => setLevelCollapsed(state => ({ ...state, unmarked: state.unmarked !== true })),
              sessions: priorityLevels.unmarked,
              renderRow: sessionId => priorityRow(sessionId, {
                selectable: true,
                selected: selected.has(sessionId),
                onToggleSelect: toggleSelected,
                toggleLabel: t('bulk.select'),
                groupedByPriority: true,
              }),
              pageLimit: Number.MAX_SAFE_INTEGER,
              folder: false,
              heading: true,
            }),
          ) : null,
          searching ? null : priorityView ? null : pinnedOrder.length > 0 ? h(Section, {
            sectionKey: '__pinned__',
            label: t('section.pinned'),
            count: pinnedOrder.length,
            expanded: !pinnedCollapsed,
            onToggle: () => setPinnedCollapsed(value => !value),
            sessions: pinnedOrder,
            // Every row in this block is pinned by definition, so the pin badge is
            // not repeated here: the space belongs to the title.
            renderRow: sessionId => renderRow(sessionId, PINNED_KEY, pinnedOrder, { flat: true, pinnedSection: true }),
            pageLimit: Number.MAX_SAFE_INTEGER,
            folder: false,
            heading: true,
          }) : null,
          searching || priorityView ? null : tree.groups.length === 0
            ? h('div', { className: 'dsm-empty' },
              h('div', null, t('empty.none')),
              h('button', {
                type: 'button',
                className: 'dsm-empty-action',
                onClick: () => { addWorkspace().catch(reportFailure) },
              }, t('action.addWorkspace')))
            : null,
          // The project block is one fold around every workspace group, so the two
          // sections read the same way and each keeps its header on screen while it
          // scrolls (Codex's session list does the same).
          searching || priorityView ? null : h('div', { className: 'dsm-project' },
            h('div', { className: 'dsm-project-header', role: 'heading', 'aria-level': 2 },
              h('button', {
                type: 'button',
                className: 'dsm-heading-header',
                'aria-expanded': String(!projectsCollapsed),
                onClick: () => setProjectsCollapsed(value => !value),
              },
              h('span', { className: 'dsm-chevron', 'aria-hidden': 'true' },
                projectsCollapsed
                  ? h(IconChevronRightOutlineRegular, { size: 12 })
                  : h(IconChevronDownOutlineRegular, { size: 12 })),
              h('span', { className: 'dsm-heading-label' }, t('section.projects')),
              tree.groups.length > 0 ? h('span', { className: 'dsm-heading-count' }, String(tree.groups.length)) : null),
            ),
            projectsCollapsed ? null : tree.groups.map(group => h(Section, {
            key: group.key || '__ungrouped__',
            sectionKey: group.key,
            label: group.label,
            path: group.cwd,
            count: undefined,
            expanded: collapsed[group.key] !== true,
            onToggle: key => setCollapsed(state => ({ ...state, [key]: state[key] !== true })),
            sessions: group.sessions,
            renderRow: sessionId => renderRow(sessionId, group.workspaceId, group.sessions),
            startLabel: t('action.newSession'),
            pageLimit: pages[group.key] ?? SESSION_PAGE_BASE,
            pageRequired: requiredPageLimit(group.sessions, attention, currentId),
            pageExpanded: (pages[group.key] ?? SESSION_PAGE_BASE) > SESSION_PAGE_BASE,
            // The page a block shows is max(stored limit, attention requirement), so
            // "show more" must step from that effective limit: stepping from the
            // stored one left the button dead whenever attention had already opened
            // the block past the next step.
            onShowMore: () => setPages(state => {
              const required = requiredPageLimit(group.sessions, attention, currentId)
              const effective = Math.max(state[group.key] ?? SESSION_PAGE_BASE, required)
              const hidden = group.sessions.length - pageRows(group.sessions, effective, required).visible.length
              return { ...state, [group.key]: nextPageLimit(effective, hidden) }
            }),
            onCollapsePage: () => setPages(state => ({ ...state, [group.key]: SESSION_PAGE_BASE })),
            expandLabel: n => t('sessions.expand', { n }),
            collapseLabel: t('sessions.collapse'),
            // Only a registered workspace can host a new session or be reordered.
            onStart: group.workspaceId === undefined ? undefined : () => startSession(group.workspaceId),
            drag: groupDrag,
            drop: groupDrop && groupDrop.key === group.key ? groupDrop.half : null,
            dragging: groupDrag === group.key,
            onDragStart: group.workspaceId === undefined ? undefined : setGroupDrag,
            onDragOver: (next) => setGroupDrop((current) => {
            if (next === null || next === undefined) return current === null ? current : null
            return current && current.key === next.key && current.half === next.half ? current : next
          }),
            // A pointer gesture has no drop event: the release commits from the
            // last marked target, exactly like a session row.
            onDragEnd: (move) => {
              if (move !== null && move !== undefined) {
                moveGroup(tree.groups.map(candidate => candidate.key), move.id, { key: move.target.id, half: move.target.half })
              }
              setGroupDrag(null); setGroupDrop(null)
            },
          })),
          ),
        ),
        notice ? h('div', { className: 'dsm-notice', role: 'alert' }, notice,
          h('button', { type: 'button', onClick: clearNotice }, t('dialog.close'))) : null,
        h(RenameDialog, {
          request: rename,
          t,
          onCancel: () => setRename(null),
          onSubmit: async (sessionId, title) => {
            await renameSession(sessionId, title)
            setRename(null)
          },
        }),
      )
      return region
    }

    /**
     * The rename dialog. It writes through the Host session service, never through a
     * plugin-owned copy of the title.
     * @param {object} props - `{ request, onSubmit, onCancel, t }`.
     * @returns {object|null} the modal while a rename is pending.
     */
    function RenameDialog({ request, onSubmit, onCancel, t }) {
      const [value, setValue] = useState('')
      const [busy, setBusy] = useState(false)
      useEffect(() => { setValue(request ? request.title : '') ; setBusy(false) }, [request])
      if (!request) return null
      const submit = async () => {
        const title = value.trim()
        if (title === '' || busy) return
        setBusy(true)
        try { await onSubmit(request.sessionId, title) } finally { setBusy(false) }
      }
      return h(Modal, {
        open: true,
        onClose: onCancel,
        title: t('dialog.renameTitle'),
        closeLabel: t('dialog.close'),
      }, h('form', {
        className: 'dsm-rename-form',
        onSubmit: (event) => { event.preventDefault(); void submit() },
      },
      h('label', null, t('dialog.nameLabel'),
        h('input', {
          className: 'dsm-rename-input',
          value,
          autoFocus: true,
          required: true,
          onChange: event => setValue(event.target.value),
        })),
      h('div', { className: 'dsm-dialog-actions' },
        h('button', { type: 'button', onClick: onCancel }, t('dialog.cancel')),
        h('button', { type: 'submit', disabled: busy }, t('dialog.save'))),
      ))
    }

    /** Required client services; `jobs` is fetched lazily because a build may omit it. */
    const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'locale']

    /**
     * Register the browsing region and its dictionaries.
     * @param {object} ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-manager: dictionaries')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute(STYLE_MARKER, '1')
        style.textContent = css
        document.head.append(style)
        return () => style.remove()
      }, 'dsh-session-manager: region styles')

      // `ctx.jobs` is installed by the job controller's client half, which this
      // plugin declares in its inject list — but a host may still publish it late.
      // Resolve it on every read and re-point the subscription when it appears, so
      // a job-driven running dot can never be silently lost.
      const jobsSource = (() => {
        const listeners = new Set()
        let inner
        let unsubscribe
        const sync = () => {
          const state = ctx.get('jobs')?.state
          if (state === inner) return
          if (unsubscribe) { try { unsubscribe() } catch { /* already gone */ } unsubscribe = undefined }
          inner = state
          if (inner && typeof inner.subscribe === 'function') {
            unsubscribe = inner.subscribe(() => { for (const listener of listeners) listener() })
          }
        }
        return {
          getSnapshot() { sync(); return inner?.getSnapshot?.() },
          subscribe(listener) {
            listeners.add(listener)
            sync()
            return () => {
              listeners.delete(listener)
              if (listeners.size > 0 || unsubscribe === undefined) return
              try { unsubscribe() } catch { /* already gone */ }
              unsubscribe = undefined
              inner = undefined
            }
          },
        }
      })()

      const priorities = priorityStore(require)

      let notice = null
      const noticeSource = {
        listeners: new Set(),
        getSnapshot: () => notice,
        subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) },
        set(next) { notice = next; for (const listener of this.listeners) listener() },
      }

      const report = (error) => {
        // The host refuses to archive a session with running work; name that case
        // explicitly instead of showing a raw carrier failure.
        const active = error?.rpcError?.code === 'workspace/session-active'
        const prefix = active ? '' : zh['notice.failed']
        noticeSource.set(active ? zh['notice.sessionActive'] : `${prefix}${error?.message || String(error)}`)
        console.warn('[dsh-session-manager] action failed', error)
      }
      // Host calls fire synchronously so an interaction is never a frame behind the
      // click that caused it; only their rejection is deferred onto the notice.
      const invoke = (run) => {
        try {
          Promise.resolve(run()).catch(report)
        } catch (error) {
          report(error)
        }
      }

      ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
        name: 'sidebar.workspaces',
        priority: SLOT_PRIORITY,
        locale: NS,
        registrant: '@pianner/dsh-session-manager',
        inject: () => ({
          open: sessionId => ctx.uiWorkspace.openSession(sessionId),
          // The Host materializes a session's job roster only while some surface
          // watches it (`ctx.jobs.watchRows`). The region decides which sessions are
          // on screen; this is the stable call it hands down, resolved on every use
          // so a late-installed job service is picked up instead of watched forever
          // from a captured undefined.
          watchRows: (sessionId) => {
            const service = ctx.get('jobs')
            if (typeof service?.watchRows !== 'function') return undefined
            try {
              return service.watchRows(sessionId)
            } catch (error) {
              console.warn('[dsh-session-manager] watchRows failed', error)
              return undefined
            }
          },
          startSession: workspaceId => ctx.uiWorkspace.startSession(workspaceId),
          pinSession: sessionId => invoke(() => ctx.uiWorkspace.pinSession(sessionId)),
          unpinSession: sessionId => invoke(() => ctx.uiWorkspace.unpinSession(sessionId)),
          archiveSession: sessionId => invoke(() => ctx.uiWorkspace.archiveSession(sessionId)),
          unarchiveSession: sessionId => invoke(() => ctx.uiWorkspace.unarchiveSession(sessionId)),
          forkSession: sessionId => invoke(() => ctx.uiWorkspace.forkSession(sessionId)),
          renameSession: (sessionId, title) => ctx.sessions.using(
            sessionId,
            { source: 'workspaceOperation' },
            reference => reference.binding.session.rename(title),
          ).then((result) => {
            if (result?.ok === false) throw new Error(result.error?.message || 'rename failed')
          }),
          insertSessionBefore: (workspaceId, sessionId, beforeSessionId) => invoke(
            () => ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId),
          ),
          insertWorkspaceBefore: (workspaceId, beforeWorkspaceId) => invoke(
            () => ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId),
          ),
          searchSessions: (query, signal) => Promise.resolve(ctx.sessions.search(query, signal)).then((result) => {
            if (result?.ok === false) throw new Error(result.error?.message || 'session search failed')
            return result.value
          }),
          searchResultLimit: ctx.sessions.searchResultLimit,
          pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
          createWorkspace: input => ctx.workspaces.create(input),
          reportFailure: report,
          copyText: (text) => invoke(async () => {
            if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return }
            throw new Error(zh['notice.copyFailed'])
          }),
          clearNotice: () => noticeSource.set(null),
          // The store itself rides the face so the region can subscribe on its own.
          priorityStore: priorities,
          // Priority labels are plugin-owned state, so the write lives beside the
          // store rather than in the region that renders it.
          // Bulk edits land as one store write, so a large selection repaints once.
          setPriorities: (sessionIds, priorityId) => {
            const level = priorityLevel(priorityId)
            const next = { ...priorities.getSnapshot() }
            for (const sessionId of sessionIds) {
              if (level === undefined) delete next[sessionId]
              else next[sessionId] = level
            }
            priorities.set(next)
          },
          setPriority: (sessionId, priorityId) => {
            const next = { ...priorities.getSnapshot() }
            const level = priorityLevel(priorityId)
            if (level === undefined) delete next[sessionId]
            else next[sessionId] = level
            priorities.set(next)
          },
          hooks: { notice: noticeSource, jobs: jobsSource },
        }),
      }, SessionManagerRegion))
    }

    module.exports = { inject, apply }

    return module.exports
  },
})
