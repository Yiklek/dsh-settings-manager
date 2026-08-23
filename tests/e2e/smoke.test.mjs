/**
 * e2e smoke test — mounts the real ManagerSection component (rendered with
 * react-dom into jsdom) and drives real interactions: rows render, a toggle
 * hides/shows a section in the nav data, reorder buttons move a row, and
 * "全部重置" clears the policy. Exercises the live reactivity path
 * (policy.subscribe / slots.subscribe → re-render).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { loadEnv } from '../helpers/load-env.mjs'

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
})

before(() => {
  // Expose jsdom globals so the bundle's document/localStorage work. Some
  // (e.g. navigator in Node ≥21) are read-only getters — override via
  // Object.defineProperty.
  const { window } = dom
  for (const key of ['document', 'window', 'localStorage', 'navigator', 'Node', 'HTMLElement', 'Event', 'MouseEvent']) {
    if (window[key] === undefined) continue
    try {
      Object.defineProperty(globalThis, key, { value: window[key], writable: true, configurable: true })
    } catch {
      /* read-only built-in; leave it */
    }
  }
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 30))

function setup() {
  const env = loadEnv({
    globals: { document: dom.window.document, localStorage: dom.window.localStorage },
    react: React,
  })
  const { slots, plugin, ctx } = env
  slots.declare('settings.section')
  slots.register({ name: 'settings.section', id: 'general', order: 0, label: () => '通用设置' }, () => 'General')
  slots.register({ name: 'settings.section', id: 'models', order: 10, label: () => '模型' }, () => 'Models')
  slots.register({ name: 'settings.section', id: 'api-retry', order: 95, label: () => 'API 重试' }, () => 'ApiRetry')
  slots.register({ name: 'settings.section', id: 'web-ui', order: 110, label: () => 'Web UI' }, () => 'WebUi')
  plugin.apply(ctx)
  const test = env.plugin.__test
  return { env, slots, test }
}

async function mount() {
  const { env, slots, test } = setup()
  const entry = slots.entries('settings.section').find((e) => e.options.id === 'settings-manager')
  assert.ok(entry, 'manager section should be registered')
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(entry.component))
  })
  await flush()
  return { env, slots, test, root }
}

function dialog() {
  return dom.window.document.querySelector('#root')
}

function rows() {
  return [...dialog().querySelectorAll('li')]
}

function rowById(label) {
  return rows().find((r) => r.textContent.includes(label))
}

test('e2e: manager panel renders one row per section with a switch', async () => {
  const { root } = await mount()
  try {
    const items = rows()
    assert.ok(items.length >= 5, `expected >=5 rows, got ${items.length}`)
    assert.ok(items.every((r) => r.getAttribute('draggable') === 'true'), 'rows are draggable')
    assert.ok(items.every((r) => r.querySelector('[role="switch"]')), 'each row has a switch')
    assert.ok(dialog().querySelector('.dsm-reset-all'), 'reset-all button present')
  } finally {
    root.unmount()
  }
})

test('e2e: toggling the switch hides the section from the nav data and back', async () => {
  const { env, slots, root } = await mount()
  try {
    const navIds = () =>
      slots
        .entries('settings.section')
        .map((e) => ({ id: e.options.id, order: e.options.order ?? 0 }))
        .sort((a, b) => a.order - b.order)
        .map((r) => r.id)

    assert.ok(navIds().includes('api-retry'))

    // Flip the switch on the "API 重试" row.
    const sw = rowById('API 重试').querySelector('[role="switch"]')
    await act(async () => sw.click())
    await flush()
    assert.ok(!navIds().includes('api-retry'), 'hidden section leaves the nav')

    // The row now carries the 已隐藏 tag and the switch is off.
    const tag = rowById('API 重试').textContent
    assert.ok(tag.includes('已隐藏') || tag.includes('Hidden'), 'hidden tag shown')

    // Toggle back → section returns.
    const sw2 = rowById('API 重试').querySelector('[role="switch"]')
    await act(async () => sw2.click())
    await flush()
    assert.ok(navIds().includes('api-retry'), 'un-hide restores the section')
  } finally {
    root.unmount()
  }
})

test('e2e: reset-all clears the policy and restores the original nav order', async () => {
  const { env, slots, root } = await mount()
  try {
    // Effective nav order (like the shell): read patched entries, sort by order.
    const navIds = () =>
      slots
        .entries('settings.section')
        .map((e) => ({ id: e.options.id, order: e.options.order ?? 0 }))
        .sort((a, b) => a.order - b.order)
        .map((row) => row.id)

    // Move "models" down past "api-retry" via the ↓ icon button.
    const modelsRow = rowById('模型')
    const downBtn = [...modelsRow.querySelectorAll('.dsm-icon-btn')].find(
      (b) => b.getAttribute('aria-label') === '下移' || b.getAttribute('aria-label') === 'Move down',
    )
    await act(async () => downBtn.click())
    await flush()
    const idxModels = navIds().indexOf('models')
    const idxRetry = navIds().indexOf('api-retry')
    assert.ok(idxModels > idxRetry, 'models moved below api-retry')

    // Reset all → original registered order restored.
    const resetAll = dialog().querySelector('.dsm-reset-all')
    await act(async () => resetAll.click())
    await flush()
    const idxModelsAfter = navIds().indexOf('models')
    const idxRetryAfter = navIds().indexOf('api-retry')
    assert.ok(idxModelsAfter < idxRetryAfter, 'models back above api-retry after reset-all')
  } finally {
    root.unmount()
  }
})
