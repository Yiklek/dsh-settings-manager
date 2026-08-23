/**
 * dsh-settings-manager — browser half, TypeScript source.
 *
 * Manages how other plugins' sections appear in the global Settings dialog
 * (show/hide, ordering, renaming) WITHOUT modifying upstream. Works by
 * intercepting the client slot registry (`ctx.slots`), the one mechanism every
 * plugin uses to contribute a settings section:
 *
 *   ctx.slots.inject('settings.section', () => ctx.slots.register({...}, Comp))
 *
 * Three interception points (all on `SlotRegistry.prototype`, which every
 * `ctx.slots.*` call resolves through dynamically — the cordis service proxy
 * re-reads property descriptors at access time, no caching):
 *
 *   1. register  — every `settings.section` registration PASSES THROUGH the
 *                  manager (inventory recorded). The stored registration is
 *                  NOT mutated: the read path is the single policy authority,
 *                  so reset() can always restore a plugin's own values (a
 *                  registration-time rewrite would destroy the original after
 *                  a page reload). Hard drop / redirect hooks live here.
 *   2. entries   — the Settings shell builds its nav from raw
 *                  `slots.entries('settings.section')`; this patch filters
 *                  hidden sections and rewrites order/label on read. Covers
 *                  EVERY section regardless of when it registered (the shell
 *                  re-reads on every slot version change), including the base
 *                  sections (General/Models/Plugins) that always register
 *                  before any profile plugin.
 *   3. entriesOfSlot — the renderer elects the winning entry per id for the
 *                  section CONTENT; this patch filters hidden ids there too
 *                  (filter-only: the renderer runs an `isLive` check on the
 *                  returned entries, so clones would throw).
 *
 * After a policy change the shell must re-read: a dummy register+dispose
 * bumps the slot version and fires the listeners (no visible flash — the
 * flush runs on a microtask after both mutations).
 *
 * Policy persistence: localStorage. The settings RPC only exposes allowlisted
 * namespaces to configuration clients (api-proxy `exposedNamespaces()`), so a
 * profile plugin cannot open its own settings namespace upstream.
 *
 * Build: esbuild bundles this file into `lib/client.js` wrapped in the DSH
 * module format (`window.__ModuleLoader__.load`). `react` stays external (a
 * shell seed); there are no other runtime imports.
 */
import type { Context } from '@deepseek-ai/cordis'
import React from 'react'

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/** The settings-section slot this plugin manages. */
const SECTION_SLOT = 'settings.section'
/** This plugin's own section id (never hidden, so its UI stays reachable). */
const OWN_ID = 'settings-manager'
/** localStorage key holding the policy document. */
const STORAGE_KEY = 'dsh-settings-manager.policy.v1'
/** Locale dictionary namespace. */
const LOCALE_NS = 'settingsManager'
/**
 * Default nav order for this plugin's own section. Kept near the TOP: the
 * settings nav does not scroll by default and gets clipped once many sections
 * register - a bottom default position would be unreachable.
 */
const OWN_ORDER = 1
/** Dummy entry id used to bump the slot version after policy changes. */
const TOUCH_ID = 'settings-manager-touch'

/** The client-side settings document (persisted in localStorage). */
interface PolicyDoc {
  hidden: Record<string, boolean>
  order: Record<string, number>
  labels: Record<string, string>
}

/** A settings section's registration options as the shell sees them. */
interface SectionOptions {
  id: string
  name?: string
  order?: number
  label?: string | (() => string)
  priority?: number
  registrant?: string
  locale?: string
  [key: string]: unknown
}

/** One stored slot entry (the renderer requires the ORIGINAL object). */
interface StoredEntry {
  component: unknown
  options: SectionOptions
}

/** The subset of the slots service this plugin touches. */
interface SlotsService {
  inject(key: string, cb: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
  entries(key: string): readonly StoredEntry[]
  entriesOfSlot(key: string): readonly StoredEntry[]
  subscribe(key: string, fn: () => void): () => void
  getVersion(key: string): number
}

interface LocaleService {
  register(ns: string, dict: Record<string, unknown>): void
  bind(ns: string): (key: string, params?: unknown) => string
}

/** The plugin's policy API (shared by patches, UI, and the test seam). */
interface Policy {
  isHidden(id: string): boolean
  orderFor(id: string): number | undefined
  labelFor(id: string): string | undefined
  effectiveOrder(id: string, registeredOrder?: number): number
  setHidden(id: string, hidden: boolean): void
  setOrder(id: string, order: number): void
  setOrders(orders: Record<string, number>): void
  setLabel(id: string, label: string): void
  reset(id: string): void
  resetAll(): void
  applyToRead(options: SectionOptions): SectionOptions
  subscribe(fn: () => void): () => void
  setOnChanged(fn: () => void): void
}

/** One row shown in the manager panel. */
interface SectionRow {
  id: string
  label: string
  originalLabel: string
  registrant?: string
  order: number
  hidden: boolean
  seq: number
}

/** The slot-registry patch handle. */
interface Patch {
  installed: boolean
  origEntries: (key: string) => readonly StoredEntry[]
  inventory: Map<string, { id: string; order: number; label?: unknown; priority: number }>
  bump: () => void
}

type Place = 'before' | 'after'

/* ------------------------------------------------------------------ *
 * Locale
 * ------------------------------------------------------------------ */

const zh = {
  nav: '设置编排',
  hint: '管理各插件在全局设置中的显示与排序，改动即时生效。隐藏的分区不再出现在设置导航；拖拽或按钮可调整顺序。',
  hide: '隐藏',
  show: '显示',
  moveUp: '上移',
  moveDown: '下移',
  reset: '重置',
  resetAll: '全部重置',
  hiddenTag: '已隐藏',
  noSections: '暂无已注册的设置分区',
  selfNote: '本分区由 dsh-settings-manager 提供，不可隐藏。',
  dragHint: '拖拽调整顺序',
  rename: '改名',
  renamePlaceholder: '输入新名称…',
}
const en = {
  nav: 'Settings Manager',
  hint: 'Manage how plugin sections appear in global settings. Changes apply instantly: hidden sections leave the settings nav; drag or use the arrows to reorder.',
  hide: 'Hide',
  show: 'Show',
  moveUp: 'Move up',
  moveDown: 'Move down',
  reset: 'Reset',
  resetAll: 'Reset all',
  hiddenTag: 'Hidden',
  noSections: 'No settings sections registered',
  selfNote: 'Provided by dsh-settings-manager; cannot be hidden.',
  dragHint: 'Drag to reorder',
  rename: 'Rename',
  renamePlaceholder: 'Enter new name…',
}

/* ------------------------------------------------------------------ *
 * Nav scroll fix + panel CSS
 *
 * The settings shell renders the nav as a fixed non-scrolling column and the
 * dialog panel clips overflow - once enough sections register, the bottom rows
 * become unreachable. Selector precedent: dsh-better-sidebar identifies the
 * settings nav with the same `[role="dialog"] nav` query.
 * ------------------------------------------------------------------ */

const NAV_SCROLL_CSS = [
  '[role="dialog"] nav { overflow-y: auto; padding-bottom: 12px; scrollbar-width: thin; }',
].join('\n')

const PANEL_CSS = [
  '.dsm-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
  '.dsm-icon-btn:disabled { opacity: .35; cursor: default; }',
  '.dsm-icon-btn:disabled:hover { background: transparent; }',
  '.dsm-reset-all:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '.dsm-switch:disabled { opacity: .5; cursor: default; }',
  // Drag feedback via classes (not inline styles — see styles.row comment).
  '.dsm-row-dragging { opacity: .4; }',
  // Single insertion indicator element, positioned in the row gap at the
  // exact spot where the dragged section will land. Blue (business-primary)
  // reads as a placement cue rather than success.
  '.dsm-drop-indicator {',
  '  position: absolute; left: 2px; right: 2px; height: 2px;',
  '  border-radius: 1px; background: var(--dsw-alias-state-business-primary);',
  '  z-index: 2; pointer-events: none;',
  '}',
].join('\n')

function insertStyles(css: string): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-settings-manager')
  style.textContent = css
  document.head.append(style)
  return () => style.remove()
}

/* ------------------------------------------------------------------ *
 * Tiny emitter
 * ------------------------------------------------------------------ */

function createEmitter() {
  const listeners = new Set<() => void>()
  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    emit(): void {
      for (const fn of [...listeners]) {
        try {
          fn()
        } catch (error) {
          /* one bad listener must not break the others */
        }
      }
    },
  }
}

/* ------------------------------------------------------------------ *
 * Policy store (localStorage-backed)
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function createPolicy(): Policy {
  const state: PolicyDoc = { hidden: {}, order: {}, labels: {} }
  try {
    const raw = globalThis.localStorage ? globalThis.localStorage.getItem(STORAGE_KEY) : null
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isRecord(parsed)) {
        if (isRecord(parsed.hidden)) state.hidden = parsed.hidden as Record<string, boolean>
        if (isRecord(parsed.order)) state.order = parsed.order as Record<string, number>
        if (isRecord(parsed.labels)) state.labels = parsed.labels as Record<string, string>
      }
    }
  } catch (error) {
    /* corrupt storage is ignored; policy starts empty */
  }

  const emitter = createEmitter()
  let onChanged: (() => void) | null = null

  function save(): void {
    try {
      if (globalThis.localStorage) {
        globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      }
    } catch (error) {
      /* storage full / blocked — keep running with in-memory policy */
    }
  }

  function changed(): void {
    save()
    emitter.emit()
    if (onChanged) {
      try {
        onChanged()
      } catch (error) {
        /* the bump must never break a policy mutation */
      }
    }
  }

  return {
    isHidden(id) {
      return id !== OWN_ID && state.hidden[id] === true
    },
    orderFor(id) {
      const value = state.order[id]
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    },
    labelFor(id) {
      const value = state.labels[id]
      return typeof value === 'string' && value.length > 0 ? value : undefined
    },
    effectiveOrder(id, registeredOrder) {
      const value = this.orderFor(id)
      return value !== undefined ? value : (typeof registeredOrder === 'number' ? registeredOrder : 0)
    },
    setHidden(id, hidden) {
      if (id === OWN_ID) return
      if (hidden) state.hidden[id] = true
      else delete state.hidden[id]
      changed()
    },
    setOrder(id, order) {
      if (typeof order === 'number' && Number.isFinite(order)) state.order[id] = order
      else delete state.order[id]
      changed()
    },
    setOrders(orders) {
      let dirty = false
      for (const [id, order] of Object.entries(orders)) {
        if (typeof order === 'number' && Number.isFinite(order)) {
          if (state.order[id] !== order) {
            state.order[id] = order
            dirty = true
          }
        } else if (id in state.order) {
          delete state.order[id]
          dirty = true
        }
      }
      if (dirty) changed()
    },
    setLabel(id, label) {
      const value = typeof label === 'string' ? label.trim() : ''
      if (value.length > 0) state.labels[id] = value
      else delete state.labels[id]
      changed()
    },
    reset(id) {
      delete state.hidden[id]
      delete state.order[id]
      delete state.labels[id]
      changed()
    },
    resetAll() {
      state.hidden = {}
      state.order = {}
      state.labels = {}
      changed()
    },
    applyToRead(options) {
      const order = this.orderFor(options.id)
      const label = this.labelFor(options.id)
      if (order === undefined && label === undefined) return options
      return {
        ...options,
        ...(order !== undefined ? { order } : {}),
        ...(label !== undefined ? { label: () => label } : {}),
      }
    },
    subscribe(fn) {
      return emitter.subscribe(fn)
    },
    setOnChanged(fn) {
      onChanged = fn
    },
  }
}

/* ------------------------------------------------------------------ *
 * SlotRegistry interception
 * ------------------------------------------------------------------ */

interface PatchTarget {
  register: (options: Record<string, unknown>, component: unknown) => () => void
  entries: (key: string) => readonly StoredEntry[]
  entriesOfSlot: (key: string) => readonly StoredEntry[]
  [key: string]: unknown
}

/**
 * Install the three patches on the slot registry prototype, reached through
 * the service instance (`Object.getPrototypeOf`), so no official package is
 * imported at runtime.
 */
function installPatches(ctx: Context, policy: Policy): Patch {
  let slotsService: unknown
  try {
    slotsService = ctx.get('slots')
  } catch (error) {
    slotsService = undefined
  }
  if (slotsService === undefined) return { installed: false } as Patch

  let proto: PatchTarget | undefined
  try {
    proto = Object.getPrototypeOf(slotsService) as PatchTarget
  } catch (error) {
    proto = undefined
  }
  if (!proto || typeof proto.register !== 'function') return { installed: false } as Patch

  // Re-apply (e.g. HMR reload): rewire the active policy + ctx so the already
  // installed patches keep working with the fresh state, and hand back the
  // stored interface — returning a bare `{ installed: true }` here would make
  // apply() crash on `patch.bump`.
  if (proto.__settingsManagerPatched) {
    const holder = proto.__settingsManagerPolicy as { current: Policy } | undefined
    if (holder) holder.current = policy
    proto.__settingsManagerCtx = ctx
    return (proto.__settingsManagerInterface as Patch) || ({ installed: true } as Patch)
  }

  // Patches read the policy through a holder so HMR re-apply can repoint it
  // without re-installing (and re-nesting) the wrappers.
  const policyHolder: { current: Policy } = { current: policy }

  const origRegister = proto.register
  const origEntries = proto.entries
  const origEntriesOfSlot = proto.entriesOfSlot
  const inventory = new Map<string, { id: string; order: number; label?: unknown; priority: number }>()

  // 1) Registration path: every settings.section registration flows through
  //    the manager. v1 only observes (records the inventory) — it does NOT
  //    mutate the stored options, so reset() can always restore the original.
  proto.register = function register(rawOptions, component) {
    if (rawOptions && rawOptions.name === SECTION_SLOT && typeof rawOptions.id === 'string') {
      inventory.set(rawOptions.id, {
        id: rawOptions.id,
        order: typeof rawOptions.order === 'number' ? rawOptions.order : 0,
        label: rawOptions.label,
        priority: typeof rawOptions.priority === 'number' ? rawOptions.priority : 0,
      })
    }
    return origRegister.call(this, rawOptions, component)
  }

  // 2) Read path (nav): filter hidden + rewrite order/label on read.
  proto.entries = function entries(key) {
    const rows = origEntries.call(this, key)
    if (key !== SECTION_SLOT) return rows
    const p = policyHolder.current
    const out: StoredEntry[] = []
    for (const entry of rows) {
      if (p.isHidden(entry.options.id)) continue
      const order = p.orderFor(entry.options.id)
      const label = p.labelFor(entry.options.id)
      if (order === undefined && label === undefined) {
        out.push(entry)
        continue
      }
      out.push({ ...entry, options: p.applyToRead(entry.options) })
    }
    return out
  }

  // 3) Read path (content): filter hidden — filter only, never clone (the
  //    renderer runs an isLive check on the returned entries).
  proto.entriesOfSlot = function entriesOfSlot(key) {
    const rows = origEntriesOfSlot.call(this, key)
    if (key !== SECTION_SLOT) return rows
    return rows.filter((entry) => !policyHolder.current.isHidden(entry.options.id))
  }

  proto.__settingsManagerPatched = true

  const iface: Patch = {
    installed: true,
    origEntries,
    inventory,
    bump() {
      try {
        const activeCtx = (proto.__settingsManagerCtx || ctx) as Context
        const slots = activeCtx.get('slots')
        if (!slots) return
        const disposer = slots.register(
          { name: SECTION_SLOT, id: TOUCH_ID, order: 1e9, priority: 100, label: () => '' },
          () => null,
        )
        if (typeof disposer === 'function') disposer()
      } catch (error) {
        /* best effort — a failed bump only delays the re-read */
      }
    },
  }
  proto.__settingsManagerPolicy = policyHolder
  proto.__settingsManagerCtx = ctx
  proto.__settingsManagerInterface = iface
  return iface
}

/* ------------------------------------------------------------------ *
 * Management section
 * ------------------------------------------------------------------ */

const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: '4px 2px' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '12px', marginBottom: '12px',
  },
  hint: {
    fontSize: '13px', lineHeight: '1.5', color: 'var(--dsw-alias-label-tertiary)',
    margin: 0, flex: '1', minWidth: 0,
  },
  resetAllBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', flex: 'none',
    fontSize: '12px', lineHeight: '16px', padding: '6px 12px', borderRadius: '8px',
    cursor: 'pointer', color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l2)',
  },
  list: {
    listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px',
    position: 'relative',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '7px 10px', borderRadius: '10px',
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l1)',
    cursor: 'grab',
  },
  // Drag feedback lives in CSS classes (.dsm-row-dragging / .dsm-drop-before
  // / .dsm-drop-after), NOT inline styles: mixing the `border` shorthand above
  // with a `borderColor` longhand causes React's inline-style diffing to
  // corrupt the border when toggling the drop target.
  grip: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
    color: 'var(--dsw-alias-label-caption)', cursor: 'grab', padding: 0, background: 'none', border: 'none',
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: '1' },
  labelLine: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 },
  label: {
    fontSize: '13px', fontWeight: 500, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  tag: {
    flex: 'none', fontSize: '10px', lineHeight: '14px', padding: '1px 7px', borderRadius: '999px',
    color: 'var(--dsw-alias-label-tertiary)', background: 'var(--dsw-alias-interactive-bg-hover)',
  },
  meta: {
    fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-label-caption)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  renameInput: {
    flex: '1', minWidth: 0, fontSize: '13px', lineHeight: '18px', padding: '2px 8px',
    color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', outline: 'none',
  },
  rowActions: { display: 'flex', alignItems: 'center', gap: '2px', flex: 'none' },
  iconBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
    width: '26px', height: '26px', borderRadius: '7px', cursor: 'pointer',
    color: 'var(--dsw-alias-label-tertiary)', background: 'transparent', border: 'none', padding: 0,
  },
  empty: { fontSize: '12px', color: 'var(--dsw-alias-label-caption)' },
  switchTrack: {
    position: 'relative', flex: 'none', width: '34px', height: '20px', borderRadius: '999px',
    cursor: 'pointer', padding: 0, border: 'none', transition: 'background-color .15s ease',
    background: 'var(--dsw-alias-border-l2)',
  },
  switchKnob: {
    position: 'absolute', top: '2px', left: '2px', width: '16px', height: '16px', borderRadius: '999px',
    background: 'var(--dsw-alias-bg-base)', transition: 'transform .15s ease', pointerEvents: 'none',
  },
}

const SVG_COMMON: React.SVGProps<SVGSVGElement> = {
  width: 16, height: 16, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false',
}

function svgIcon(name: string): React.ReactElement {
  const circles = (x: number, ys: number[]) =>
    ys.map((cy, i) => React.createElement('circle', { key: `${x}-${i}`, cx: x, cy, r: 1, fill: 'currentColor', stroke: 'none' }))
  const paths = (ds: string[]) => ds.map((d, i) => React.createElement('path', { key: i, d }))
  const content: Record<string, () => React.ReactNode[]> = {
    grip: () => [...circles(9, [5, 12, 19]), ...circles(15, [5, 12, 19])],
    // Lucide chevron-up / chevron-down: centered 12x6 strokes that visually
    // match the weight of the reset arc and the pencil shape (the old tiny
    // top-left chevrons looked smaller than the neighboring icons).
    up: () => paths(['m18 15-6-6-6 6']),
    down: () => paths(['m6 9 6 6 6-6']),
    reset: () => paths(['M3 12a9 9 0 1 0 2.64-6.36L3 8', 'M3 3v5h5']),
    pencil: () => paths(['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z']),
  }
  // Unknown name → empty svg (never throw).
  return React.createElement('svg', SVG_COMMON, content[name] ? content[name]() : null)
}

function resolveLabel(label: string | (() => string) | undefined): string {
  if (typeof label === 'function') return label()
  return typeof label === 'string' ? label : ''
}

/**
 * Decide the insertion side (before/after) for a pointer Y over a row, with a
 * hysteresis dead band around the midpoint so the gap indicator doesn't flip
 * back and forth (flicker/shake) as the cursor crosses the middle of the row.
 * The current side is kept inside the band; `current` is the side the indicator
 * is already showing, so the drop lands where the user saw it.
 */
function resolvePlace(clientY: number, rect: DOMRect, current: Place | null): Place {
  const mid = rect.top + rect.height / 2
  const band = rect.height * 0.2
  if (clientY < mid - band) return 'before'
  if (clientY > mid + band) return 'after'
  return current ?? (clientY < mid ? 'before' : 'after')
}

/** The environment handed to the manager component. */
interface ManagerEnv {
  slots: SlotsService
  policy: Policy
  readSections: () => SectionRow[]
  reorder: (movedId: string, targetId: string, place: Place) => void
  reset: (id: string) => void
  resetAll: () => void
  t: (key: string) => string
}

function createManagerSection(env: ManagerEnv): React.FC {
  const { slots, policy, readSections, reorder, reset, resetAll, t } = env

  function ManagerSection(): React.ReactElement {
    const [, force] = React.useReducer((value: number) => value + 1, 0)
    const dragId = React.useRef<string | null>(null)
    const [overId, setOverId] = React.useState<string | null>(null)
    const [overPlace, setOverPlace] = React.useState<Place | null>(null)
    // Y (in list coords) of the single insertion-indicator line; null = hidden.
    const [indicatorY, setIndicatorY] = React.useState<number | null>(null)
    const listRef = React.useRef<HTMLUListElement | null>(null)
    // Inline rename: editingId = row currently editing; draft = input value.
    const editingIdRef = React.useRef<string | null>(null)
    const [editingId, setEditingId] = React.useState<string | null>(null)
    const [draft, setDraft] = React.useState('')

    React.useEffect(() => {
      let offSlot: () => void = () => {}
      let offPolicy: () => void = () => {}
      try {
        offSlot = slots.subscribe(SECTION_SLOT, force)
      } catch (error) {
        /* slot subscription is best effort */
      }
      offPolicy = policy.subscribe(force)
      return () => {
        offSlot()
        offPolicy()
      }
    }, [])

    const rows = readSections()

    function clearDragTarget(): void {
      if (overId !== null || overPlace !== null || indicatorY !== null) {
        setOverId(null)
        setOverPlace(null)
        setIndicatorY(null)
      }
    }

    /** Enter inline-rename for a row, seeding the input with its current name. */
    function startEdit(row: SectionRow): void {
      editingIdRef.current = row.id
      setEditingId(row.id)
      setDraft(row.label)
    }

    /**
     * Commit the rename. An empty/whitespace value or a value identical to the
     * plugin's original name clears the override (back to the original). The
     * ref guards against the blur that fires right after Enter/Escape unmounts
     * the input — only the first caller acts.
     */
    function commitEdit(id: string): void {
      if (editingIdRef.current !== id) return
      editingIdRef.current = null
      const row = rows.find((r) => r.id === id)
      const value = draft.trim()
      if (row && value !== '' && value !== row.originalLabel) policy.setLabel(id, value)
      else policy.setLabel(id, '')
      setEditingId(null)
      setDraft('')
    }

    function cancelEdit(): void {
      editingIdRef.current = null
      setEditingId(null)
      setDraft('')
    }

    /** Insertion line TOP in list coordinates for a target row rect + side.
     *  The line is 2px tall, so its center lands on the gap midpoint (a 4px
     *  gap: before → 3px above the row's top edge, after → 1px below the
     *  row's bottom edge). */
    function computeIndicatorY(rect: DOMRect, place: Place): number | null {
      const listRect = listRef.current ? listRef.current.getBoundingClientRect() : null
      if (!listRect) return null
      return place === 'before' ? rect.top - listRect.top - 3 : rect.bottom - listRect.top + 1
    }

    function handleDragStart(e: React.DragEvent<HTMLLIElement>, id: string): void {
      dragId.current = id
      try {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
      } catch (error) {
        /* dataTransfer may be unavailable */
      }
      force()
    }

    function handleDragOver(e: React.DragEvent<HTMLLIElement>, id: string): void {
      if (dragId.current === id) {
        // Over the source row: don't allow a drop here.
        clearDragTarget()
        return
      }
      e.preventDefault()
      try {
        e.dataTransfer.dropEffect = 'move'
      } catch (error) {
        /* dataTransfer may be unavailable */
      }
      const rect = e.currentTarget.getBoundingClientRect()
      const place = resolvePlace(e.clientY, rect, overPlace)
      if (overId !== id) setOverId(id)
      if (overPlace !== place) setOverPlace(place)
      const y = computeIndicatorY(rect, place)
      if (indicatorY !== y) setIndicatorY(y)
    }

    // List-level: keep the drop allowed over the gaps, and only clear when
    // leaving the whole list — so the indicator never blinks while the pointer
    // crosses a 4px row gap.
    function handleListDragOver(e: React.DragEvent<HTMLUListElement>): void {
      e.preventDefault()
      try {
        e.dataTransfer.dropEffect = 'move'
      } catch (error) {
        /* dataTransfer may be unavailable */
      }
    }
    function handleListDragLeave(e: React.DragEvent<HTMLUListElement>): void {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) clearDragTarget()
    }
    function handleListDrop(e: React.DragEvent<HTMLUListElement>): void {
      e.preventDefault()
      const movedId = dragId.current || (e.dataTransfer && e.dataTransfer.getData('text/plain'))
      const targetId = overId
      const place = overPlace
      dragId.current = null
      clearDragTarget()
      force()
      if (!movedId || !targetId || !place) return
      reorder(movedId, targetId, place)
    }

    function handleDrop(e: React.DragEvent<HTMLLIElement>, id: string): void {
      e.preventDefault()
      e.stopPropagation()
      // Prefer the ref; fall back to the dataTransfer payload in case a
      // dragstart didn't register dragId.
      const movedId = dragId.current || (e.dataTransfer && e.dataTransfer.getData('text/plain'))
      dragId.current = null
      clearDragTarget()
      force()
      if (!movedId || movedId === id) return
      // Use the hysteresis-aware side (matching the shown indicator) so the
      // drop lands where the user saw the gap line.
      const rect = e.currentTarget.getBoundingClientRect()
      const place = resolvePlace(e.clientY, rect, overPlace)
      reorder(movedId, id, place)
    }

    function handleDragEnd(): void {
      dragId.current = null
      clearDragTarget()
      force()
    }

    function renderRow(row: SectionRow, index: number): React.ReactElement {
      const isOwn = row.id === OWN_ID
      const editing = editingId === row.id
      const dragging = !editing && dragId.current === row.id
      const className = ['dsm-row', dragging ? 'dsm-row-dragging' : ''].filter(Boolean).join(' ')
      const prev = rows[index - 1]
      const next = rows[index + 1]

      const labelNode = editing
        ? React.createElement('input', {
            className: 'dsm-rename-input',
            autoFocus: true,
            value: draft,
            style: styles.renameInput,
            placeholder: t('renamePlaceholder'),
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
            onBlur: () => commitEdit(row.id),
            onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') commitEdit(row.id)
              else if (e.key === 'Escape') cancelEdit()
            },
          })
        : React.createElement('span', { style: styles.label }, row.label)

      return React.createElement(
        'li',
        {
          key: row.id,
          draggable: !editing,
          className,
          style: styles.row,
          onDragStart: (e: React.DragEvent<HTMLLIElement>) => handleDragStart(e, row.id),
          onDragOver: (e: React.DragEvent<HTMLLIElement>) => handleDragOver(e, row.id),
          onDrop: (e: React.DragEvent<HTMLLIElement>) => handleDrop(e, row.id),
          onDragEnd: handleDragEnd,
        },
        React.createElement('span', { style: styles.grip, title: t('dragHint') }, svgIcon('grip')),
        React.createElement(
          'div',
          { style: styles.rowMain },
          React.createElement(
            'span',
            { style: styles.labelLine },
            labelNode,
            row.hidden ? React.createElement('span', { style: styles.tag }, t('hiddenTag')) : null,
          ),
          React.createElement(
            'span',
            { style: styles.meta },
            `${row.id}${row.registrant ? ' · ' + row.registrant : ''}`,
          ),
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsm-switch',
            role: 'switch',
            'aria-checked': !row.hidden,
            disabled: isOwn,
            title: isOwn ? t('selfNote') : (row.hidden ? t('show') : t('hide')),
            onClick: () => policy.setHidden(row.id, !row.hidden),
            style: {
              ...styles.switchTrack,
              ...(row.hidden ? {} : { background: 'var(--dsw-alias-state-success-primary)' }),
            },
          },
          React.createElement('span', {
            style: {
              ...styles.switchKnob,
              transform: row.hidden ? 'translateX(0)' : 'translateX(14px)',
            },
          }),
        ),
        React.createElement(
          'div',
          { style: styles.rowActions },
          React.createElement(
            'button',
            {
              type: 'button', className: 'dsm-icon-btn', title: t('moveUp'), 'aria-label': t('moveUp'),
              style: styles.iconBtn, disabled: prev === undefined,
              onClick: () => reorder(row.id, prev.id, 'before'),
            },
            svgIcon('up'),
          ),
          React.createElement(
            'button',
            {
              type: 'button', className: 'dsm-icon-btn', title: t('moveDown'), 'aria-label': t('moveDown'),
              style: styles.iconBtn, disabled: next === undefined,
              onClick: () => reorder(row.id, next.id, 'after'),
            },
            svgIcon('down'),
          ),
          React.createElement(
            'button',
            {
              type: 'button', className: 'dsm-icon-btn', title: t('rename'), 'aria-label': t('rename'),
              style: styles.iconBtn, disabled: editing,
              onClick: () => startEdit(row),
            },
            svgIcon('pencil'),
          ),
          React.createElement(
            'button',
            {
              type: 'button', className: 'dsm-icon-btn', title: t('reset'), 'aria-label': t('reset'),
              style: styles.iconBtn,
              onClick: () => reset(row.id),
            },
            svgIcon('reset'),
          ),
        ),
      )
    }

    const header = React.createElement(
      'div',
      { style: styles.header },
      React.createElement('p', { style: styles.hint }, t('hint')),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsm-reset-all',
          onClick: () => resetAll(),
          style: styles.resetAllBtn,
          title: t('resetAll'),
        },
        svgIcon('reset'),
        React.createElement('span', null, t('resetAll')),
      ),
    )

    const body =
      rows.length === 0
        ? React.createElement('p', { style: styles.empty }, t('noSections'))
        : React.createElement(
            'ul',
            {
              ref: listRef,
              style: styles.list,
              onDragOver: handleListDragOver,
              onDragLeave: handleListDragLeave,
              onDrop: handleListDrop,
            },
            // Single insertion indicator, positioned in the row gap; persists
            // across the gaps so it never blinks while dragging.
            indicatorY !== null
              ? React.createElement('div', { className: 'dsm-drop-indicator', style: { top: indicatorY } })
              : null,
            rows.map((row, index) => renderRow(row, index)),
          )

    return React.createElement('div', { style: styles.wrap }, header, body)
  }

  return ManagerSection
}

/* ------------------------------------------------------------------ *
 * Plugin entry
 * ------------------------------------------------------------------ */

/** The __test seam (attached to globalThis only under the test flag). */
interface TestSeam {
  policy: Policy
  readSections: () => SectionRow[]
  reorder: (movedId: string, targetId: string, place: Place) => void
  setOrders: (orders: Record<string, number>) => void
  reset: (id: string) => void
  resetAll: () => void
  patch: Patch
  inventory: Map<string, { id: string; order: number; label?: unknown; priority: number }>
}

function globals(): any {
  return globalThis as any
}

export const name = 'dsh-settings-manager'
export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as unknown as SlotsService
  if (slots === undefined) return

  const locale = ctx.get('locale') as unknown as LocaleService | undefined
  if (locale !== undefined) {
    ctx.effect(
      () => {
        locale.register(LOCALE_NS, { zh, en })
        return () => {}
      },
      'dsh-settings-manager: dictionaries',
    )
  }
  const t = locale !== undefined ? locale.bind(LOCALE_NS) : (key: string) => key

  // The settings nav clips once many sections register; make it scroll.
  ctx.effect(() => insertStyles(NAV_SCROLL_CSS + '\n' + PANEL_CSS), 'dsh-settings-manager: styles')

  // Policy first, patches second — every registration from here on (including
  // this plugin's own section) flows through the policy.
  const policy = createPolicy()
  const patch = installPatches(ctx, policy)
  if (!patch.installed) return
  policy.setOnChanged(patch.bump)
  // Force the shell to re-read at least once after patching.
  patch.bump()

  /** Raw inventory: ALL sections (hidden included), policy NOT applied. */
  const readSections = (): SectionRow[] => {
    let entries: readonly StoredEntry[]
    try {
      entries = patch.origEntries.call(slots, SECTION_SLOT)
    } catch (error) {
      entries = []
    }
    return entries
      .map((entry, seq) => {
        const originalLabel = resolveLabel(entry.options.label) || entry.options.id
        return {
          id: entry.options.id,
          label: policy.labelFor(entry.options.id) ?? originalLabel,
          originalLabel,
          registrant: entry.options.registrant,
          order: policy.effectiveOrder(entry.options.id, entry.options.order),
          hidden: policy.isHidden(entry.options.id),
          seq,
        }
      })
      .sort((a, b) => a.order - b.order || a.seq - b.seq)
  }

  /**
   * Reorder by placing `movedId` immediately before/after `targetId` in the
   * effective sorted order, then renumber ALL sections to even index*10 slots
   * so the new arrangement is exact and collision-free (resettable via the
   * per-row reset / "全部重置").
   */
  const reorder = (movedId: string, targetId: string, place: Place): void => {
    const rows = readSections()
    const src = rows.findIndex((row) => row.id === movedId)
    if (src === -1) return
    const list = rows.map((row) => row.id)
    list.splice(src, 1)
    let ins = list.indexOf(targetId)
    if (ins === -1) return
    if (place === 'after') ins += 1
    list.splice(ins, 0, movedId)
    const orders: Record<string, number> = {}
    list.forEach((id, index) => {
      orders[id] = index * 10
    })
    policy.setOrders(orders)
  }

  const env: ManagerEnv = { slots, policy, readSections, reorder, reset: policy.reset, resetAll: policy.resetAll, t }
  const ManagerSection = createManagerSection(env)

  // This plugin's own section — registered through the (patched) slots service
  // so it participates normally; the policy never hides it.
  slots.inject(SECTION_SLOT, () =>
    slots.register(
      {
        name: SECTION_SLOT,
        id: OWN_ID,
        order: OWN_ORDER,
        label: () => t('nav'),
        locale: LOCALE_NS,
      },
      () => React.createElement(ManagerSection),
    ),
  )

  // Test seam: drives policy mutations / read-only inventory from the test
  // harness; never present in production.
  if (globals().__DSH_SETTINGS_MANAGER_TEST__) {
    const seam: TestSeam = {
      policy,
      readSections,
      reorder,
      setOrders: policy.setOrders,
      reset: policy.reset,
      resetAll: policy.resetAll,
      patch,
      inventory: patch.inventory,
    }
    globals().__DSH_SETTINGS_MANAGER_SEAM__ = seam
  }
}
