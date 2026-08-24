/**
 * Unit tests — policy store (localStorage-backed placement policy).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScenario } from '../helpers/scenario.mjs'
import { loadEnv, SEAM_KEY } from '../helpers/load-env.mjs'

function fresh() {
  return setupScenario()
}

test('policy starts empty', () => {
  const { test } = fresh()
  assert.equal(test.policy.isHidden('api-retry'), false)
  assert.equal(test.policy.orderFor('api-retry'), undefined)
  assert.equal(test.policy.labelFor('api-retry'), undefined)
})

test('effectiveOrder falls back to the registered order', () => {
  const { test } = fresh()
  assert.equal(test.policy.effectiveOrder('api-retry', 95), 95)
  assert.equal(test.policy.effectiveOrder('missing', 12), 12)
  assert.equal(test.policy.effectiveOrder('missing', undefined), 0)
})

test('setHidden/setOrder/setLabel persist to the server settings namespace', () => {
  const { test, connection } = fresh()
  test.policy.setHidden('api-retry', true)
  test.policy.setOrder('web-ui', 7)
  test.policy.setLabel('models', 'Model List')

  assert.equal(test.policy.isHidden('api-retry'), true)
  assert.equal(test.policy.orderFor('web-ui'), 7)
  assert.equal(test.policy.labelFor('models'), 'Model List')

  const persisted = connection._persisted()
  assert.equal(persisted.hidden['api-retry'], true)
  assert.equal(persisted.order['web-ui'], 7)
  assert.equal(persisted.labels['models'], 'Model List')
  // every mutation fired one server replace against the manager namespace
  assert.ok(connection._replaceCalls().every((call) => call.ns === 'settings-manager'))
})

test('hidden/show toggle round-trips', () => {
  const { test } = fresh()
  test.policy.setHidden('api-retry', true)
  assert.equal(test.policy.isHidden('api-retry'), true)
  test.policy.setHidden('api-retry', false)
  assert.equal(test.policy.isHidden('api-retry'), false)
})

test('own section can never be hidden', () => {
  const { test } = fresh()
  test.policy.setHidden('settings-manager', true)
  assert.equal(test.policy.isHidden('settings-manager'), false)
})

test('reset clears only one section', () => {
  const { test } = fresh()
  test.policy.setHidden('api-retry', true)
  test.policy.setOrder('api-retry', 50)
  test.policy.setHidden('models', true)
  test.policy.reset('api-retry')
  assert.equal(test.policy.isHidden('api-retry'), false)
  assert.equal(test.policy.orderFor('api-retry'), undefined)
  // sibling untouched
  assert.equal(test.policy.isHidden('models'), true)
})

test('resetAll clears everything', () => {
  const { test, connection } = fresh()
  test.policy.setHidden('api-retry', true)
  test.policy.setOrder('models', 3)
  test.policy.setLabel('general', 'Renamed')
  test.policy.resetAll()
  const persisted = connection._persisted()
  assert.deepEqual(persisted.hidden, {})
  assert.deepEqual(persisted.order, {})
  assert.deepEqual(persisted.labels, {})
})

test('load populates the policy from a server document', () => {
  const { test } = fresh()
  test.policy.load({ hidden: { 'api-retry': true }, order: { 'web-ui': 7 }, labels: { models: 'X' } })
  assert.equal(test.policy.isHidden('api-retry'), true)
  assert.equal(test.policy.orderFor('web-ui'), 7)
  assert.equal(test.policy.labelFor('models'), 'X')
})

test('a late server load is ignored after a user mutation', () => {
  const { test } = fresh()
  test.policy.setHidden('api-retry', true)
  // Simulate apply()'s async describe resolving AFTER the user acted: it must
  // not clobber the fresher in-memory change.
  test.policy.load({ hidden: {}, order: {}, labels: {} })
  assert.equal(test.policy.isHidden('api-retry'), true)
})

test('applyToRead returns the same object when no policy applies', () => {
  const { test } = fresh()
  const options = { id: 'api-retry', order: 95 }
  assert.equal(test.policy.applyToRead(options), options)
})

test('applyToRead rewrites order and label when policy applies', () => {
  const { test, raw } = fresh()
  test.policy.setOrder('api-retry', 5)
  test.policy.setLabel('api-retry', '接管后')
  const rewritten = test.policy.applyToRead({ id: 'api-retry', order: 95 })
  assert.equal(rewritten.order, 5)
  assert.equal(typeof rewritten.label, 'function')
  assert.equal(rewritten.label(), '接管后')
  // original object untouched
  assert.equal(raw('api-retry').options.order, 95)
})

test('setLabel with an empty/whitespace string clears the override', () => {
  const { test } = fresh()
  test.policy.setLabel('models', '接管')
  assert.equal(test.policy.labelFor('models'), '接管')
  test.policy.setLabel('models', '')
  assert.equal(test.policy.labelFor('models'), undefined)
  test.policy.setLabel('api-retry', '接管')
  test.policy.setLabel('api-retry', '   ')
  assert.equal(test.policy.labelFor('api-retry'), undefined)
})

test('readSections reports the custom label and the original label', () => {
  const { test } = fresh()
  test.policy.setLabel('models', '模型接管')
  const rows = test.readSections()
  const model = rows.find((row) => row.id === 'models')
  assert.equal(model.label, '模型接管')
  assert.equal(model.originalLabel, '模型')
  // sibling untouched, original label still the registered one
  const retry = rows.find((row) => row.id === 'api-retry')
  assert.equal(retry.label, 'API 重试')
  assert.equal(retry.originalLabel, 'API 重试')
})

test('nav read path reflects the custom label', () => {
  const { test, slots } = fresh()
  test.policy.setLabel('models', '接管模型')
  const model = slots.entries('settings.section').find((entry) => entry.options.id === 'models')
  assert.equal(typeof model.options.label, 'function')
  assert.equal(model.options.label(), '接管模型')
})



test('startup loads the persisted policy from settings.describe', async () => {
  const env = loadEnv()
  const { slots, plugin, ctx, connection } = env
  slots.declare('settings.section')
  slots.register({ name: 'settings.section', id: 'api-retry', order: 95, label: () => 'API 重试' }, () => {})
  slots.register({ name: 'settings.section', id: 'models', order: 10, label: () => '模型' }, () => {})
  // Seed the server document BEFORE apply, so the async describe load picks it up.
  connection._setPersisted({ hidden: { 'api-retry': true }, order: { models: 30 }, labels: { models: '接管' } })
  plugin.apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const test = env.vmGlobal[SEAM_KEY]
  assert.equal(test.policy.isHidden('api-retry'), true)
  assert.equal(test.policy.orderFor('models'), 30)
  assert.equal(test.policy.labelFor('models'), '接管')
})

test('startup load does not overwrite a user mutation made before describe resolves', async () => {
  const env = loadEnv()
  const { slots, plugin, ctx, connection } = env
  slots.declare('settings.section')
  slots.register({ name: 'settings.section', id: 'api-retry', order: 95, label: () => 'API 重试' }, () => {})
  connection._setPersisted({ hidden: { 'api-retry': true }, order: {}, labels: {} })
  plugin.apply(ctx)
  const test = env.vmGlobal[SEAM_KEY]
  // user toggles before the async describe resolves
  test.policy.setHidden('api-retry', false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(test.policy.isHidden('api-retry'), false) // user change wins over the stale load
})
