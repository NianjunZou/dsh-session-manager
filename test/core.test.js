/**
 * Unit tests for the pure derivation core.
 *
 * These exercise the host-contract projections without a browser: the fixtures
 * mirror the exact snapshot shapes the client reads (`sessions.list`,
 * `uiSession.sessionStatus`, `jobs.state`, `workspaces.list`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DOT,
  SESSION_PAGE_BASE,
  STATE_DOT,
  buildSearchNodes,
  nextPageLimit,
  pageRows,
  requiredPageLimit,
  sanitizeQuery,
  workspaceLabelOf,
  buildChildren,
  buildRollup,
  computeGroups,
  descendantsOf,
  dotPlan,
  formatRelative,
  isVisibleMember,
  moveAnchor,
  orderByRecency,
  orderMembers,
  pendingKind,
  relativeTime,
  snapshotOf,
  splitPinned,
  statusOf,
  visibleTopLevelIds,
  watchTargets,
} from '../src/client/core.js'

/** Build a `sessions.list` snapshot from compact rows. */
function list(rows, projections = {}) {
  const byId = {}
  for (const row of rows) byId[row.id] = { blank: false, retainedBy: { mainView: 0 }, updatedAt: 0, ...row }
  return { ids: rows.map(row => row.id), byId, phase: 'ready', projectionsBySession: projections }
}

/** Build a `jobs.state` snapshot. */
function jobs(rows) {
  return { rows }
}

function statuses(entries) {
  return new Map(Object.entries(entries))
}

test('snapshotOf reads either store accessor shape and tolerates absence', () => {
  assert.deepEqual(snapshotOf({ getSnapshot: () => ({ a: 1 }) }), { a: 1 })
  assert.deepEqual(snapshotOf({ get: () => ({ b: 2 }) }), { b: 2 })
  assert.equal(snapshotOf(undefined), undefined)
  assert.equal(snapshotOf({}), undefined)
})

test('pendingKind accepts both the string and object wire shapes', () => {
  assert.equal(pendingKind('approval'), 'approval')
  assert.equal(pendingKind({ kind: 'plan-review' }), 'plan-review')
  assert.equal(pendingKind(undefined), undefined)
  assert.equal(pendingKind({}), undefined)
})

test('buildChildren merges the parent edge and the durable subagent catalog', () => {
  const snapshot = list(
    [
      { id: 'root' },
      { id: 'child-a', parentId: 'root', origin: 'subagent' },
      { id: 'child-b', parentId: 'root', origin: 'subagent' },
      { id: 'grand', parentId: 'child-a', origin: 'subagent' },
    ],
    {
      root: { values: { subagentCatalog: [
        { id: 'child-a', mode: 'continuable' },
        { id: 'child-c', mode: 'one-shot' },
        { id: 'external-1', mode: 'external' },
      ] } },
    },
  )
  const children = buildChildren(snapshot)
  assert.deepEqual(children.get('root'), ['child-a', 'child-b', 'child-c'])
  assert.deepEqual(children.get('child-a'), ['grand'])
  // The host itself skips `external` rows, so the plugin must too.
  assert.equal(children.has('external-1'), false)
})

test('buildChildren ignores self-parenting and non-string identities', () => {
  const snapshot = list([{ id: 'a', parentId: 'a' }, { id: 'b', parentId: 42 }])
  const children = buildChildren(snapshot)
  assert.equal(children.size, 0)
})

test('descendantsOf walks the whole subtree once and survives a cycle', () => {
  const children = new Map([
    ['a', ['b', 'c']],
    ['b', ['d']],
    ['d', ['a']],
  ])
  assert.deepEqual([...descendantsOf(children, 'a')].sort(), ['b', 'c', 'd'])
  assert.deepEqual([...descendantsOf(children, 'c')], [])
})

test('buildRollup folds jobs, subagents and abnormal turns across the subtree', () => {
  const snapshot = list([
    { id: 'root' },
    { id: 'child', parentId: 'root', origin: 'subagent', running: true },
    { id: 'grand', parentId: 'child', origin: 'subagent' },
    { id: 'sibling' },
  ], {
    grand: { values: { subagentTiming: { settledMs: 10, lastTurnCompleted: false } } },
    child: { values: { subagentTiming: { settledMs: 10, active: { since: 1, through: 2 } } } },
  })
  const { rollup } = buildRollup(snapshot, jobs({
    root: [{ status: 'running' }, { status: 'stopping' }, { status: 'failed', finishedAt: 100 }],
    grand: [{ status: 'running' }, { status: 'failed', finishedAt: 200 }, { status: 'killed', finishedAt: 150 }],
    sibling: [{ status: 'running' }],
  }))
  assert.deepEqual(rollup.get('root'), {
    selfRunning: false,
    subagentsTotal: 1,
    subagentsRunning: 1, // `child` is running; its own descendants are not
    jobsRunning: 2, // `root`'s own plus `grand`'s
    jobsStopping: 1, // `stopping` stays separate here; `statusOf` merges it into "busy"
    // Own and delegated rosters stay apart: "my job" and "a subagent's job" are
    // different news on the row, so one merged number would hide the owner.
    jobsRunningSelf: 1,
    jobsStoppingSelf: 1,
    jobsRunningSubtree: 1,
    jobsStoppingSubtree: 0,
    // Only the tree's newest settled job counts: `grand` failed at 200, so
    // `root`'s own failure at 100 is history, and `grand`'s kill at 150 too.
    jobsFailed: 1,
    settledAt: 200,
    abnormalTurns: 1, // only `grand`: closed turn that did not complete normally
  })
  // A sibling subtree never leaks into the root's counters.
  assert.equal(rollup.get('sibling').jobsRunning, 1)
  assert.equal(rollup.get('sibling').jobsRunningSelf, 1)
  assert.equal(rollup.get('sibling').jobsRunningSubtree, 0)
})

test('buildRollup retires an earlier failure once anything settles later', () => {
  const snapshot = list([{ id: 's' }])
  const failedLast = buildRollup(snapshot, jobs({ s: [{ status: 'failed', finishedAt: 100 }] }))
  assert.equal(failedLast.rollup.get('s').jobsFailed, 1)

  const recovered = buildRollup(snapshot, jobs({ s: [
    { status: 'failed', finishedAt: 100 },
    { status: 'completed', finishedAt: 200 },
  ] }))
  assert.equal(recovered.rollup.get('s').jobsFailed, 0)

  const twoAtOnce = buildRollup(snapshot, jobs({ s: [
    { status: 'failed', finishedAt: 300 },
    { status: 'failed', finishedAt: 300 },
  ] }))
  assert.equal(twoAtOnce.rollup.get('s').jobsFailed, 2)

  // A settled job without a usable instant cannot claim to be the newest.
  const noClock = buildRollup(snapshot, jobs({ s: [{ status: 'failed' }] }))
  assert.equal(noClock.rollup.get('s').jobsFailed, 0)
})

test('buildRollup ignores a timing hint on a session that is not a child', () => {
  // `subagentTiming` is defined for descriptor-backed child sessions; a
  // top-level row carrying one is stale data, not a failed turn.
  const snapshot = list([
    { id: 'top', projectionValues: { subagentTiming: { settledMs: 1, lastTurnCompleted: false } } },
  ])
  const { rollup } = buildRollup(snapshot, jobs({}))
  assert.equal(rollup.get('top').abnormalTurns, 0)
})

test('buildRollup reads subagent timing from the list row projection too', () => {
  const snapshot = list([
    { id: 'root' },
    { id: 'child', parentId: 'root', origin: 'subagent', projectionValues: { subagentTiming: { settledMs: 1, lastTurnCompleted: false } } },
  ])
  const { rollup } = buildRollup(snapshot, jobs({}))
  assert.equal(rollup.get('root').abnormalTurns, 1)
})

test('buildRollup degrades instead of looping on a cyclic parent chain', () => {
  const snapshot = list([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }])
  const { rollup } = buildRollup(snapshot, jobs({}))
  assert.equal(rollup.get('a').jobsRunning, 0)
  assert.equal(rollup.get('b').jobsRunning, 0)
})

test('statusOf fixes the dot precedence in one place', () => {
  const snapshot = list([{ id: 's', running: true }])
  const { rollup } = buildRollup(snapshot, jobs({ s: [{ status: 'failed' }] }))

  // pending beats everything, including a live run and a recorded failure.
  assert.equal(statusOf('s', {
    rollup, statusSnapshot: statuses({ s: { running: true, pendingInteraction: 'approval', completionUnread: true } }),
  }).dot, DOT.PENDING)

  // own run > subagent > job
  assert.equal(statusOf('s', { rollup, statusSnapshot: statuses({ s: { running: true } }) }).dot, DOT.RUNNING)
})

test('statusOf distinguishes subagent work from background-job work', () => {
  const snapshot = list([{ id: 'root' }, { id: 'child', parentId: 'root', origin: 'subagent', running: true }])
  const subagentOnly = buildRollup(snapshot, jobs({ root: [{ status: 'failed' }] }))
  const status = statusOf('root', { rollup: subagentOnly.rollup, statusSnapshot: statuses({ root: {} }) })
  assert.equal(status.dot, DOT.SUBAGENT)
  assert.equal(status.activity.subagents.running, 1)
  assert.equal(status.activity.jobs.running, 0)
  assert.equal(status.activity.self, false)

  const jobOnly = buildRollup(list([{ id: 'root' }]), jobs({ root: [{ status: 'running' }] }))
  const jobStatus = statusOf('root', { rollup: jobOnly.rollup, statusSnapshot: statuses({ root: {} }) })
  assert.equal(jobStatus.dot, DOT.JOB)
  assert.equal(jobStatus.activity.jobs.running, 1)
})

test('statusOf never turns a settled job outcome into a row state', () => {
  // The client has no session failure state, and both proxies for one
  // false-positive in real use, so a settled failure never colours the row.
  const failed = buildRollup(list([{ id: 's' }]), jobs({ s: [{ status: 'failed', finishedAt: 5 }] }))
  const settled = statusOf('s', { rollup: failed.rollup, statusSnapshot: statuses({ s: {} }) })
  assert.equal(settled.dot, DOT.IDLE)
  assert.equal(settled.facts.jobsFailed, 1, 'the raw count stays available as a fact')
  assert.equal('failure' in settled, false)

  // The same holds while the session runs again.
  const running = statusOf('s', { rollup: failed.rollup, statusSnapshot: statuses({ s: { running: true } }) })
  assert.equal(running.dot, DOT.RUNNING)

  // A finished-but-unread stop still reads as unread, not as a failure.
  const unread = statusOf('s', { rollup: failed.rollup, statusSnapshot: statuses({ s: { completionUnread: true } }) })
  assert.equal(unread.dot, DOT.UNREAD)

  const killed = buildRollup(list([{ id: 's' }]), jobs({ s: [{ status: 'killed', finishedAt: 9 }, { status: 'completed', finishedAt: 3 }] }))
  assert.equal(statusOf('s', { rollup: killed.rollup, statusSnapshot: statuses({ s: {} }) }).dot, DOT.IDLE)
})

test('statusOf falls back to the list row running flag until the UI status establishes one', () => {
  const snapshot = list([{ id: 's', running: true }])
  const { rollup } = buildRollup(snapshot, jobs({}))
  assert.equal(statusOf('s', { rollup, statusSnapshot: statuses({ s: {} }) }).dot, DOT.RUNNING)
  // An explicit `false` from the UI status wins over a stale list row.
  assert.equal(statusOf('s', { rollup, statusSnapshot: statuses({ s: { running: false } }) }).dot, DOT.IDLE)
})

test('statusOf marks completion-unread only when nothing is running', () => {
  const { rollup } = buildRollup(list([{ id: 's' }]), jobs({}))
  assert.equal(statusOf('s', { rollup, statusSnapshot: statuses({ s: { completionUnread: true } }) }).dot, DOT.UNREAD)
})

test('statusOf degrades to idle for a session with no rollup record', () => {
  const status = statusOf('ghost', { rollup: new Map(), statusSnapshot: new Map() })
  assert.equal(status.dot, DOT.IDLE)
  assert.deepEqual(status.activity, {
    self: false,
    subagents: { running: 0, total: 0 },
    jobs: { running: 0, own: 0, subtree: 0 },
  })
})

test('orderByRecency sorts by updatedAt then id', () => {
  const byId = { a: { updatedAt: 5 }, b: { updatedAt: 9 }, c: { updatedAt: 5 } }
  assert.deepEqual(orderByRecency(['a', 'b', 'c'], byId), ['b', 'a', 'c'])
  assert.deepEqual(orderByRecency(['a', 'ghost'], byId), ['a'])
})

test('orderMembers keeps the host manual order and fronts pinned members', () => {
  const manual = orderMembers({
    memberIds: ['a', 'b', 'c'],
    orderBy: 'manual',
    pinnedSessionIds: ['c'],
    archivedSessionIds: [],
    byId: { a: { updatedAt: 1 }, b: { updatedAt: 99 }, c: { updatedAt: 5 } },
  })
  assert.deepEqual(manual, ['c', 'a', 'b'])

  const recent = orderMembers({
    memberIds: ['a', 'b', 'c'],
    orderBy: 'updated',
    pinnedSessionIds: ['c'],
    archivedSessionIds: [],
    byId: { a: { updatedAt: 1 }, b: { updatedAt: 99 }, c: { updatedAt: 5 } },
  })
  assert.deepEqual(recent, ['c', 'b', 'a'])

  // An archived pin never leads the list.
  const archivedPin = orderMembers({
    memberIds: ['a', 'b'], orderBy: 'manual', pinnedSessionIds: ['b'],
    archivedSessionIds: ['b'], byId: { a: {}, b: {} },
  })
  assert.deepEqual(archivedPin, ['a', 'b'])
})

test('moveAnchor resolves drag halves, keyboard steps, appends and no-ops', () => {
  const order = ['a', 'b', 'c', 'd']
  // Drag `a` onto the lower half of `c` -> insert after `c`.
  assert.equal(moveAnchor({ order, movingId: 'a', targetId: 'c', half: 'after' }), 'd')
  // Drag `d` onto the upper half of `b` -> insert before `b`.
  assert.equal(moveAnchor({ order, movingId: 'd', targetId: 'b', half: 'before' }), 'b')
  // Drag onto the last row's lower half -> append (`null` means "omit the anchor").
  assert.equal(moveAnchor({ order, movingId: 'a', targetId: 'd', half: 'after' }), null)
  // Keyboard steps move exactly one slot.
  assert.equal(moveAnchor({ order, movingId: 'c', direction: 'up' }), 'b')
  assert.equal(moveAnchor({ order, movingId: 'c', direction: 'down' }), null)
  assert.equal(moveAnchor({ order, movingId: 'a', direction: 'up' }), undefined)
  assert.equal(moveAnchor({ order, movingId: 'd', direction: 'down' }), undefined)
  // Same-slot drops and unknown identities change nothing.
  assert.equal(moveAnchor({ order, movingId: 'b', targetId: 'b', half: 'before' }), undefined)
  assert.equal(moveAnchor({ order, movingId: 'a', targetId: 'b', half: 'before' }), undefined)
  assert.equal(moveAnchor({ order, movingId: 'b', targetId: 'a', half: 'after' }), undefined)
  assert.equal(moveAnchor({ order, movingId: 'ghost', targetId: 'a', half: 'before' }), undefined)
  assert.equal(moveAnchor({ order, movingId: 'a', targetId: 'ghost', half: 'before' }), undefined)
})

test('moveAnchor drops a row on the far side of a longer list without an off-by-one', () => {
  // Regression: the target index must be read from the source-removed order,
  // otherwise a forward drag lands one slot short of the marker.
  const order = ['a', 'b', 'c', 'd', 'e']
  assert.equal(moveAnchor({ order, movingId: 'a', targetId: 'd', half: 'before' }), 'd')
  assert.equal(moveAnchor({ order, movingId: 'a', targetId: 'd', half: 'after' }), 'e')
  assert.equal(moveAnchor({ order, movingId: 'e', targetId: 'b', half: 'before' }), 'b')
  assert.equal(moveAnchor({ order, movingId: 'e', targetId: 'b', half: 'after' }), 'c')
  assert.equal(moveAnchor({ order, movingId: 'b', targetId: 'd', half: 'before' }), 'd')
  assert.equal(moveAnchor({ order, movingId: 'b', targetId: 'd', half: 'after' }), 'e')
})

test('visibleTopLevelIds drops subagent rows but keeps host order', () => {
  const snapshot = list([
    { id: 'a' }, { id: 'child', parentId: 'a', origin: 'subagent' }, { id: 'b' },
  ])
  assert.deepEqual(visibleTopLevelIds(snapshot), ['a', 'b'])
})

test('splitPinned separates the pinned block without dropping archived pins', () => {
  const split = splitPinned({
    order: ['a', 'b', 'c'],
    pinnedSessionIds: ['b', 'c'],
    archivedSessionIds: ['c'],
  })
  assert.deepEqual(split, { pinned: ['b'], ordinary: ['a', 'c'] })
})

test('relativeTime buckets match the host-wide shared bucket set', () => {
  const now = 1_800_000_000_000
  const at = minutes => now - minutes * 60_000
  assert.deepEqual(relativeTime(0, now), { unit: 'none', n: 0 })
  assert.deepEqual(relativeTime(Number.NaN, now), { unit: 'none', n: 0 })
  assert.deepEqual(relativeTime(now, now), { unit: 'now', n: 0 })
  assert.deepEqual(relativeTime(at(59), now), { unit: 'minutes', n: 59 })
  assert.deepEqual(relativeTime(at(60), now), { unit: 'hours', n: 1 })
  assert.deepEqual(relativeTime(at(1439), now), { unit: 'hours', n: 23 })
  assert.deepEqual(relativeTime(at(1440), now), { unit: 'days', n: 1 })
  assert.deepEqual(relativeTime(at(29 * 1440), now), { unit: 'days', n: 29 })
  assert.deepEqual(relativeTime(at(30 * 1440), now), { unit: 'months', n: 1 })
  assert.deepEqual(relativeTime(at(365 * 1440), now), { unit: 'years', n: 1 })
  // The host bucket set has no `weeks`: 14 days reads as days, as everywhere else in DSH.
  assert.deepEqual(relativeTime(at(14 * 1440), now), { unit: 'days', n: 14 })
})

test('formatRelative localizes a bucket and degrades on an unknown one', () => {
  const strings = { now: '刚刚', minutes: ' 分钟', hours: ' 小时', days: ' 天', months: ' 月', years: ' 年' }
  assert.equal(formatRelative({ unit: 'none', n: 0 }, strings), '')
  assert.equal(formatRelative({ unit: 'now', n: 0 }, strings), '刚刚')
  assert.equal(formatRelative({ unit: 'minutes', n: 5 }, strings), '5 分钟')
  assert.equal(formatRelative({ unit: 'weeks', n: 2 }, strings), '')
})

test('dotPlan maps the layered state onto the one dot the row paints', () => {
  const of = () => dotPlan(statusOf('s', {
    rollup: new Map([['s', {
      selfRunning: false, subagentsTotal: 0, subagentsRunning: 0,
      jobsRunning: 0, jobsStopping: 0, jobsFailed: 0, abnormalTurns: 0,
    }]]),
    statusSnapshot: new Map(),
  }))
  assert.equal(of(null).primary, STATE_DOT.IDLE)

  const running = dotPlan(statusOf('s', {
    rollup: new Map([['s', {
      selfRunning: true, subagentsTotal: 0, subagentsRunning: 0,
      jobsRunning: 0, jobsStopping: 0, jobsFailed: 0, abnormalTurns: 0,
    }]]),
    statusSnapshot: new Map(),
  }))
  assert.equal(running.primary, STATE_DOT.ONGOING)

  // One dot per row: whatever is running — the row's own agent, a subagent, a
  // background job — spins it. The composition lives in the tooltip, not in a
  // second glyph.
  const snapshot = list([
    { id: 's' },
    { id: 'kid', parentId: 's', origin: 'subagent', running: true },
  ])
  const { rollup } = buildRollup(snapshot, jobs({
    s: [{ status: 'running' }],
    kid: [{ status: 'running' }],
  }))
  const planOf = (entry) => dotPlan(statusOf('s', {
    rollup,
    statusSnapshot: new Map(Object.entries(entry)),
  }))
  const delegated = planOf({})
  assert.deepEqual(delegated, { primary: STATE_DOT.ONGOING })
  const both = planOf({ s: { running: true } })
  assert.deepEqual(both, { primary: STATE_DOT.ONGOING })
  // Pending outranks everything, and running outranks unread: the host's own
  // precedence, not the renderer's, decides which fact the single dot carries.
  assert.equal(planOf({ s: { pendingInteraction: 'approval' } }).primary, STATE_DOT.WARNING)
  assert.equal(planOf({ s: { completionUnread: true } }).primary, STATE_DOT.ONGOING)
  const unreadOnly = dotPlan(statusOf('s', {
    rollup: new Map([['s', {
      selfRunning: false, subagentsTotal: 0, subagentsRunning: 0,
      jobsRunning: 0, jobsStopping: 0, jobsFailed: 0, abnormalTurns: 0,
    }]]),
    statusSnapshot: new Map([['s', { completionUnread: true }]]),
  }))
  assert.equal(unreadOnly.primary, STATE_DOT.DONE)
})

test('dotPlan folds subagent and job work into that dot, and reports no failure', () => {
  const snapshot = list([
    { id: 'root' },
    { id: 'child', parentId: 'root', origin: 'subagent', running: true },
    { id: 'bad', parentId: 'root', origin: 'subagent', projectionValues: { subagentTiming: { settledMs: 1, lastTurnCompleted: false } } },
  ])
  const { rollup } = buildRollup(snapshot, jobs({
    root: [{ status: 'running' }, { status: 'failed', finishedAt: 500 }],
    bad: [{ status: 'failed', finishedAt: 500 }],
  }))
  const status = statusOf('root', { rollup, statusSnapshot: new Map() })
  // A live run of any family is the spinner; the plan carries no marks at all,
  // and the failure families stay out of the row even though the roster reports
  // them.
  assert.deepEqual(dotPlan(status), { primary: STATE_DOT.ONGOING })
  // The counts the tooltip needs are still available from the status itself.
  assert.equal(status.activity.jobs.own, 1)
  assert.equal(status.activity.subagents.running, 1)
})

test('a settled failure leaves the row completely unmarked', () => {
  const snapshot = list([{ id: 's' }])
  const { rollup } = buildRollup(snapshot, jobs({ s: [{ status: 'failed', finishedAt: 100 }] }))
  const idle = dotPlan(statusOf('s', { rollup, statusSnapshot: statuses({ s: {} }) }))
  assert.deepEqual(idle, { primary: STATE_DOT.IDLE })

  const running = dotPlan(statusOf('s', { rollup, statusSnapshot: statuses({ s: { running: true } }) }))
  assert.deepEqual(running, { primary: STATE_DOT.ONGOING })
})

test('isVisibleMember applies the three-way archived filter and hides other blanks', () => {
  const snapshot = list([
    { id: 'live' },
    { id: 'archived', archived: true },
    { id: 'blank', blank: true },
    { id: 'other-blank', blank: true },
    { id: 'child', parentId: 'live', origin: 'subagent' },
  ])
  const base = { byId: snapshot.byId, currentId: 'blank', archivedSessionIds: ['archived'] }
  assert.equal(isVisibleMember('live', { ...base, archivedFilter: 'default' }), true)
  assert.equal(isVisibleMember('archived', { ...base, archivedFilter: 'default' }), false)
  assert.equal(isVisibleMember('archived', { ...base, archivedFilter: 'show' }), true)
  assert.equal(isVisibleMember('live', { ...base, archivedFilter: 'only' }), false)
  assert.equal(isVisibleMember('archived', { ...base, archivedFilter: 'only' }), true)
  assert.equal(isVisibleMember('blank', { ...base, archivedFilter: 'default' }), true)
  assert.equal(isVisibleMember('other-blank', { ...base, archivedFilter: 'default' }), false)
  assert.equal(isVisibleMember('child', { ...base, archivedFilter: 'default' }), false)
  assert.equal(isVisibleMember('ghost', { ...base, archivedFilter: 'default' }), false)
})

test('computeGroups keeps host membership, fronts pinned and honours manual order', () => {
  const snapshot = list([
    { id: 'p1', updatedAt: 1 },
    { id: 'w1a', updatedAt: 2 },
    { id: 'w1b', updatedAt: 3 },
    { id: 'w2a', updatedAt: 4 },
    { id: 'loose', updatedAt: 5 },
  ])
  const workspaces = [
    { workspaceId: 'w1', title: 'alpha', path: '/tmp/alpha', sessionIds: ['w1a', 'p1', 'w1b'] },
    { workspaceId: 'w2', title: 'beta', path: '/tmp/beta', sessionIds: ['w2a'] },
  ]
  const tree = computeGroups({
    list: snapshot,
    workspaces,
    orderBy: 'manual',
    archivedFilter: 'default',
    pinnedSessionIds: ['p1'],
    archivedSessionIds: [],
    currentId: undefined,
    expandedKeys: ['w1'],
    labels: { ungrouped: '未分组' },
  })
  // Pinned leads globally, and is lifted out of its workspace block.
  assert.deepEqual(tree.pinned, ['p1'])
  assert.deepEqual(tree.groups.map(group => group.key), ['w1', 'w2', ''])
  assert.deepEqual(tree.groups[0].sessions, ['w1a', 'w1b'])
  assert.equal(tree.groups[0].expanded, true)
  assert.equal(tree.groups[0].label, 'alpha')
  assert.equal(tree.groups[0].cwd, '/tmp/alpha')
  assert.equal(tree.groups[1].expanded, false)
  // Sessions outside every workspace account land in the ungrouped bucket.
  assert.deepEqual(tree.groups[2].sessions, ['loose'])
  assert.equal(tree.groups[2].label, '未分组')
})

test('computeGroups drops empty groups and follows recency order when asked', () => {
  const snapshot = list([{ id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 9 }])
  const tree = computeGroups({
    list: snapshot,
    workspaces: [
      { workspaceId: 'full', title: 'full', sessionIds: ['a', 'b'] },
      { workspaceId: 'empty', title: 'empty', sessionIds: [] },
    ],
    orderBy: 'updated',
    archivedFilter: 'default',
    pinnedSessionIds: [],
    archivedSessionIds: [],
  })
  assert.deepEqual(tree.groups.map(group => group.key), ['full'])
  assert.deepEqual(tree.groups[0].sessions, ['b', 'a'])
})

/* ------------------------------------------------------------------ *
 * Paging and search
 * ------------------------------------------------------------------ */

test('sanitizeQuery strips NUL and never splits a surrogate pair at the cap', () => {
  assert.equal(sanitizeQuery('a\u0000b'), 'ab')
  assert.equal(sanitizeQuery('abc', 5), 'abc')
  assert.equal(sanitizeQuery('abcdef', 3), 'abc')
  // An emoji is one astral character but two code units: the cap must back off
  // rather than slice it in half.
  const emoji = '\u{1F600}'
  assert.equal(sanitizeQuery(`ab${emoji}cd`, 3), 'ab')
  assert.equal(sanitizeQuery(`ab${emoji}cd`, 4), `ab${emoji}`)
})

test('requiredPageLimit raises the page to the last session that needs attention', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  assert.equal(requiredPageLimit(ids, new Set(), undefined), 0)
  assert.equal(requiredPageLimit(ids, new Set(['d']), undefined), 4)
  assert.equal(requiredPageLimit(ids, new Set(), 'b'), 2)
  // Only the first SESSION_PAGE_AUTO_MAX rows can raise a page on their own.
  const long = Array.from({ length: 60 }, (_, index) => `s${index}`)
  assert.equal(requiredPageLimit(long, new Set(['s59']), undefined), 0)
  assert.equal(requiredPageLimit(long, new Set(['s49']), undefined), 50)
})

test('pageRows shows the page, the attention requirement, or everything', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  assert.deepEqual(pageRows(ids, SESSION_PAGE_BASE), { visible: ['a', 'b', 'c', 'd', 'e'], hiddenCount: 2 })
  assert.deepEqual(pageRows(ids, SESSION_PAGE_BASE, 7), { visible: ids, hiddenCount: 0 })
  assert.deepEqual(pageRows(ids, SESSION_PAGE_BASE, 6), { visible: ['a', 'b', 'c', 'd', 'e', 'f'], hiddenCount: 1 })
  assert.deepEqual(pageRows(['a', 'b'], 5), { visible: ['a', 'b'], hiddenCount: 0 })
})

test('nextPageLimit steps by one page, or reveals all when only a page is left', () => {
  assert.equal(nextPageLimit(SESSION_PAGE_BASE, 20), 10)
  assert.equal(nextPageLimit(SESSION_PAGE_BASE, 6), 10)
  assert.equal(nextPageLimit(SESSION_PAGE_BASE, 5), Number.MAX_SAFE_INTEGER)
  assert.equal(nextPageLimit(SESSION_PAGE_BASE, 2), Number.MAX_SAFE_INTEGER)
})

test('workspaceLabelOf takes the final path segment for either separator', () => {
  assert.equal(workspaceLabelOf('/tmp/me/code/alpha'), 'alpha')
  assert.equal(workspaceLabelOf('/tmp/me/code/alpha/'), 'alpha')
  assert.equal(workspaceLabelOf('C:\\work\\beta'), 'beta')
  assert.equal(workspaceLabelOf(''), '')
  assert.equal(workspaceLabelOf(undefined), '')
})

test('buildSearchNodes merges local title matches with content hits', () => {
  const snapshot = list([
    { id: 'alpha-one', displayTitle: 'Alpha one', updatedAt: 5 },
    { id: 'beta', displayTitle: 'Beta', updatedAt: 9 },
    { id: 'child', parentId: 'beta', origin: 'subagent', displayTitle: 'Alpha child' },
    { id: 'blank', displayTitle: 'Alpha blank', blank: true },
    { id: 'archived', displayTitle: 'Alpha archived', updatedAt: 1 },
  ])
  const result = buildSearchNodes({
    list: snapshot,
    workspaces: [{ workspaceId: 'w', title: 'alpha-project', path: '/tmp/alpha-project', sessionIds: ['alpha-one', 'beta'] }],
    query: 'alpha',
    items: [{ sessionId: 'beta', snippet: '…alpha in the log…' }],
    hasMore: false,
    limit: 10,
    archivedSessionIds: ['archived'],
    archivedFilter: 'default',
  })
  // `alpha-one` matches on title, `beta` on its workspace name, and both are
  // ordered by recency; the content hit adds the snippet to the existing row.
  assert.deepEqual(result.nodes.map(node => node.id), ['beta', 'alpha-one'])
  assert.equal(result.nodes[0].snippet, '…alpha in the log…')
  assert.equal(result.nodes[0].workspace, 'alpha-project')
  // Subagent rows and blank placeholders never match.
  assert.equal(result.nodes.some(node => node.id === 'child' || node.id === 'blank'), false)
})

test('buildSearchNodes honours the archived filter, the limit and hasMore', () => {
  const snapshot = list([
    { id: 'a', displayTitle: 'hit a', updatedAt: 3 },
    { id: 'b', displayTitle: 'hit b', updatedAt: 2 },
    { id: 'c', displayTitle: 'hit c', updatedAt: 1 },
  ])
  const base = {
    list: snapshot, workspaces: [], query: 'hit', items: [], limit: 2,
    archivedSessionIds: [], archivedFilter: 'default',
  }
  const limited = buildSearchNodes(base)
  assert.deepEqual(limited.nodes.map(node => node.id), ['a', 'b'])
  assert.equal(limited.truncated, true)
  assert.equal(limited.hasMore, true)
  assert.equal(limited.total, 3)
  // An empty query is not a search.
  assert.deepEqual(buildSearchNodes({ ...base, query: '   ' }).nodes, [])
})

test('computeGroups keeps every member so the region can page them itself', () => {
  const snapshot = list(Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, updatedAt: 7 - index })))
  const tree = computeGroups({
    list: snapshot,
    workspaces: [{ workspaceId: 'w', title: 'w', sessionIds: snapshot.ids }],
    orderBy: 'updated',
    archivedFilter: 'default',
    pinnedSessionIds: [],
    archivedSessionIds: [],
  })
  assert.equal(tree.groups[0].sessions.length, 7)
  const page = pageRows(tree.groups[0].sessions, SESSION_PAGE_BASE, requiredPageLimit(tree.groups[0].sessions, new Set(['s6']), undefined))
  assert.deepEqual(page, { visible: ['s0', 's1', 's2', 's3', 's4', 's5', 's6'], hiddenCount: 0 })
})

test('watchTargets covers every painted row and its whole subtree', () => {
  const snapshot = list([
    { id: 'root' },
    { id: 'child', parentId: 'root', origin: 'subagent' },
    { id: 'grandchild', parentId: 'child', origin: 'subagent' },
    { id: 'other' },
  ])
  const children = buildChildren(snapshot)
  // A row's status folds its subtree, so watching only the rendered id would
  // never open the roster a grandchild's background job lives in.
  assert.deepEqual(watchTargets(['root', 'other'], children),
    ['root', 'child', 'grandchild', 'other'])
  // A session can be both a row and another row's descendant: one stream serves
  // both, and the second visit adds nothing twice.
  assert.deepEqual(watchTargets(['root', 'child', 'root'], children),
    ['root', 'child', 'grandchild'])
  // Degrades instead of throwing: no children index, blank ids, absent list.
  assert.deepEqual(watchTargets(['', null, 'root'], undefined), ['root'])
  assert.deepEqual(watchTargets(undefined, children), [])
})
