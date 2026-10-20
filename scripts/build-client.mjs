#!/usr/bin/env node
/**
 * Bundle the authored client half into the single file the browser module
 * loader can materialize.
 *
 * Why a hand-rolled build: the client module system resolves `require(spec)`
 * only from platform seed words, already-materialized modules and registered
 * package factories — synchronous relative paths are not resolvable — so the
 * shipped client entry must be one self-contained file. A dependency-free
 * concatenation keeps the toolchain at zero packages, and the strict shape
 * assertions below turn any drift in the authored sources into a build failure
 * instead of a subtly broken bundle.
 *
 * Output: `client/client.js`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = resolve(root, 'src/client/core.js')
const BODY = resolve(root, 'src/client/body.js')
const OUT = resolve(root, 'client/client.js')

/** Plugin identity: package name, client module id and bundle name are one thing. */
const PLUGIN_ID = '@pianner/dsh-session-manager'

/**
 * Strip the `export ` prefix from top-level declarations so the module can be
 * inlined into the factory body, where every name shares one scope.
 * @param {string} source - ESM source of the pure core.
 * @returns {string} the same source with top-level `export ` keywords removed.
 */
function inlineCore(source) {
  if (/^\s*import\s/m.test(source)) {
    throw new Error('src/client/core.js must stay dependency-free: found an `import` statement')
  }
  if (/^\s*export\s+default\s/m.test(source) || /^\s*export\s*\{/m.test(source)) {
    throw new Error('src/client/core.js must use only `export function` / `export const` declarations')
  }
  const stripped = source.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '')
  if (/^export\b/m.test(stripped)) {
    throw new Error('src/client/core.js has an export form this build cannot inline')
  }
  return stripped
}

/** Indent a block so the emitted factory body reads as ordinary source. */
function indent(source, spaces) {
  const pad = ' '.repeat(spaces)
  return source.split('\n').map(line => (line === '' ? '' : pad + line)).join('\n')
}

const core = inlineCore(readFileSync(CORE, 'utf8'))
const body = readFileSync(BODY, 'utf8')

const bundle = `/*!
 * ${PLUGIN_ID} — generated client bundle. DO NOT EDIT.
 * Source of truth: src/client/core.js (pure derivation) + src/client/body.js (view).
 * Rebuild with: npm run build
 * License: MIT.
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PLUGIN_ID)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ---- inlined from src/client/core.js ----
${indent(core, 4)}
    // ---- end src/client/core.js ----

${indent(body, 4)}
    return module.exports
  },
})
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, bundle)
process.stdout.write(`built ${OUT} (${bundle.length} bytes)\n`)
