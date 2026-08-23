/**
 * dsh-settings-manager — logic verification harness (no browser needed).
 *
 * Loads src/client.js inside a sandbox that mimics the client module system,
 * then exercises the three slot-registry patches against a minimal
 * SlotRegistry-like service:
 *
 *   - base sections registered BEFORE the manager (like General/Models/Plugins)
 *   - a section registered AFTER the manager (passes through the register hook)
 *   - read-path hiding / reordering / label rewriting
 *   - entriesOfSlot identity safety (renderer isLive contract)
 *   - policy persistence in localStorage
 *   - the bump trick leaving no trace
 *   - the own section being unhideable
 *
 * Note: the mock's register() returns a disposer (like the real SlotRegistry),
 * so raw entry objects are captured from the store, never from register().
 *
 * Run: node scripts/verify.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`)
  }
}

/* ------------------------------------------------------------------ *
 * Minimal SlotRegistry-like service (list-slot semantics only).
 * Prototype methods are what the manager patches, so the service must be a
 * real class instance (like the real SlotRegistry). register() returns a
 * disposer function, mirroring the real API.
 * ------------------------------------------------------------------ */
const EMPTY = Object.freeze([])

class MockSlots {
  constructor() {
    this._entries = new Map()
    this._declared = new Set()
    this._listeners = new Map()
    this._versions = new Map()
    this._injectQueues = new Map()
  }

  declare(key) {
    this._declared.add(key)
    const queue = this._injectQueues.get(key)
    if (queue) {
      this._injectQueues.delete(key)
      for (const cb of [...queue]) cb()
    }
  }

  register(options, component) {
    const key = options.name
    if (!this._declared.has(key)) throw new Error(`slot "${key}" is not declared`)
    const stored = { component, options: { ...options } }
    const list = this._entries.get(key) || []
    list.push(stored)
    this._entries.set(key, list)
    this._bump(key)
    return () => {
      const next = (this._entries.get(key) || []).filter((entry) => entry !== stored)
      this._entries.set(key, next)
      this._bump(key)
    }
  }

  entries(key) {
    return this._entries.get(key) || EMPTY
  }

  entriesOfSlot(key) {
    return this._entries.get(key) || EMPTY
  }

  subscribe(key, fn) {
    const set = this._listeners.get(key) || new Set()
    set.add(fn)
    this._listeners.set(key, set)
    return () => set.delete(fn)
  }

  getVersion(key) {
    return this._versions.get(key) || 0
  }

  inject(key, cb) {
    if (this._declared.has(key)) {
      cb()
      return () => {}
    }
    const queue = this._injectQueues.get(key) || new Set()
    queue.add(cb)
    this._injectQueues.set(key, queue)
    return () => queue.delete(cb)
  }

  _bump(key) {
    this._versions.set(key, (this._versions.get(key) || 0) + 1)
    for (const fn of this._listeners.get(key) || []) fn()
  }
}

/* ------------------------------------------------------------------ *
 * Browser-ish sandbox: window.__ModuleLoader__, localStorage, React stub.
 * ------------------------------------------------------------------ */
const storage = new Map()
const localStorageMock = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('fragment'),
  useState: () => [0, () => {}],
  useEffect: () => {},
  useReducer: (reducer, init) => [typeof init === 'function' ? init() : init, () => {}],
}

const registrations = []
const sandbox = {
  window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
  localStorage: localStorageMock,
  console,
  __DSH_SETTINGS_MANAGER_TEST__: true,
  Symbol,
  Map,
  Set,
  JSON,
  Object,
  Array,
  Number,
  String,
  Error,
  Math,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)

const code = readFileSync(join(root, 'src', 'client.js'), 'utf8')
vm.runInContext(code, sandbox)

check('client bundle registered one module', registrations.length === 1, `got ${registrations.length}`)
const registration = registrations[0]
check('module id is dsh-settings-manager', registration.id === 'dsh-settings-manager')

const plugin = registration.factory((spec) => {
  if (spec === 'react') return ReactStub
  throw new Error(`unexpected require("${spec}")`)
})

/* ------------------------------------------------------------------ *
 * Context + environment
 * ------------------------------------------------------------------ */
const slots = new MockSlots()
const localeMock = {
  register: () => {},
  bind: () => (key) => key,
}
const ctx = {
  get(name) {
    if (name === 'slots') return slots
    if (name === 'locale') return localeMock
    return undefined
  },
  effect(callback) {
    return callback()
  },
}

// The shell declares settings.section at boot, then base sections register
// BEFORE any profile plugin (General/Models/Plugins).
slots.declare('settings.section')
slots.register({ name: 'settings.section', id: 'general', order: 0, label: () => '通用设置' }, () => 'General')
slots.register({ name: 'settings.section', id: 'models', order: 10, label: () => '模型' }, () => 'Models')
slots.register({ name: 'settings.section', id: 'api-retry', order: 95, label: () => 'API 重试' }, () => 'ApiRetry')

// Raw entry objects captured BEFORE the manager loads (identity baselines).
const rawGeneral = slots.entries('settings.section').find((e) => e.options.id === 'general')
const rawModels = slots.entries('settings.section').find((e) => e.options.id === 'models')
const rawRetry = slots.entries('settings.section').find((e) => e.options.id === 'api-retry')

/** Nav order exactly like the shell computes it: read entries, sort by order. */
function navIds() {
  return slots
    .entries('settings.section')
    .map((e) => ({ id: e.options.id, order: e.options.order ?? 0 }))
    .sort((a, b) => a.order - b.order)
    .map((row) => row.id)
}

/** Total number of sections currently registered (raw store). */
function readAllCount() {
  return test.patch.origEntries.call(slots, 'settings.section').length
}

/* ------------------------------------------------------------------ *
 * Apply the manager (simulates the profile plugin loading after base).
 * ------------------------------------------------------------------ */
plugin.apply(ctx)
const test = plugin.__test
check('test seam attached', test !== undefined)

const proto = Object.getPrototypeOf(slots)
check('prototype patches installed', proto.__settingsManagerPatched === true)

console.log('\n— registration pass-through —')

// A section registering AFTER the manager passes through the register hook.
slots.register({ name: 'settings.section', id: 'web-ui-plugins', order: 110, label: () => 'Web UI 插件' }, () => 'WebUi')
check('post-patch registration visible (no policy)', navIds().includes('web-ui-plugins'))

// The register hook records the inventory but never mutates the stored options
// (read the RAW store — the patched entries() applies the policy on read).
test.policy.setOrder('late-plugin', 7)
slots.register({ name: 'settings.section', id: 'late-plugin', order: 999, label: () => 'Late' }, () => 'Late')
const lateStored = test.patch.origEntries.call(slots, 'settings.section').find((e) => e.options.id === 'late-plugin')
check('register hook does NOT mutate stored order', lateStored.options.order === 999, `got ${lateStored.options.order}`)
check(
  'register hook records the inventory',
  test.inventory.has('late-plugin') && test.inventory.get('late-plugin').order === 999,
)
// Read path applies the policy order even though the store was untouched.
const lateRead = slots.entries('settings.section').find((e) => e.options.id === 'late-plugin')
check('read path applies policy order', lateRead.options.order === 7, `got ${lateRead.options.order}`)
test.policy.reset('late-plugin')

check('own section registered', navIds().includes('settings-manager'))

console.log('\n— read path: hiding —')

test.policy.setHidden('api-retry', true)
check('hidden section removed from entries() (nav)', !navIds().includes('api-retry'))
check(
  'hidden section removed from entriesOfSlot() (content)',
  !slots.entriesOfSlot('settings.section').some((e) => e.options.id === 'api-retry'),
)
test.policy.setHidden('api-retry', false)
check('un-hide restores the section live', navIds().includes('api-retry'))

console.log('\n— read path: identity safety (renderer isLive contract) —')

const modelsNow = slots.entries('settings.section').find((e) => e.options.id === 'models')
check('entries() keeps original object when no policy applies', modelsNow === rawModels)
const generalElected = slots.entriesOfSlot('settings.section').find((e) => e.options.id === 'general')
check('entriesOfSlot() always returns the original entry object', generalElected === rawGeneral)

console.log('\n— read path: reorder + rename —')

test.policy.setOrder('web-ui-plugins', 5)
test.policy.setLabel('api-retry', 'API 重试（已接管）')
const webUiRead = slots.entries('settings.section').find((e) => e.options.id === 'web-ui-plugins')
check('entries() rewrites order on read', webUiRead.options.order === 5, `got ${webUiRead.options.order}`)
const retryRead = slots.entries('settings.section').find((e) => e.options.id === 'api-retry')
check(
  'entries() rewrites label on read',
  typeof retryRead.options.label === 'function' && retryRead.options.label() === 'API 重试（已接管）',
)

const expectedOrder = ['general', 'settings-manager', 'web-ui-plugins', 'models', 'api-retry', 'late-plugin']
check(
  'nav order follows rewritten orders (shell-style sort)',
  JSON.stringify(navIds()) === JSON.stringify(expectedOrder),
  `got ${JSON.stringify(navIds())}`,
)

console.log('\n— reorder() semantics (↑↓ buttons + drag) —')

// models placed AFTER api-retry → sorted: general, settings-manager, web-ui,
// api-retry, models, late-plugin (renumbered to index*10).
test.reorder('models', 'api-retry', 'after')
let rows = test.readSections()
let idxModels = rows.findIndex((r) => r.id === 'models')
let idxRetry = rows.findIndex((r) => r.id === 'api-retry')
check('reorder-after moves the section below the target', idxModels > idxRetry, `models@${idxModels} api-retry@${idxRetry}`)
check('reorder renumbers every section to a distinct slot', new Set(rows.map((r) => r.order)).size === rows.length)
check('reorder preserves all sections', rows.length === readAllCount())

// web-ui-plugins placed BEFORE general → ends up first.
test.reorder('web-ui-plugins', 'general', 'before')
rows = test.readSections()
check('reorder-before moves the section above the target', rows[0].id === 'web-ui-plugins', `first=${rows[0].id}`)

// Drag onto the same row is a no-op (must not crash or change anything).
const beforeDrag = JSON.stringify(test.readSections().map((r) => r.id))
test.reorder('models', 'models', 'after')
check('reorder onto itself is a no-op', JSON.stringify(test.readSections().map((r) => r.id)) === beforeDrag)

// Clear the order policy the reorder tests produced, so the persistence
// checks below start from a clean slate.
test.resetAll()

console.log('\n— own section is protected —')

test.policy.setHidden('settings-manager', true)
check('own section cannot be hidden', navIds().includes('settings-manager'))
check('policy refuses to hide own section', test.policy.isHidden('settings-manager') === false)

console.log('\n— bump leaves no trace —')

const before = slots.getVersion('settings.section')
test.patch.bump()
const after = slots.getVersion('settings.section')
check('bump raises the slot version', after > before, `${before} -> ${after}`)
check('touch entry removed after bump', !navIds().includes('settings-manager-touch'))

console.log('\n— persistence —')

test.policy.setHidden('late-plugin', true) // fresh hide for the persistence check
test.policy.setOrder('web-ui-plugins', 5) // fresh order for the persistence check
test.policy.setLabel('api-retry', 'persist-label') // fresh label for the persistence check
const stored = storage.get('dsh-settings-manager.policy.v1')
check('policy persisted to localStorage', typeof stored === 'string' && stored.length > 0)
const parsed = JSON.parse(stored)
check('persisted hidden policy', parsed.hidden && parsed.hidden['late-plugin'] === true)
check('persisted order policy', parsed.order && parsed.order['web-ui-plugins'] === 5)
check('persisted label policy', parsed.labels && parsed.labels['api-retry'] === 'persist-label')

test.resetAll()
const cleared = JSON.parse(storage.get('dsh-settings-manager.policy.v1'))
check(
  'resetAll clears persisted policy',
  Object.keys(cleared.hidden).length === 0 && Object.keys(cleared.order).length === 0 && Object.keys(cleared.labels).length === 0,
)

console.log('\n— reset restores the original registration —')

check('reset restores hidden section', navIds().includes('late-plugin'))
const webUiAfterReset = slots.entries('settings.section').find((e) => e.options.id === 'web-ui-plugins')
check('reset restores original order', webUiAfterReset.options.order === 110, `got ${webUiAfterReset.options.order}`)
const retryAfterReset = slots.entries('settings.section').find((e) => e.options.id === 'api-retry')
check('reset restores original label', retryAfterReset.options.label === rawRetry.options.label)

console.log('\n— disposer contract preserved —')

const disposer = slots.register({ name: 'settings.section', id: 'temp-section', order: 500, label: () => 'Temp' }, () => 'Temp')
check('register still returns a disposer', typeof disposer === 'function')
disposer()
check('disposer removes the entry', !navIds().includes('temp-section'))

console.log('')
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s)`)
  process.exit(1)
}
console.log('ALL CHECKS PASSED')
