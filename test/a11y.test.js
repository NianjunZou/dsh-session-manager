/**
 * Accessibility contract of the rendered region.
 *
 * Asserted against the shipped bundle rather than a live DOM: the shapes here
 * are the ones a screen reader and a keyboard user depend on, and the contract
 * lane already proves they are actually rendered.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const code = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

test('rows and blocks expose the roles and states a tree needs', () => {
  for (const needle of [
    "role: 'treeitem'",
    "'aria-selected': String(sessionId === currentId)",
    "'aria-expanded': String(expanded)",
    "'aria-haspopup': 'menu'",
    "'aria-label': t('menu.label')",
    "'aria-label': t('view.options')",
    "'aria-label': t('section.workspaces')",
    "role: 'alert'",
    "'aria-hidden': 'true'",
    'tabIndex: 0',
  ]) assert.ok(code.includes(needle), needle)
})

test('status is announced to assistive tech without occupying layout', () => {
  assert.match(code, /dsm-visually-hidden/)
  assert.match(code, /\.dsm-visually-hidden\{[^}]*clip:rect\(0 0 0 0\)/)
  // The mark's meaning reaches the label even though only a dot is painted.
  assert.match(code, /label\.join\('，'\)/)
})

test('a waiting row keeps its state text while the pointer is on it', () => {
  // Hover used to hand the trailing cell to the actions unconditionally, which
  // removed "等待批准 / 等待计划确认 / 等待回答" exactly when the user moved in
  // to read the row. The slot now opts out of that swap.
  assert.match(code, /'data-status-label': status\.pending === undefined \? undefined : 'true'/)
  assert.match(code, /\.dsm-row:hover \.dsm-time:not\(\[data-status-label="true"\]\)/)
  // The time/pin swap still happens for every row that carries no state text.
  assert.match(code, /\.dsm-row:hover \.dsm-pin/)
})

test('the region is fully operable from the keyboard', () => {
  // Rows open on Enter and Space.
  assert.match(code, /event\.key === 'Enter' \|\| event\.key === ' '\)/)
  // Ordering has a keyboard path that is not a pointer drag.
  assert.match(code, /event\.altKey && \(event\.key === 'ArrowUp' \|\| event\.key === 'ArrowDown'\)/)
  // Blocks are real buttons, so Space/Enter toggle them natively.
  assert.match(code, /'button', \{\s*type: 'button',\s*className: 'dsm-section-header'/)
  // Focus stays visible on rows, action buttons and block headers.
  assert.match(code, /\.dsm-row:focus-visible,\.dsm-action:focus-visible,\.dsm-section-header:focus-visible\{outline:2px solid var\(--dsw-alias-focus-ring\)/)
})

test('a truncated title still exposes its full text', () => {
  assert.match(code, /className: 'dsm-title', title \}/)
  assert.match(code, /\.dsm-title\{[^}]*text-overflow:ellipsis/)
})
