/**
 * Unit tests — the three slot-registry patches (register hook, entries,
 * entriesOfSlot) and the read-path behavior.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScenario } from '../helpers/scenario.mjs'
import { SEAM_KEY } from '../helpers/load-env.mjs'

function fresh() {
  const s = setupScenario()
  s.slots.register({ name: 'settings.section', id: 'web-ui', order: 110, label: () => 'Web UI' }, () => 'WebUi')
  return s
}

test('register hook records inventory but never mutates stored options', () => {
  const { test, slots, raw } = fresh()
  test.policy.setOrder('late-plugin', 7)
  slots.register({ name: 'settings.section', id: 'late-plugin', order: 999, label: () => 'Late' }, () => 'Late')
  // stored stays 999 (read path is the sole policy authority)
  assert.equal(raw('late-plugin').options.order, 999)
  assert.equal(test.inventory.get('late-plugin').order, 999)
  // read path applies the policy order
  const read = slots.entries('settings.section').find((e) => e.options.id === 'late-plugin')
  assert.equal(read.options.order, 7)
})

test('entries() filters hidden sections', () => {
  const { test, slots } = fresh()
  test.policy.setHidden('api-retry', true)
  const ids = slots.entries('settings.section').map((e) => e.options.id)
  assert.ok(!ids.includes('api-retry'))
  assert.ok(ids.includes('general'))
})

test('entries() rewrites order and label on read', () => {
  const { test, slots } = fresh()
  test.policy.setOrder('web-ui', 5)
  test.policy.setLabel('api-retry', '接管后')
  const webUi = slots.entries('settings.section').find((e) => e.options.id === 'web-ui')
  assert.equal(webUi.options.order, 5)
  const retry = slots.entries('settings.section').find((e) => e.options.id === 'api-retry')
  assert.equal(retry.options.label(), '接管后')
})

test('entriesOfSlot() filters hidden but returns the original entry object (isLive contract)', () => {
  const { test, slots, general } = fresh()
  test.policy.setHidden('api-retry', true)
  const elected = slots.entriesOfSlot('settings.section')
  assert.ok(!elected.some((e) => e.options.id === 'api-retry'))
  // identity preserved for non-hidden sections (renderer runs isLive on these)
  const generalElected = elected.find((e) => e.options.id === 'general')
  assert.equal(generalElected, general)
})

test('nav order follows rewritten orders (shell-style sort)', () => {
  const { test, navIds } = fresh()
  test.policy.setOrder('web-ui', 5)
  assert.deepEqual(navIds(), ['general', 'settings-manager', 'web-ui', 'models', 'api-retry'])
})

test('bump raises the slot version and leaves no trace', () => {
  const { test, slots } = fresh()
  const before = slots.getVersion('settings.section')
  test.patch.bump()
  assert.ok(slots.getVersion('settings.section') > before)
  const ids = slots.entries('settings.section').map((e) => e.options.id)
  assert.ok(!ids.includes('settings-manager-touch'))
})

test('the manager registers its own unhideable section near the top', () => {
  const { navIds } = fresh()
  const ids = navIds()
  assert.ok(ids.includes('settings-manager'))
  // order 1 → second slot
  assert.equal(ids[1], 'settings-manager')
})

test('hidden section is restored live by un-hiding', () => {
  const { test, navIds } = fresh()
  test.policy.setHidden('models', true)
  assert.ok(!navIds().includes('models'))
  test.policy.setHidden('models', false)
  assert.ok(navIds().includes('models'))
})

test('re-applying the plugin (HMR) does not crash and rewires the policy', () => {
  const { plugin, slots, ctx, vmGlobal } = fresh()
  // Second apply simulates an HMR reload. Before the fix this crashed on
  // `patch.bump is not a function` (the already-patched branch returned a bare
  // `{ installed: true }`), and the fresh policy never reached the patches.
  plugin.apply(ctx)
  assert.ok(vmGlobal[SEAM_KEY], 'test seam survives re-apply')
  // The fresh policy now drives the (already-installed) patches.
  vmGlobal[SEAM_KEY].policy.setHidden('models', true)
  assert.ok(!slots.entries('settings.section').some((e) => e.options.id === 'models'))
  vmGlobal[SEAM_KEY].policy.setHidden('models', false)
  assert.ok(slots.entries('settings.section').some((e) => e.options.id === 'models'))
})

test('setOrders batches many order writes into one change', () => {
  const { test, slots } = fresh()
  const before = slots.getVersion('settings.section')
  test.setOrders({ 'general': 0, 'models': 10, 'api-retry': 20 })
  const after = slots.getVersion('settings.section')
  // exactly one bump (one register/dispose pair) despite three writes
  assert.equal(after - before, 2, 'one bump = version +2')
  assert.equal(test.policy.orderFor('api-retry'), 20)
  assert.equal(test.policy.orderFor('models'), 10)
})
