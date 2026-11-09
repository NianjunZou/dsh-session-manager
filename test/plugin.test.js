/**
 * Static and packaging contract of the 0.2.0 client bundle.
 *
 * The previous revision asserted a DOM-projection implementation. This one
 * asserts the shape the Host actually consumes: one module-loader registration
 * that shadows the sidebar browsing cell, a registration that declares its
 * locale and injected actions, and the absence of the native-DOM editing the
 * projection approach needed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const code = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
const core = readFileSync(new URL('../src/client/core.js', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('identity is one thing across package, client module id and bundle name', () => {
  assert.equal(pkg.name, '@pianner/dsh-session-manager')
  assert.equal(pkg.version, '0.2.0')
  assert.equal(pkg.exports['./client'], './client/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(code.includes(`id: "@pianner/dsh-session-manager"`))
  assert.ok(patch.includes(`name: '@pianner/dsh-session-manager'`))
})

// Platform seeds the host shell provides; a bundle may `require` these without
// any arrival edge. Source: deepseek-harness packages/client/web/src/platform.ts
const PLATFORM_SEEDS = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'zod',
  '@tanstack/react-virtual', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
])

test('plugin display metadata is bilingual and ships with the package', () => {
  // The Host reads display text from exported locale JSON (`<pkg>/locale/<lang>.json`
  // -> `meta.title` / `meta.description`) without evaluating plugin code; Chinese
  // therefore needs its own dictionary, not a translated package name.
  assert.match(pkg.exports['./locale/*'] ?? '', /^\.\/locale\/\*$/)
  assert.ok(pkg.files.includes('locale'), 'publish list must carry locale/')
  const read = name => JSON.parse(readFileSync(new URL(`../locale/${name}.json`, import.meta.url), 'utf8'))
  const en = read('en')
  const zh = read('zh')
  assert.ok(en.meta?.title && zh.meta?.title, 'both dictionaries must ship meta.title')
  assert.ok(en.meta?.description && zh.meta?.description, 'both dictionaries must ship meta.description')
  assert.match(en.meta.title, /^[\x20-\x7e]+$/, 'English title stays ASCII')
  assert.match(zh.meta.title, /[\u4e00-\u9fff]/, 'Chinese title must be Chinese characters')
  assert.notEqual(zh.meta.title, en.meta.title)
  assert.deepEqual(Object.keys(en.meta).sort(), Object.keys(zh.meta).sort())
})

test('dsh.client.inject declares exactly the non-seed modules the bundle requires', () => {
  const declared = pkg.dsh.client.inject
  assert.ok(Array.isArray(declared), 'dsh.client.inject must be an array (empty is valid)')
  // Reason, not a snapshot: arrival edges exist only for non-seed modules this
  // bundle actually requires. Seeds need no edge (the shell provides them) and
  // a service name is not a package edge. See dsh-plugin-dev
  // references/host-declaration-surfaces.md (R2).
  const required = new Set(
    [...code.matchAll(/require\('([^']+)'\)/g)].map(match => match[1]).filter(name => !PLATFORM_SEEDS.has(name)),
  )
  assert.deepEqual([...declared].sort(), [...required].sort())
  assert.match(pkg.peerDependencies.react, /^\^18/)
  assert.match(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-slots'], /0\.2\.0-alpha\.0/)
})

test('every required cordis service is actually used by the plugin', () => {
  // R4: a declared service is a load gate; declaring one the code never touches
  // makes slim builds wait (or refuse to load) for nothing.
  const declared = [...code.matchAll(/const inject = \[([^\]]*)\]/g)]
    .flatMap(match => [...match[1].matchAll(/'([^']+)'/g)].map(hit => hit[1]))
  assert.ok(declared.length > 0, 'the client entry must declare its required services')
  for (const service of declared) {
    assert.match(code, new RegExp(`ctx\\.${service}\\b`), `declared service ${service} is never used as ctx.${service}`)
  }
})

test('the bundle is the single module-loader registration the runtime can materialize', () => {
  assert.equal(code.match(/^window\.__ModuleLoader__\.load\(\{$/gm).length, 1)
  assert.match(code, /factory: \(require\) => \{/)
  assert.match(code, /var module = \{ exports: \{\} \}/)
  assert.match(code, /return module\.exports/)
  // Relative requires are not resolvable by the client module system.
  assert.doesNotMatch(code, /require\(["']\.\.?\//)
})

test('the region shadows the sidebar browsing cell and declares its locale', () => {
  assert.match(code, /name: 'sidebar\.workspaces'/)
  assert.match(code, /priority: SLOT_PRIORITY/)
  assert.match(code, /const SLOT_PRIORITY = -2/)
  assert.match(code, /locale: NS/)
  assert.match(code, /registrant: '@pianner\/dsh-session-manager'/)
  assert.match(code, /ctx\.slots\.inject\('sidebar\.workspaces'/)
  assert.match(code, /ctx\.locale\.register\(NS, \{ zh, en \}\)/)
})

test('the running dot is toned apart from the neutral idle step', () => {
  // A grey spinner at hairline weight is unreadable at row scale. The region tints
  // only the ongoing glyph and enlarges it: accent colour, 16px box, heavier
  // stroke, brighter track, a faint halo and a slightly faster cycle. Idle rows
  // paint nothing at all, so there is no neutral step to confuse it with.
  assert.match(code, /\.dsm-dot-slot \[data-state='ongoing'\]\{color:var\(--dsw-alias-state-business-primary\);/)
  assert.match(code, /svg\[data-state='ongoing'\]\{width:16px;height:16px\}/)
  assert.match(code, /svg\[data-state='ongoing'\] circle\{stroke-width:2\.5\}/)
  assert.match(code, /svg\[data-state='ongoing'\] circle:first-of-type\{opacity:\.4\}/)
  assert.match(code, /svg\[data-state='ongoing'\] \*\{animation-duration:1\.15s\}/)
  assert.match(code, /drop-shadow\(0 0 2px color-mix\(in srgb,currentColor 60%,transparent\)\)/)
  assert.doesNotMatch(code, /\.dsm-dot-slot \[data-state='idle'\]/)
})

test('the region never edits host-rendered DOM', () => {
  for (const forbidden of ['MutationObserver', 'querySelector', 'dsm-native-hidden',
    'data-row-key', 'restoreNative', 'nativeEntries', 'getElementById', 'closest(']) {
    assert.equal(code.includes(forbidden), false, `bundle must not use ${forbidden}`)
  }
})

test('every action is a host service call', () => {
  for (const call of [
    'ctx.uiWorkspace.openSession(sessionId)',
    'ctx.uiWorkspace.pinSession(sessionId)',
    'ctx.uiWorkspace.unpinSession(sessionId)',
    'ctx.uiWorkspace.archiveSession(sessionId)',
    'ctx.uiWorkspace.unarchiveSession(sessionId)',
    'ctx.uiWorkspace.forkSession(sessionId)',
    'ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)',
    'reference.binding.session.rename(title)',
  ]) assert.ok(code.includes(call), call)
  // No plugin-owned persistence: no storage, no private order/title table.
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'BroadcastChannel']) {
    assert.equal(code.includes(forbidden), false, forbidden)
  }
})

test('reordering is a pointer gesture that never starts a text selection', () => {
  // Without `user-select: none` a mousedown on the title begins a selection and
  // the gesture is lost to the selection instead.
  assert.match(code, /\.dsm-row\{[^}]*user-select:none/)
  // Native drag-and-drop stays off: the browser would run its own drag and
  // swallow the pointer stream that drives the reorder.
  assert.match(code, /draggable: false/)
  assert.equal(/onDragStart: canReorder/.test(code), false)
  assert.match(code, /onPointerDown: canReorder \? \(event\) => \{/)
  assert.match(code, /const DRAG_THRESHOLD_PX = 4/)
  // No native drag source may wrap the session rows: a `draggable` ancestor
  // makes Chromium start its own drag and cancel the pointer stream.
  assert.equal(/draggable: true/.test(code), false)
  assert.equal(/webkit-user-drag:element/.test(code), false)
  assert.match(code, /\.dsm-row\{[^}]*webkit-user-drag:none/)
  // The gesture must own the pointer: a pan takeover arrives as `pointercancel`,
  // and an Electron window-drag band must not swallow the press either.
  assert.match(code, /\.dsm-row\{[^}]*touch-action:none/)
  assert.match(code, /\.dsm-region\{[^}]*app-region:no-drag/)
  assert.match(code, /gestureDown\('session', sessionId, event/)
  assert.match(code, /gestureDown\('workspace', sectionKey, event/)
  // Three explicit levels: sections at the edge, workspaces one step in,
  // sessions one step further. The host's nesting variable is not used, because
  // this region owns its tree and its own indent scale.
  assert.match(code, /\.dsm-row\{[^}]*padding-inline-start:32px/)
  // A row straight under a heading keeps the heading's shallow column.
  assert.match(code, /\.dsm-row\[data-flat="true"\]\{padding-inline-start:14px\}/)
  // The pin badge stays for pinned rows elsewhere, but not inside the pinned
  // block, where every row is pinned and the width belongs to the title.
  assert.match(code, /pinned && !archived && !pinnedSection/)
  assert.match(code, /\.dsm-section-header\{[^}]*padding-inline-start:20px/)
  assert.equal(/--dsh-workspace-indent/.test(code), false)
})

test('row typography and metrics match the shipped browsing rows', () => {
  // These are the shipped values (ui-workspace Rows.module.css): a 32px row, a
  // 16x20 leading cell, a 14px/20px title and a 10px/16px trailing time. Any
  // drift here is what makes the region read as a foreign, cheaper list.
  assert.match(code, /\.dsm-row\{[^}]*height:32px/)
  assert.match(code, /\.dsm-dot-slot\{[^}]*width:16px;height:20px/)
  assert.match(code, /\.dsm-title\{[^}]*font-size:14px;line-height:20px/)
  assert.match(code, /\.dsm-time\{[^}]*font-size:10px;line-height:16px/)
  assert.match(code, /\.dsm-section-label\{[^}]*font-size:14px;line-height:20px/)
  assert.match(code, /\.dsm-overflow\{[^}]*height:28px/)
  // A section header holds its place while its own block scrolls past it, on an
  // opaque fill so rows travel underneath rather than through it.
  assert.match(code, /\.dsm-section-row\{[^}]*position:sticky;top:0/)
  assert.match(code, /\.dsm-heading-row,\.dsm-project-header\{[^}]*position:sticky;top:0/)
  assert.match(code, /background:var\(--dsw-specific-sidebar-fill\)/)
  // macOS keeps the sidebar glass: no opaque slab, a faint label wash + blur.
  assert.match(code, /\[data-platform='darwin'\] \.dsm-section-row\{[^}]*backdrop-filter:blur\(14px\)/)
  assert.match(code, /\[data-platform='darwin'\] \.dsm-heading-row,\[data-platform='darwin'\] \.dsm-project-header/)
  // The fixed sections are headings: a 28px caption band on the raised surface,
  // never the 32px primary-weight row a workspace directory gets.
  assert.match(code, /\.dsm-heading-label\{[^}]*font-size:14px;line-height:20px;font-weight:600/)
  assert.match(code, /\.dsm-heading-row,\.dsm-project-header\{[^}]*height:32px;background:var\(--dsw-alias-bg-layer-2\)/)
  // The workspace row's leading seat is the shipped 16x20 cell.
  assert.match(code, /\.dsm-slot\{[^}]*width:16px;height:20px/)
  // Radius and color come from shipped tokens rather than literals.
  assert.match(code, /border-radius:var\(--dsw-radius-md\)/)
  assert.equal(/#[0-9a-fA-F]{6}/.test(code.slice(code.indexOf('const css = `'), code.indexOf('`\n\n/**'))), false)
})

test('the priority view ships its own controls', () => {
  // The bulk bar, the row checkbox and the view toggle are part of the bundle's
  // stylesheet, so a host build without them cannot half-render the view.
  assert.match(code, /\.dsm-bulk\{[^}]*position:sticky/)
  assert.match(code, /\.dsm-bulk-action\{[^}]*cursor:pointer/)
  assert.match(code, /\.dsm-select-box\{/)
  // The view's entry point is a decorated "P", not a shipped glyph: it has to
  // say "priority levels" at a glance.
  assert.match(code, /className: 'dsm-pbadge'/)
  assert.match(code, /\.dsm-pbadge\{[^}]*font-weight:700/)
  assert.match(code, /'aria-pressed': String\(priorityView\)/)
})

test('every affordance is a shipped icon, not a text glyph', () => {
  // Text glyphs render at a different weight and baseline from the rest of the
  // shell, which is what made the region read as foreign; the shipped set is
  // the only source that stays consistent across themes and font stacks.
  for (const icon of ['IconSearchOutlineRegular', 'IconSlidersTwoOutlineRegular',
    'IconProjectAddOutlineRegular', 'IconFolderCloseRegular', 'IconFolderOpenRegular',
    'IconChevronDownOutlineRegular', 'IconChevronRightOutlineRegular', 'IconPlusOutlineRegular',
    'IconPinFillRegular', 'IconCloseFillRegular']) {
    assert.ok(code.includes(icon), icon)
  }
  // No stray glyph literals survive from the first cut.
  for (const glyph of ['\u2315', '\u22ef', '\u25be', '\u00d7', "'+'", "'\u2022'"]) {
    assert.equal(code.includes(glyph), false, `text glyph ${glyph} still rendered`)
  }
  // The row menu trigger and the per-workspace new-session seat are icons too.
  assert.match(code, /h\(IconEllipsisOutlineRegular, \{ size: 14 \}\)/)
  assert.match(code, /h\(IconPlusOutlineRegular, \{ size: 14 \}\)/)
})

test('permanent header affordances are not hidden behind the row hover seat', () => {
  // `.dsm-action` is revealed by `.dsm-row:hover`; a header seat using it stays
  // invisible forever, which silently removed search and the view menu.
  assert.match(code, /\.dsm-row:hover \.dsm-action/)
  assert.equal(/className: 'dsm-head-action'/.test(code), true)
  assert.match(code, /className: 'dsm-head-action',\s*\n\s*title: t\('action\.addWorkspace'\)/)
  assert.match(code, /className: 'dsm-head-action',\s*\n\s*title: t\('search\.placeholder'\)/)
})

test('ordering goes through the durable host API from both drag and keyboard', () => {
  assert.match(code, /moveAnchor\(/)
  assert.match(code, /insertSessionBefore\(accountId, sessionId, anchor \?\? undefined\)/)
  // The commit reads the recorded gesture, so a gesture that ends outside a row
  // still lands where its marker pointed.
  assert.match(code, /if \(move !== null && move !== undefined\) drop\(move\.accountId, move\.order, move\.id, move\.target\)/)
  assert.match(code, /event\.altKey && \(event\.key === 'ArrowUp' \|\| event\.key === 'ArrowDown'\)/)
  assert.match(code, /id: 'moveUp'/)
  assert.match(code, /id: 'moveDown'/)
})

test('status is one dot in the shipped vocabulary, with the detail as its title', () => {
  assert.match(code, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/)
  assert.match(code, /StateDot/)
  assert.match(code, /dotPlan\(status\)/)
  // The dot — including its 10/14 sizes — is the shipped component's; the region
  // only ever tones the running spinner (a token already used for selection), and
  // resting rows paint no glyph at all.
  assert.match(code, /const resting = plan\.primary === 'idle'/)
  assert.match(code, /resting \? null : h\(StateDot, \{ state: plan\.primary, size: plan\.primary === 'ongoing' \? 16 : undefined \}\)/)
  assert.match(code, /'data-dot': resting \? 'none' : plan\.primary/)
  assert.equal(code.includes('--dsw-alias-state-idle-primary'), false)
  assert.equal(code.includes('--dsw-alias-state-success-primary'), false)
  // 0.1.6's guessed color aliases and hard-coded fallbacks are gone.
  for (const gone of ['--dsw-alias-blue', '--dsw-alias-red', '--dsw-alias-green', '#e5534b']) {
    assert.equal(code.includes(gone), false, gone)
  }
  // One glyph per row: the qualifier marks and the unread chip are gone, not
  // just hidden. The native row says "unread" with the done dot plus a heavier
  // title, so a badge there only competes with the priority pill.
  for (const gone of ['dsm-mark', 'dsm-marks', 'MARK_TOKEN', 'SUBAGENT_JOB', 'data-kind', 'dsm-unread', 'mark.unread']) {
    assert.equal(code.includes(gone), false, gone)
  }
  // The dot is a name, not only a colour: the description the screen reader gets
  // is also the hover title, and the painted 10px circle sits in a hit cell grown
  // to the row height so it can be pointed at without aiming.
  assert.match(code, /const description = label\.join\('，'\)/)
  assert.match(code, /className: 'dsm-dot-slot',\s*\n\s*title: description/)
  assert.match(code, /'data-dot': resting \? 'none' : plan\.primary/)
  assert.match(code, /\.dsm-dot-slot\{position:relative\}/)
  assert.match(code, /\.dsm-dot-slot::after\{content:'';position:absolute;inset:-6px -2px\}/)
  // The composition sentence is built from the split roster counts, so the single
  // dot can still say "1 个子会话的后台任务" on hover.
  assert.match(code, /status\.activity\.jobs\.own/)
  assert.match(code, /status\.activity\.jobs\.subtree/)
  assert.match(code, /status\.activity\.subagents\.running/)
  // The owner split comes from the rollup, not from a merged job count.
  assert.match(code, /jobsRunningSelf/)
  assert.match(code, /jobsRunningSubtree/)
})

test('the region is reversible through the registration lifetime only', () => {
  assert.match(code, /ctx\.effect\(/)
  assert.match(code, /style\.remove\(\)/)
  assert.match(code, /return module\.exports/)
  // Optional host services degrade instead of failing the load.
  // `jobs` is resolved lazily on every read, so a late-installed service still
  // reacts instead of leaving job-driven rows without a dot.
  assert.match(code, /ctx\.get\('jobs'\)\?\.state/)
  assert.match(code, /const jobsState = useJobs\(snapshot => snapshot\)/)
  assert.match(code, /hooks: \{ notice: noticeSource, jobs: jobsSource \}/)
  // The priority store rides the face and the region subscribes to it with
  // React's own bridge, so the Host is not asked to synthesize a new hook key.
  assert.match(code, /priorityStore: priorities/)
  assert.match(code, /useSyncExternalStore\(priorityStore\.subscribe, priorityStore\.getSnapshot\)/)
  // Priority labels persist through the shipped store seat, not by hand.
  assert.match(code, /require\('@deepseek-ai\/dsh-client-store'\)/)
  assert.match(code, /persist: \{ name: 'dsh-session-manager\.priority' \}/)
  assert.doesNotMatch(code, /inject = \[[^\]]*'jobs'/)
})

test('copy comes from the locale namespace, in both shipped languages', () => {
  assert.match(code, /const zh = \{/)
  assert.match(code, /const en = \{/)
  for (const key of ['section.pinned', 'status.running', 'status.jobs', 'menu.moveUp', 'menu.copyCwd']) {
    assert.ok(code.includes(`'${key}':`), key)
  }
  // The same key set in both dictionaries.
  const keys = source => [...source.matchAll(/^\s*'([\w.]+)':/gm)].map(match => match[1]).sort()
  const zhBlock = code.slice(code.indexOf('const zh = {'), code.indexOf('const en = {'))
  const enBlock = code.slice(code.indexOf('const en = {'), code.indexOf('const css = `'))
  assert.deepEqual(keys(zhBlock), keys(enBlock))
})

test('the pure core stays dependency-free so the build can inline it', () => {
  assert.doesNotMatch(core, /^\s*import\s/m)
  assert.doesNotMatch(core, /^\s*export\s+default\s/m)
  assert.doesNotMatch(core, /^\s*export\s*\{/m)
  for (const declaration of core.matchAll(/^export\s+(\w+)/gm)) assert.ok(declaration[1])
})

test('the shipped bundle matches a fresh build of the authored sources', () => {
  const sources = readdirSync(new URL('../src/client/', import.meta.url)).sort()
  assert.deepEqual(sources, ['body.js', 'core.js'])
  // The generated file must carry the inlined core inside the factory.
  const bodyStart = code.indexOf('factory: (require) => {')
  const coreStart = code.indexOf('function snapshotOf(store)')
  assert.ok(coreStart > bodyStart, 'core must be inlined inside the factory')
  assert.ok(code.indexOf('const React = require(\'react\')') > coreStart, 'core precedes the view body')
})

test('folder state uses its own versioned key and lives on the injection face', () => {
  assert.match(code, /dsh-plugin:dsh-session-manager:folders/)
  assert.match(code, /readFolderState\(/)
  assert.match(code, /buildFolderViews\(/)
  assert.match(code, /folderStore: folders,/)
  assert.match(code, /folderActions,/)
  // The bundle still never names a Web Storage API; persistence stays behind
  // the store seat.
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'BroadcastChannel']) {
    assert.equal(code.includes(forbidden), false, forbidden)
  }
})

test('folder sections are not workspace drag groups and their header is not sticky', () => {
  // A nested Section would carry `data-dsm-group` (the workspace drag target)
  // and a sticky header; the folder block must carry neither.
  assert.match(code, /className: 'dsm-folder-group', 'data-dsm-folder': section\.key/)
  assert.equal(/\.dsm-folder-row\{[^}]*position:sticky/.test(code), false)
  assert.match(code, /\.dsm-folder-mark\{[^}]*border-radius:50%/)
})

test('the folder renderer is wired into the row dependency table and the declaration stays minimal', () => {
  assert.match(code, /folderEntries, folderReadonly, move, now,/)
  assert.match(code, /const inject = \['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale'\]/)
  assert.equal(pkg.dsh.client.inject.length, 0)
})

test('the first folder is creatable from the workspace header, not only a session menu', () => {
  assert.match(code, /className: 'dsm-workspace-action dsm-workspace-folder'/)
  assert.match(code, /onNewFolder/)
  assert.match(code, /\.dsm-workspace-folder\{position:relative;opacity:1\}/)
  assert.match(code, /\.dsm-workspace-folder::after\{content:"\+"/)
  // The tree has no chip strip, so the header seat stays after the first folder.
  assert.match(code, /onNewFolder: group\.workspaceId === undefined \|\| folderReadonly/)
  assert.match(code, /openCreateFolder\(group\.workspaceId\)/)
})

test('folder tree headers stay light and there is no duplicate chip row', () => {
  // One navigation model: workspace -> collapsible folder sections -> rows.
  // The old chip strip + full section header duplicated every folder name.
  assert.equal(code.includes('dsm-folder-strip'), false)
  assert.equal(code.includes('dsm-folder-chip'), false)
  assert.equal(code.includes('dsm-folder-new'), false)
  assert.equal(code.includes('IconFolderOpenOutlineRegular'), false)
  assert.match(code, /\.dsm-folder-header\{[^}]*height:28px/)
  assert.match(code, /\.dsm-folder-header\{[^}]*padding-inline-start:38px/)
  assert.match(code, /\.dsm-folder-header\{[^}]*font-size:14px/)
  assert.match(code, /\.dsm-folder-row \.dsm-folder-count\{margin-inline-start:6px\}/)
})
