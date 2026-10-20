/**
 * Contract lane: evaluate the shipped bundle the way the client module system
 * does, then drive the registered region with fake host services.
 *
 * This replaces the previous DOM-projection browser lane. The projection is gone,
 * so what needs proving changed: the registration shape, that the injected
 * actions reach the Host services with Host identities, that a drag and a
 * keyboard move both resolve to `insertSessionBefore`, and that the rendered
 * tree carries one row per visible session with the expected status marks.
 *
 * React, the primitives and the DOM are stubbed to the minimum the bundle
 * touches. The stub keeps real per-instance state and re-renders on demand, so
 * the drag path (which legitimately holds its in-flight source in component
 * state) is exercised for real rather than short-circuited.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

/**
 * Minimal but stateful `react` stand-in: enough to render one tree, dispatch
 * handlers, re-render, and collect effect cleanups.
 * @returns {object} the stub plus its render driver.
 */
function createReact() {
  const instances = []
  let cursor = 0
  let effects = []
  let current = null

  const hook = () => current

  function walk(element) {
    if (element === null || element === undefined || element === false) return null
    if (typeof element === 'string' || typeof element === 'number') return String(element)
    if (typeof element.type === 'function') {
      const slot = cursor++
      const instance = instances[slot] || (instances[slot] = { cursor: 0, state: [], effectCursor: 0 })
      instance.cursor = 0
      instance.effectCursor = 0
      const previous = current
      current = instance
      const rendered = element.type(element.props)
      current = previous
      return walk(rendered)
    }
    return {
      type: element.type,
      props: element.props,
      children: element.props.children.map(walk).filter(Boolean),
    }
  }

  return {
    createElement(type, props, ...children) {
      return {
        type,
        props: { ...(props || {}), children: children.flat().filter(child => child !== null && child !== undefined && child !== false) },
      }
    },
    useState(initial) {
      const instance = hook()
      const index = instance.cursor++
      if (!(index in instance.state)) instance.state[index] = typeof initial === 'function' ? initial() : initial
      return [instance.state[index], (next) => {
        instance.state[index] = typeof next === 'function' ? next(instance.state[index]) : next
      }]
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      subscribe(() => {})
      return getSnapshot()
    },
    useEffect(effect, deps) {
      const instance = hook()
      const index = instance.effectCursor++
      const previous = instance.effectDeps?.[index]
      const changed = previous === undefined || deps === undefined
        || deps.length !== previous.length
        || deps.some((value, at) => !Object.is(value, previous[at]))
      if (!changed) return
      instance.effectDeps = instance.effectDeps || []
      instance.effectCleanups = instance.effectCleanups || []
      // React runs the previous cleanup before the next effect body; without
      // that, a listener removed only by its cleanup would look permanent.
      const prior = instance.effectCleanups[index]
      if (typeof prior === 'function') prior()
      instance.effectCleanups[index] = undefined
      instance.effectDeps[index] = deps
      // The wrapper has to *return* the cleanup: a block body alone swallowed it,
      // so `render()` never collected one and no lane could prove an unmount
      // releases what it opened.
      effects.push(() => {
        instance.effectCleanups[index] = effect()
        return instance.effectCleanups[index]
      })
    },
    useMemo(compute) { return compute() },
    useCallback(fn) { return fn },
    useRef() { return { current: null } },
    render(Component, props) {
      cursor = 0
      effects = []
      const tree = walk(this.createElement(Component, props))
      const cleanups = []
      for (const effect of effects) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      return { tree, cleanups }
    },
  }
}

/** Evaluate the shipped bundle and capture its registration. */
function loadBundle() {
  const react = createReact()
  let registration = null
  const styleEl = { setAttribute() {}, remove() { this.removed = true }, textContent: '' }
  const documentListeners = new Set()
  const clipboardWrites = []
  const sandbox = {
    console,
    navigator: { clipboard: { writeText: async (text) => { clipboardWrites.push(text) } } },
    document: {
      head: { append: () => {} },
      createElement: () => styleEl,
      addEventListener: (type) => { documentListeners.add(type) },
      removeEventListener: (type) => { documentListeners.delete(type) },
    },
    AbortController,
    window: {
      setInterval: () => 1,
      clearInterval: () => {},
      // The search input is debounced; the lane runs the callback immediately so
      // one render is one request.
      setTimeout: (callback) => { callback(); return 1 },
      clearTimeout: () => {},
      __ModuleLoader__: { load(options) { registration = options } },
    },
  }
  sandbox.globalThis = sandbox
  runInNewContext(bundle, sandbox)
  assert.ok(registration, 'the bundle must register with the module loader')
  const exports = registration.factory(spec => {
    if (spec === 'react') return react
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
      // The primitives are stubbed as marker host elements rather than as
      // components returning null: the lane needs their props to stay visible
      // in the rendered tree (which dot state, which menu rows).
      const marker = name => props => ({ type: `stub-${name}`, props: props || {}, children: [] })
      const base = { StateDot: marker('statedot'), Menu: marker('menu'), Modal: marker('modal') }
      // Every `Icon*` export is one marker component, so the lane can tell a
      // real icon seat from a text glyph.
      return new Proxy(base, {
        get: (target, key) => (key in target
          ? target[key]
          : (typeof key === 'string' && key.startsWith('Icon') ? marker('icon') : undefined)),
      })
    }
    throw new Error(`unexpected require(${spec})`)
  })
  return { exports, registration, react, styleEl, documentListeners, clipboardWrites }
}

/** Fixtures: two workspaces, a pinned session, a running subtree and a failed job. */
function fixtures() {
  const byId = {
    pinned: { id: 'pinned', displayTitle: 'Pinned one', running: false, blank: false, retainedBy: { mainView: 1 }, updatedAt: 1 },
    'w1-a': { id: 'w1-a', displayTitle: 'Alpha', running: true, blank: false, retainedBy: { mainView: 0 }, updatedAt: 5, cwd: '/tmp/w1' },
    'w1-b': { id: 'w1-b', displayTitle: 'Beta', running: false, blank: false, retainedBy: { mainView: 0 }, updatedAt: 4 },
    'w1-c': { id: 'w1-c', displayTitle: 'Cee', running: false, blank: false, retainedBy: { mainView: 0 }, updatedAt: 3 },
    child: { id: 'child', parentId: 'w1-a', origin: 'subagent', displayTitle: 'Child', running: true, blank: false, retainedBy: { mainView: 0 }, updatedAt: 3 },
    'w2-a': { id: 'w2-a', displayTitle: 'Gamma', running: false, blank: false, retainedBy: { mainView: 0 }, updatedAt: 2 },
  }
  return {
    list: { ids: ['pinned', 'w1-a', 'w1-b', 'w1-c', 'child', 'w2-a'], byId, phase: 'ready', projectionsBySession: {} },
    workspaces: {
      phase: 'ready', state: 'ready',
      items: [
        { workspaceId: 'w1', title: 'alpha', path: '/tmp/alpha', sessionIds: ['w1-a', 'pinned', 'w1-b', 'w1-c'] },
        { workspaceId: 'w2', title: 'beta', path: '/tmp/beta', sessionIds: ['w2-a'] },
      ],
      pinnedSessionIds: ['pinned'],
      archivedSessionIds: [],
    },
    statuses: new Map(),
    jobs: { rows: { 'w1-a': [{ id: 'job-1', status: 'failed', label: 'build', finishedAt: 1000 }] } },
  }
}

/** Build a fake client context and apply the plugin to it. */
function applyPlugin({ withJobs = true } = {}) {
  const { exports, react, styleEl, documentListeners, clipboardWrites } = loadBundle()
  const calls = []
  const effects = []
  let registered = null
  let pickResult = '/tmp/picked'
  let searchResult = { items: [], hasMore: false }
  const jobs = fixtures().jobs
  // The Host materializes a session's job roster only while some surface watches
  // it, so the fake records every open stream the way the real service does:
  // refcounted, released by the returned disposer.
  const watched = new Map()
  const jobsService = {
    state: { getSnapshot: () => jobs, subscribe: () => () => {} },
    watchRows(sessionId) {
      calls.push(['watchRows', sessionId])
      watched.set(sessionId, (watched.get(sessionId) || 0) + 1)
      return () => {
        calls.push(['releaseRows', sessionId])
        const left = (watched.get(sessionId) || 1) - 1
        if (left <= 0) watched.delete(sessionId)
        else watched.set(sessionId, left)
      }
    },
  }
  const ctx = {
    effect(factory, label) { effects.push({ label, dispose: factory() }) },
    get: name => (name === 'jobs' ? (withJobs ? jobsService : undefined) : undefined),
    locale: { register: (ns, dicts) => { calls.push(['locale.register', ns, Object.keys(dicts)]); return () => {} } },
    slots: {
      inject(name, callback) { calls.push(['slots.inject', name]); callback() },
      register(options, Component) { registered = { options, Component }; return () => {} },
    },
    uiWorkspace: {
      openSession: id => calls.push(['openSession', id]),
      startSession: id => calls.push(['startSession', id]),
      pinSession: id => calls.push(['pinSession', id]),
      unpinSession: id => calls.push(['unpinSession', id]),
      archiveSession: id => calls.push(['archiveSession', id]),
      unarchiveSession: id => calls.push(['unarchiveSession', id]),
      forkSession: id => calls.push(['forkSession', id]),
      pickDirectory: () => { calls.push(['pickDirectory']); return Promise.resolve(pickResult) },
    },
    sessions: {
      searchResultLimit: 5,
      search: (query) => {
        calls.push(['search', query])
        return Promise.resolve({ ok: true, value: searchResult })
      },
      using: (id, options, run) => {
        calls.push(['sessions.using', id, options.source])
        return Promise.resolve(run({ binding: { session: { rename: title => calls.push(['rename', id, title]) } } }))
      },
    },
    workspaces: {
      insertSessionBefore: (w, s, before) => calls.push(['insertSessionBefore', w, s, before]),
      insertBefore: (w, before) => calls.push(['insertBefore', w, before]),
      create: input => { calls.push(['createWorkspace', input.path]); return Promise.resolve({}) },
    },
  }
  exports.apply(ctx)
  assert.ok(registered, 'apply must register the sidebar browsing region')
  const injected = registered.options.inject()
  return {
    calls, clipboardWrites, effects, registered, injected, exports, react, styleEl, documentListeners, watched,
    setPickResult(result) { pickResult = result },
    setSearchResult(result) { searchResult = result },
  }
}

/** Depth-first walk of a rendered tree. */
function walk(node, visit) {
  if (!node || typeof node === 'string') return
  visit(node)
  for (const child of node.children || []) walk(child, visit)
}

/** The actions menu belonging to one row. */
function menuOfRow(tree, sessionId) {
  let row = null
  walk(tree, node => { if (node.props?.['data-dsm-session'] === sessionId) row = node })
  let menu = null
  if (row) walk(row, node => { if (node.type === 'stub-menu') menu = node })
  return menu
}

/** Every rendered row, in order. */
function rowsOf(tree) {
  const rows = []
  walk(tree, node => { if (node.props?.['data-dsm-session']) rows.push(node) })
  return rows
}

/**
 * Render the registered region with the fixture host snapshots.
 * @param {object} applied - capture returned by {@link applyPlugin}.
 * @param {object} overrides - extra component props (e.g. `wide: false`).
 * @returns {{tree: object, render: Function}} the tree plus a re-render function.
 */
function renderRegion(applied, overrides = {}) {
  const data = fixtures()
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
    ...overrides,
  }
  const render = () => applied.react.render(applied.registered.Component, props)
  const first = render()
  return { tree: first.tree, cleanups: first.cleanups, render, data, props }
}

/** A row element as the pointer handlers see it: identity plus its box. */
const rowElement = (id, top = 0, height = 32) => ({
  getAttribute: name => (name === 'data-dsm-session' || name === 'data-dsm-group' ? id : null),
  getBoundingClientRect: () => ({ top, bottom: top + height, height, left: 0, right: 240 }),
})
/** A pointer press/move/release on one row. The region reads the row under it. */
const pointerEvent = (over = {}) => ({
  button: 0,
  pointerType: 'mouse',
  pointerId: 1,
  preventDefault() {},
  clientX: 40,
  clientY: 8,
  currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
  ...over,
})
const keyEvent = (key) => {
  const event = { altKey: true, key, preventDefault() {}, stopPropagation() {} }
  return event
}
const withTarget = (event, node) => { event.target = node; event.currentTarget = node; return event }
const moves = calls => calls.filter(call => call[0] === 'insertSessionBefore')

/**
 * Copy a value into this realm. Arrays built inside the sandbox carry that
 * realm's `Array.prototype`, which `deepStrictEqual` refuses to match even when
 * the contents are identical.
 */
const plain = value => JSON.parse(JSON.stringify(value))

test('apply registers the browsing cell, its dictionaries and its styles reversibly', () => {
  const applied = applyPlugin()
  assert.deepEqual(applied.calls[0], ['locale.register', 'dsh-session-manager', ['zh', 'en']])
  assert.deepEqual(applied.calls[1], ['slots.inject', 'sidebar.workspaces'])
  assert.equal(applied.registered.options.name, 'sidebar.workspaces')
  assert.equal(applied.registered.options.priority, -2)
  assert.equal(applied.registered.options.locale, 'dsh-session-manager')
  assert.equal(applied.registered.options.registrant, '@pianner/dsh-session-manager')
  assert.equal(applied.exports.inject.includes('jobs'), false, 'jobs stays optional')
  renderRegion(applied)
  // `ctx.effect` owns the region's lifecycle: disposing it must undo the style
  // element, which is the only DOM the plugin ever owns.
  for (const effect of applied.effects) if (typeof effect.dispose === 'function') effect.dispose()
  assert.equal(applied.styleEl.removed, true)
})

test('the injected face reaches the host services with host identities', async () => {
  const applied = applyPlugin()
  const face = applied.injected
  face.open('w1-a')
  face.pinSession('w1-a')
  face.unpinSession('w1-a')
  face.archiveSession('w1-a')
  face.unarchiveSession('w1-a')
  face.forkSession('w1-a')
  await face.renameSession('w1-a', 'renamed')
  face.insertSessionBefore('w1', 'w1-b', 'w1-a')
  await new Promise(resolve => setImmediate(resolve))
  // The guarded actions settle on microtasks, so the lane compares the set
  // rather than one interleaving.
  const actions = applied.calls
    .filter(call => call[0] !== 'slots.inject' && call[0] !== 'locale.register')
    .map(call => JSON.stringify(call))
    .sort()
  assert.deepEqual(actions, [
    ['openSession', 'w1-a'],
    ['pinSession', 'w1-a'],
    ['unpinSession', 'w1-a'],
    ['archiveSession', 'w1-a'],
    ['unarchiveSession', 'w1-a'],
    ['forkSession', 'w1-a'],
    ['sessions.using', 'w1-a', 'workspaceOperation'],
    ['rename', 'w1-a', 'renamed'],
    ['insertSessionBefore', 'w1', 'w1-b', 'w1-a'],
  ].map(call => JSON.stringify(call)).sort())
  assert.deepEqual(face.hooks.notice.getSnapshot(), null)
})

test('the region renders one row per visible session with the pinned block first', () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  // Subagent rows are never listed; the pinned session leads its own block.
  assert.deepEqual(rowsOf(tree).map(row => row.props['data-dsm-session']),
    ['pinned', 'w1-a', 'w1-b', 'w1-c', 'w2-a'])
  // The pinned block is a heading, the two workspace blocks are directory rows.
  const sections = []
  walk(tree, node => {
    if (node.props?.className === 'dsm-section-header') sections.push(['workspace', node.props['aria-expanded']])
    if (node.props?.className === 'dsm-heading-header') sections.push(['heading', node.props['aria-expanded']])
  })
  assert.deepEqual(plain(sections),
    [['heading', 'true'], ['heading', 'true'], ['workspace', 'true'], ['workspace', 'true']],
    'the two fixed headings, then two workspace blocks, and no empty bucket')
})

test('a workspace row reads like the shipped one: folder seat, chevron, path tooltip', () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  // The group header carries the host's canonical directory as a tooltip only.
  const titles = []
  walk(tree, node => {
    if (node.props?.className === 'dsm-section-header') titles.push(node.props.title)
  })
  // The pinned heading is not a directory at all, so only workspaces carry a path.
  assert.deepEqual(plain(titles), ['/tmp/alpha', '/tmp/beta'])
  // Each workspace row has a 16x20 folder seat and a chevron; the pinned block
  // has the chevron but no folder, because it is not a directory.
  const slots = []
  walk(tree, node => {
    if (node.props?.className === 'dsm-slot') slots.push(node.children[0]?.type)
  })
  assert.deepEqual(plain(slots), ['stub-icon', 'stub-icon'], 'one folder seat per workspace group')
  const chevrons = []
  walk(tree, node => { if (node.props?.className === 'dsm-chevron') chevrons.push(node.type) })
  // One chevron per fold: the pinned block, the project block, two workspaces.
  assert.equal(chevrons.length, 4, 'pinned block, project block and two workspaces')
  // The project block is a heading that folds every workspace group at once.
  const dividers = []
  walk(tree, node => {
    if (node.props?.className !== 'dsm-project-header') return
    dividers.push([node.props.role, node.props['aria-level'], node.children[0].props.className])
  })
  assert.deepEqual(plain(dividers), [['heading', 2, 'dsm-heading-header']])
})

test('the pin badge is not repeated inside the pinned block', () => {
  const applied = applyPlugin()
  // Every row in that block is pinned, so the badge would only cost the title its
  // width; a pinned row seen anywhere else still carries it (asserted statically
  // in the plugin lane, where the badge's condition is locked).
  const badges = []
  walk(renderRegion(applied).tree, node => { if (node.props?.className === 'dsm-pin') badges.push(node.props['aria-label']) })
  assert.deepEqual(badges, [])
})

test('one dot per row: anything running spins it, and no extra glyph is painted', () => {
  const applied = applyPlugin()
  // Alpha's own agent runs; its child runs too.
  const { tree } = renderRegion(applied)
  const states = []
  walk(tree, node => { if (node.type === 'stub-statedot') states.push(node.props.state) })
  assert.ok(states.includes('ongoing'), 'a row with running work renders the spinner')

  // A session whose only activity is a background job: the same single spinner,
  // and nothing beside the title. The old design painted a second amber mark for
  // the very same fact.
  const data = fixtures()
  data.list.byId['w2-a'].running = false
  data.jobs.rows['w2-a'] = [{ id: 'job-2', status: 'running', label: 'deploy' }]
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
  }
  const jobOnly = applied.react.render(applied.registered.Component, props)
  let gamma = null
  walk(jobOnly.tree, node => {
    if (node.props?.['data-dsm-session'] === 'w2-a') gamma = node
  })
  const own = []
  const extra = []
  walk(gamma, node => {
    if (node.type === 'stub-statedot') own.push(node.props.state)
    if (node.props?.className === 'dsm-marks' || node.props?.['data-kind']) extra.push(node.props.className)
  })
  assert.deepEqual(plain(own), ['ongoing'], 'a job-running row uses the one dot')
  assert.deepEqual(plain(extra), [], 'no qualifier glyphs are rendered any more')
})

test('the dot title carries the composition that the glyphs used to', () => {
  const applied = applyPlugin()
  const data = fixtures()
  // The row's own agent and its subagent are both idle, so the only facts left
  // are two background jobs with different owners. One dot, one sentence.
  data.list.byId['w1-a'].running = false
  data.list.byId.child.running = false
  data.jobs.rows['w1-a'] = [{ id: 'own-1', status: 'running', label: 'own' }]
  data.jobs.rows.child = [{ id: 'kid-1', status: 'running', label: 'kid' }]
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
  }
  const { tree } = applied.react.render(applied.registered.Component, props)
  let alpha = null
  walk(tree, node => { if (node.props?.['data-dsm-session'] === 'w1-a') alpha = node })
  const slots = []
  walk(alpha, node => {
    if (node.props?.className === 'dsm-dot-slot') slots.push(node.props)
  })
  assert.equal(slots.length, 1, 'exactly one status cell per row')
  assert.equal(slots[0].title, 'status.jobs:{"n":1}，status.subagentJobs:{"n":1}')
  assert.deepEqual(plain(slots[0]['data-dot']), 'ongoing')
})

test('a running subtree and a live job fold into one dot; a settled failure never paints', () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  const dots = []
  walk(tree, node => {
    if (node.type === 'stub-statedot') dots.push(node.props.state)
    if (node.props?.['data-kind']) dots.push(`mark:${node.props['data-kind']}`)
  })
  // Alpha is running because its child is a live subagent and its own agent is
  // at work. The failed job in its roster is history, not a row state.
  assert.equal(dots.includes('error'), false, 'no row may claim a failure')
  assert.equal(dots.some(state => String(state).startsWith('mark:')), false, 'no mark glyphs')
  const titles = []
  walk(tree, node => { if (node.props?.className === 'dsm-dot-slot') titles.push(node.props.title) })
  assert.ok(titles.includes('status.running，status.subagents:{"n":1}'), 'the dot names the composition')
})

test('a drag drop resolves a durable host anchor instead of reordering locally', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const source = rowsOf(region.tree).find(row => row.props['data-dsm-session'] === 'w1-c')
  source.props.onPointerDown(pointerEvent())
  // Past the threshold, then over alpha's upper half: insert before alpha.
  source.props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('w1-a') }))
  rowsOf(region.render().tree).find(row => row.props['data-dsm-session'] === 'w1-c')
    .props.onPointerUp(pointerEvent())
  assert.deepEqual(moves(applied.calls), [['insertSessionBefore', 'w1', 'w1-c', 'w1-a']])
})

test('a gesture that never leaves the list still commits where its marker points', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const source = () => rowsOf(region.render().tree).find(row => row.props['data-dsm-session'] === 'w1-c')
  source().props.onPointerDown(pointerEvent())
  source().props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('w1-a') }))
  // Released where the marker points: no drop event exists in this model.
  source().props.onPointerUp(pointerEvent())
  assert.deepEqual(moves(applied.calls), [['insertSessionBefore', 'w1', 'w1-c', 'w1-a']])
})

test('a flick that renders no frame still commits the row it ended on', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  // Every handler below belongs to the same render: a real flick can start and
  // end between frames, so the commit must come from the gesture, not from the
  // marker state the frame never painted.
  const source = rowsOf(region.tree).find(row => row.props['data-dsm-session'] === 'w1-c')
  source.props.onPointerDown(pointerEvent())
  source.props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('w1-a') }))
  source.props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('w1-b') }))
  source.props.onPointerUp(pointerEvent())
  assert.deepEqual(moves(applied.calls),
    [['insertSessionBefore', 'w1', 'w1-c', 'w1-b']],
    'the last marked row wins even though nothing re-rendered')
})

test('a press that never crosses the threshold is a click, not a reorder', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const source = rowsOf(region.tree).find(row => row.props['data-dsm-session'] === 'w1-c')
  source.props.onPointerDown(pointerEvent())
  source.props.onPointerMove(pointerEvent({ clientY: 10, target: rowElement('w1-a') }))
  rowsOf(region.render().tree).find(row => row.props['data-dsm-session'] === 'w1-c')
    .props.onPointerUp(pointerEvent())
  assert.deepEqual(moves(applied.calls), [], 'a nudge must not reorder')
  // And the click that follows still opens the session.
  rowsOf(region.render().tree).find(row => row.props['data-dsm-session'] === 'w1-c')
    .props.onClick(pointerEvent())
  assert.deepEqual(applied.calls.filter(call => call[0] === 'openSession'), [['openSession', 'w1-c']])
})

test('the click that ends a gesture does not also open the session', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const source = () => rowsOf(region.render().tree).find(row => row.props['data-dsm-session'] === 'w1-c')
  source().props.onPointerDown(pointerEvent())
  source().props.onPointerMove(pointerEvent({ clientY: 20, target: rowElement('w1-a') }))
  source().props.onPointerUp(pointerEvent())
  source().props.onClick(pointerEvent())
  assert.deepEqual(applied.calls.filter(call => call[0] === 'openSession'), [], 'the gesture opened a session')
  // Only the gesture's own click is swallowed.
  source().props.onClick(pointerEvent())
  assert.deepEqual(applied.calls.filter(call => call[0] === 'openSession'), [['openSession', 'w1-c']])
})

test('pressing the row actions never arms a reorder gesture', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const row = rowsOf(region.tree).find(candidate => candidate.props['data-dsm-session'] === 'w1-c')
  // The press lands on the actions button, whose ancestor chain answers `closest`.
  const onButton = { closest: selector => (selector.includes('button') ? { tagName: 'BUTTON' } : null) }
  row.props.onPointerDown(pointerEvent({ target: onButton }))
  row.props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('w1-a') }))
  row.props.onPointerUp(pointerEvent())
  assert.deepEqual(moves(applied.calls), [], 'the menu press must not move the session')
  // The same press on the row body still drags.
  const plain = rowsOf(region.render().tree).find(candidate => candidate.props['data-dsm-session'] === 'w1-c')
  plain.props.onPointerDown(pointerEvent())
  plain.props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('w1-a') }))
  rowsOf(region.render().tree).find(candidate => candidate.props['data-dsm-session'] === 'w1-c')
    .props.onPointerUp(pointerEvent())
  assert.deepEqual(moves(applied.calls), [['insertSessionBefore', 'w1', 'w1-c', 'w1-a']])
})

test('a gesture only takes rows the host can actually move', () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  const gestures = {}
  walk(tree, node => {
    const id = node.props?.['data-dsm-session']
    if (id) gestures[id] = typeof node.props.onPointerDown === 'function'
  })
  for (const id of ['pinned', 'w1-a', 'w1-b', 'w1-c', 'w2-a']) assert.equal(gestures[id], true, id)
  // The ungrouped bucket has no account to write into, so it takes no gesture.
  const data = fixtures()
  data.workspaces.items = [{ workspaceId: 'w1', title: 'alpha', path: '/tmp/alpha', sessionIds: ['w1-a'] }]
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: key => key,
    ...applied.injected,
  }
  let loose = null
  walk(applied.react.render(applied.registered.Component, props).tree, node => {
    if (node.props?.['data-dsm-session'] === 'w1-b') loose = node
  })
  assert.equal(loose.props.onPointerDown, undefined)
})

test('the pinned block reorders through the pin set the host actually owns', async () => {
  const applied = applyPlugin()
  const data = fixtures()
  data.workspaces.pinnedSessionIds = ['p1', 'p2', 'p3']
  for (const id of ['p1', 'p2', 'p3']) {
    data.list.byId[id] = { id, displayTitle: id, running: false, blank: false, retainedBy: { mainView: 0 }, updatedAt: 10 }
  }
  data.list.ids = ['p1', 'p2', 'p3', ...data.list.ids]
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
  }
  const region = {
    render: () => applied.react.render(applied.registered.Component, props),
    get tree() { return this.render().tree },
  }
  const source = rowsOf(region.tree).find(row => row.props['data-dsm-session'] === 'p3')
  source.props.onPointerDown(pointerEvent())
  // Drop p3 above p1: the wanted order is p3, p1, p2.
  source.props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('p1') }))
  rowsOf(region.render().tree).find(row => row.props['data-dsm-session'] === 'p3')
    .props.onPointerUp(pointerEvent())
  await new Promise(resolve => setImmediate(resolve))
  // Pin prepends, so the head of the wanted order is written last.
  assert.deepEqual(applied.calls.filter(call => call[0] === 'unpinSession'), [
    ['unpinSession', 'p1'], ['unpinSession', 'p2'], ['unpinSession', 'p3'],
  ])
  assert.deepEqual(applied.calls.filter(call => call[0] === 'pinSession'), [
    ['pinSession', 'p2'], ['pinSession', 'p1'], ['pinSession', 'p3'],
  ])
  // And a pinned move never touches a workspace account.
  assert.deepEqual(moves(applied.calls), [])
})

test('the view-options menu is controlled by its anchor', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const headerMenu = (tree) => {
    let found = null
    walk(tree, node => {
      if (node.type === 'stub-menu' && node.props.items?.some(item => item.id === 'orderManual')) found = node
    })
    return found
  }
  const menu = headerMenu(region.tree)
  assert.ok(menu, 'the header renders the view-options menu')
  // `Menu` renders nothing until it is told to: an anchor without an opener and
  // a menu without `open` is a button that appears to do nothing.
  assert.equal(menu.props.open, false)
  assert.deepEqual(plain(menu.props.selectedIds), ['orderManual', 'archivedDefault'])
  assert.equal(menu.props.align, 'end')
  assert.equal(menu.props.portal, true)
  menu.props.anchor.props.onClick()
  const opened = headerMenu(region.render().tree)
  assert.equal(opened.props.open, true, 'the anchor opens the menu')
  opened.props.onSelect('orderUpdated')
  const picked = headerMenu(region.render().tree)
  assert.equal(picked.props.open, false, 'a selection closes the menu')
  assert.deepEqual(plain(picked.props.selectedIds), ['orderUpdated', 'archivedDefault'])
})

test('both fixed sections fold on their own and keep their headers', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const headerOf = (tree, className, index = 0) => {
    const found = []
    walk(tree, node => { if (node.props?.className === className) found.push(node) })
    return found[index]
  }
  const rowCount = tree => rowsOf(tree).length
  const full = rowCount(region.tree)
  // The project fold hides every workspace group in one gesture.
  // Both fixed sections use the same heading control: 0 = pinned, 1 = project.
  const pinnedToggle = headerOf(region.tree, 'dsm-heading-header', 0)
  const projectToggle = headerOf(region.tree, 'dsm-heading-header', 1)
  assert.equal(projectToggle.props['aria-expanded'], 'true')
  projectToggle.props.onClick()
  const folded = region.render()
  assert.equal(rowCount(folded.tree) < full, true, 'folding the project block hides its rows')
  assert.ok(headerOf(folded.tree, 'dsm-project-header'), 'the header stays')
  headerOf(folded.tree, 'dsm-heading-header', 1).props.onClick()
  assert.equal(rowCount(region.render().tree), full, 'and it opens again')
  // The pinned fold is its own, and the two do not interfere.
  headerOf(region.tree, 'dsm-heading-header', 0).props.onClick()
  assert.equal(rowCount(region.render().tree) < full, true, 'folding the pinned block hides its rows')
})

test('a priority label ranks the row without borrowing a status colour', () => {
  const applied = applyPlugin()
  const writes = []
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(fixtures().list),
    useWorkspaces: selector => selector(fixtures().workspaces),
    useSessionStatus: selector => selector(fixtures().statuses),
    useJobs: selector => selector(fixtures().jobs),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
    setPriority: (sessionId, value) => { writes.push([sessionId, value]) },
  }
  // Labels live in the plugin's own store: seed it through the real face write.
  props.priorityStore.set({ 'w1-a': 'p1', 'w1-b': 'red' })
  const tree = applied.react.render(applied.registered.Component, props).tree
  const labelled = rowsOf(tree).find(row => row.props['data-dsm-session'] === 'w1-a')
  assert.equal(labelled.props['data-priority'], 'p1')
  const pill = []
  walk(labelled, node => { if (node.props?.className === 'dsm-priority') pill.push([node.children[0], node.props['data-level']]) })
  // Rank is spelled out, and the palette itself is the stylesheet's business.
  assert.deepEqual(plain(pill), [['P1', 'p1']])
  // A colour stored by the first cut still resolves to the rank it meant.
  const legacy = rowsOf(tree).find(row => row.props['data-dsm-session'] === 'w1-b')
  assert.equal(legacy.props['data-priority'], 'p1')
  const plain3 = rowsOf(tree).find(row => row.props['data-dsm-session'] === 'w1-c')
  assert.equal(plain3.props['data-priority'], undefined)
  // No priority rule may borrow a status hue: red/amber/green/neutral stay the
  // status vocabulary's own.
  const css = applied.styleEl.textContent
  const priorityRules = css.split('}').filter(block => block.includes('.dsm-priority'))
  assert.equal(priorityRules.some(block => /success|warn|error|idle/.test(block)), false)
  // The menu marks the current label and offers the rest.
  const menu = menuOfRow(tree, 'w1-a')
  assert.equal(menu.props.selectedIds.includes('priority:p1'), true)
  const ids = plain(menu.props.items.map(item => item.id))
  for (const id of ['priority:p1', 'priority:p2', 'priority:p3', 'priority:p4', 'priority:none']) {
    assert.equal(ids.includes(id), true, id)
  }
  menu.props.onSelect('priority:p3')
  menu.props.onSelect('priority:none')
  assert.deepEqual(plain(writes), [['w1-a', 'p3'], ['w1-a', 'none']])
})

test('the row menu is controlled, and only a real value is marked', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  // One menu per row: address it through the row that owns it.
  const rowMenu = (tree, id = 'w1-a') => {
    let row = null
    walk(tree, node => { if (node.props?.['data-dsm-session'] === id) row = node })
    let found = null
    walk(row, node => { if (node.type === 'stub-menu') found = node })
    return found
  }
  const menu = rowMenu(region.tree)
  assert.equal(menu.props.open, false)
  // Only a real value is ticked: a toggle's state lives in its label.
  assert.deepEqual(plain(menu.props.selectedIds), [])
  // The anchor stops the row's own click so opening the menu never opens the session.
  menu.props.anchor.props.onClick({ stopPropagation: () => {} })
  assert.equal(rowMenu(region.render().tree, 'w1-a').props.open, true)
  rowMenu(region.render().tree, 'w1-a').props.onSelect('archive')
  assert.equal(rowMenu(region.render().tree, 'w1-a').props.open, false)
  assert.deepEqual(applied.calls.filter(call => call[0] === 'archiveSession'), [['archiveSession', 'w1-a']])
})

test('show more steps past the attention requirement', () => {
  const applied = applyPlugin()
  const data = fixtures()
  // One workspace, many sessions, and a running one deep enough that attention
  // alone has already opened the block past the next page step.
  const ids = Array.from({ length: 21 }, (unused, index) => `s${index}`)
  const byId = {}
  ids.forEach((id, index) => {
    byId[id] = { id, displayTitle: `Session ${index}`, running: index === 11, blank: false, retainedBy: { mainView: 0 }, updatedAt: 1000 - index, cwd: '/tmp/many' }
  })
  data.list = { ids, byId, phase: 'ready', projectionsBySession: {} }
  data.workspaces = {
    phase: 'ready', state: 'ready',
    items: [{ workspaceId: 'w1', title: 'many', path: '/tmp/many', sessionIds: ids }],
    pinnedSessionIds: [], archivedSessionIds: [],
  }
  const render = () => applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs ?? { rows: {} }),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
  })
  const region = render()
  const visible = () => rowsOf(region.tree).length
  const opened = visible()
  assert.equal(opened, 12, 'the running session at index 11 holds the block open that far')
  let control = null
  walk(region.tree, node => { if (node.props?.className === 'dsm-overflow') control = node })
  assert.ok(control, 'the block offers a way to show more')
  control.props.onClick()
  const after = render()
  let grown = 0
  walk(after.tree, node => { if (node.props?.['data-dsm-session']) grown += 1 })
  assert.equal(grown > opened, true, `showing more must reveal rows (${opened} -> ${grown})`)
})

test('the priority view groups labelled sessions and edits them in bulk', () => {
  const applied = applyPlugin()
  const data = fixtures()
  data.workspaces.pinnedSessionIds = ['pinned', 'w1-a']
  const render = () => applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
  })
  // `dsm-bulk-action` rows carry a second class, so match on inclusion.
  const find = (tree, className, extra = () => true) => {
    let found = null
    walk(tree, node => {
      if (String(node.props?.className ?? '').split(' ').includes(className) && extra(node)) found = node
    })
    return found
  }
  // Two labelled sessions, one of them pinned: the view regroups by level.
  applied.injected.priorityStore.set({ 'w1-a': 'p1', 'w1-b': 'p3' })
  const toggle = find(render().tree, 'dsm-head-action', node => node.props['aria-pressed'] !== undefined)
  assert.ok(toggle, 'the header offers the priority view')
  assert.equal(toggle.props['aria-pressed'], 'false')
  toggle.props.onClick()
  let tree = render().tree
  const headings = []
  walk(tree, node => { if (node.props?.className === 'dsm-heading-label') headings.push(node.children[0]) })
  assert.deepEqual(plain(headings), ['priority.p1', 'priority.p3', 'section.unmarked'], '空的等级不占位')
  const listed = []
  walk(tree, node => { if (node.props?.['data-dsm-session']) listed.push(node.props['data-dsm-session']) })
  assert.deepEqual(plain(listed), ['w1-a', 'w1-b'], '未标记那一层默认折叠，所以先只列出已标记的')
  const boxes = []
  walk(tree, node => { if (node.props?.className === 'dsm-select-box') boxes.push(node) })
  assert.equal(boxes.length, 2, '每个列出的行都有勾选框')
  // The checkbox is the row's first child, so the selection column never moves.
  const rowOf = (source, id) => {
    let row = null
    walk(source, node => { if (node.props?.['data-dsm-session'] === id) row = node })
    return row
  }
  const firstRow = rowOf(tree, 'w1-a')
  assert.equal(firstRow.children[0].props?.className, 'dsm-select', '勾选框固定在最前面')
  assert.deepEqual(plain(boxes.map(box => box.props.checked)), [false, false])
  boxes[0].props.onChange({ stopPropagation: () => {} })
  tree = render().tree
  assert.equal(find(tree, 'dsm-bulk-count').children[0], 'bulk.selected:{"n":1}')
  // Selecting all labelled rows then relabelling writes the store once.
  find(tree, 'dsm-bulk-action', node => node.children[0] === 'bulk.marked').props.onClick()
  tree = render().tree
  find(tree, 'dsm-bulk-action', node => node.props['data-level'] === 'p4').props.onClick()
  assert.deepEqual(plain(applied.injected.priorityStore.getSnapshot()), { 'w1-a': 'p4', 'w1-b': 'p4' })
  // Clearing drops the labels, and leaving the view restores the normal tree.
  find(render().tree, 'dsm-bulk-clear').props.onClick()
  assert.deepEqual(plain(applied.injected.priorityStore.getSnapshot()), {})
  find(render().tree, 'dsm-bulk-done').props.onClick()
  const normal = render().tree
  const back = find(normal, 'dsm-head-action', node => node.props['aria-pressed'] !== undefined)
  assert.equal(back.props['aria-pressed'], 'false', '退出后回到普通视图')
  assert.equal(find(normal, 'dsm-bulk'), null, '批量条只在优先级视图里出现')
  assert.ok(find(normal, 'dsm-project-header'), '普通视图的置顶/项目结构回来了')
})

test('a new priority label reaches the rows immediately', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const pillOf = (tree, id) => {
    let row = null
    walk(tree, node => { if (node.props?.['data-dsm-session'] === id) row = node })
    let pill = null
    walk(row, node => { if (node.props?.className === 'dsm-priority') pill = node })
    return pill
  }
  assert.equal(pillOf(region.tree, 'w1-a'), null, 'nothing is labelled yet')
  // The store is the plugin's own; writing to it must repaint the row it names.
  applied.injected.setPriority('w1-a', 'p2')
  const label = pillOf(region.render().tree, 'w1-a')
  assert.ok(label, 'the row shows its label without any other change')
  assert.equal(label.children[0], 'P2')
  applied.injected.setPriority('w1-a', 'none')
  assert.equal(pillOf(region.render().tree, 'w1-a'), null, 'and clearing it repaints too')
})

test('a row under a heading is shallow, a row in a workspace is nested', () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  const flat = rowsOf(tree).map(row => [row.props['data-dsm-session'], row.props['data-flat']])
  // Pinned rows hang straight off the heading; workspace rows are one level in.
  // `plain()` round-trips through JSON, so an absent prop reads as null.
  assert.deepEqual(plain(flat), [
    ['pinned', 'true'], ['w1-a', null], ['w1-b', null], ['w1-c', null], ['w2-a', null],
  ])
})

test('a pinned row shows no toggle tick, only its label', () => {
  const applied = applyPlugin()
  const data = fixtures()
  // Pinned rows are lifted into the pinned block and still carry their menu.
  // (An archived one is hidden by the default filter, so it cannot be addressed.)
  data.workspaces.pinnedSessionIds = ['w1-a']
  const tree = applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
  }).tree
  let row = null
  walk(tree, node => { if (node.props?.['data-dsm-session'] === 'w1-a') row = node })
  let menu = null
  walk(row, node => { if (node.type === 'stub-menu') menu = node })
  assert.deepEqual(plain(menu.props.selectedIds), [], '打勾只表示"当前取值"，与固定/归档无关')
  // The state is spelled by the labels instead.
  assert.deepEqual(
    plain(menu.props.items.filter(item => item.id === 'unpin' || item.id === 'pin' || item.id === 'archive' || item.id === 'unarchive')
      .map(item => [item.id, item.label])),
    [['unpin', 'menu.unpin'], ['archive', 'menu.archive']],
  )
})

test('dropping a row on its own slot writes nothing', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const source = rowsOf(region.tree).find(row => row.props['data-dsm-session'] === 'w1-c')
  source.props.onPointerDown(pointerEvent())
  source.props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('w1-a') }))
  // Cee's own slot: beta's lower half is exactly where cee already sits.
  source.props.onPointerMove(pointerEvent({ clientY: 200, target: rowElement('w1-b', 180) }))
  rowsOf(region.render().tree).find(row => row.props['data-dsm-session'] === 'w1-c')
    .props.onPointerUp(pointerEvent())
  assert.deepEqual(moves(applied.calls), [])
})

test('a gesture from another workspace account is refused rather than guessed', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const source = rowsOf(region.tree).find(row => row.props['data-dsm-session'] === 'w1-a')
  source.props.onPointerDown(pointerEvent())
  // A session never leaves its workspace: a row in another account is not a target.
  source.props.onPointerMove(pointerEvent({ clientY: 20, target: rowElement('w2-a') }))
  rowsOf(region.render().tree).find(row => row.props['data-dsm-session'] === 'w1-a')
    .props.onPointerUp(pointerEvent())
  // The target row belongs to another account, so its handler never fires:
  // an unmatched account is not a move the Host API can express.
  assert.deepEqual(moves(applied.calls), [])
})

test('Alt+Arrow moves one slot through the same host call', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const alpha = rowsOf(region.tree).find(row => row.props['data-dsm-session'] === 'w1-a')
  alpha.props.onKeyDown(withTarget(keyEvent('ArrowDown'), alpha))
  // Moving down one slot means "insert before the member after next": that is
  // what puts alpha between beta and cee instead of leaving it in place.
  assert.deepEqual(moves(applied.calls), [['insertSessionBefore', 'w1', 'w1-a', 'w1-c']])
})

test('the first row cannot move up and writes nothing', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const alpha = rowsOf(region.tree).find(row => row.props['data-dsm-session'] === 'w1-a')
  alpha.props.onKeyDown(withTarget(keyEvent('ArrowUp'), alpha))
  assert.deepEqual(moves(applied.calls), [])
})

test('the row menu exposes pin, rename, fork, archive, move and copy rows', () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  const rowMenu = menuOfRow(tree, 'w1-a')
  assert.ok(rowMenu, 'each row carries its own actions menu')
  const actions = menu => plain(menu.props.items
    .filter(item => item.id && item.type !== 'separator')
    .map(item => item.id))
  assert.deepEqual(actions(rowMenu),
    ['pin', 'rename', 'fork', 'archive', 'moveUp', 'moveDown', 'copyId', 'copyCwd',
      'priority-label', 'priority:p1', 'priority:p2', 'priority:p3', 'priority:p4', 'priority:none'])
  assert.deepEqual(plain(rowMenu.props.items.filter(item => item.type === 'separator').map(item => item.id)),
    ['sep-move', 'sep-copy', 'sep-priority'])
  // Copying the working directory is offered only when the host summary has one.
  const noCwd = menuOfRow(tree, 'w1-b')
  assert.deepEqual(actions(noCwd),
    ['pin', 'rename', 'fork', 'archive', 'moveUp', 'moveDown', 'copyId',
      'priority-label', 'priority:p1', 'priority:p2', 'priority:p3', 'priority:p4', 'priority:none'])
})

test('a menu selection routes to the host service', async () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  const menu = menuOfRow(tree, 'w1-a')
  assert.ok(menu, 'the row menu must render')
  menu.props.onSelect('pin')
  menu.props.onSelect('moveDown')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(applied.calls.filter(call => call[0] === 'pinSession'), [['pinSession', 'w1-a']])
  assert.deepEqual(moves(applied.calls), [['insertSessionBefore', 'w1', 'w1-a', 'w1-c']])
})

test('the archive filter shows, hides and isolates archived sessions', () => {
  const applied = applyPlugin()
  const data = fixtures()
  data.workspaces.archivedSessionIds = ['w1-c']
  const render = () => applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: key => key,
    ...applied.injected,
  })
  const ids = tree => rowsOf(tree).map(row => row.props['data-dsm-session'])
  const viewMenu = tree => {
    let found = null
    walk(tree, node => {
      if (node.type === 'stub-menu' && node.props.items.some(item => item.id === 'archivedOnly')) found = node
    })
    return found
  }
  // Default hides it, "show" lists it among the rest, "only" isolates it.
  assert.equal(ids(render().tree).includes('w1-c'), false, '默认隐藏归档')
  viewMenu(render().tree).props.onSelect('archivedShow')
  assert.equal(ids(render().tree).includes('w1-c'), true, '显示归档时列出')
  viewMenu(render().tree).props.onSelect('archivedOnly')
  assert.deepEqual(plain(ids(render().tree)), ['w1-c'], '只看归档时只剩下它')
})

test('the rename dialog offers a field and a submit action', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  menuOfRow(region.tree, 'w1-a').props.onSelect('rename')
  const tree = region.render().tree
  let input = null
  let form = null
  let save = null
  walk(tree, node => {
    if (node.props?.className === 'dsm-rename-input') input = node
    if (node.props?.className === 'dsm-rename-form') form = node
    if (node.props?.type === 'submit') save = node
  })
  assert.ok(input && form && save, 'the dialog has a field, a form and a save button')
  // The submit itself (typed title → host call) is driven in the browser lane,
  // where a real React owns the dialog's local state.
})

test('fork and the move items reach the host from the row menu', async () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const menu = menuOfRow(region.tree, 'w1-b')
  menu.props.onSelect('fork')
  menu.props.onSelect('moveUp')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(plain(applied.calls.filter(call => call[0] === 'forkSession')), [['forkSession', 'w1-b']])
  // Beta sits between Alpha and Cee, so moving it up anchors it at Alpha.
  assert.deepEqual(plain(applied.calls.filter(call => call[0] === 'insertSessionBefore')),
    [['insertSessionBefore', 'w1', 'w1-b', 'w1-a']])
})

test('pin, unpin, archive and unarchive each reach their own host call', () => {
  const applied = applyPlugin()
  const data = fixtures()
  data.workspaces.pinnedSessionIds = ['pinned', 'w1-a']
  data.workspaces.archivedSessionIds = ['w1-c']
  const tree = applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: key => key,
    ...applied.injected,
  }).tree
  const menuOf = (id, source = tree) => {
    let row = null
    walk(source, node => { if (node.props?.['data-dsm-session'] === id) row = node })
    let menu = null
    walk(row, node => { if (node.type === 'stub-menu') menu = node })
    return menu
  }
  // The archived row is hidden by the default filter, so reveal it first.
  const viewMenu = []
  walk(tree, node => {
    if (node.type === 'stub-menu' && node.props.items.some(item => item.id === 'archivedShow')) viewMenu.push(node)
  })
  viewMenu[0].props.onSelect('archivedShow')
  const shown = applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: key => key,
    ...applied.injected,
  }).tree
  // A pinned row offers unpin, an archived one offers unarchive — and the ids
  // must say so, or the dispatcher re-runs the opposite action. The choice is
  // read off the label, exactly as a click on that item would dispatch it.
  const idOf = (menu, label) => {
    const item = menu.props.items.find(candidate => candidate.label === label)
    assert.ok(item, `no item labelled ${label}`)
    return item.id
  }
  const pinnedMenu = menuOf('w1-a')
  const archivedMenu = menuOf('w1-c', shown)
  menuOf('w1-b').props.onSelect(idOf(menuOf('w1-b'), 'menu.pin'))
  pinnedMenu.props.onSelect(idOf(pinnedMenu, 'menu.unpin'))
  archivedMenu.props.onSelect(idOf(archivedMenu, 'menu.unarchive'))
  assert.deepEqual(plain(pinnedMenu.props.items.filter(item => ['pin', 'unpin'].includes(item.id)).map(item => [item.id, item.label])),
    [['unpin', 'menu.unpin']], '置顶中的行给出取消置顶')
  assert.deepEqual(plain(archivedMenu.props.items.filter(item => ['archive', 'unarchive'].includes(item.id)).map(item => [item.id, item.label])),
    [['unarchive', 'menu.unarchive']], '已归档的行给出取消归档')
  assert.deepEqual(plain(applied.calls.filter(call =>
    ['pinSession', 'unpinSession', 'archiveSession', 'unarchiveSession'].includes(call[0]))),
  [['pinSession', 'w1-b'], ['unpinSession', 'w1-a'], ['unarchiveSession', 'w1-c']])
})

test('copying reaches the clipboard service with the right value', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const menu = menuOfRow(region.tree, 'w1-a')
  menu.props.onSelect('copyId')
  menu.props.onSelect('copyCwd')
  // No working directory, no copy action: beta has no `cwd` in the fixtures.
  const noCwd = menuOfRow(region.tree, 'w1-b')
  assert.equal(noCwd.props.items.some(item => item.id === 'copyCwd'), false)
  // Copying goes straight to the clipboard, so the writes land there rather than
  // in the host call log.
  assert.deepEqual(applied.clipboardWrites, ['w1-a', '/tmp/w1'])
})

test('the view options menu switches ordering and the archived filter', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const options = []
  walk(region.tree, node => {
    if (node.type === 'stub-menu' && node.props.items.some(item => item.id === 'orderUpdated')) options.push(node)
  })
  assert.equal(options.length, 1)
  options[0].props.onSelect('archivedOnly')
  const filtered = rowsOf(region.render().tree)
  // Only archived sessions remain under the archived-only filter; the fixtures
  // have none, so the region renders no rows at all.
  assert.deepEqual(filtered, [])
})

test('a real workspace offers a new-session seat and the pinned block does not', () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  const seats = []
  walk(tree, node => {
    if (node.props?.['aria-label'] === 'action.newSession') seats.push(node.props.title)
  })
  assert.deepEqual(seats, ['action.newSession', 'action.newSession'], 'one seat per workspace group')
  let seat = null
  walk(tree, node => { if (node.props?.['aria-label'] === 'action.newSession' && seat === null) seat = node })
  seat.props.onClick({ stopPropagation() {} })
  assert.deepEqual(applied.calls.filter(call => call[0] === 'startSession'), [['startSession', 'w1']])
})

test('a workspace header gesture reorders the durable registry order', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  const headerOf = (tree, key) => {
    let group = null
    walk(tree, node => { if (node.props?.['data-dsm-group'] === key) group = node })
    let header = null
    walk(group, node => { if (node.props?.className === 'dsm-section-header') header = node })
    return header
  }
  const beta = headerOf(region.tree, 'w2')
  assert.ok(beta, 'the workspace header is the gesture source')
  beta.props.onPointerDown(pointerEvent())
  // Beta pressed, then marked above alpha: beta becomes first in the registry.
  beta.props.onPointerMove(pointerEvent({ clientY: 4, target: rowElement('w1') }))
  headerOf(region.render().tree, 'w2').props.onPointerUp(pointerEvent())
  // The face name is `insertWorkspaceBefore`; the Host call it makes is
  // `insertBefore` on the durable registry order.
  assert.deepEqual(
    applied.calls.filter(call => call[0] === 'insertBefore'),
    [['insertBefore', 'w2', 'w1']],
  )
})

test('the ungrouped bucket is not draggable and hosts no new-session seat', () => {
  const applied = applyPlugin()
  const data = fixtures()
  // A session outside every workspace account lands in the ungrouped bucket.
  data.list.byId.loose = { id: 'loose', displayTitle: 'Loose', running: false, blank: false, retainedBy: { mainView: 0 }, updatedAt: 1 }
  data.list.ids = [...data.list.ids, 'loose']
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: key => key,
    ...applied.injected,
  }
  const { tree } = applied.react.render(applied.registered.Component, props)
  let ungrouped = null
  walk(tree, node => { if (node.props?.['data-dsm-group'] === '') ungrouped = node })
  assert.ok(ungrouped, 'the ungrouped bucket renders')
  assert.equal(ungrouped.props.draggable, undefined)
  const seats = []
  walk(tree, node => { if (node.props?.['aria-label'] === 'action.newSession') seats.push(node) })
  assert.equal(seats.length, 2, 'still one seat per registered workspace only')
})

test('the add-workspace entry registers the picked directory with the host', async () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  const entries = []
  walk(tree, node => { if (node.props?.['aria-label'] === 'action.addWorkspace') entries.push(node) })
  assert.equal(entries.length, 1, 'one entry in the region header')
  entries[0].props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(applied.calls.filter(call => call[0] === 'pickDirectory' || call[0] === 'createWorkspace'),
    [['pickDirectory'], ['createWorkspace', '/tmp/picked']])
})

test('a cancelled directory pick registers nothing and stays silent', async () => {
  const applied = applyPlugin()
  applied.setPickResult(null)
  const { tree } = renderRegion(applied)
  let entry = null
  walk(tree, node => { if (node.props?.['aria-label'] === 'action.addWorkspace') entry = node })
  entry.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(applied.calls.filter(call => call[0] === 'createWorkspace'), [])
  assert.equal(applied.injected.hooks.notice.getSnapshot(), null)
})

test('a rejected pick is reported instead of swallowed', async () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied)
  let entry = null
  walk(tree, node => { if (node.props?.['aria-label'] === 'action.addWorkspace') entry = node })
  // Break the host picker for this call only.
  const original = applied.injected.pickDirectory
  const boom = () => Promise.reject(new Error('picker offline'))
  const patched = { ...applied.injected, pickDirectory: boom }
  const data = fixtures()
  const { tree: failureTree } = applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: key => key,
    ...patched,
  })
  let failureEntry = null
  walk(failureTree, node => { if (node.props?.['aria-label'] === 'action.addWorkspace') failureEntry = node })
  failureEntry.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(String(applied.injected.hooks.notice.getSnapshot()), /picker offline/)
  assert.ok(entry && original)
})

test('the empty state offers the same add-workspace entry', () => {
  const applied = applyPlugin()
  const data = fixtures()
  data.workspaces.items = []
  data.list.ids = []
  data.list.byId = {}
  const { tree } = applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: key => key,
    ...applied.injected,
  })
  const empties = []
  walk(tree, node => { if (node.props?.className === 'dsm-empty-action') empties.push(node) })
  assert.equal(empties.length, 1)
})

test('a block pages its rows and reveals the rest on demand', () => {
  const applied = applyPlugin()
  const data = fixtures()
  const ids = Array.from({ length: 7 }, (_, index) => `p${index}`)
  for (const id of ids) {
    data.list.byId[id] = { id, displayTitle: id, running: false, blank: false, retainedBy: { mainView: 0 }, updatedAt: Number(id.slice(1)) }
  }
  data.list.ids = [...data.list.ids, ...ids]
  data.workspaces.items = [{ workspaceId: 'w1', title: 'alpha', path: '/tmp/alpha', sessionIds: ids }]
  const props = {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...applied.injected,
  }
  const rowsIn = (tree, key) => {
    let group = null
    walk(tree, node => { if (node.props?.['data-dsm-group'] === key) group = node })
    return group === null ? [] : rowsOf(group).map(row => row.props['data-dsm-session'])
  }
  const first = applied.react.render(applied.registered.Component, props)
  // The default order is the host's own manual order, which the fixture set to
  // `p0..p6`; paging therefore clips the tail, not the head.
  assert.deepEqual(rowsIn(first.tree, 'w1'), ['p0', 'p1', 'p2', 'p3', 'p4'], 'the base page holds five rows')
  let overflow = null
  walk(first.tree, node => {
    if (node.props?.className === 'dsm-overflow' && node.children[0].startsWith('sessions.expand')) overflow = node
  })
  assert.equal(overflow.props['aria-expanded'], 'false')
  assert.equal(overflow.children[0], 'sessions.expand:{"n":2}')
  overflow.props.onClick()
  const second = applied.react.render(applied.registered.Component, props)
  assert.equal(rowsIn(second.tree, 'w1').length, 7, 'one click reveals the remainder')
  let collapse = null
  walk(second.tree, node => {
    if (node.props?.className === 'dsm-overflow' && node.children[0] === 'sessions.collapse') collapse = node
  })
  assert.ok(collapse)
  collapse.props.onClick()
  assert.equal(rowsIn(applied.react.render(applied.registered.Component, props).tree, 'w1').length, 5)
})

test('a session that needs attention is never hidden by the page', () => {
  const applied = applyPlugin()
  const data = fixtures()
  const ids = Array.from({ length: 7 }, (_, index) => `q${index}`)
  for (const id of ids) {
    data.list.byId[id] = { id, displayTitle: id, running: id === 'q6', blank: false, retainedBy: { mainView: 0 }, updatedAt: Number(id.slice(1)) }
  }
  data.list.ids = ids
  data.workspaces.items = [{ workspaceId: 'w1', title: 'alpha', path: '/tmp/alpha', sessionIds: ids }]
  const { tree } = applied.react.render(applied.registered.Component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: selector => selector(data.list),
    useWorkspaces: selector => selector(data.workspaces),
    useSessionStatus: selector => selector(data.statuses),
    useJobs: selector => selector(data.jobs),
    useNotice: selector => selector(undefined),
    t: key => key,
    ...applied.injected,
  })
  // `q6` runs, so the page opens far enough to include it, and nothing is hidden.
  assert.equal(rowsOf(tree).some(row => row.props['data-dsm-session'] === 'q6'), true)
  let overflow = null
  walk(tree, node => { if (node.props?.className === 'dsm-overflow') overflow = node })
  assert.equal(overflow, null)
})

test('typing a query searches the host index and renders merged rows', async () => {
  const applied = applyPlugin()
  applied.setSearchResult({ items: [{ sessionId: 'w2-a', snippet: '…gamma in the log…' }], hasMore: true })
  const region = renderRegion(applied)
  let entry = null
  walk(region.tree, node => { if (node.props?.['aria-label'] === 'search.placeholder' && node.props.className === 'dsm-head-action') entry = node })
  assert.ok(entry, 'the header offers a search entry')
  entry.props.onClick()
  const opened = region.render()
  let input = null
  walk(opened.tree, node => { if (node.props?.className === 'dsm-search-input') input = node })
  assert.ok(input, 'the query opens a controlled input')
  input.props.onChange({ target: { value: 'gamma' } })
  await new Promise(resolve => setImmediate(resolve))
  const typing = region.render()
  await new Promise(resolve => setImmediate(resolve))
  const searched = region.render()
  const rows = rowsOf(searched.tree)
  assert.deepEqual(rows.map(row => row.props['data-dsm-session']), ['w2-a'])
  const metas = []
  walk(searched.tree, node => { if (node.props?.className === 'dsm-search-meta') metas.push(node.children[0]) })
  assert.deepEqual(metas, ['search.more'], 'a bounded result set asks for a narrower query')
  assert.deepEqual(applied.calls.filter(call => call[0] === 'search').map(call => call[1]), ['gamma'])
  // The row carries the snippet and the workspace label.
  const labels = []
  const snippets = []
  walk(searched.tree, node => {
    if (node.props?.className === 'dsm-workspace') labels.push(node.children[0])
    if (node.props?.className === 'dsm-snippet') snippets.push(node.children[0])
  })
  assert.deepEqual(labels, ['beta'])
  assert.deepEqual(snippets, ['…gamma in the log…'])
  // The list is not rendered while a query is active.
  assert.equal(searched.tree.children.some(child => child?.props?.className === 'dsm-project-header'), false)
  assert.ok(typing)
})

test('a blank query never reaches the host and leaves the list in place', async () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  let entry = null
  walk(region.tree, node => { if (node.props?.['aria-label'] === 'search.placeholder' && node.props.className === 'dsm-head-action') entry = node })
  entry.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  // The entry seeds a space so the input mounts; a whitespace query is not a search.
  assert.deepEqual(applied.calls.filter(call => call[0] === 'search'), [])
  const cleared = region.render()
  let clear = null
  walk(cleared.tree, node => {
    if (node.props?.['aria-label'] === 'search.clear') clear = node
  })
  assert.ok(clear, 'a clear affordance exists while the query is open')
  assert.equal(rowsOf(cleared.tree).length > 0, true)
})

test('the narrow rail keeps the sidebar expandable and renders no rows', () => {
  const applied = applyPlugin()
  const { tree } = renderRegion(applied, { wide: false })
  assert.deepEqual(rowsOf(tree), [])
  let expanded = 0
  walk(tree, node => { if (node.props?.['aria-label'] === 'section.workspaces') expanded++ })
  assert.equal(expanded, 1)
})

test('the region watches the job roster of every row it paints, and releases on unmount', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  // Every rendered row owns a roster. Without this watch the Host keeps `rows`
  // empty for that session, which is why the "background job running" mark used
  // to appear only for the session the shipped jobs control happened to watch.
  for (const id of ['pinned', 'w1-a', 'w1-b', 'w1-c', 'w2-a']) {
    assert.ok(applied.watched.has(id), `${id} is watched`)
  }
  // A subagent child has no row of its own; its jobs fold into the parent's
  // status, so the parent's watch has to reach the subtree below it.
  assert.ok(applied.watched.has('child'), 'the visible subtree is watched through its parent')
  // The registration's own lifetime releases every stream it opened.
  for (const cleanup of region.cleanups) cleanup()
  assert.equal(applied.watched.size, 0, 'no stream outlives the region')
  // A re-render with the same set opens nothing: the key, not the snapshot
  // identity, decides whether streams are re-established.
  const opened = applied.calls.filter(call => call[0] === 'watchRows').length
  region.render()
  assert.equal(applied.calls.filter(call => call[0] === 'watchRows').length, opened)
})

test('folding a block drops the job streams of the rows it hides', () => {
  const applied = applyPlugin()
  const region = renderRegion(applied)
  let header = null
  walk(region.tree, node => {
    if (node.props?.className === 'dsm-section-header' && node.props?.title === '/tmp/alpha') header = node
  })
  assert.ok(header, 'the alpha workspace header is rendered')
  header.props.onClick()
  region.render()
  // Hidden rows keep no stream: a folded project must not keep paying for
  // rosters nobody can see.
  assert.equal(applied.watched.has('w1-a'), false)
  assert.equal(applied.watched.has('child'), false)
  // The blocks still on screen keep theirs.
  assert.ok(applied.watched.has('pinned'), 'the pinned block stays watched')
  assert.ok(applied.watched.has('w2-a'), 'the other workspace stays watched')
})

test('a host without the job service fails open instead of blocking the region', () => {
  const applied = applyPlugin({ withJobs: false })
  const region = renderRegion(applied, { useJobs: () => undefined })
  assert.ok(rowsOf(region.tree).length > 0, 'the list still renders')
  assert.equal(applied.calls.some(call => call[0] === 'watchRows'), false)
})
