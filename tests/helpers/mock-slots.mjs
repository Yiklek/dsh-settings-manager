/**
 * Minimal SlotRegistry-like service (list-slot semantics only), mirroring the
 * real API surface the plugin patches:
 *   - register(options, component) returns a disposer
 *   - entries / entriesOfSlot / subscribe / getVersion / inject / declare
 * The prototype methods are exactly what the plugin's patches wrap, so the
 * service must be a real class instance (like the real SlotRegistry).
 */
export const EMPTY = Object.freeze([])

export class MockSlots {
  constructor() {
    this._entries = new Map()
    this._declared = new Set()
    this._listeners = new Map()
    this._versions = new Map()
    this._injectQueues = new Map()
  }

  /** Declare a slot (the shell declares settings.section at boot). */
  declare(key) {
    this._declared.add(key)
    const queue = this._injectQueues.get(key)
    if (queue) {
      this._injectQueues.delete(key)
      for (const cb of [...queue]) cb()
    }
  }

  /** Register one entry; returns a disposer (like the real API). */
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

  /** Raw store access for tests (hidden-inclusive, policy NOT applied). */
  raw(key) {
    return this._entries.get(key) || EMPTY
  }

  _bump(key) {
    this._versions.set(key, (this._versions.get(key) || 0) + 1)
    for (const fn of this._listeners.get(key) || []) fn()
  }
}
