/**
 * Load the client bundle inside a VM sandbox (mirroring the browser module
 * system) and build a test environment: a MockSlots service, a minimal cordis
 * ctx (get/effect), and the plugin's exported apply() + __test seam.
 *
 * The bundle's own `window.__ModuleLoader__.load(...)` registration is
 * captured by the sandbox collector; the factory is then invoked with a
 * specifier resolver so `react` (and only react) resolves to a real instance
 * (needed by the e2e smoke test that renders the component).
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { MockSlots } from './mock-slots.mjs'

const BUNDLE = fileURLToPath(new URL('../../lib/client.js', import.meta.url))

/** Key on the VM global where apply() stashes the test seam (TS port). */
export const SEAM_KEY = '__DSH_SETTINGS_MANAGER_SEAM__'

/** Minimal React stub used when no real React is provided (UT only). */
const defaultReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('fragment'),
  useState: () => [0, () => {}],
  useEffect: () => {},
  useReducer: (reducer, init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (init) => ({ current: init }),
}

/** Fresh in-memory localStorage mock (jsdom-free). */
export function inMemoryStorage() {
  const store = new Map()
  return {
    _store: store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
}

/**
 * Fresh mock `connection` service (the DSH settings wire). The client's policy
 * persists to `api.settings.replace({ ns:'settings-manager', section })` and
 * loads from `api.settings.describe({})`. The mock stores the persisted
 * document in memory so tests can assert what got written / seed what gets read.
 */
export function mockConnection(initial = undefined) {
  let persisted = initial !== undefined ? initial : { hidden: {}, order: {}, labels: {} }
  const replaceCalls = []
  return {
    isLoopback: true,
    api: {
      settings: {
        async describe() {
          return {
            result: {
              ok: true,
              value: { writable: true, hasDocument: true, namespaces: [{ ns: 'settings-manager', value: persisted }] },
            },
          }
        },
        async replace({ ns, section }) {
          replaceCalls.push({ ns, section: structuredClone(section) })
          persisted = structuredClone(section)
          return { result: { ok: true, value: { ns, value: persisted } } }
        },
      },
    },
    /** Current persisted document (what a fresh describe would return). */
    _persisted() {
      return persisted
    },
    /** Every replace() write the client has fired, in order. */
    _replaceCalls() {
      return replaceCalls
    },
    /** Seed the server document (what the client loads on startup). */
    _setPersisted(doc) {
      persisted = doc
    },
  }
}

/**
 * @param opts.globals - extra VM globals (e.g. jsdom `document`/`localStorage`).
 * @param opts.react  - real React module; the bundle's `require('react')` gets it.
 * @param opts.locale - locale mock; defaults to one that captures the plugin's zh dict.
 * @param opts.resolveSpecifier - optional custom resolver for bundle specifiers
 *   other than `react` (the DSH module system's `require` in real life).
 */
export function loadEnv({ globals = {}, react, locale, resolveSpecifier } = {}) {
  const code = readFileSync(BUNDLE, 'utf8')
  const registrations = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
    console,
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
    __DSH_SETTINGS_MANAGER_TEST__: true,
    localStorage: inMemoryStorage(),
    ...globals,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)

  const registration = registrations[0]
  if (!registration) throw new Error('client bundle did not register a module')
  if (registration.id !== 'dsh-settings-manager') {
    throw new Error(`unexpected module id "${registration.id}"`)
  }

  const plugin = registration.factory((spec) => {
    if (spec === 'react') return react || defaultReact
    if (resolveSpecifier) return resolveSpecifier(spec)
    throw new Error(`client bundle requested an unresolved specifier "${spec}" (only 'react' is wired by default)`)
  })

  // A fresh subclass instance per scenario: the plugin patches the instance's
  // OWN prototype (register/entries/entriesOfSlot + marker), so sharing
  // MockSlots.prototype across tests would leak the patch + policy closure
  // between scenarios. A per-call subclass isolates each test.
  const slots = new (class extends MockSlots {})()
  const connection = mockConnection()
  const localeMock =
    locale ||
    (() => {
      const dict = {}
      return {
        register(ns, value) {
          Object.assign(dict, value && value.zh ? value.zh : value || {})
        },
        bind() {
          return (key) => dict[key] ?? key
        },
      }
    })()
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return localeMock
      if (name === 'connection') return connection
      return undefined
    },
    effect(callback) {
      return callback()
    },
  }

  return { registration, plugin, slots, ctx, connection, localeMock, storage: sandbox.localStorage, vmGlobal: sandbox }
}
