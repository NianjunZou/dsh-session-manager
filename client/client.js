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
     * Virtual subfolders
     *
     * The Host has no session-level folder concept: `SessionSummary` carries no
     * folder/tag/group field and `WorkspaceView` cannot nest. A subfolder is
     * therefore plugin-owned presentation data, never a second copy of a host
     * value. It is stored as one versioned JSON value; every function below is a
     * pure projection/update so the model can be tested without a browser.
     *
     * Invariants live in `docs/DESIGN-0.2.0.md` §3.3. In particular: folder ids
     * start with `f-`, names are trimmed to 1..40 code units, assignments only
     * point at a folder of the same workspace, and an unknown schema version is
     * read-only so an older plugin cannot overwrite a newer one.
     * ------------------------------------------------------------------ */

    /** Current persisted folder schema version. */
    const FOLDER_SCHEMA_VERSION = 1
    /** Chip id for the "all folders" view. */
    const FOLDER_ALL = '__all__'
    /** Chip id for sessions without an assignment. */
    const FOLDER_UNFILED = '__unfiled__'
    /** Maximum folder name length, in UTF-16 code units. */
    const FOLDER_NAME_MAX = 40
    /** Maximum folders per workspace; keeps the row submenu inside one screen. */
    const FOLDER_MAX_PER_WORKSPACE = 20

    /** The immutable empty state, also the store's initial value. */
    const FOLDER_INIT = Object.freeze({
      v: FOLDER_SCHEMA_VERSION,
      workspaces: Object.freeze({}),
    })

    /** Keys that must never become object keys read from persisted JSON. */
    const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
    /** Control characters are not valid in a display name. */
    const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

    /**
     * Whether a value is a plain JSON object (not null, not an array).
     * @param {unknown} value - candidate.
     * @returns {boolean} true for plain objects.
     */
    function isPlainObject(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /**
     * Whether a key read from persisted JSON is safe to use as an object key.
     * @param {unknown} key - candidate key.
     * @returns {boolean} true when the key is a non-empty safe string.
     */
    function isSafeKey(key) {
      return typeof key === 'string' && key !== '' && !UNSAFE_KEYS.has(key)
    }

    /**
     * Whether a value is a v1 folder state.
     * @param {unknown} state - candidate state.
     * @returns {boolean} true for `{ v: 1, workspaces: object }`.
     */
    function isFolderState(state) {
      return isPlainObject(state) && state.v === FOLDER_SCHEMA_VERSION && isPlainObject(state.workspaces)
    }

    /**
     * The member set of a workspace, accepting either an array or a Set.
     * @param {Iterable<string>|undefined} memberIds - workspace session ids.
     * @returns {Set<string>} the ids.
     */
    function memberSet(memberIds) {
      if (memberIds instanceof Set) return new Set(memberIds)
      return new Set(Array.isArray(memberIds) ? memberIds.filter(id => typeof id === 'string') : [])
    }

    /**
     * Normalize one persisted folder entry.
     * @param {unknown} value - candidate folder.
     * @returns {{id: string, name: string}|undefined} a valid folder, or undefined.
     */
    function sanitizeFolder(value) {
      if (!isPlainObject(value)) return undefined
      if (typeof value.id !== 'string' || !value.id.startsWith('f-')) return undefined
      if (typeof value.name !== 'string') return undefined
      const name = value.name.trim()
      if (name === '' || name.length > FOLDER_NAME_MAX || CONTROL_CHARACTERS.test(name)) return undefined
      return { id: value.id, name }
    }

    /**
     * Build a sanitized v1 state from an arbitrary JSON value.
     *
     * The input is never mutated. Duplicate folder ids, invalid names, unsafe
     * keys and assignments to missing folders are dropped. Empty workspace
     * records are omitted so repeated writes cannot grow the value without bound.
     *
     * @param {unknown} raw - parsed persisted value.
     * @returns {object} a v1 state (possibly {@link FOLDER_INIT}).
     */
    function sanitizeFolderState(raw) {
      if (!isPlainObject(raw) || raw.v !== FOLDER_SCHEMA_VERSION) return FOLDER_INIT
      const workspaces = {}
      for (const [workspaceId, workspace] of Object.entries(isPlainObject(raw.workspaces) ? raw.workspaces : {})) {
        if (!isSafeKey(workspaceId) || !isPlainObject(workspace)) continue
        const folders = []
        const seen = new Set()
        for (const candidate of Array.isArray(workspace.folders) ? workspace.folders : []) {
          const folder = sanitizeFolder(candidate)
          if (!folder || seen.has(folder.id)) continue
          seen.add(folder.id)
          folders.push(folder)
        }
        const assign = {}
        for (const [sessionId, folderId] of Object.entries(isPlainObject(workspace.assign) ? workspace.assign : {})) {
          if (!isSafeKey(sessionId) || typeof folderId !== 'string' || !seen.has(folderId)) continue
          assign[sessionId] = folderId
        }
        if (folders.length > 0 || Object.keys(assign).length > 0) workspaces[workspaceId] = { folders, assign }
      }
      return Object.keys(workspaces).length === 0 ? FOLDER_INIT : { v: FOLDER_SCHEMA_VERSION, workspaces }
    }

    /**
     * Classify a store snapshot before rendering or writing.
     *
     * `empty` and `ok` are writable; `readonly` must not be written at all. A
     * future integer version is treated as newer so an older plugin cannot
     * destroy it; anything else is unrecognized (array, string, missing `v`, ...).
     *
     * @param {unknown} raw - store snapshot.
     * @returns {{ mode: 'empty'|'ok'|'readonly', reason?: 'newer'|'unrecognized', state: object }} classification.
     */
    function readFolderState(raw) {
      if (raw === undefined || raw === null || raw === FOLDER_INIT) return { mode: 'empty', state: FOLDER_INIT }
      if (!isPlainObject(raw)) return { mode: 'readonly', reason: 'unrecognized', state: FOLDER_INIT }
      if (raw.v === FOLDER_SCHEMA_VERSION) return { mode: 'ok', state: sanitizeFolderState(raw) }
      if (Number.isInteger(raw.v) && raw.v > FOLDER_SCHEMA_VERSION) return { mode: 'readonly', reason: 'newer', state: FOLDER_INIT }
      return { mode: 'readonly', reason: 'unrecognized', state: FOLDER_INIT }
    }

    /**
     * Assign many sessions to one folder in a single write.
     *
     * Bulk filing is one gesture, so it is one store write: a per-row loop would
     * repaint the tree once per row and could leave a half-filed view on failure.
     * @param {object} state - v1 state.
     * @param {string} workspaceId - owning workspace.
     * @param {readonly string[]} sessionIds - sessions to file.
     * @param {string|null|undefined} folderId - target folder, or null/undefined for unfiled.
     * @returns {object} the new state, or the input reference when nothing changes.
     */
    function assignSessions(state, workspaceId, sessionIds, folderId) {
      if (!isFolderState(state) || !Array.isArray(sessionIds)) return state
      const entry = foldersOf(state, workspaceId)
      const target = folderId === null || folderId === undefined ? null : String(folderId)
      if (target !== null && !entry.folders.some(folder => folder.id === target)) return state
      const ids = []
      for (const id of sessionIds) {
        if (!isSafeKey(id)) continue
        if ((entry.assign[id] ?? null) === target) continue
        if (!ids.includes(id)) ids.push(id)
      }
      if (ids.length === 0) return state
      return withWorkspace(state, workspaceId, (draft) => {
        for (const id of ids) {
          if (target === null) delete draft.assign[id]
          else draft.assign[id] = target
        }
        return true
      })
    }

    /**
     * Read one workspace's folders and assignments as immutable copies.
     * @param {object} state - sanitized v1 state.
     * @param {string} workspaceId - host workspace id.
     * @returns {{ folders: Array<{id: string, name: string}>, assign: Record<string, string> }} the workspace entry.
     */
    function foldersOf(state, workspaceId) {
      const entry = isSafeKey(workspaceId) && isPlainObject(state?.workspaces)
        ? state.workspaces[workspaceId]
        : undefined
      const folders = []
      const seen = new Set()
      for (const candidate of Array.isArray(entry?.folders) ? entry.folders : []) {
        const folder = sanitizeFolder(candidate)
        if (!folder || seen.has(folder.id)) continue
        seen.add(folder.id)
        folders.push(folder)
      }
      const assign = {}
      for (const [sessionId, folderId] of Object.entries(isPlainObject(entry?.assign) ? entry.assign : {})) {
        if (!isSafeKey(sessionId) || typeof folderId !== 'string' || !seen.has(folderId)) continue
        assign[sessionId] = folderId
      }
      return { folders, assign }
    }

    /**
     * Validate a folder name against the current workspace.
     * @param {unknown} name - proposed name.
     * @param {readonly object[]} folders - sibling folders.
     * @param {{ reserved?: readonly string[], exceptId?: string }} [options] - reserved labels and the renamed folder.
     * @returns {'empty'|'tooLong'|'invalid'|'duplicate'|'reserved'|undefined} the error code, or undefined.
     */
    function folderNameError(name, folders, options = {}) {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (trimmed === '') return 'empty'
      if (trimmed.length > FOLDER_NAME_MAX) return 'tooLong'
      if (CONTROL_CHARACTERS.test(trimmed)) return 'invalid'
      const lower = trimmed.toLocaleLowerCase()
      const reserved = Array.isArray(options.reserved) ? options.reserved : []
      if (reserved.some(value => typeof value === 'string' && value.toLocaleLowerCase() === lower)) return 'reserved'
      const exceptId = options.exceptId
      if ((folders || []).some(folder => folder && folder.id !== exceptId
        && typeof folder.name === 'string' && folder.name.toLocaleLowerCase() === lower)) return 'duplicate'
      return undefined
    }

    /**
     * Apply a mutation to one workspace entry, cloning only the changed path.
     *
     * The mutator returns `true` when it changed something. An unchanged draft is
     * discarded and the original state reference is returned, which lets callers
     * skip a store write entirely.
     *
     * @param {object} state - v1 state.
     * @param {string} workspaceId - target workspace.
     * @param {(draft: { folders: object[], assign: Record<string, string> }) => boolean} mutate - editor.
     * @returns {object} the new state, or the input reference when nothing changed.
     */
    function withWorkspace(state, workspaceId, mutate) {
      if (!isFolderState(state) || !isSafeKey(workspaceId)) return state
      const current = state.workspaces[workspaceId]
      const draft = {
        folders: Array.isArray(current?.folders) ? current.folders.map(folder => ({ id: folder.id, name: folder.name })) : [],
        assign: isPlainObject(current?.assign) ? { ...current.assign } : {},
      }
      if (mutate(draft) !== true) return state
      const workspaces = { ...state.workspaces }
      if (draft.folders.length === 0 && Object.keys(draft.assign).length === 0) delete workspaces[workspaceId]
      else workspaces[workspaceId] = draft
      return { v: FOLDER_SCHEMA_VERSION, workspaces }
    }

    /**
     * Create one folder in a workspace.
     * @param {object} state - v1 state.
     * @param {string} workspaceId - target workspace.
     * @param {{ id: string, name: string }} input - stable id and display name.
     * @returns {object} the new state, or the input reference on any validation failure.
     */
    function createFolder(state, workspaceId, input = {}) {
      if (!isFolderState(state) || !isSafeKey(workspaceId)) return state
      const { id, name } = input
      if (typeof id !== 'string' || !id.startsWith('f-')) return state
      const entry = foldersOf(state, workspaceId)
      if (entry.folders.length >= FOLDER_MAX_PER_WORKSPACE) return state
      if (entry.folders.some(folder => folder.id === id)) return state
      if (folderNameError(name, entry.folders) !== undefined) return state
      const trimmed = name.trim()
      return withWorkspace(state, workspaceId, (draft) => {
        draft.folders.push({ id, name: trimmed })
        return true
      })
    }

    /**
     * Rename one folder without changing its id.
     * @param {object} state - v1 state.
     * @param {string} workspaceId - target workspace.
     * @param {string} folderId - folder to rename.
     * @param {string} name - new display name.
     * @returns {object} the new state, or the input reference when unchanged/invalid.
     */
    function renameFolder(state, workspaceId, folderId, name) {
      if (!isFolderState(state)) return state
      const entry = foldersOf(state, workspaceId)
      const index = entry.folders.findIndex(folder => folder.id === folderId)
      if (index === -1) return state
      if (folderNameError(name, entry.folders, { exceptId: folderId }) !== undefined) return state
      const trimmed = name.trim()
      if (entry.folders[index].name === trimmed) return state
      return withWorkspace(state, workspaceId, (draft) => {
        draft.folders[index] = { id: folderId, name: trimmed }
        return true
      })
    }

    /**
     * Delete one folder and every assignment pointing at it.
     * Sessions are not touched: they simply become unfiled.
     * @param {object} state - v1 state.
     * @param {string} workspaceId - target workspace.
     * @param {string} folderId - folder to delete.
     * @returns {object} the new state, or the input reference when absent.
     */
    function deleteFolder(state, workspaceId, folderId) {
      if (!isFolderState(state)) return state
      const entry = foldersOf(state, workspaceId)
      if (!entry.folders.some(folder => folder.id === folderId)) return state
      return withWorkspace(state, workspaceId, (draft) => {
        draft.folders = draft.folders.filter(folder => folder.id !== folderId)
        for (const [sessionId, assigned] of Object.entries(draft.assign)) {
          if (assigned === folderId) delete draft.assign[sessionId]
        }
        return true
      })
    }

    /**
     * Move one folder one slot up or down.
     * @param {object} state - v1 state.
     * @param {string} workspaceId - target workspace.
     * @param {string} folderId - folder to move.
     * @param {'up'|'down'} direction - movement direction.
     * @returns {object} the new state, or the input reference at a boundary/unknown folder.
     */
    function moveFolder(state, workspaceId, folderId, direction) {
      if (!isFolderState(state)) return state
      const entry = foldersOf(state, workspaceId)
      const index = entry.folders.findIndex(folder => folder.id === folderId)
      if (index === -1) return state
      const next = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : index
      if (next < 0 || next >= entry.folders.length || next === index) return state
      return withWorkspace(state, workspaceId, (draft) => {
        const moved = draft.folders[index]
        draft.folders[index] = draft.folders[next]
        draft.folders[next] = moved
        return true
      })
    }

    /**
     * Move one folder to a slot before or after another folder.
     *
     * Drag ordering is expressed as "this folder now sits before/after that one",
     * so the caller never has to translate a pixel position into an index.
     * @param {object} state - v1 state.
     * @param {string} workspaceId - target workspace.
     * @param {string} movingId - folder being moved.
     * @param {string} targetId - folder the move is anchored to.
     * @param {'before'|'after'} [position] - side of the anchor to land on.
     * @returns {object} the new state, or the input reference when nothing changes.
     */
    function reorderFolder(state, workspaceId, movingId, targetId, position = 'before') {
      if (!isFolderState(state) || movingId === targetId) return state
      const entry = foldersOf(state, workspaceId)
      const from = entry.folders.findIndex(folder => folder.id === movingId)
      const anchor = entry.folders.findIndex(folder => folder.id === targetId)
      if (from === -1 || anchor === -1) return state
      const order = entry.folders.map(folder => folder.id).filter(id => id !== movingId)
      const at = order.indexOf(targetId)
      const insert = position === 'after' ? at + 1 : at
      if (insert === from) return state
      order.splice(insert, 0, movingId)
      return withWorkspace(state, workspaceId, (draft) => {
        const byId = new Map(draft.folders.map(folder => [folder.id, folder]))
        draft.folders = order.map(id => byId.get(id))
        return true
      })
    }

    /**
     * Assign one session to a folder, or to unfiled with `null`.
     * @param {object} state - v1 state.
     * @param {string} workspaceId - owning workspace.
     * @param {string} sessionId - host session id.
     * @param {string|null|undefined} folderId - target folder, or null/undefined for unfiled.
     * @returns {object} the new state, or the input reference when unchanged/invalid.
     */
    function assignSession(state, workspaceId, sessionId, folderId) {
      if (!isFolderState(state) || !isSafeKey(sessionId)) return state
      const entry = foldersOf(state, workspaceId)
      const target = folderId === null || folderId === undefined ? null : String(folderId)
      if (target !== null && !entry.folders.some(folder => folder.id === target)) return state
      const current = entry.assign[sessionId] ?? null
      if (current === target) return state
      return withWorkspace(state, workspaceId, (draft) => {
        if (target === null) delete draft.assign[sessionId]
        else draft.assign[sessionId] = target
        return true
      })
    }

    /**
     * Drop assignments for sessions that are no longer workspace members.
     *
     * Called only when the Host's workspace snapshot is ready, so a cold start
     * cannot mistake "not listed yet" for "deleted". Archived sessions remain
     * members and keep their assignment.
     *
     * @param {object} state - v1 state.
     * @param {string} workspaceId - workspace to prune.
     * @param {Iterable<string>} memberIds - current `workspace.sessionIds`.
     * @returns {object} the new state, or the input reference when nothing was stale.
     */
    function pruneAssign(state, workspaceId, memberIds) {
      if (!isFolderState(state)) return state
      const entry = foldersOf(state, workspaceId)
      const members = memberSet(memberIds)
      const next = {}
      let changed = false
      for (const [sessionId, folderId] of Object.entries(entry.assign)) {
        if (members.has(sessionId)) next[sessionId] = folderId
        else changed = true
      }
      if (!changed) return state
      return withWorkspace(state, workspaceId, (draft) => {
        draft.assign = next
        return true
      })
    }

    /**
     * Map every session to the first workspace that accounts for it.
     * @param {readonly object[]|{ items?: readonly object[] }} workspaces - workspace list/snapshot.
     * @returns {Map<string, string>} session id -> workspace id.
     */
    function workspaceOfSession(workspaces) {
      const items = Array.isArray(workspaces)
        ? workspaces
        : Array.isArray(workspaces?.items) ? workspaces.items : []
      const map = new Map()
      for (const workspace of items) {
        if (!workspace || typeof workspace.workspaceId !== 'string') continue
        for (const sessionId of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
          if (typeof sessionId === 'string' && !map.has(sessionId)) map.set(sessionId, workspace.workspaceId)
        }
      }
      return map
    }

    /**
     * Derive one workspace group's chips, folder sections and active view.
     *
     * `sessionIds` must already be the group's visible, ordered members (archive
     * filter, blank filter, pinned lift and orderBy applied). Counts therefore
     * match what the region would render. Empty folders and an empty unfiled
     * section are kept: they are stable drop targets and management seats.
     *
     * `active` is `null` in the "all" view, so callers cannot accidentally render
     * a second copy of the full list.
     *
     * @param {{ groupKey: string, sessionIds: readonly string[], entry: {folders: readonly object[], assign: Readonly<Record<string, string>>}, activeId?: string }} input - group inputs.
     * @returns {object|null} the view, or null when the workspace has no folders.
     */
    function buildFolderView(input) {
      const folders = Array.isArray(input?.entry?.folders) ? input.entry.folders : []
      if (folders.length === 0) return null
      const groupKey = typeof input.groupKey === 'string' ? input.groupKey : String(input.groupKey ?? '')
      const sessionIds = Array.isArray(input.sessionIds) ? input.sessionIds : []
      const assign = isPlainObject(input.entry?.assign) ? input.entry.assign : {}
      const buckets = new Map(folders.map(folder => [folder.id, []]))
      const unfiled = []
      for (const sessionId of sessionIds) {
        const folderId = typeof sessionId === 'string' ? assign[sessionId] : undefined
        if (typeof folderId === 'string' && buckets.has(folderId)) buckets.get(folderId).push(sessionId)
        else unfiled.push(sessionId)
      }
      const chips = [
        { id: FOLDER_ALL, kind: 'all', count: sessionIds.length },
        ...folders.map(folder => ({ id: folder.id, kind: 'folder', name: folder.name, count: buckets.get(folder.id).length })),
        { id: FOLDER_UNFILED, kind: 'unfiled', count: unfiled.length },
      ]
      const sections = [
        ...folders.map(folder => ({
          key: `${groupKey}:f:${folder.id}`,
          id: folder.id,
          kind: 'folder',
          name: folder.name,
          sessions: buckets.get(folder.id),
        })),
        { key: `${groupKey}:u`, id: FOLDER_UNFILED, kind: 'unfiled', sessions: unfiled },
      ]
      const activeId = input.activeId === FOLDER_UNFILED || folders.some(folder => folder.id === input.activeId)
        ? input.activeId
        : FOLDER_ALL
      const active = activeId === FOLDER_ALL
        ? null
        : activeId === FOLDER_UNFILED
          ? { key: `${groupKey}:u`, sessions: unfiled }
          : { key: `${groupKey}:f:${activeId}`, sessions: buckets.get(activeId) }
      return { hasFolders: true, activeId, chips, sections, active }
    }

    /**
     * Derive every workspace group's folder view in one pass.
     * @param {{ groups?: readonly object[], state: object, active?: Readonly<Record<string, string>> }} input - tree + folder state + active ids.
     * @returns {Record<string, object|null>} group key -> view (null when the group has no folders or no workspace).
     */
    function buildFolderViews(input) {
      const views = {}
      const groups = Array.isArray(input?.groups) ? input.groups : []
      const active = isPlainObject(input?.active) ? input.active : {}
      for (const group of groups) {
        if (!group || typeof group.key !== 'string') continue
        if (typeof group.workspaceId !== 'string') {
          views[group.key] = null
          continue
        }
        const entry = foldersOf(input.state, group.workspaceId)
        views[group.key] = buildFolderView({
          groupKey: group.key,
          sessionIds: Array.isArray(group.sessions) ? group.sessions : [],
          entry,
          activeId: Object.prototype.hasOwnProperty.call(active, group.key) ? active[group.key] : undefined,
        })
      }
      return views
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
     * Split a query into the terms every local match must satisfy.
     *
     * NFKC folds full-width forms, so a query typed on a Chinese IME (`ＡＰＩ`)
     * still finds an ASCII title; lower-casing keeps the matcher case-insensitive.
     * Duplicates are dropped because a repeated term cannot narrow a match.
     * @param {string} query - raw search input.
     * @returns {string[]} normalized terms (empty when the query is blank).
     */
    function searchTerms(query) {
      const terms = []
      for (const part of String(query ?? '').normalize('NFKC').toLowerCase().split(/\s+/u)) {
        if (part !== '' && !terms.includes(part)) terms.push(part)
      }
      return terms
    }

    /**
     * Locate every case-insensitive occurrence of the terms in a label.
     * @param {string} text - the label as rendered.
     * @param {readonly string[]} terms - lowercase terms from {@link searchTerms}.
     * @returns {Array<[number, number]>} merged `[start, end)` ranges in text order.
     */
    function matchRanges(text, terms) {
      const hay = String(text ?? '').toLowerCase()
      const ranges = []
      for (const term of terms) {
        if (term === '') continue
        let from = 0
        while (from <= hay.length - term.length) {
          const at = hay.indexOf(term, from)
          if (at < 0) break
          ranges.push([at, at + term.length])
          from = at + term.length
        }
      }
      ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      const merged = []
      for (const range of ranges) {
        const last = merged[merged.length - 1]
        if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
        else merged.push([range[0], range[1]])
      }
      return merged
    }

    /**
     * Whether a host rejection means content search is off for this deployment.
     *
     * The base bundle mounts the session-query index with `openAt: 'never'`, where
     * every content call rejects with `SESSION_QUERY_SEARCH_DISABLED`. That is a
     * deployment setting rather than a failed search, so the region degrades to
     * local matching instead of painting an error on every keystroke.
     * @param {unknown} error - rejection from `searchSessions`.
     * @returns {boolean} true when only local matching is available.
     */
    function contentSearchDisabled(error) {
      if (error?.code === 'SESSION_QUERY_SEARCH_DISABLED') return true
      const message = String(error?.message ?? error ?? '')
      return /SESSION_QUERY_SEARCH_DISABLED|session search is disabled/i.test(message)
    }

    /**
     * Label each session by the workspace that lists it.
     *
     * The first workspace that claims a session wins, which matches how the tree
     * groups members: a session is listed under one account.
     * @param {readonly object[]} workspaces - `workspaces.list` items.
     * @returns {Map<string, string>} session id to workspace label.
     */
    function workspaceLabels(workspaces) {
      const labels = new Map()
      for (const workspace of workspaces || []) {
        const label = workspace.title || workspaceLabelOf(workspace.path)
        for (const id of workspace.sessionIds || []) if (!labels.has(id)) labels.set(id, label)
      }
      return labels
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
     * Classify a failed session rename by the host's reason.
     *
     * A rename resumes the session first, so a session recorded with an agent
     * preset this deployment no longer mounts cannot be renamed at all. Naming that
     * case keeps the dialog actionable instead of echoing a transport string.
     * @param {unknown} message - the rejection message.
     * @returns {{kind: 'preset', preset: string}|{kind: 'resume'}|{kind: 'other'}} the reason.
     */
    function explainRenameFailure(message) {
      const text = String(message ?? '')
      const preset = /Unknown agent preset:\s*([^\s"']+)/i.exec(text)
      if (preset !== null) return { kind: 'preset', preset: preset[1] }
      if (/resume failed/i.test(text)) return { kind: 'resume' }
      return { kind: 'other' }
    }

    /**
     * Read the stored takeover choice.
     *
     * Only an explicit `'off'` yields the region; a missing or malformed value
     * means this window keeps the region, which is the shipped behavior.
     * @param {unknown} raw - the stored value.
     * @returns {'on'|'off'} the normalized mode.
     */
    function readTakeover(raw) {
      return raw?.mode === 'off' ? 'off' : 'on'
    }

    /** Default auto-archive policy: off until the operator turns it on. */
    const AUTO_ARCHIVE_INIT = Object.freeze({ days: null })
    /** The longest idle window a reasonable policy would ask for (one year). */
    const AUTO_ARCHIVE_MAX_DAYS = 365
    const DAY_MS = 24 * 60 * 60 * 1000

    /**
     * Read the stored auto-archive policy.
     *
     * Only a positive whole number of days is a policy; anything else (a missing
     * key, a stale shape, `0`, a negative, a float) means "off", so a bad value can
     * never archive more than the operator asked for.
     * @param {unknown} raw - the stored value.
     * @returns {{days: number|null}} the normalized policy.
     */
    function readAutoArchive(raw) {
      const days = raw?.days
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > AUTO_ARCHIVE_MAX_DAYS) {
        return AUTO_ARCHIVE_INIT
      }
      return { days }
    }

    /**
     * Sessions an auto-archive sweep may archive right now.
     *
     * Archive is reversible, so the sweep is allowed to be eager about idle
     * sessions — but it never touches a pinned, archived, current, running or
     * subagent row, because those are either deliberate or not the operator's to
     * file away.
     * @param {object} input - `{ list, archivedSessionIds, pinnedSessionIds, currentId, busy, days, now }`.
     * @returns {string[]} ids to archive, oldest activity first.
     */
    function autoArchiveCandidates(input) {
      const { list, archivedSessionIds, pinnedSessionIds, currentId, busy, days, now } = input
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) return []
      const byId = list?.byId || {}
      const archived = new Set(archivedSessionIds || [])
      const pinned = new Set(pinnedSessionIds || [])
      const running = busy instanceof Set ? busy : new Set(busy || [])
      const cutoff = now - days * DAY_MS
      const candidates = []
      for (const id of list?.ids || []) {
        const row = byId[id]
        if (!row || row.blank === true || row.origin === SUBAGENT_ORIGIN) continue
        if (archived.has(id) || pinned.has(id) || running.has(id) || id === currentId) continue
        if (!Number.isFinite(row.updatedAt) || row.updatedAt >= cutoff) continue
        candidates.push(id)
      }
      return candidates.sort((a, b) => (byId[a].updatedAt ?? 0) - (byId[b].updatedAt ?? 0))
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
     * list uses), then content hits the local pass did not already include. Every
     * whitespace-separated term must appear in the title or the workspace label,
     * so a two-word query narrows instead of widening. Blank placeholders never
     * match, because their canonical title is localized.
     *
     * @param {object} input - `{ list, workspaces, query, items, hasMore, limit, archivedSessionIds, archivedFilter, currentId, labels }`.
     * @returns {{nodes: Array<object>, hasMore: boolean, total: number, truncated: boolean}}
     */
    function buildSearchNodes(input) {
      const terms = searchTerms(input.query)
      if (terms.length === 0) return { nodes: [], hasMore: false, total: 0, truncated: false }
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
        const title = titleOf(row).toLowerCase()
        const label = labelOf(row).toLowerCase()
        if (terms.every(term => title.includes(term) || label.includes(term))) local.push(id)
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
        nodes: shown.map((id) => {
          const row = byId[id]
          const title = titleOf(row)
          return {
            id,
            title,
            workspace: labelOf(row),
            snippet: snippetById.get(id),
            titleMatch: matchRanges(title, terms),
          }
        }),
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
     * Sections, in file order:
     *   1. constants and small helpers (gesture, stores, formatting)
     *   2. copy (zh / en) — every user-visible string lives here
     *   3. styles — one stylesheet, read by the region's style effect
     *   4. view components — row, section, folder, dialogs
     *   5. the region — state, derivations, and the rendered tree
     *   6. the host half — registration, stores, and host-service actions
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
      IconCheckOutlineRegular, IconCheckCircleOutlineRegular,
    } = primitives
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

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
    /* ------------------------------------------------------------------ *
     * Constants and small helpers.
     * ------------------------------------------------------------------ */

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

    /** Namespaced key for the plugin-owned virtual folder data. */
    const FOLDER_KEY = 'dsh-plugin:dsh-session-manager:folders'
    /** Names owned by the built-in views, rejected in both UI languages. */
    const FOLDER_RESERVED_NAMES = Object.freeze(['全部', '未分类', 'All', 'Unfiled'])

    /**
     * The virtual folder data, persisted through the store seat when it is composed.
     *
     * The value is the versioned schema from `core.js` (`FOLDER_INIT` when empty),
     * so `readFolderState` can classify it before any render or write. A host
     * without `dsh-client-store` gets an in-memory store: the UI works for this
     * mount and the default fallback is the same empty state.
     *
     * @param {Function} require - the module loader's resolve function.
     * @returns {object} the versioned folder store.
     */
    function folderStore(require) {
      try {
        const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
        return createSnapshotStore(FOLDER_INIT, { persist: { name: FOLDER_KEY } })
      } catch {
        return observable(FOLDER_INIT)
      }
    }

    /**
     * Whether this window renders the region at all.
     *
     * Persisted through the same store seat as the other plugin-owned state, so the
     * bundle never names a Web Storage API itself. Yielding disposes the slot
     * registration — a null-rendering occupant would still shadow the shipped
     * browser, so disposal is the only real revert.
     */
    const TAKEOVER_KEY = 'dsh-plugin:dsh-session-manager:takeover'

    /**
     * @param {Function} require - the module loader's resolve function.
     * @returns {object} the takeover store (`{ mode: 'on' | 'off' }`).
     */
    function takeoverStore(require) {
      try {
        const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
        return createSnapshotStore({ mode: 'on' }, { persist: { name: TAKEOVER_KEY } })
      } catch {
        return observable({ mode: 'on' })
      }
    }

    /** Namespaced key for the plugin-owned auto-archive policy. */
    const AUTO_ARCHIVE_KEY = 'dsh-plugin:dsh-session-manager:auto-archive'

    /**
     * The auto-archive policy, persisted through the store seat.
     *
     * Off is the shipped value; a policy is a whole number of idle days. The sweep
     * only ever archives (reversible), never deletes, and never touches pinned,
     * running or current sessions.
     * @param {Function} require - the module loader's resolve function.
     * @returns {object} the policy store.
     */
    function autoArchiveStore(require) {
      try {
        const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
        return createSnapshotStore(AUTO_ARCHIVE_INIT, { persist: { name: AUTO_ARCHIVE_KEY } })
      } catch {
        return observable(AUTO_ARCHIVE_INIT)
      }
    }

    /**
     * Generate a stable folder id. The `f-` prefix keeps folder ids distinct from
     * the row-menu action ids (`folder:new`, `folder:none`).
     * @returns {string} a new folder id.
     */
    function newFolderId() {
      try {
        if (typeof globalThis.crypto?.randomUUID === 'function') return `f-${globalThis.crypto.randomUUID()}`
      } catch { /* fall through to the timestamp form */ }
      return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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
    // The sidebar is one scroller reused by four views. Remembering its offset per
    // view keeps a switch (or a takeover round-trip) from throwing the reader back
    // to the top of a long list.
    const scrollMemory = new Map()

    let gestureForwarding = false

    const pointerGesture = {
      kind: null, id: null, accountId: null, order: null, scope: null,
      startX: 0, startY: 0, pointerId: null, active: false, moved: false,
      targetId: null, half: null, targetScope: null, folderId: null,
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
      pointerGesture.scope = extra?.scope ?? null
      pointerGesture.startX = event.clientX
      pointerGesture.startY = event.clientY
      pointerGesture.pointerId = event.pointerId
      pointerGesture.active = false
      pointerGesture.moved = false
      pointerGesture.targetId = null
      pointerGesture.half = null
      pointerGesture.targetScope = null
      pointerGesture.folderId = null
      pointerGesture.published = false
      pointerGesture.edge = 0
      pointerGesture.element = event.currentTarget ?? null
      // Capture keeps the gesture alive while the pointer crosses other elements.
      // A host that refuses or silently loses capture would otherwise deliver the
      // moves to whatever sits under the pointer and the gesture would die without
      // a trace, so the same stream is forwarded to the row element.
      try { event.currentTarget?.setPointerCapture?.(event.pointerId) } catch { /* forwarding covers it */ }
      bindGestureForwarding()
      // A press inside a workspace row must not also start the workspace gesture.
      event.stopPropagation?.()
    }

    /**
     * Forward pointer events to the gesture element when capture did not deliver
     * them (a refused `setPointerCapture`, or a host that drops capture mid-drag).
     * A delivered event targets the element itself, so it is never forwarded twice.
     */
    function bindGestureForwarding() {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
      if (gestureForwarding) return
      gestureForwarding = true
      document.addEventListener('pointermove', forwardGesture, true)
      document.addEventListener('pointerup', forwardGesture, true)
      document.addEventListener('pointercancel', forwardGesture, true)
    }

    /** Stop forwarding once the gesture is over. */
    function unbindGestureForwarding() {
      if (!gestureForwarding) return
      gestureForwarding = false
      document.removeEventListener('pointermove', forwardGesture, true)
      document.removeEventListener('pointerup', forwardGesture, true)
      document.removeEventListener('pointercancel', forwardGesture, true)
    }

    /**
     * Re-dispatch one pointer event on the gesture's own element.
     * @param {object} event - the event seen on the document.
     */
    function forwardGesture(event) {
      if (pointerGesture.kind === null) { unbindGestureForwarding(); return }
      if (event.button !== undefined && event.type === 'pointerup' && event.button !== 0) return
      const element = pointerGesture.element
      if (!element || element === event.target || element.contains?.(event.target)) return
      const clone = new PointerEvent(event.type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.type === 'pointerup' ? 0 : event.button,
        buttons: event.type === 'pointerup' ? 0 : event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
      })
      element.dispatchEvent(clone)
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
        pointerGesture.targetScope = null
        scheduleMark(onMark, null)
        return true
      }
      const rect = hit.getBoundingClientRect()
      const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      const targetScope = hit?.getAttribute?.('data-dsm-scope') ?? null
      if (pointerGesture.targetId !== targetId || pointerGesture.half !== half
        || pointerGesture.targetScope !== targetScope) {
        pointerGesture.targetId = targetId
        pointerGesture.half = half
        pointerGesture.targetScope = targetScope
        scheduleMark(onMark, { id: targetId, half, scope: targetScope })
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
      // frame would otherwise commit nothing. A target that declares a different
      // folder scope is not a legal drop even if the marker was painted before the
      // scope check ran.
      const inScope = pointerGesture.targetScope === null || pointerGesture.targetScope === pointerGesture.scope
      const move = !wasActive || pointerGesture.targetId === null || !inScope ? null : {
        accountId: pointerGesture.accountId,
        order: pointerGesture.order,
        id: pointerGesture.id,
        target: { id: pointerGesture.targetId, half: pointerGesture.half, scope: pointerGesture.targetScope },
      }
      pointerGesture.kind = null
      pointerGesture.active = false
      pointerGesture.moved = wasActive
      pointerGesture.edge = 0
      pointerGesture.element = null
      unbindGestureForwarding()
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
    /* ------------------------------------------------------------------ *
     * Copy — one dictionary per shipped language.
     * ------------------------------------------------------------------ */

    const zh = {
      'section.workspaces': '工作区',
      'attention.show': '需要处理 {n}',
      'attention.exit': '退出「需要处理」',
      'attention.none': '没有等待你处理的会话',
      'section.pinned': '置顶会话',
      'section.ungrouped': '未分组',
      'section.unmarked': '未标记',
      'section.projects': '项目会话',
      'action.newSession': '新建会话',
      'action.addWorkspace': '添加工作区',
      'sessions.expand': '展开其余 {n} 个会话',
      'sessions.collapse': '收起',
      'sessions.loading': '加载中…',
      'search.aria': '会话搜索',
      'search.placeholder': '搜索会话',
      'search.loading': '搜索中…',
      'search.clear': '清除搜索',
      'search.none': '没有匹配的会话',
      'search.more': '结果较多，请细化查询',
      'search.failed': '搜索失败：',
      'search.local': '内容搜索未开启，仅匹配标题与工作区',
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
      'view.autoArchive': '自动归档（可恢复）',
      'view.yield': '回到官方会话区',
      'toggle.yield': '暂停接管，回到官方会话区',
      'toggle.resume': '启用会话管理器',
      'view.autoArchiveOff': '不自动归档',
      'view.autoArchiveDays': '{n} 天未活动',
      'view.autoArchiveDaysCount': '{n} 天未活动（将归档 {count} 个）',
      'notice.autoArchived': '已自动归档 {n} 个会话，可在「只看归档」里恢复',
      'bulk.archive': '归档',
      'bulk.selectMode': '批量选择',
      'bulk.selectModeFull': '批量选择（仅当前工作区）',
      'bulk.moveTo': '移到子目录',
      'bulk.all': '全选本工作区',
      'bulk.exit': '完成',
      'bulk.count': '已选 {n} 个',
      'bulk.scope': '仅当前工作区',
      'notice.filedMany': '已把 {n} 个会话移入「{name}」',
      'notice.archiveBulkFailed': '有 {n} 个会话没能归档（可能在运行或已归档）',
      'notice.filed': '已移入「{name}」',
      'view.options': '视图选项',
      'dialog.renameTitle': '重命名会话',
      'rename.presetGone': '无法重命名：该会话的 Agent 预设「{preset}」已不在当前 profile 中，宿主无法恢复它。请恢复该预设后再试。',
      'rename.resumeFailed': '无法重命名：宿主恢复该会话失败（详情见下方原文）。',
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
      'folders.unfiled': '未分类',
      'folders.new': '新建子目录',
      'folders.rename': '重命名子目录',
      'folders.moveUp': '上移',
      'folders.moveDown': '下移',
      'folders.delete': '删除子目录',
      'folders.moveTo': '移到子目录',
      'folders.none': '未分类',
      'folders.newHere': '新建子目录…',
      'folders.current': '（当前）',
      'folders.nameLabel': '子目录名称',
      'folders.namePlaceholder': '输入名称',
      'folders.createTitle': '新建子目录',
      'folders.renameTitle': '重命名子目录',
      'folders.createHint': '只用于分类，不会在磁盘创建目录。',
      'folders.deleteTitle': '删除子目录',
      'folders.deleteBody': '{name} 中的 {n} 个会话会回到未分类，会话本身不会被删除。',
      'folders.deleteConfirm': '删除',
      'folders.mark': '含需要关注的会话',
      'folders.readonly': '子目录数据来自更新版本，当前只读。',
      'folders.error.empty': '名称不能为空',
      'folders.error.tooLong': '名称过长（最多 40 个字符）',
      'folders.error.invalid': '名称包含不可用字符',
      'folders.error.duplicate': '已有同名子目录',
      'folders.error.reserved': '该名称保留给内置视图',
      'folders.error.max': '每个工作区最多 20 个子目录',
      'folders.error.failed': '子目录操作失败，请重试',
    }

    const en = {
      'section.workspaces': 'Workspaces',
      'attention.show': 'Needs you {n}',
      'attention.exit': 'Leave “needs you”',
      'attention.none': 'Nothing is waiting on you',
      'section.pinned': 'Pinned',
      'section.unmarked': 'Unlabelled',
      'section.ungrouped': 'Ungrouped',
      'section.projects': 'Project sessions',
      'action.newSession': 'New session',
      'action.addWorkspace': 'Add workspace',
      'sessions.expand': 'Show {n} more sessions',
      'sessions.collapse': 'Collapse',
      'sessions.loading': 'Loading…',
      'search.aria': 'Session search',
      'search.placeholder': 'Search sessions',
      'search.loading': 'Searching…',
      'search.clear': 'Clear search',
      'search.none': 'No matching sessions',
      'search.more': 'More results — refine your query',
      'search.failed': 'Search failed: ',
      'search.local': 'Content search is off — matching titles and workspaces only',
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
      'view.autoArchive': 'Auto-archive (reversible)',
      'view.yield': 'Back to the shipped session list',
      'toggle.yield': 'Pause takeover and restore the shipped list',
      'toggle.resume': 'Enable the session manager',
      'view.autoArchiveOff': 'Off',
      'view.autoArchiveDays': 'After {n} idle days',
      'view.autoArchiveDaysCount': 'After {n} idle days ({count} would be archived)',
      'notice.autoArchived': 'Auto-archived {n} sessions — restore them from “Archived only”',
      'bulk.archive': 'Archive',
      'bulk.selectMode': 'Select sessions',
      'bulk.selectModeFull': 'Select sessions (this workspace only)',
      'bulk.moveTo': 'Move to folder',
      'bulk.all': 'Select all here',
      'bulk.exit': 'Done',
      'bulk.count': '{n} selected',
      'bulk.scope': 'This workspace only',
      'notice.filedMany': 'Filed {n} sessions into “{name}”',
      'notice.archiveBulkFailed': '{n} sessions could not be archived (running or already archived)',
      'notice.filed': 'Filed into “{name}”',
      'view.options': 'View options',
      'dialog.renameTitle': 'Rename session',
      'rename.presetGone': 'Cannot rename: this session records agent preset “{preset}”, which this profile no longer mounts, so the host cannot resume it. Restore the preset and try again.',
      'rename.resumeFailed': 'Cannot rename: the host failed to resume this session (details below).',
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
      'folders.unfiled': 'Unfiled',
      'folders.new': 'New subfolder',
      'folders.rename': 'Rename subfolder',
      'folders.moveUp': 'Move up',
      'folders.moveDown': 'Move down',
      'folders.delete': 'Delete subfolder',
      'folders.moveTo': 'Move to subfolder',
      'folders.none': 'Unfiled',
      'folders.newHere': 'New subfolder…',
      'folders.current': '(current)',
      'folders.nameLabel': 'Subfolder name',
      'folders.namePlaceholder': 'Enter a name',
      'folders.createTitle': 'New subfolder',
      'folders.renameTitle': 'Rename subfolder',
      'folders.createHint': 'Only groups sessions; no folder is created on disk.',
      'folders.deleteTitle': 'Delete subfolder',
      'folders.deleteBody': 'The {n} session(s) in {name} will move to Unfiled; the sessions themselves are not deleted.',
      'folders.deleteConfirm': 'Delete',
      'folders.mark': 'Contains sessions needing attention',
      'folders.readonly': 'Folder data comes from a newer version; read-only.',
      'folders.error.empty': 'Name cannot be empty',
      'folders.error.tooLong': 'Name is too long (max 40 characters)',
      'folders.error.invalid': 'Name contains invalid characters',
      'folders.error.duplicate': 'A subfolder with this name already exists',
      'folders.error.reserved': 'This name is reserved for a built-in view',
      'folders.error.max': 'A workspace can have at most 20 subfolders',
      'folders.error.failed': 'Subfolder action failed; try again',
    }

    /**
     * Region styles. The plugin ships no CSS pipeline, so the sheet is one owned
     * `<style>` element removed by the same effect that added it. Every color comes
     * from a shipped `--dsw-alias-*` token, so themes (including third-party ones)
     * apply without the plugin knowing about them.
     */
    /* ------------------------------------------------------------------ *
     * Styles — the region owns its own stylesheet; no host CSS is edited.
     * ------------------------------------------------------------------ */

    const css = `
    /* Typography and metrics follow the shipped browsing rows (ui-workspace
     * Rows.module.css / WorkspaceBrowser.module.css) so the region reads as part
     * of the shell rather than as a plugin: 32px rows, a 16x20 leading cell, a
     * 14px/20px title, a 10px/16px trailing time and the same radius tokens. */
    .dsm-region{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;-webkit-app-region:no-drag}
    .dsm-head{display:flex;align-items:center;gap:2px;flex:none;padding:0 8px;height:36px}
    .dsm-head-label{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary);padding-inline-start:4px}
    .dsm-head-spacer{flex:1}
    .dsm-takeover{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:28px;height:28px;flex:none;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
    .dsm-takeover:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .dsm-takeover:focus-visible{outline:2px solid var(--dsw-alias-focus-ring);outline-offset:-2px}
    .dsm-head-action{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:26px;height:26px;flex:0 0 26px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
    .dsm-head-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .dsm-head-action:focus-visible{outline:2px solid var(--dsw-alias-focus-ring);outline-offset:-2px}
    .dsm-search{display:flex;align-items:center;flex:1;min-width:0}
    .dsm-search-input{box-sizing:border-box;width:100%;min-width:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;outline:none}
    .dsm-body{flex:1;min-height:0;overflow-y:auto;padding:0 8px 8px}
    .dsm-list{display:flex;flex-direction:column;gap:2px}
    .dsm-folder-body{display:flex;flex-direction:column;gap:2px}
    .dsm-folder-count{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
    .dsm-folder-mark{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
    /* Blue already means drag/drop and selection in this region; a folder that
       holds a session waiting on the operator uses the waiting colour. */
    .dsm-folder-mark[data-tone='pending']{background:var(--dsw-alias-state-warn-primary)}
    .dsm-folder-group{margin:1px 0 3px;position:relative}
    .dsm-folder-group[data-dsm-folder-side='before'] .dsm-folder-row{box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary)}
    .dsm-folder-group[data-dsm-folder-side='after'] .dsm-folder-row{box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary)}
    .dsm-folder-group[data-dsm-drop='true'] .dsm-folder-row{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);border-radius:var(--dsw-radius-sm);outline:1px dashed var(--dsw-alias-state-business-primary);outline-offset:-1px}
    .dsm-folder-row{display:flex;align-items:center;height:28px;padding:0 4px}
    .dsm-folder-header{display:flex;align-items:center;flex:1;min-width:0;height:28px;padding:0 8px;padding-inline-start:44px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:20px;font-weight:400;text-align:left;cursor:pointer}
    .dsm-folder-header:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
    .dsm-folder-header:focus-visible{outline:2px solid var(--dsw-alias-focus-ring);outline-offset:-2px}
    .dsm-folder-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsm-folder-row .dsm-folder-count{margin-inline-start:6px}
    .dsm-folder-action{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:24px;height:20px;flex:0 0 24px;margin-right:4px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);opacity:0;cursor:pointer}
    .dsm-folder-row:hover .dsm-folder-action,.dsm-folder-row:focus-within .dsm-folder-action{opacity:1}
    .dsm-folder-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .dsm-dialog-hint{margin:8px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
    .dsm-dialog-body{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
    .dsm-dialog-error{margin:8px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
    .dsm-danger{color:var(--dsw-alias-state-error-primary)}
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
    .dsm-heading-count{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
    .dsm-workspace-action{margin-right:4px}
    .dsm-workspace-action[data-active='true']{opacity:1;color:var(--dsw-alias-state-business-primary)}
    /* Bulk selection is a primary capability of this region: its seat stays
       visible at rest instead of appearing only on hover. */
    .dsm-workspace-select{opacity:.55}
    .dsm-section-row:hover .dsm-workspace-select,.dsm-workspace-select:focus-visible{opacity:1}
    .dsm-section-row{position:sticky;top:0;z-index:2;display:flex;align-items:center;height:32px;background:var(--dsw-specific-sidebar-fill)}
    /* macOS: the sidebar is window vibrancy and the host makes its own fill
     * transparent there, so a themed opaque fill reads as a foreign slab (its
     * comment says as much). Mirror the host's own treatment — a faint wash of the
     * label ink sitting in the glass — and blur the rows that travel underneath. */
    [data-platform='darwin'] .dsm-heading-row,[data-platform='darwin'] .dsm-project-header,[data-platform='darwin'] .dsm-section-row{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
    .dsm-section-row:hover .dsm-workspace-action,.dsm-section-row:focus-within .dsm-workspace-action{opacity:1}
    .dsm-workspace-action{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:24px;height:20px;flex:0 0 24px;margin-right:4px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);opacity:0;cursor:pointer}
    .dsm-workspace-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    /* The first folder has no strip to host its create button, so the workspace
     * header carries a folder-plus seat. It is only rendered while the workspace
     * has no folders; once one exists, the always-visible strip owns creation. */
    .dsm-workspace-folder{position:relative;opacity:1}
    .dsm-workspace-folder .dsm-folder-plus{position:absolute;right:-1px;bottom:0;pointer-events:none;color:var(--dsw-alias-label-tertiary)}
    .dsm-workspace-folder:hover .dsm-folder-plus{color:var(--dsw-alias-label-primary)}
    .dsm-section-header{display:flex;align-items:center;flex:1;min-width:0;height:32px;touch-action:none;padding:0 8px;padding-inline-start:20px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
    .dsm-section-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-section-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:600;margin:0 6px 0 4px}
    .dsm-section-count{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
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
    .dsm-bulk-sep{flex:none;width:1px;height:14px;margin:0 2px;background:var(--dsw-alias-border-l1)}
    .dsm-bulk-secondary{border-color:transparent;color:var(--dsw-alias-label-secondary)}
    .dsm-bulk-secondary:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
    .dsm-bulk-action[data-level="p1"]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
    .dsm-bulk-action[data-level="p4"]{color:var(--dsw-alias-label-secondary)}
    .dsm-bulk-hint{flex:1 0 100%;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary)}
    .dsm-select{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;margin-right:2px;cursor:pointer}
    .dsm-select-box{width:13px;height:13px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
    /* The priority view's entry point is a letter badge rather than one of the
     * shipped glyphs: a bold P in a hairline frame reads as "priority levels" and
     * turns accent-coloured while the view is open. */
    .dsm-pbadge{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:16px;height:16px;border:1px solid currentColor;border-radius:var(--dsw-radius-xs);font-size:10px;line-height:1;font-weight:700;letter-spacing:0}
    .dsm-attn-badge{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;margin-inline-start:2px;padding:0 3px;border-radius:7px;font-size:10px;line-height:15px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-state-business-primary)}
    .dsm-head-action[data-active="true"] .dsm-pbadge{color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
    .dsm-row:has(.dsm-select-box:checked){background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-levels{display:flex;flex-direction:column}
    .dsm-pin{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;margin-left:6px;color:var(--dsw-alias-label-caption)}
    .dsm-row[data-flat="true"]{padding-inline-start:14px}
    .dsm-row[data-stacked="true"]{height:auto;min-height:48px;padding-top:4px;padding-bottom:4px;contain-intrinsic-size:auto 48px}
    .dsm-stack{display:flex;flex-direction:column;justify-content:center;flex:1;min-width:0;margin:0 6px 0 4px}
    .dsm-stack-main{display:flex;align-items:center;gap:4px;min-width:0}
    .dsm-stack-main .dsm-title{flex:1;margin:0}
    .dsm-stack-sub{display:flex;align-items:center;gap:6px;min-width:0;margin-top:1px}
    .dsm-stack-sub .dsm-snippet{max-width:60%}
    .dsm-stack-sub .dsm-workspace{flex:none;max-width:40%}
    .dsm-folder-group .dsm-row{padding-inline-start:48px}
    .dsm-row{content-visibility:auto;contain-intrinsic-size:auto 32px;position:relative;display:flex;align-items:center;box-sizing:border-box;width:100%;height:32px;gap:0;padding:0 8px;padding-inline-start:32px;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;-webkit-user-drag:none;touch-action:none}
    .dsm-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-row[data-current="true"]{background:var(--dsw-alias-interactive-bg-hover)}
    .dsm-row[data-archived="true"]{opacity:.6}
    /* In the archived-only view every row is archived: dimming them all reads as
       a disabled list rather than as a state marker. */
    .dsm-body[data-filter="only"] .dsm-row[data-archived="true"]{opacity:1}
    .dsm-row[data-dragging="true"]{opacity:.45}
    .dsm-row[data-drop="before"]{box-shadow:inset 0 2px 0 0 var(--dsw-alias-state-business-primary)}
    .dsm-row[data-drop="after"]{box-shadow:inset 0 -2px 0 0 var(--dsw-alias-state-business-primary)}
    .dsm-dot-slot{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:20px}
    /* The painted dot is 10px inside a 16x20 cell; the overlay grows the hover /
       click target to the full row height without moving a single pixel of layout. */
    .dsm-dot-slot{position:relative}
    .dsm-dot-slot::after{content:'';position:absolute;inset:-6px -2px}
    /* Running must read as active at row scale. The shipped StateDot paints the
       ongoing spinner in label-tertiary, which collapses into the neutral idle step
       sitting in the same column; tint the shipped glyph with the accent this region
       already uses for selection and drop targets. Strokes (svg) and borders (harness
       stub) both ride currentColor, so one declaration carries to either renderer;
       idle keeps the theme's own neutral step untouched. */
    /* The running ring has to announce itself at a glance: the shipped default is a
       14px hairline in tertiary grey. Everything here rides currentColor (the tint
       above), so it stays one accent: a 16px box, a heavier stroke, a brighter track,
       a faint halo, and a slightly faster cycle (both host animations share one
       duration, so they stay in step). */
    .dsm-dot-slot [data-state='ongoing']{color:var(--dsw-alias-state-business-primary);filter:drop-shadow(0 0 2px color-mix(in srgb,currentColor 60%,transparent))}
    .dsm-dot-slot svg[data-state='ongoing']{width:16px;height:16px}
    .dsm-dot-slot svg[data-state='ongoing'] circle{stroke-width:2.5}
    .dsm-dot-slot svg[data-state='ongoing'] circle:first-of-type{opacity:.4}
    .dsm-dot-slot svg[data-state='ongoing'] *{animation-duration:1.15s}
    .dsm-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font-size:14px;line-height:20px;margin:0 6px 0 4px}
    .dsm-hit{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent);border-radius:2px;color:inherit;font-weight:600}
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
    .dsm-notice{margin:8px;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
    .dsm-notice[data-tone='warn']{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary)}
    .dsm-notice[data-tone='success']{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}
    .dsm-rename-form{display:grid;gap:12px}
    .dsm-dialog-detail{margin-top:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);word-break:break-word}
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
    /**
     * One minute clock shared by every time cell.
     *
     * The region used to hold `now` in state, so one minute tick re-rendered the
     * whole tree; subscribing per cell keeps the tick local to the labels that show
     * it. The interval exists only while some cell is mounted.
     */
    const clock = (() => {
      let now = Date.now()
      let timer = null
      const listeners = new Set()
      const tick = () => { now = Date.now(); for (const listener of listeners) listener() }
      return {
        getSnapshot: () => now,
        subscribe(listener) {
          listeners.add(listener)
          if (timer === null) timer = window.setInterval(tick, 60_000)
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0 && timer !== null) { window.clearInterval(timer); timer = null }
          }
        },
      }
    })()

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
    /* ------------------------------------------------------------------ *
     * View components.
     * ------------------------------------------------------------------ */

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
      // Resting rows paint no glyph at all. The shipped neutral idle dot read as
      // "status unknown" beside a live spinner, and at 32px row height the two greys
      // were the same shape; a quiet row is better said by the empty cell than by a
      // dot that means nothing is happening. The 16x20 cell stays so every title keeps
      // the same left edge, and the state still reaches screen readers through the
      // hidden text and hover title.
      const resting = plan.primary === 'idle'
      return h('span', {
        className: 'dsm-dot-slot',
        title: description,
        'data-dot': resting ? 'none' : plan.primary,
      },
        resting ? null : h(StateDot, { state: plan.primary, size: plan.primary === 'ongoing' ? 16 : undefined }),
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
    function TimeCell({ status, updatedAt, t }) {
      const now = useSyncExternalStore(clock.subscribe, clock.getSnapshot)
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
     * The row's hover text: the full title, where the session lives, and its
     * directory. Titles truncate in a 32px row, so the tooltip is often the only
     * place the whole label is readable.
     * @param {string} title - the row title.
     * @param {string|undefined} workspaceLabel - the owning workspace, when known.
     * @param {object|undefined} summary - the session summary.
     * @returns {string} a multi-line tooltip.
     */
    function hoverTitle(title, workspaceLabel, summary) {
      const lines = [title]
      if (workspaceLabel) lines.push(workspaceLabel)
      if (summary?.cwd) lines.push(summary.cwd)
      return lines.join('\n')
    }

    /**
     * Split a title into plain and highlighted parts for the search rows.
     *
     * `matchRanges` returns merged `[start, end)` offsets over the same string the
     * row renders, so the split is byte-for-byte the title text rather than a
     * normalized copy that would shift offsets.
     * @param {string} title - the row's title.
     * @param {Array<[number, number]>|undefined} ranges - ranges to mark.
     * @returns {Array<string|object>} text and `<mark>` nodes in order.
     */
    function titleParts(title, ranges) {
      if (!Array.isArray(ranges) || ranges.length === 0) return [title]
      const parts = []
      let cursor = 0
      for (const [start, end] of ranges) {
        if (start > cursor) parts.push(title.slice(cursor, start))
        parts.push(h('mark', { className: 'dsm-hit', key: `hit-${start}-${end}` }, title.slice(start, end)))
        cursor = end
      }
      if (cursor < title.length) parts.push(title.slice(cursor))
      return parts
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
      t, dragging = false, dropHalf = null, onDragStart, onDragOverRow, onDragEnd, onOpen, onSelectAction, onMove,
      workspaceLabel, snippet, titleMatch, canReorder = false, priority, flat = false,
      pinnedSection = false, selectable = false, selected = false, onToggleSelect, toggleLabel,
      groupedByPriority = false, folderOptions, scope, onFolderOver, onAssignFolder, bulkMulti = false,
      stacked = false,
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
        ]
        if (folderOptions !== undefined) {
          const check = h(IconCheckOutlineRegular, { size: 14 })
          const submenu = []
          if (folderOptions.readonly) {
            submenu.push({ id: 'folder:readonly', label: t('folders.readonly'), disabled: true })
          } else {
            if (folderOptions.folders.length > 0) {
              submenu.push({
                id: 'folder:none',
                label: t('folders.none'),
                icon: folderOptions.current === null ? check : undefined,
              })
              for (const folder of folderOptions.folders) {
                const current = folder.id === folderOptions.current
                submenu.push({
                  id: `folder:${folder.id}`,
                  label: current
                    ? h('span', null, folder.name, h('span', { className: 'dsm-visually-hidden' }, t('folders.current')))
                    : folder.name,
                  icon: current ? check : undefined,
                })
              }
              submenu.push({ type: 'separator', id: 'sep-folder-new' })
            }
            submenu.push({ id: 'folder:new', label: t('folders.newHere'), disabled: !folderOptions.canCreate })
          }
          items.push(
            { type: 'separator', id: 'sep-folder' },
            { id: 'folder', label: t('folders.moveTo'), submenu },
          )
        }
        items.push(
          { type: 'separator', id: 'sep-move' },
          { id: 'moveUp', label: t('menu.moveUp') },
          { id: 'moveDown', label: t('menu.moveDown') },
          { type: 'separator', id: 'sep-copy' },
          { id: 'copyId', label: t('menu.copyId') },
        )
        if (summary?.cwd) items.push({ id: 'copyCwd', label: t('menu.copyCwd') })
        items.push({ type: 'separator', id: 'sep-priority' })
        items.push({ type: 'label', id: 'priority-label', text: t('menu.priority') })
        for (const level of PRIORITY) {
          items.push({ id: `priority:${level}`, label: t(`priority.${level}`) })
        }
        items.push({ id: 'priority:none', label: t('priority.none') })
        return items
      }, [archived, folderOptions, pinned, summary?.cwd, t])

      const title = String(summary?.displayTitle || summary?.title || sessionId)
      const drop = dropHalf
      const titleNode = h('span', { className: 'dsm-title', title: hoverTitle(title, workspaceLabel, summary) }, ...titleParts(title, titleMatch))
      const workspaceNode = workspaceLabel === undefined ? null : h('span', { className: 'dsm-workspace' }, workspaceLabel)
      const snippetNode = snippet === undefined || snippet === '' ? null : h('span', { className: 'dsm-snippet', title: snippet }, snippet)
      const pinnedNode = pinned && !archived && !pinnedSection
        ? h('span', { className: 'dsm-pin', role: 'img', 'aria-label': t('mark.pinned'), title: t('mark.pinned') },
          h(IconPinFillRegular, { size: 14 }))
        : null
      const priorityNode = priority === undefined || groupedByPriority ? null : h('span', {
        className: 'dsm-priority',
        title: t(`priority.${priority}`),
        'data-level': priority,
      }, priority.toUpperCase())
      const hasSub = workspaceNode !== null || snippetNode !== null
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
        'data-dragging': String(dragging),
        'data-drop': drop || undefined,
        'data-dsm-session': sessionId,
        'data-dsm-scope': scope,
        // A row directly under a heading is a top-level item, not a nested one: it
        // keeps the heading's own shallow column instead of the project indent.
        'data-flat': flat ? 'true' : undefined,
        // Search results stack the title over its provenance: a 32px line cannot
        // hold title + workspace + snippet without shrink-to-nothing titles.
        'data-stacked': stacked ? 'true' : undefined,
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
          gestureDown('session', sessionId, event, { accountId, order: accountOrder, scope })
        } : undefined,
        onPointerMove: canReorder ? (event) => {
          // A session never leaves its workspace account, so a row in another one is
          // not a target at all: no marker, and nothing to commit.
          if (pointerGesture.accountId !== accountId) return
          const active = gestureMove('session', event, 'data-dsm-session', (mark) => {
            if (mark !== null && mark.scope !== pointerGesture.scope) {
              onDragOverRow(null)
              return
            }
            onDragOverRow(mark === null ? null : { sessionId: mark.id, half: mark.half })
          })
          // One publication per gesture: the latch lives on the gesture, so a burst
          // of moves cannot each queue the same state write.
          if (active && pointerGesture.published !== true) {
            pointerGesture.published = true
            onDragStart({ sessionId, accountId })
          }
          // A folder header is a second kind of drop target: the row under the
          // pointer wins when there is one, otherwise the folder group it sits in.
          if (onFolderOver !== undefined) {
            const hit = elementUnder(event, 'data-dsm-folder-id')
            const folderId = hit?.getAttribute?.('data-dsm-folder-id') ?? null
            if (pointerGesture.folderId !== folderId) {
              pointerGesture.folderId = folderId
              onFolderOver(folderId)
            }
          }
        } : undefined,
        onPointerUp: canReorder ? (event) => {
          let folderId = pointerGesture.folderId
          const active = pointerGesture.active
          const hasRowTarget = pointerGesture.targetId !== null
          // A fast flick can release on a folder without a move event that marked
          // it; the release point decides, not the last published marker.
          if (folderId === null && onAssignFolder !== undefined && event !== undefined) {
            const hit = elementUnder(event, 'data-dsm-folder-id')
            if (hit?.getAttribute?.('data-dsm-folder-ws') === accountId) {
              folderId = hit.getAttribute('data-dsm-folder-id')
            }
          }
          pointerGesture.folderId = null
          onFolderOver?.(null)
          // Filing into a folder is a drop on the folder, not a reorder: only when
          // the pointer never marked a row, so the two gestures cannot fight.
          // A multi-selection files as a whole, so a row target cannot veto it.
          if (active && (bulkMulti || !hasRowTarget) && folderId !== null && onAssignFolder !== undefined) {
            pointerGesture.kind = null
            pointerGesture.active = false
            pointerGesture.moved = true
            pointerGesture.element = null
            unbindGestureForwarding()
            flushMark()
            // The drag is over: clearing it through the same end-of-gesture path as
            // a reorder, or the row keeps its `data-dragging` half-opacity and the
            // filed row reads as a different colour.
            onDragEnd(null)
            onAssignFolder(folderId)
            return
          }
          gestureUp('session', onDragEnd)
        } : undefined,
        onPointerCancel: canReorder ? () => {
          pointerGesture.folderId = null
          onFolderOver?.(null)
          gestureUp('session', onDragEnd)
        } : undefined,
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
      // No "unread" chip: the native row says it with the done dot and a heavier
      // title, and a second badge beside the title only competes with the priority
      // pill for the same strip of width.
      // The badge marks a pinned session among unpinned ones. Inside the pinned
      // block every row is pinned, so it would only eat the title's width.
      // The label sits opposite the status dot as text, so the two can never be
      // confused: a coloured round dot is always status, a digit pill is priority.
      // In the priority view the level is the section heading, so repeating it on
      // every row would only cost the title its width.
      ...(stacked
        ? [h('span', { className: 'dsm-stack' },
          h('span', { className: 'dsm-stack-main' }, titleNode, pinnedNode, priorityNode),
          hasSub ? h('span', { className: 'dsm-stack-sub' }, snippetNode, workspaceNode) : null)]
        : [titleNode, workspaceNode, snippetNode, pinnedNode, priorityNode]),
      h(TimeCell, { status, updatedAt: summary?.updatedAt, t }),
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

    // Rows are pure views over stable props: memoising them means a drop marker or a
    // status tick only re-renders the rows whose own props changed.
    const SessionRowCell = React.memo(SessionRow)

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
        onStart, onNewFolder, newFolderLabel, onSelectMode, selectLabel, selectActive = false,
        drop, dragging,
        onDragStart, onDragOver, onDragEnd,
        pageLimit, pageRequired, pageExpanded, onShowMore, onCollapsePage, expandLabel, collapseLabel,
        folder, heading = false, body,

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
        onNewFolder === undefined ? null : h('button', {
          type: 'button',
          className: 'dsm-workspace-action dsm-workspace-folder',
          title: newFolderLabel,
          'aria-label': newFolderLabel,
          onClick: (event) => { event.stopPropagation(); onNewFolder(sectionKey) },
        }, h(IconFolderCloseRegular, { size: 14 }), h(IconPlusOutlineRegular, { size: 8, className: 'dsm-folder-plus' })),
        onStart === undefined ? null : h('button', {
          type: 'button',
          className: 'dsm-workspace-action',
          title: props.startLabel,
          'aria-label': props.startLabel,
          onClick: (event) => { event.stopPropagation(); onStart(sectionKey) },
        }, h(IconPlusOutlineRegular, { size: 14 })),
        onSelectMode === undefined ? null : h('button', {
          type: 'button',
          className: 'dsm-workspace-action dsm-workspace-select',
          title: selectLabel,
          'aria-label': selectLabel,
          'aria-pressed': String(selectActive),
          'data-active': selectActive ? 'true' : undefined,
          // The same seat turns the mode off: a mode whose only exit is a bar that
          // scrolls with the list is a trap.
          onClick: (event) => { event.stopPropagation(); onSelectMode(sectionKey) },
        }, selectActive
          ? h(IconCloseFillRegular, { size: 12 })
          : h(IconCheckCircleOutlineRegular, { size: 14 }))),
      expanded ? h('div', { className: body === undefined ? 'dsm-list' : 'dsm-folder-body' },
        body === undefined ? page.visible.map(renderRow) : body) : null,
      expanded && body === undefined && showPageControl ? h('button', {
        type: 'button',
        className: 'dsm-overflow',
        'aria-expanded': String(!overflowing),
        onClick: () => { if (overflowing) onShowMore(); else onCollapsePage() },
      }, overflowing ? expandLabel(page.hiddenCount) : collapseLabel) : null,
      )
    }

    /**
     * One folder section: a collapsible group inside a workspace.
     *
     * It deliberately does not reuse `Section`: that component marks its wrapper
     * with `data-dsm-group` (the workspace drag target) and its header is sticky.
     * A nested folder header must be neither.
     *
     * @param {object} props - section data, paging and handlers.
     * @returns {object} the folder block.
     */
    function FolderSection(props) {
      const {
        section, header = true, expanded, onToggle, menu, marked = false, pending = false, renderRow, folderHover = false,
        workspaceId, reorderHandlers, reorderHint,
        pageLimit, pageRequired, pageExpanded, onShowMore, onCollapsePage, expandLabel, collapseLabel, t,
      } = props
      const page = pageRows(section.sessions, pageLimit === undefined ? section.sessions.length : pageLimit, pageRequired ?? 0)
      const overflowing = page.hiddenCount > 0
      const showPage = expanded && (overflowing || pageExpanded === true)
      return h('div', {
        className: 'dsm-folder-group',
        'data-dsm-folder': section.key,
        'data-dsm-folder-id': section.id,
        'data-dsm-folder-ws': workspaceId,
        'data-dsm-drop': folderHover ? 'true' : undefined,
        'data-dsm-folder-side': reorderHint === null || reorderHint === undefined ? undefined : reorderHint,
      },
        header ? h('div', { className: 'dsm-folder-row', ...(reorderHandlers ?? {}) },
          h('button', {
            type: 'button',
            className: 'dsm-folder-header',
            'aria-expanded': String(expanded),
            onClick: () => onToggle(section.key),
          },
          h('span', { className: 'dsm-chevron', 'aria-hidden': 'true' },
            expanded ? h(IconChevronDownOutlineRegular, { size: 10 }) : h(IconChevronRightOutlineRegular, { size: 10 })),
          h('span', { className: 'dsm-folder-label' }, section.kind === 'unfiled' ? t('folders.unfiled') : section.name),
          marked ? h('span', {
            className: 'dsm-folder-mark',
            role: 'img',
            'data-tone': pending ? 'pending' : undefined,
            'aria-label': t('folders.mark'),
            title: t('folders.mark'),
          }) : null,
          h('span', { className: 'dsm-folder-count' }, String(section.sessions.length)),
          ),
          menu ?? null,
        ) : null,
        expanded ? h('div', { className: 'dsm-list' },
          page.visible.map(renderRow),
        ) : null,
        showPage ? h('button', {
          type: 'button',
          className: 'dsm-overflow',
          'aria-expanded': String(!overflowing),
          onClick: () => { if (overflowing) onShowMore(); else onCollapsePage() },
        }, overflowing ? expandLabel(page.hiddenCount) : collapseLabel) : null,
      )
    }

    /**
     * The per-folder actions menu.
     * @param {object} props - position, action handler and copy.
     * @returns {object} the controlled menu.
     */
    function FolderMenu({ index, total, onSelect, t }) {
      const [open, setOpen] = useState(false)
      return h(Menu, {
        open,
        anchor: h('button', {
          type: 'button',
          className: 'dsm-folder-action',
          title: t('menu.label'),
          'aria-label': t('menu.label'),
          'aria-haspopup': 'menu',
          onClick: (event) => { event.stopPropagation(); setOpen(value => !value) },
        }, h(IconEllipsisOutlineRegular, { size: 14 })),
        items: [
          { id: 'rename', label: t('folders.rename') },
          { id: 'up', label: t('folders.moveUp'), disabled: index <= 0 },
          { id: 'down', label: t('folders.moveDown'), disabled: index >= total - 1 },
          { type: 'separator', id: 'sep-folder-actions' },
          { id: 'delete', label: t('folders.delete'), danger: true },
        ],
        onSelect: (id) => { setOpen(false); onSelect(id) },
        onClose: () => setOpen(false),
        align: 'end',
        dense: true,
        portal: true,
      })
    }

    /**
     * Create / rename / delete dialog for one folder.
     *
     * Validation is local (the same `folderNameError` the store uses), so an
     * invalid name never reaches a store write. `onSubmit` returns false to keep
     * the dialog open when the store refused the change (for example a full
     * workspace or a read-only snapshot).
     *
     * @param {object} props - request, sibling folders, submit and copy.
     * @returns {object|null} the dialog while a request is pending.
     */
    function FolderDialog({ request, folders, reserved, onSubmit, onCancel, t }) {
      const [value, setValue] = useState('')
      const [error, setError] = useState(undefined)
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        setValue(request?.name ?? '')
        setError(undefined)
        setBusy(false)
      }, [request])
      if (!request) return null

      if (request.mode === 'delete') {
        return h(Modal, {
          open: true,
          onClose: onCancel,
          title: t('folders.deleteTitle'),
          closeLabel: t('dialog.close'),
        },
        h('div', { className: 'dsm-dialog-body' },
          t('folders.deleteBody', { name: request.name ?? '', n: request.count ?? 0 })),
        h('div', { className: 'dsm-dialog-actions' },
          h('button', { type: 'button', onClick: onCancel }, t('dialog.cancel')),
          h('button', {
            type: 'button',
            className: 'dsm-danger',
            onClick: () => { if (!busy) { setBusy(true); onSubmit(request) } },
          }, t('folders.deleteConfirm'))),
        )
      }

      const submit = () => {
        if (busy) return
        if (request.mode === 'rename' && value.trim() === request.name) {
          onCancel()
          return
        }
        const code = folderNameError(value, folders, { reserved, exceptId: request.folderId })
        if (code !== undefined) { setError(code); return }
        if (request.mode === 'create' && folders.length >= FOLDER_MAX_PER_WORKSPACE) {
          setError('max')
          return
        }
        setBusy(true)
        const ok = onSubmit(request, value.trim())
        if (ok === false) {
          setBusy(false)
          setError('failed')
        }
      }

      return h(Modal, {
        open: true,
        onClose: onCancel,
        title: request.mode === 'rename' ? t('folders.renameTitle') : t('folders.createTitle'),
        closeLabel: t('dialog.close'),
      },
      h('form', {
        className: 'dsm-rename-form',
        onSubmit: (event) => { event.preventDefault(); submit() },
      },
      h('label', null, t('folders.nameLabel'),
        h('input', {
          className: 'dsm-rename-input',
          value,
          autoFocus: true,
          required: true,
          placeholder: t('folders.namePlaceholder'),
          onChange: (event) => { setValue(event.target.value); setError(undefined) },
        })),
      request.mode === 'create' ? h('p', { className: 'dsm-dialog-hint' }, t('folders.createHint')) : null,
      error === undefined ? null : h('div', { className: 'dsm-dialog-error', role: 'alert' }, t(`folders.error.${error}`)),
      h('div', { className: 'dsm-dialog-actions' },
        h('button', { type: 'button', onClick: onCancel }, t('dialog.cancel')),
        h('button', { type: 'submit', disabled: busy }, t('dialog.save'))),
      ))
    }

    /**
     * The sidebar foot action that hands the region back, or takes it again.
     *
     * It lives in a different slot from the region on purpose: while the region is
     * yielded its registration is disposed, so this is the only way back without a
     * reload.
     * @param {object} props - owner share, injected takeover store and copy.
     * @returns {object} the toggle.
     */
    function TakeoverFooterAction({ takeover, setTakeover, t }) {
      const snapshot = useSyncExternalStore(takeover.subscribe, takeover.getSnapshot)
      const active = readTakeover(snapshot) === 'on'
      const label = active ? t('toggle.yield') : t('toggle.resume')
      return h('button', {
        type: 'button',
        className: 'dsm-takeover',
        title: label,
        'aria-label': label,
        'aria-pressed': String(active),
        onClick: () => setTakeover(!active),
      }, h(active ? IconPauseOutlineRegular : IconPlayOutlineRegular, { size: 16 }))
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
    /* ------------------------------------------------------------------ *
     * The region: state, derivations, and the rendered tree.
     * ------------------------------------------------------------------ */

    function SessionManagerRegion(props) {
      const {
        wide, expandSidebar, useSessions, useWorkspaces, useSessionStatus, useJobs, t,
        open, startSession, pinSession, unpinSession, archiveSession, unarchiveSession,
        renameSession, forkSession, insertSessionBefore, insertWorkspaceBefore, copyText,
        pickDirectory, createWorkspace, searchSessions, searchResultLimit, useNotice, clearNotice,
        setPriority, setPriorities, priorityStore, folderStore, folderActions, watchRows,
        autoArchiveStore, setAutoArchive, archiveMany, setTakeover, reportNotice,
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
      const autoArchiveSnapshot = useSyncExternalStore(autoArchiveStore.subscribe, autoArchiveStore.getSnapshot)
      const autoArchiveRead = useMemo(() => readAutoArchive(autoArchiveSnapshot), [autoArchiveSnapshot])
      const folderSnapshot = useSyncExternalStore(folderStore.subscribe, folderStore.getSnapshot)
      const folderRead = useMemo(() => readFolderState(folderSnapshot), [folderSnapshot])
      const folderReadonly = folderRead.mode === 'readonly'
      // Component-level failures are reported through the same notice channel the
      // injected actions use, so a rejected pick/create is never silent.
      const reportFailure = props.reportFailure ?? (() => {})
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
      // The attention view is a flat “what is waiting on me” list: waiting for
      // input or finished-but-unread, most recently active first.
      const [attentionOnly, setAttentionOnly] = useState(false)
      // Bulk selection is scoped to one workspace: a transfer target is a folder
      // of that workspace, so selecting across workspaces could not name one.
      const [bulk, setBulk] = useState(null)
      const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
      const [selected, setSelected] = useState(() => new Set())
      const [levelCollapsed, setLevelCollapsed] = useState(() => ({}))
      const [collapsed, setCollapsed] = useState({})
      const [folderCollapsed, setFolderCollapsed] = useState({})
      // The folder currently under a dragged row, painted as a drop target.
      const [folderDrop, setFolderDrop] = useState(null)
      // The folder a drag would reorder against (painted as a before/after rule).
      const [folderHint, setFolderHint] = useState(null)
      const [folderDialog, setFolderDialog] = useState(null)
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

      // One status object per session per (rollup, statuses) generation. Rows are
      // memoised and the region reads status in several derivations, so the identity
      // has to be stable across renders that changed neither input.
      const statusCache = useMemo(() => {
        const cache = new Map()
        for (const id of list?.ids || []) cache.set(id, statusOf(id, { rollup, statusSnapshot: statuses }))
        return cache
      }, [list, rollup, statuses])
      const statusOfId = useCallback(
        (id) => statusCache.get(id) ?? statusOf(id, { rollup, statusSnapshot: statuses }),
        [rollup, statusCache, statuses],
      )

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

      const workspaceOf = useMemo(() => workspaceOfSession(workspaces), [workspaces])
      const workspaceMembers = useMemo(
        () => new Map(workspaces.map(workspace => [workspace.workspaceId, workspace.sessionIds || []])),
        [workspaces],
      )
      const workspaceReady = workspaceState?.phase === 'ready'
      const folderEntries = useMemo(() => {
        const entries = new Map()
        for (const workspace of workspaces) entries.set(workspace.workspaceId, foldersOf(folderRead.state, workspace.workspaceId))
        return entries
      }, [workspaces, folderRead.state])
      const folderViews = useMemo(
        () => folderReadonly
          ? {}
          : buildFolderViews({ groups: tree.groups, state: folderRead.state }),
        [folderReadonly, tree, folderRead.state],
      )

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

      // Content search is a deployment capability, not a per-keystroke gamble: the
      // base bundle mounts the index with `openAt: 'never'`, where every call
      // rejects. Once that rejection is seen the region stops asking and keeps
      // matching titles and workspace names locally, so no error paints over them.
      const [contentSearchOff, setContentSearchOff] = useState(false)

      // One superseded request per keystroke: the previous controller is aborted
      // before the next timer fires, and a blank query never reaches the host.
      useEffect(() => {
        const clean = sanitizeQuery(query)
        if (clean.trim() === '') {
          setSearch({ phase: 'idle', items: [], hasMore: false })
          return undefined
        }
        if (contentSearchOff) {
          setSearch({ phase: 'local', items: [], hasMore: false })
          return undefined
        }
        const controller = new AbortController()
        const timer = window.setTimeout(() => {
          setSearch(current => ({ ...current, phase: 'loading' }))
          Promise.resolve(searchSessions(clean, controller.signal))
            .then(result => setSearch({ phase: 'ready', items: result?.items ?? [], hasMore: result?.hasMore === true }))
            .catch(error => {
              if (controller.signal.aborted) return
              if (contentSearchDisabled(error)) {
                setContentSearchOff(true)
                setSearch({ phase: 'local', items: [], hasMore: false })
                return
              }
              setSearch({ phase: 'error', items: [], hasMore: false, message: String(error?.message ?? error) })
            })
        }, SEARCH_DEBOUNCE_MS)
        return () => { window.clearTimeout(timer); controller.abort() }
      }, [contentSearchOff, query, searchSessions])

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
            if (statusOfId(id).dot !== DOT.IDLE) busy.add(id)
          }
        }
        for (const id of tree.pinned) {
          if (statusOfId(id).dot !== DOT.IDLE) busy.add(id)
        }
        return busy
      }, [tree, rollup, statuses])

      // “Needs you” is the two states a person has to act on. Running work has a
      // dot of its own but is not a request for the operator, so it stays out.
      const needsAttention = useMemo(() => {
        const ids = []
        for (const id of [...tree.pinned, ...tree.groups.flatMap(group => group.sessions)]) {
          const dot = statusOfId(id).dot
          if (dot === DOT.PENDING || dot === DOT.UNREAD) ids.push(id)
        }
        return orderByRecency([...new Set(ids)], list.byId)
      }, [tree, rollup, statuses, list.byId])

      const workspaceLabelBySession = useMemo(() => workspaceLabels(workspaces), [workspaces])

      // Running work is never a sweep candidate; every other dot is fair game once
      // the idle window has passed.
      const runningSessions = useMemo(() => {
        const running = new Set()
        for (const id of list?.ids || []) {
          if (statusOfId(id).dot === DOT.RUNNING) running.add(id)
        }
        return running
      }, [list, rollup, statuses])

      const autoLabel = (days) => {
        const count = autoArchiveCounts[days] ?? 0
        return count > 0
          ? t('view.autoArchiveDaysCount', { n: days, count })
          : t('view.autoArchiveDays', { n: days })
      }
      // The menu says what a policy would do before it does it: an auto-archive
      // that quietly removes rows is the one destructive-feeling action here.
      const autoArchiveCounts = useMemo(() => {
        const counts = {}
        for (const days of [7, 30, 90]) {
          counts[days] = autoArchiveCandidates({
            list,
            archivedSessionIds: workspaceState?.archivedSessionIds || [],
            pinnedSessionIds: workspaceState?.pinnedSessionIds || [],
            currentId,
            busy: runningSessions,
            days,
            now: Date.now(),
          }).length
        }
        return counts
      }, [list, workspaceState, currentId, runningSessions])

      // The sweep reads live state through a ref: a policy change must not fire once
      // per list update, and a sweep must never act on a stale snapshot.
      // The injected actions object is rebuilt by the registration whenever it
      // re-renders, so the sweep keeps the latest one in a ref: only a policy
      // change should arm or disarm the timer.
      const archiveManyRef = useRef(archiveMany)
      archiveManyRef.current = archiveMany
      const sweepState = useRef({})
      sweepState.current = {
        list,
        archivedSessionIds: workspaceState?.archivedSessionIds || [],
        pinnedSessionIds: workspaceState?.pinnedSessionIds || [],
        currentId,
        busy: runningSessions,
      }
      useEffect(() => {
        if (autoArchiveRead.days === null) return undefined
        let cancelled = false
        const tick = () => {
          const current = sweepState.current
          const ids = autoArchiveCandidates({ ...current, days: autoArchiveRead.days, now: Date.now() })
          if (ids.length === 0) return
          Promise.resolve(archiveManyRef.current(ids)).then((result) => {
            if (cancelled || !result) return
            if (result.archived > 0) {
              reportNotice?.(t('notice.autoArchived', { n: result.archived }))
            }
            if (result.failed > 0) {
              reportFailure(new Error(t('notice.archiveBulkFailed', { n: result.failed })))
            }
          }).catch(reportFailure)
        }
        tick()
        const timer = window.setInterval(tick, 15 * 60 * 1000)
        return () => { cancelled = true; window.clearInterval(timer) }
      }, [autoArchiveRead.days])

      // Per-folder paging. The same derivation the workspace block uses, keyed by
      // the folder section key so a folder's page never collides with a workspace's.
      const folderPageProps = (key, sessions) => {
        const required = requiredPageLimit(sessions, attention, currentId)
        const stored = pages[key] ?? SESSION_PAGE_BASE
        const limit = Math.max(stored, required)
        return {
          pageLimit: limit,
          pageRequired: required,
          pageExpanded: stored > SESSION_PAGE_BASE,
          onShowMore: () => setPages((state) => {
            const nextRequired = requiredPageLimit(sessions, attention, currentId)
            const effective = Math.max(state[key] ?? SESSION_PAGE_BASE, nextRequired)
            const hidden = sessions.length - pageRows(sessions, effective, nextRequired).visible.length
            return { ...state, [key]: nextPageLimit(effective, hidden) }
          }),
          onCollapsePage: () => setPages(state => ({ ...state, [key]: SESSION_PAGE_BASE })),
        }
      }

      const folderMenuAction = useCallback((workspaceId, section, action) => {
        if (action === 'rename') {
          setFolderDialog({ mode: 'rename', workspaceId, folderId: section.id, name: section.name })
          return
        }
        if (action === 'delete') {
          const entry = folderEntries.get(workspaceId)
          const count = Object.values(entry?.assign ?? {}).filter(folderId => folderId === section.id).length
          setFolderDialog({ mode: 'delete', workspaceId, folderId: section.id, name: section.name, count })
          return
        }
        if (action === 'up' || action === 'down') folderActions.move(workspaceId, section.id, action)
      }, [folderActions, folderEntries])

      const openCreateFolder = (workspaceId) => {
        if (typeof workspaceId !== 'string' || workspaceId === '') return
        setFolderDialog({ mode: 'create', workspaceId, name: '' })
      }

      const submitFolderDialog = useCallback((request, name) => {
        const workspaceId = request.workspaceId
        const options = { memberIds: workspaceMembers.get(workspaceId), ready: workspaceReady }
        if (request.mode === 'create') {
          const id = folderActions.create(workspaceId, name, { ...options, sessionId: request.sessionId })
          if (id === undefined) return false
        } else if (request.mode === 'rename') {
          if (folderActions.rename(workspaceId, request.folderId, name) === false) return false
        } else if (request.mode === 'delete') {
          folderActions.remove(workspaceId, request.folderId)
        }
        setFolderDialog(null)
        return true
      }, [folderActions, setFolderDialog, workspaceMembers, workspaceReady])

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
        if (action.startsWith('folder:')) {
          const workspaceId = workspaceOf.get(sessionId)
          if (!workspaceId) return
          const target = action.slice('folder:'.length)
          if (target === 'readonly') return
          if (target === 'new') {
            const entry = folderEntries.get(workspaceId)
            if (folderReadonly || (entry?.folders.length ?? 0) >= FOLDER_MAX_PER_WORKSPACE) return
            setFolderDialog({ mode: 'create', workspaceId, sessionId })
            return
          }
          folderActions.assign(workspaceId, sessionId, target === 'none' ? null : target, {
            memberIds: workspaceMembers.get(workspaceId), ready: workspaceReady,
          })
          return
        }
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
      }, [archiveSession, byId, copyText, folderActions, folderEntries, folderReadonly, forkSession, move,
        pinSession, setPriority, unpinSession, unarchiveSession, workspaceMembers, workspaceOf, workspaceReady])

      const startBulk = useCallback((workspaceId) => {
        setPriorityView(false)
        setSelected(new Set())
        setBulk({ workspaceId, selected: new Set() })
      }, [])

      const toggleBulk = useCallback((sessionId) => {
        setBulk((current) => {
          if (current === null) return current
          const selected = new Set(current.selected)
          if (selected.has(sessionId)) selected.delete(sessionId)
          else selected.add(sessionId)
          return { ...current, selected }
        })
      }, [])

      const leaveBulk = useCallback(() => setBulk(null), [])

      // Filing a selection is one workspace write, then the mode stays open with an
      // empty selection so several passes are cheap.
      const moveBulkTo = useCallback((folderId) => {
        if (bulk === null || bulk.selected.size === 0) return
        const ids = [...bulk.selected]
        const workspaceId = bulk.workspaceId
        folderActions.assignMany(workspaceId, ids, folderId === FOLDER_UNFILED ? null : folderId, {
          ready: workspaceReady,
          memberIds: workspaceMembers.get(workspaceId),
        })
        const name = folderId === FOLDER_UNFILED
          ? t('folders.unfiled')
          : folderEntries.get(workspaceId)?.folders.find(folder => folder.id === folderId)?.name
        if (name) reportNotice?.(t('notice.filedMany', { n: ids.length, name }))
        setBulk({ workspaceId, selected: new Set() })
      }, [bulk, folderActions, folderEntries, reportNotice, t, workspaceMembers, workspaceReady])

      const selectAllInBulk = useCallback(() => {
        if (bulk === null) return
        const group = tree.groups.find(candidate => candidate.workspaceId === bulk.workspaceId)
        setBulk({ workspaceId: bulk.workspaceId, selected: new Set(group?.sessions ?? []) })
      }, [bulk, tree])

      // Per-row callbacks are stable: a memoised row must not re-render because its
      // parent produced a new closure for the same behaviour.
      const handleDragOverRow = useCallback((next) => setDropTarget((current) => {
        if (next === null || next === undefined) return current === null ? current : null
        return current && current.sessionId === next.sessionId && current.half === next.half ? current : next
      }), [])

      // A multi-selection cannot be expressed as a single-row insertion: it paints
      // no line and clears the marker state a row drag would otherwise keep.
      const handleDragOverMulti = useCallback(() => {
        pointerGesture.targetId = null
        pointerGesture.half = null
        setDropTarget(null)
      }, [])

      const handleDragEnd = useCallback((move) => {
        if (move !== null && move !== undefined) drop(move.accountId, move.order, move.id, move.target)
        setDrag(null)
        setDropTarget(null)
        setFolderDrop(null)
      }, [drop])

      const handleFolderOver = useCallback((folderId) => setFolderDrop(folderId), [])
      const handleToggleSelect = useCallback((sessionId) => toggleBulk(sessionId), [toggleBulk])

      // Bulk state is read at drop time from a ref: one stable callback serves every
      // row without freezing the selection it was created under.
      const bulkRef = useRef(bulk)
      bulkRef.current = bulk
      const filingRef = useRef(null)
      filingRef.current = { folderActions, folderEntries, workspaceMembers, workspaceReady, t, reportNotice }
      const handleAssignFolder = useCallback((folderId) => {
        const sessionId = pointerGesture.id
        const workspaceId = pointerGesture.accountId
        if (!sessionId || !workspaceId) return
        const current = filingRef.current
        const bulkNow = bulkRef.current
        const selected = bulkNow !== null && bulkNow.workspaceId === workspaceId ? [...bulkNow.selected] : []
        const multi = selected.includes(sessionId) && selected.length > 1
        const target = folderId === FOLDER_UNFILED ? null : folderId
        const options = { ready: current.workspaceReady, memberIds: current.workspaceMembers.get(workspaceId) }
        if (multi) {
          current.folderActions.assignMany(workspaceId, selected, target, options)
          setBulk({ workspaceId, selected: new Set() })
        } else {
          current.folderActions.assign(workspaceId, sessionId, target, options)
        }
        const name = folderId === FOLDER_UNFILED
          ? current.t('folders.unfiled')
          : current.folderEntries.get(workspaceId)?.folders.find(folder => folder.id === folderId)?.name
        if (name) {
          current.reportNotice?.(multi
            ? current.t('notice.filedMany', { n: selected.length, name })
            : current.t('notice.filed', { name }))
        }
      }, [])

      // Folder options are per workspace+session; caching them keeps the per-row
      // object identity stable while folders and assignments are unchanged.
      const folderOptionsCache = useMemo(() => {
        const cache = new Map()
        for (const [workspaceId, entry] of folderEntries) {
          for (const sessionId of workspaceMembers.get(workspaceId) || []) {
            cache.set(`${workspaceId}:${sessionId}`, {
              current: entry.assign[sessionId] ?? null,
              folders: entry.folders,
              readonly: folderReadonly,
              canCreate: !folderReadonly && entry.folders.length < FOLDER_MAX_PER_WORKSPACE,
            })
          }
        }
        return cache
      }, [folderEntries, folderReadonly, workspaceMembers])

      const renderRow = useCallback((sessionId, accountId, accountOrder, layout = {}) => {
        const {
          flat = false, pinnedSection = false,
          selectable = false, selected = false, onToggleSelect, toggleLabel,
          groupedByPriority = false, folderScope,
        } = layout
        const summary = byId[sessionId]
        if (!summary) return null
        const workspaceId = workspaceOf.get(sessionId)
        const folderOptions = workspaceId === undefined
          ? undefined
          : folderOptionsCache.get(`${workspaceId}:${sessionId}`)
        const scope = typeof accountId === 'string' && accountId !== ''
          ? `${accountId}:${folderScope ?? ''}`
          : undefined
        // A bulk selection never leaves its workspace: rows elsewhere are not
        // selectable, so a transfer can only ever name one folder.
        const bulkActive = bulk !== null && typeof accountId === 'string' && bulk.workspaceId === accountId
        // Dragging one selected row drags the whole selection: an insertion between
        // single rows cannot express that, so only folder targets are honoured.
        const bulkMulti = bulkActive && bulk.selected.has(sessionId) && bulk.selected.size > 1
        return h(SessionRowCell, {
          key: sessionId,
          sessionId,
          summary,
          status: statusCache.get(sessionId) ?? statusOfId(sessionId),
          accountId,
          accountOrder,
          currentId,
          archived: archivedSet.has(sessionId),
          pinned: pinnedSet.has(sessionId),
          t,
          dragging: drag?.sessionId === sessionId,
          dropHalf: dropTarget?.sessionId === sessionId ? dropTarget.half : null,
          bulkMulti,
          onDragStart: setDrag,
          // `dragover` fires continuously: only a *changed* cell may re-render.
          // A pointer stream is continuous: only a *changed* cell may re-render.
          // A multi-drag paints no insertion line at all: the drop is a folder.
          onDragOverRow: bulkMulti ? handleDragOverMulti : handleDragOverRow,
          onDragEnd: handleDragEnd,
          onOpen: open,
          onSelectAction: selectAction,
          onMove: move,
          // The pinned block leads the region but its order is the host's pin set,
          // which exposes no move operation; ungrouped rows have no account either.
          canReorder: typeof accountId === 'string' && accountId !== '',
          priority: priorityLevel(priorities?.[sessionId]),
          flat,
          pinnedSection,
          selectable: bulkActive ? true : selectable,
          selected: bulkActive ? bulk.selected.has(sessionId) : selected,
          onToggleSelect: bulkActive ? handleToggleSelect : onToggleSelect,
          toggleLabel: bulkActive ? t('bulk.selectMode') : toggleLabel,
          groupedByPriority,
          folderOptions,
          scope,
          onFolderOver: folderOptions === undefined ? undefined : handleFolderOver,
          onAssignFolder: folderOptions === undefined ? undefined : handleAssignFolder,
        })
      // `priorities` belongs here: without it the memoised renderer kept writing the
      // labels it saw when it was created, so a new P1–P4 choice only showed up after
      // something else rebuilt the rows.
      }, [archivedSet, bulk, byId, currentId, drag, dropTarget, folderOptionsCache, handleAssignFolder,
        handleDragEnd, handleDragOverMulti, handleDragOverRow, handleFolderOver, handleToggleSelect, move, open,
        pinnedSet, priorities, selectAction, statusCache, statusOfId, t, workspaceOf])

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
          const view = folderViews[group.key]
          if (view) {
            for (const section of view.sections) {
              if (folderCollapsed[section.key] === true) continue
              const required = requiredPageLimit(section.sessions, attention, currentId)
              const limit = Math.max(pages[section.key] ?? SESSION_PAGE_BASE, required)
              ids.push(...pageRows(section.sessions, limit, required).visible)
            }
            continue
          }
          // The page a block shows is max(stored limit, attention requirement), the
          // same derivation its rows and its "show more" control use.
          const required = requiredPageLimit(group.sessions, attention, currentId)
          const limit = Math.max(pages[group.key] ?? SESSION_PAGE_BASE, required)
          ids.push(...pageRows(group.sessions, limit, required).visible)
        }
        return ids
      }, [attention, collapsed, currentId, folderCollapsed, folderViews, levelCollapsed, pages, pinnedCollapsed, pinnedOrder, priorityLevels, priorityView, projectsCollapsed, results, searching, tree, wide])

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

      // The body of a workspace that has folders: one collapsible section per
      // folder, then Unfiled when it still has rows. There is no chip row; the
      // section headers are the tree, so a folder name appears once.
      const folderReorderHandlers = (workspaceId) => ({
        onPointerDown: (event) => {
          // The header's own menu and toggle are controls, not drag handles.
          if (event.target?.closest?.('button, a, input, [role="menu"], [role="menuitem"]')) return
          const folderId = event.currentTarget?.closest?.('[data-dsm-folder-id]')?.getAttribute?.('data-dsm-folder-id')
          if (!folderId) return
          gestureDown('folder', folderId, event, { workspaceId, scope: `folders:${workspaceId}` })
        },
        onPointerMove: (event) => {
          if (pointerGesture.kind !== 'folder') return
          gestureMove('folder', event, 'data-dsm-folder-id', (mark) => {
            const hit = mark === null ? null : elementUnder(event, 'data-dsm-folder-id')
            const sameWorkspace = hit?.getAttribute?.('data-dsm-folder-ws') === workspaceId
            setFolderHint(mark === null || !sameWorkspace ? null : { id: mark.id, half: mark.half })
          })
        },
        onPointerUp: () => {
          const hint = folderHint
          setFolderHint(null)
          gestureUp('folder', (move) => {
            if (move === null || move === undefined || hint === null) return
            folderActions.reorder(workspaceId, move.id, hint.id, hint.half === 'after' ? 'after' : 'before')
          })
        },
        onPointerCancel: () => { setFolderHint(null); gestureUp('folder', () => {}) },
      })

      const renderFolderBody = (group, view) => {
        const folders = view.sections.filter(section => section.kind === 'folder')
        return view.sections
          .filter(section => section.kind === 'folder' || section.sessions.length > 0)
          .map(section => h(FolderSection, {
            key: section.key,
            section,
            expanded: folderCollapsed[section.key] !== true,
            onToggle: key => setFolderCollapsed(state => ({ ...state, [key]: state[key] !== true })),
            marked: section.sessions.some(id => id === currentId || attention.has(id)),
            pending: section.sessions.some(id => statusOfId(id).pending !== undefined),
            folderHover: folderDrop === section.id,
            workspaceId: group.workspaceId,
            reorderHandlers: folderReorderHandlers(group.workspaceId),
            reorderHint: folderHint?.id === section.id ? folderHint.half : null,
            menu: section.kind === 'folder' ? h(FolderMenu, {
              key: `menu:${section.key}`,
              index: folders.findIndex(folder => folder.id === section.id),
              total: folders.length,
              onSelect: action => folderMenuAction(group.workspaceId, section, action),
              t,
            }) : undefined,
            renderRow: sessionId => renderRow(sessionId, group.workspaceId, section.sessions, {
              folderScope: section.id,
            }),
            ...folderPageProps(section.key, section.sessions),
            expandLabel: n => t('sessions.expand', { n }),
            collapseLabel: t('sessions.collapse'),
            t,
          }))
      }

      const renderGroup = (group) => {
        const view = folderViews[group.key]
        return h(Section, {
          key: group.key || '__ungrouped__',
          sectionKey: group.key,
          label: group.label,
          path: group.cwd,
          count: undefined,
          expanded: collapsed[group.key] !== true,
          onToggle: key => setCollapsed(state => ({ ...state, [key]: state[key] !== true })),
          sessions: group.sessions,
          renderRow: sessionId => renderRow(sessionId, group.workspaceId, group.sessions),
          body: view === undefined || view === null ? undefined : renderFolderBody(group, view),
          // The tree has no chip strip, so the workspace header is the only create
          // seat: it stays for both the first folder and every later one.
          onNewFolder: group.workspaceId === undefined || folderReadonly
            ? undefined
            : () => openCreateFolder(group.workspaceId),
          newFolderLabel: t('folders.new'),
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
          onSelectMode: group.workspaceId === undefined ? undefined : () => (
            bulk !== null && bulk.workspaceId === group.workspaceId ? leaveBulk() : startBulk(group.workspaceId)
          ),
          selectLabel: bulk !== null && bulk.workspaceId === group.workspaceId ? t('bulk.exit') : t('bulk.selectModeFull'),
          selectActive: bulk !== null && bulk.workspaceId === group.workspaceId,
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
              moveGroup(tree.groups.map(candidate => candidate.key), move.id, {
                key: move.target.id,
                half: move.target.half,
              })
            }
            setGroupDrag(null)
            setGroupDrop(null)
          },
        })
      }

      if (!wide) {
        // The rail: the shell owns the icon column; the region only needs an entry
        // that expands the sidebar back to its wide form.
        return h('div', { className: 'dsm-region' },
          h('button', { type: 'button', className: 'dsm-section-header', onClick: expandSidebar, 'aria-label': t('section.workspaces') }, h(IconChevronRightOutlineRegular, { size: 12 })))
      }

      const viewKey = searching ? 'search' : attentionOnly ? 'attention' : priorityView ? 'priority' : 'tree'
      const bodyRef = useRef(null)
      useEffect(() => {
        const host = bodyRef.current
        if (!host) return
        host.scrollTop = scrollMemory.get(viewKey) ?? 0
      }, [viewKey])

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
          needsAttention.length === 0 && !attentionOnly ? null : h('button', {
            type: 'button',
            className: 'dsm-head-action',
            'data-active': attentionOnly ? 'true' : undefined,
            title: attentionOnly ? t('attention.exit') : t('attention.show', { n: needsAttention.length }),
            'aria-label': attentionOnly ? t('attention.exit') : t('attention.show', { n: needsAttention.length }),
            'aria-pressed': String(attentionOnly),
            onClick: () => setAttentionOnly(value => !value),
          }, h(IconQueueOutlineRegular, { size: 16 }),
          h('span', { className: 'dsm-attn-badge', 'aria-hidden': 'true' }, String(needsAttention.length))),
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
              { type: 'separator', id: 'sep-auto' },
              { type: 'label', id: 'auto-label', text: t('view.autoArchive') },
              { id: 'autoOff', label: t('view.autoArchiveOff') },
              { id: 'auto7', label: autoLabel(7) },
              { id: 'auto30', label: autoLabel(30) },
              { id: 'auto90', label: autoLabel(90) },
              { type: 'separator', id: 'sep-yield' },
              { id: 'yieldTakeover', label: t('view.yield') },
            ],
            selectedIds: [
              orderBy === 'manual' ? 'orderManual' : 'orderUpdated',
              archivedFilter === 'show' ? 'archivedShow'
                : archivedFilter === 'only' ? 'archivedOnly' : 'archivedDefault',
              autoArchiveRead.days === 7 ? 'auto7'
                : autoArchiveRead.days === 30 ? 'auto30'
                  : autoArchiveRead.days === 90 ? 'auto90' : 'autoOff',
            ],
            onSelect: (id) => {
              if (id === 'orderManual') setOrderBy('manual')
              else if (id === 'orderUpdated') setOrderBy('updated')
              else if (id === 'archivedDefault') setArchivedFilter('default')
              else if (id === 'archivedShow') setArchivedFilter('show')
              else if (id === 'archivedOnly') setArchivedFilter('only')
              else if (id === 'autoOff') setAutoArchive(null)
              else if (id === 'auto7') setAutoArchive(7)
              else if (id === 'auto30') setAutoArchive(30)
              else if (id === 'auto90') setAutoArchive(90)
              else if (id === 'yieldTakeover') setTakeover(false)
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
        bulk !== null && !searching && !priorityView ? h('div', { className: 'dsm-bulk' },
          h('span', { className: 'dsm-bulk-count' }, t('bulk.count', { n: bulk.selected.size })),
          h('span', { className: 'dsm-bulk-actions' },
            h(Menu, {
              open: bulkMenuOpen,
              anchor: h('button', {
                type: 'button',
                className: 'dsm-bulk-action',
                disabled: bulk.selected.size === 0 || folderEntries.get(bulk.workspaceId) === undefined,
                'aria-haspopup': 'menu',
                onClick: () => setBulkMenuOpen(value => !value),
              }, t('bulk.moveTo')),
              items: [
                { id: 'none', label: t('folders.unfiled') },
                ...(folderEntries.get(bulk.workspaceId)?.folders ?? []).map(folder => ({ id: folder.id, label: folder.name })),
              ],
              onSelect: (id) => {
                setBulkMenuOpen(false)
                moveBulkTo(id === 'none' ? FOLDER_UNFILED : id)
              },
              onClose: () => setBulkMenuOpen(false),
              align: 'end',
              dense: true,
              portal: true,
            }),
            h('button', {
              type: 'button',
              className: 'dsm-bulk-action',
              onClick: selectAllInBulk,
            }, t('bulk.all')),
            h('button', {
              type: 'button',
              className: 'dsm-bulk-action dsm-bulk-done',
              onClick: leaveBulk,
            }, t('bulk.exit')),
          ),
          h('span', { className: 'dsm-bulk-hint' }, t('bulk.scope')),
        ) : null,
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
            h('span', { className: 'dsm-bulk-sep', 'aria-hidden': 'true' }),
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
            h('span', { className: 'dsm-bulk-sep', 'aria-hidden': 'true' }),
            // Archiving is a clear-out action: it sits at the tail, styled secondary,
            // never between the level buttons it has nothing to do with.
            h('button', {
              type: 'button',
              className: 'dsm-bulk-action dsm-bulk-secondary',
              disabled: selected.size === 0,
              onClick: () => {
                const ids = [...selected]
                setSelected(new Set())
                Promise.resolve(archiveMany(ids)).then((result) => {
                  if (result?.failed > 0) reportFailure(new Error(t('notice.archiveBulkFailed', { n: result.failed })))
                }).catch(reportFailure)
              },
            }, t('bulk.archive')),
            h('button', {
              type: 'button',
              className: 'dsm-bulk-action dsm-bulk-done',
              onClick: leavePriorityView,
            }, t('bulk.done')),
          ),
          h('span', { className: 'dsm-bulk-hint' }, t('bulk.hint')),
        ) : null,
        h('div', {
          className: 'dsm-body',
          'data-filter': archivedFilter,
          ref: bodyRef,
          onScroll: (event) => { scrollMemory.set(viewKey, event.currentTarget.scrollTop) },
        },
          searching ? h('div', { className: 'dsm-list' },
            search.phase === 'error' ? h('div', { className: 'dsm-search-meta' }, `${t('search.failed')}${search.message ?? ''}`) : null,
            search.phase === 'local' ? h('div', { className: 'dsm-search-meta' }, t('search.local')) : null,
            search.phase === 'loading' ? h('div', { className: 'dsm-search-meta' }, t('search.loading')) : null,
            results.nodes.length === 0 && search.phase !== 'loading'
              ? h('div', { className: 'dsm-empty' }, t('search.none'))
              : null,
            results.nodes.map(node => {
              const summary = byId[node.id] ?? { displayTitle: node.title, updatedAt: 0 }
              return h(SessionRow, {
                key: node.id,
                sessionId: node.id,
                summary,
                status: statusOfId(node.id),
                accountId: undefined,
                accountOrder: [],
                currentId,
                archived: archivedSet.has(node.id),
                pinned: pinnedSet.has(node.id),
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
                stacked: true,
                snippet: node.snippet,
                titleMatch: node.titleMatch,
                canReorder: false,
                flat: true,
              })
            }),
            results.hasMore ? h('div', { className: 'dsm-search-meta' }, t('search.more')) : null,
          ) : null,
          // --- priority view: one fold per level, then the unmarked rows ----------
          searching ? null : attentionOnly ? h('div', { className: 'dsm-list' },
            needsAttention.length === 0 ? h('div', { className: 'dsm-empty' }, t('attention.none')) : null,
            needsAttention.map((sessionId) => {
              const summary = byId[sessionId] ?? { displayTitle: sessionId, updatedAt: 0 }
              return h(SessionRow, {
                key: sessionId,
                sessionId,
                summary,
                status: statusOfId(sessionId),
                accountId: undefined,
                accountOrder: [],
                currentId,
                archived: archivedSet.has(sessionId),
                pinned: pinnedSet.has(sessionId),
                t,
                drag: null,
                dropTarget: null,
                onDragStart: () => {},
                onDragOverRow: () => {},
                onDragEnd: () => {},
                onOpen: open,
                onSelectAction: selectAction,
                onMove: () => {},
                workspaceLabel: workspaceLabelBySession.get(sessionId),
                canReorder: false,
                flat: true,
              })
            }),
          ) : priorityView ? h('div', { className: 'dsm-levels' },
            markedCount === 0 && priorityLevels.unmarked.length === 0
              ? h('div', { className: 'dsm-empty' }, t('priority.empty'))
              : null,
            priorityLevels.buckets.map(bucket => bucket.ids.length === 0 ? null : h(Section, {
              key: `level-${bucket.level}`,
              sectionKey: `level-${bucket.level}`,
              label: bucket.label,
              count: bucket.ids.length,
              expanded: levelCollapsed[bucket.level] !== true,
              onToggle: () => setLevelCollapsed(state => ({ ...state, [bucket.level]: state[bucket.level] !== true })),
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
          searching || priorityView ? null : workspaceReady ? (tree.groups.length === 0
            ? h('div', { className: 'dsm-empty' },
              h('div', null, t('empty.none')),
              h('button', {
                type: 'button',
                className: 'dsm-empty-action',
                onClick: () => { addWorkspace().catch(reportFailure) },
              }, t('action.addWorkspace')))
            : null)
            // Before the Host list is ready, an empty tree is not an empty state.
            : h('div', { className: 'dsm-empty' }, t('sessions.loading')),
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
            projectsCollapsed ? null : tree.groups.map(renderGroup),
          ),
        ),
        notice ? h('div', { className: 'dsm-notice', role: 'alert', 'data-tone': notice.tone ?? 'info' }, notice.text ?? notice,
          h('button', { type: 'button', onClick: clearNotice }, t('dialog.close'))) : null,
        h(FolderDialog, {
          request: folderDialog,
          folders: folderDialog ? (folderEntries.get(folderDialog.workspaceId)?.folders ?? []) : [],
          reserved: FOLDER_RESERVED_NAMES,
          onSubmit: submitFolderDialog,
          onCancel: () => setFolderDialog(null),
          t,
        }),
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
    /* ------------------------------------------------------------------ *
     * Dialogs — rename and folder management.
     * ------------------------------------------------------------------ */

    function RenameDialog({ request, onSubmit, onCancel, t }) {
      const [value, setValue] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      useEffect(() => { setValue(request ? request.title : ''); setBusy(false); setError(null) }, [request])
      if (!request) return null
      const submit = async () => {
        const title = value.trim()
        if (title === '' || busy) return
        setBusy(true)
        setError(null)
        try {
          await onSubmit(request.sessionId, title)
        } catch (reason) {
          // A rejected rename used to leave the dialog looking inert: the host's
          // reason now lands on the form, which is the only place it can be read.
          setError(String(reason?.message ?? reason))
        } finally {
          setBusy(false)
        }
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
      error === null ? null : (() => {
        const failure = explainRenameFailure(error)
        const text = failure.kind === 'preset'
          ? t('rename.presetGone', { preset: failure.preset })
          : failure.kind === 'resume' ? t('rename.resumeFailed') : error
        return h('div', { className: 'dsm-dialog-error', role: 'alert' }, text,
          failure.kind === 'other' ? null : h('div', { className: 'dsm-dialog-detail' }, error))
      })(),
      h('div', { className: 'dsm-dialog-actions' },
        h('button', { type: 'button', onClick: onCancel }, t('dialog.cancel')),
        h('button', { type: 'submit', disabled: busy }, t('dialog.save'))),
      ))
    }

    /** Required client services; `jobs` is fetched lazily because a build may omit it. */
    /* ------------------------------------------------------------------ *
     * Host half: registration, stores, and host-service actions.
     * ------------------------------------------------------------------ */

    const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale']

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
      const folders = folderStore(require)
      const autoArchive = autoArchiveStore(require)
      const takeover = takeoverStore(require)
      // The host half has no injected `t`: bind the namespace once so failure
      // notices follow the active language instead of always speaking Chinese.
      const hostT = ctx.locale.bind(NS)

      // Folder writes live on the injection face, next to the priority writes:
      // every action reads the store's current snapshot before applying a pure
      // update, so a render-time closure can never write an older value back.
      const folderActions = (() => {
        const read = () => readFolderState(folders.getSnapshot())
        const write = (next) => {
          if (next === undefined || next === folders.getSnapshot()) return false
          folders.set(next)
          return true
        }
        const editable = (run) => {
          const current = read()
          if (current.mode === 'readonly') return undefined
          return run(current.state)
        }
        const prune = (next, workspaceId, options) => {
          if (options?.ready !== true || !Array.isArray(options.memberIds)) return next
          return pruneAssign(next, workspaceId, options.memberIds)
        }
        return {
          create: (workspaceId, name, options = {}) => editable((state) => {
            const id = typeof options.id === 'string' ? options.id : newFolderId()
            let next = createFolder(state, workspaceId, { id, name })
            if (next === state) return undefined
            if (typeof options.sessionId === 'string') {
              next = assignSession(next, workspaceId, options.sessionId, id)
            }
            next = prune(next, workspaceId, options)
            write(next)
            return id
          }),
          rename: (workspaceId, folderId, name) => editable(
            state => write(renameFolder(state, workspaceId, folderId, name)),
          ),
          remove: (workspaceId, folderId) => editable(
            state => write(deleteFolder(state, workspaceId, folderId)),
          ),
          move: (workspaceId, folderId, direction) => editable(
            state => write(moveFolder(state, workspaceId, folderId, direction)),
          ),
          reorder: (workspaceId, movingId, targetId, position) => editable(
            state => write(reorderFolder(state, workspaceId, movingId, targetId, position)),
          ),
          assign: (workspaceId, sessionId, folderId, options = {}) => editable((state) => {
            const next = prune(assignSession(state, workspaceId, sessionId, folderId), workspaceId, options)
            return write(next)
          }),
          assignMany: (workspaceId, sessionIds, folderId, options = {}) => editable((state) => {
            const next = prune(assignSessions(state, workspaceId, sessionIds, folderId), workspaceId, options)
            return write(next)
          }),
        }
      })()

      // Another window's write replaces the whole value; adopt it instead of
      // letting this window's next write overwrite it with a stale snapshot.
      ctx.effect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onStorage = (event) => {
          if (!event || event.key !== FOLDER_KEY) return
          if (event.newValue === null) {
            folders.set(FOLDER_INIT)
            return
          }
          try {
            folders.set(JSON.parse(event.newValue))
          } catch { /* a malformed remote value is ignored; this window keeps its copy */ }
        }
        window.addEventListener('storage', onStorage)
        return () => {
          if (typeof window.removeEventListener === 'function') window.removeEventListener('storage', onStorage)
        }
      }, 'dsh-session-manager: folder sync')

      let notice = null
      const noticeSource = {
        listeners: new Set(),
        getSnapshot: () => notice,
        subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) },
        set(next, tone = 'info') { notice = { text: String(next), tone }; for (const listener of this.listeners) listener() },
      }

      const report = (error) => {
        // The host refuses to archive a session with running work; name that case
        // explicitly instead of showing a raw carrier failure.
        const active = error?.rpcError?.code === 'workspace/session-active'
        const prefix = active ? '' : hostT('notice.failed')
        noticeSource.set(active ? hostT('notice.sessionActive') : `${prefix}${error?.message || String(error)}`, 'warn')
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

      const registerRegion = () => ctx.slots.register({
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
            setAutoArchive: days => autoArchive.set(readAutoArchive({ days })),
          setTakeover: next => takeover.set({ mode: next ? 'on' : 'off' }),
          reportNotice: message => noticeSource.set(String(message), 'success'),
            autoArchiveStore: autoArchive,
            // Bulk archive is one call so a sweep and the priority view share the same
            // failure accounting: each session is still its own host write.
            archiveMany: sessionIds => Promise.allSettled((sessionIds || []).map(
              sessionId => Promise.resolve(ctx.uiWorkspace.archiveSession(sessionId)),
            )).then(results => ({
              archived: results.filter(result => result.status === 'fulfilled').length,
              failed: results.filter(result => result.status === 'rejected').length,
            })),
            unarchiveSession: sessionId => invoke(() => ctx.uiWorkspace.unarchiveSession(sessionId)),
            forkSession: sessionId => invoke(() => ctx.uiWorkspace.forkSession(sessionId)),
            renameSession: (sessionId, title) => ctx.sessions.using(
              sessionId,
              { source: 'workspaceOperation' },
              reference => reference.binding.session.rename(title),
            ).then((result) => {
              if (result?.ok === false) throw new Error(result.error?.message || 'rename failed')
              // The title is a Host projection: nudge a refresh so the row cannot
              // keep showing the old title when no live frame follows the rename.
              // It must not gate the dialog: a slow refresh is not a failed rename.
              try { Promise.resolve(ctx.sessions.refresh?.()).catch(() => {}) } catch { /* projection only */ }
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
              throw new Error(hostT('notice.copyFailed'))
            }),
            clearNotice: () => noticeSource.set(null),
            // The stores themselves ride the face so the region can subscribe on its own.
            priorityStore: priorities,
            folderStore: folders,
            folderActions,
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
        }, SessionManagerRegion)

      ctx.effect(() => ctx.slots.inject('sidebar.workspaces', () => {
        let dispose
        const arm = () => {
          if (readTakeover(takeover.getSnapshot()) === 'on') {
            if (dispose === undefined) dispose = registerRegion()
            return
          }
          if (dispose === undefined) return
          dispose()
          dispose = undefined
        }
        const stop = takeover.subscribe(arm)
        arm()
        return () => {
          stop()
          if (dispose !== undefined) { dispose(); dispose = undefined }
        }
      }), 'dsh-session-manager: browsing region')

      // The foot of the sidebar carries the way back while the region is handed to
      // the shipped browser: without it, yielding would be a one-way door.
      ctx.effect(() => {
        // The foot action is an extra, not a requirement: a build without the slot
        // (or one that rejects the name) must still mount the browsing region.
        try {
          return ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'dsh-session-manager-takeover',
            order: 900,
            locale: NS,
            registrant: '@pianner/dsh-session-manager',
            inject: () => ({ takeover, setTakeover: next => takeover.set({ mode: next ? 'on' : 'off' }) }),
          }, TakeoverFooterAction))
        } catch (error) {
          console.warn('[dsh-session-manager] footer toggle unavailable', error)
          return undefined
        }
      }, 'dsh-session-manager: takeover toggle')
    }

    module.exports = { inject, apply }

    return module.exports
  },
})
