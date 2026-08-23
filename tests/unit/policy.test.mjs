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

