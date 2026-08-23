/**
 * Unit tests — policy store (localStorage-backed placement policy).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScenario } from '../helpers/scenario.mjs'

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

test('setHidden/setOrder/setLabel persist to localStorage', () => {
  const { test, storage } = fresh()
  test.policy.setHidden('api-retry', true)
  test.policy.setOrder('web-ui', 7)
  test.policy.setLabel('models', 'Model List')

  assert.equal(test.policy.isHidden('api-retry'), true)
  assert.equal(test.policy.orderFor('web-ui'), 7)
  assert.equal(test.policy.labelFor('models'), 'Model List')

  const parsed = JSON.parse(storage.getItem('dsh-settings-manager.policy.v1'))
  assert.equal(parsed.hidden['api-retry'], true)
  assert.equal(parsed.order['web-ui'], 7)
  assert.equal(parsed.labels['models'], 'Model List')
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
  const { test, storage } = fresh()
  test.policy.setHidden('api-retry', true)
  test.policy.setOrder('models', 3)
  test.policy.setLabel('general', 'Renamed')
  test.policy.resetAll()
  const parsed = JSON.parse(storage.getItem('dsh-settings-manager.policy.v1'))
  assert.deepEqual(parsed.hidden, {})
  assert.deepEqual(parsed.order, {})
  assert.deepEqual(parsed.labels, {})
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


