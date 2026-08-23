/**
 * dsh-settings-manager — browser half bundle.
 *
 * Manages how other plugins' sections appear in the global Settings dialog
 * (show/hide, ordering, renaming) WITHOUT modifying upstream. Works by
 * intercepting the client slot registry (`ctx.slots`), which is the one
 * mechanism every plugin uses to contribute a settings section:
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
 * This file is the shipped bundle: a CJS factory registered through
 * `window.__ModuleLoader__.load`, same format as tsdown-generated client
 * bundles, hand-written with inline styles and zero build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-settings-manager',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

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
     * settings nav does not scroll by default and gets clipped once many
     * sections register - a bottom default position would be unreachable
     * (the injected nav-scroll CSS below also mitigates this).
     */
    const OWN_ORDER = 1
    /** Dummy entry id used to bump the slot version after policy changes. */
    const TOUCH_ID = 'settings-manager-touch'

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
    }

    /* ------------------------------------------------------------------ *
     * Nav scroll fix
     *
     * The settings shell renders the nav as a fixed non-scrolling column and
     * the dialog panel clips overflow - once enough sections register, the
     * bottom rows (this manager included) become unreachable. Make the nav
     * itself scrollable. Selector precedent: dsh-better-sidebar identifies
     * the settings nav with the same `[role="dialog"] nav` query.
     * ------------------------------------------------------------------ */

    const NAV_SCROLL_CSS = [
      '[role="dialog"] nav { overflow-y: auto; padding-bottom: 12px; scrollbar-width: thin; }',
    ].join('\n')

    // Hover affordances the panel's inline styles cannot express.
    const PANEL_CSS = [
      '.dsm-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.dsm-icon-btn:disabled { opacity: .35; cursor: default; }',
      '.dsm-icon-btn:disabled:hover { background: transparent; }',
      '.dsm-reset-all:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dsm-switch:disabled { opacity: .5; cursor: default; }',
      // Drag feedback via classes (not inline styles — see styles.row comment).
      '.dsm-row-dragging { opacity: .4; }',
      '.dsm-row.dsm-drop-target { border-color: var(--dsw-alias-border-l2); box-shadow: 0 0 0 1px var(--dsw-alias-border-l2); }',
    ].join('\n')

    function insertStyles(css) {
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
      const listeners = new Set()
      return {
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        emit() {
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
     *
     * Document shape:
     *   { hidden: { [sectionId]: true },
     *     order:  { [sectionId]: number },
     *     labels: { [sectionId]: string } }
     * ------------------------------------------------------------------ */

    function createPolicy() {
      const state = { hidden: {}, order: {}, labels: {} }
      try {
        const raw = globalThis.localStorage ? globalThis.localStorage.getItem(STORAGE_KEY) : null
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            if (isRecord(parsed.hidden)) state.hidden = parsed.hidden
            if (isRecord(parsed.order)) state.order = parsed.order
            if (isRecord(parsed.labels)) state.labels = parsed.labels
          }
        }
      } catch (error) {
        /* corrupt storage is ignored; policy starts empty */
      }

      const emitter = createEmitter()
      let onChanged = null

      function save() {
        try {
          if (globalThis.localStorage) {
            globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
          }
        } catch (error) {
          /* storage full / blocked — keep running with in-memory policy */
        }
      }

      function changed() {
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

      function isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
      }

      return {
        /** @returns whether the section is hidden (own section can never hide). */
        isHidden(id) {
          return id !== OWN_ID && state.hidden[id] === true
        },
        /** @returns the explicit order override for a section, or undefined. */
        orderFor(id) {
          const value = state.order[id]
          return typeof value === 'number' && Number.isFinite(value) ? value : undefined
        },
        /** @returns the explicit label override for a section, or undefined. */
        labelFor(id) {
          const value = state.labels[id]
          return typeof value === 'string' && value.length > 0 ? value : undefined
        },
        /** Effective order of a section: policy override, else its registered order. */
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
        setLabel(id, label) {
          if (typeof label === 'string' && label.length > 0) state.labels[id] = label
          else delete state.labels[id]
          changed()
        },
        /** Remove every policy entry for one section (back to registered defaults). */
        reset(id) {
          delete state.hidden[id]
          delete state.order[id]
          delete state.labels[id]
          changed()
        },
        /** Remove every policy entry (all sections back to defaults). */
        resetAll() {
          state.hidden = {}
          state.order = {}
          state.labels = {}
          changed()
        },
        /**
         * Rewrite a registration's options through the policy (read-time
         * authority). Never mutates the stored registration: the read path is the
         * single policy authority, so reset() can always restore the plugin's own
         * registered values (a registration-time rewrite would destroy the
         * original after a page reload).
         */
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
        /** Wire the "something changed" hook (used to bump the slot version). */
        setOnChanged(fn) {
          onChanged = fn
        },
      }
    }

    /* ------------------------------------------------------------------ *
     * SlotRegistry interception
     * ------------------------------------------------------------------ */

    /**
     * Install the three patches on the slot registry prototype. The prototype
     * is reached through the service instance (`Object.getPrototypeOf`), which
     * avoids importing the runtime package entirely; a require fallback keeps
     * it working if the service shape ever changes.
     * @param ctx - plugin context (for bumping via ctx.get('slots')).
     * @param policy - the manager policy.
     * @returns { installed, origEntries, bump } — origEntries reads the RAW
     *          inventory (hidden included, policy NOT applied) for the UI.
     */
    function installPatches(ctx, policy) {
      let slotsService = undefined
      try {
        slotsService = ctx.get('slots')
      } catch (error) {
        slotsService = undefined
      }
      if (slotsService === undefined) return { installed: false }

      let proto = undefined
      try {
        proto = Object.getPrototypeOf(slotsService)
      } catch (error) {
        proto = undefined
      }
      if (!proto || typeof proto.register !== 'function') {
        // Fallback: import the SlotRegistry class directly.
        try {
          const runtime = require('@deepseek-ai/dsh-client-runtime/client')
          proto = runtime.SlotRegistry && runtime.SlotRegistry.prototype
        } catch (error) {
          proto = undefined
        }
      }
      if (!proto || typeof proto.register !== 'function') return { installed: false }

      if (proto.__settingsManagerPatched) return { installed: true }

      const origRegister = proto.register
      const origEntries = proto.entries
      const origEntriesOfSlot = proto.entriesOfSlot
      const inventory = new Map()

      // 1) Registration path: every settings.section registration flows
      //    through the manager. v1 only observes (records the inventory) —
      //    it does NOT mutate the stored options, so the read path stays the
      //    single policy authority and reset() can always restore a
      //    plugin's own registered values. Future behaviors (hard drop,
      //    redirect into a container slot) hook in here.
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

      // 2) Read path (nav): the shell maps raw entries to {id, order, label}
      //    and sorts by order. Filter hidden + rewrite order/label on read.
      proto.entries = function entries(key) {
        const rows = origEntries.call(this, key)
        if (key !== SECTION_SLOT) return rows
        const out = []
        for (const entry of rows) {
          if (policy.isHidden(entry.options.id)) continue
          const order = policy.orderFor(entry.options.id)
          const label = policy.labelFor(entry.options.id)
          if (order === undefined && label === undefined) {
            out.push(entry)
            continue
          }
          out.push({
            ...entry,
            options: policy.applyToRead(entry.options),
          })
        }
        return out
      }

      // 3) Read path (content): the renderer elects the winning entry per id
      //    and runs an isLive check on it — filter only, never clone.
      proto.entriesOfSlot = function entriesOfSlot(key) {
        const rows = origEntriesOfSlot.call(this, key)
        if (key !== SECTION_SLOT) return rows
        return rows.filter((entry) => !policy.isHidden(entry.options.id))
      }

      proto.__settingsManagerPatched = true

      return {
        installed: true,
        origEntries,
        inventory,
        bump() {
          try {
            const slots = ctx.get('slots')
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
    }

    /* ------------------------------------------------------------------ *
     * Management section
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * Management section — styled with the shell's design tokens so it
     * matches the official settings dialog (light/dark aware).
     * ------------------------------------------------------------------ */

    const styles = {
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
      list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
      row: {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '7px 10px', borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        cursor: 'grab',
      },
      // Drag feedback lives in CSS classes (.dsm-row-dragging / .dsm-drop-target),
      // NOT inline styles: mixing the `border` shorthand above with a
      // `borderColor` longhand causes React's inline-style diffing to corrupt
      // the border when toggling the drop target (the row's border ends up
      // emptied and stays visually "highlighted" after the drop).
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
      rowActions: { display: 'flex', alignItems: 'center', gap: '2px', flex: 'none' },
      iconBtn: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
        width: '26px', height: '26px', borderRadius: '7px', cursor: 'pointer',
        color: 'var(--dsw-alias-label-tertiary)', background: 'transparent', border: 'none', padding: 0,
      },
      empty: { fontSize: '12px', color: 'var(--dsw-alias-label-caption)' },

      // Switch
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

    function svgIcon(name) {
      const common = {
        width: 16, height: 16, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false',
      }
      const circles = (x, ys) => ys.map((cy, i) => React.createElement('circle', { key: `${x}-${i}`, cx: x, cy, r: 1, fill: 'currentColor', stroke: 'none' }))
      const paths = (ds) => ds.map((d, i) => React.createElement('path', { key: i, d }))
      const content = {
        grip: () => [...circles(9, [5, 12, 19]), ...circles(15, [5, 12, 19])],
        up: () => paths(['m5 9 3-3 3 3']),
        down: () => paths(['m5 7 3 3 3-3']),
        reset: () => paths(['M3 12a9 9 0 1 0 2.64-6.36L3 8', 'M3 3v5h5']),
      }[name]
      return React.createElement('svg', common, content())
    }

    function resolveLabel(label) {
      return typeof label === 'function' ? label() : (typeof label === 'string' ? label : '')
    }

    /**
     * Build the management section component over a fixed environment.
     * @param env - { slots, policy, readSections, reorder, reset, resetAll, t }
     */
    function createManagerSection(env) {
      const { slots, policy, readSections, reorder, reset, resetAll, t } = env

      function ManagerSection() {
        const [, force] = React.useReducer((value) => value + 1, 0)
        const dragId = React.useRef(null)
        const [overId, setOverId] = React.useState(null)

        React.useEffect(() => {
          let offSlot = () => {}
          let offPolicy = () => {}
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

        function handleDragStart(e, id) {
          dragId.current = id
          try {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', id)
          } catch (error) {
            /* dataTransfer may be unavailable */
          }
          force()
        }

        function handleDragOver(e, id) {
          if (dragId.current === id) {
            // Over the source row: don't allow a drop here, and clear any
            // lingering highlight.
            if (overId !== null) setOverId(null)
            return
          }
          e.preventDefault()
          if (overId !== id) setOverId(id)
        }

        function handleDragLeave(e) {
          // Clear the highlight once the pointer leaves this row entirely
          // (dragging over another row re-sets it). relatedTarget check avoids
          // flicker when moving between the row's own child elements.
          if (!e.currentTarget.contains(e.relatedTarget)) {
            if (overId !== null) setOverId(null)
          }
        }

        function handleDrop(e, id) {
          e.preventDefault()
          e.stopPropagation()
          // Prefer the ref; fall back to the dataTransfer payload in case a
          // dragstart didn't register dragId (would otherwise show the
          // highlight but never move).
          const movedId = dragId.current || (e.dataTransfer && e.dataTransfer.getData('text/plain'))
          dragId.current = null
          setOverId(null)
          force()
          if (!movedId || movedId === id) return
          const rect = e.currentTarget.getBoundingClientRect()
          const place = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
          reorder(movedId, id, place)
        }

        function handleDragEnd() {
          dragId.current = null
          setOverId(null)
          force()
        }

        function renderRow(row, index) {
          const isOwn = row.id === OWN_ID
          const dragging = dragId.current === row.id
          const isTarget = overId === row.id
          const className = ['dsm-row', dragging ? 'dsm-row-dragging' : '', isTarget ? 'dsm-drop-target' : '']
            .filter(Boolean)
            .join(' ')
          const prev = rows[index - 1]
          const next = rows[index + 1]

          return React.createElement(
            'li',
            {
              key: row.id,
              draggable: true,
              className,
              style: styles.row,
              onDragStart: (e) => handleDragStart(e, row.id),
              onDragOver: (e) => handleDragOver(e, row.id),
              onDragLeave: handleDragLeave,
              onDrop: (e) => handleDrop(e, row.id),
              onDragEnd: handleDragEnd,
            },
            // drag grip
            React.createElement('span', { style: styles.grip, title: t('dragHint') }, svgIcon('grip')),
            // label + id
            React.createElement(
              'div',
              { style: styles.rowMain },
              React.createElement(
                'span',
                { style: styles.labelLine },
                React.createElement('span', { style: styles.label }, row.label),
                row.hidden ? React.createElement('span', { style: styles.tag }, t('hiddenTag')) : null,
              ),
              React.createElement(
                'span',
                { style: styles.meta },
                `${row.id}${row.registrant ? ' · ' + row.registrant : ''}`,
              ),
            ),
            // hide/show switch
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
            // move + reset icons
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
            : React.createElement('ul', { style: styles.list }, rows.map((row, index) => renderRow(row, index)))

        return React.createElement('div', { style: styles.wrap }, header, body)
      }

      return ManagerSection
    }

    /* ------------------------------------------------------------------ *
     * Plugin entry
     * ------------------------------------------------------------------ */

    module.exports = {
      name: 'dsh-settings-manager',
      inject: ['slots', 'locale'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) return

        const locale = ctx.get('locale')
        if (locale !== undefined) {
          ctx.effect(
            () => locale.register(LOCALE_NS, { zh, en }),
            'dsh-settings-manager: dictionaries',
          )
        }
        const t = locale !== undefined ? locale.bind(LOCALE_NS) : (key) => key

        // The settings nav clips once many sections register; make it scroll.
        // Panel hover affordances ride their own stylesheet.
        ctx.effect(() => insertStyles(NAV_SCROLL_CSS + '\n' + PANEL_CSS), 'dsh-settings-manager: styles')

        // Policy first, patches second — every registration from here on
        // (including this plugin's own section) flows through the policy.
        const policy = createPolicy()
        const patch = installPatches(ctx, policy)
        if (!patch.installed) return
        policy.setOnChanged(patch.bump)
        // Force the shell to re-read at least once after patching.
        patch.bump()

        /** Raw inventory: ALL sections (hidden included), policy NOT applied. */
        const readSections = () => {
          let entries
          try {
            entries = patch.origEntries.call(slots, SECTION_SLOT)
          } catch (error) {
            entries = []
          }
          return entries
            .map((entry, seq) => ({
              id: entry.options.id,
              label: resolveLabel(entry.options.label) || entry.options.id,
              registrant: entry.options.registrant,
              order: policy.effectiveOrder(entry.options.id, entry.options.order),
              hidden: policy.isHidden(entry.options.id),
              seq,
            }))
            .sort((a, b) => a.order - b.order || a.seq - b.seq)
        }

        /**
         * Reorder by placing `movedId` immediately before/after `targetId` in
         * the effective sorted order, then renumber ALL sections to even
         * index*10 slots so the new arrangement is exact and collision-free
         * (resettable via the per-row reset / "全部重置"). This is the single
         * primitive behind both the ↑↓ buttons and drag & drop.
         */
        const reorder = (movedId, targetId, place) => {
          const rows = readSections()
          const src = rows.findIndex((row) => row.id === movedId)
          if (src === -1) return
          const list = rows.map((row) => row.id)
          list.splice(src, 1)
          let ins = list.indexOf(targetId)
          if (ins === -1) return
          if (place === 'after') ins += 1
          list.splice(ins, 0, movedId)
          list.forEach((id, index) => policy.setOrder(id, index * 10))
        }

        const env = { slots, policy, readSections, reorder, reset: policy.reset, resetAll: policy.resetAll, t }
        const ManagerSection = createManagerSection(env)

        // This plugin's own section — registered through the (patched) slots
        // service so it participates normally; the policy never hides it.
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

        // Test seam: drives policy mutations / read-only inventory from the
        // verify harness; never present in production.
        if (globalThis.__DSH_SETTINGS_MANAGER_TEST__) {
          module.exports.__test = {
            policy,
            readSections,
            reorder,
            reset: policy.reset,
            resetAll: policy.resetAll,
            patch,
            inventory: patch.inventory,
          }
        }
      },
    }

    return module.exports
  },
})
