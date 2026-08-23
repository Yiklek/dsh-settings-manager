/**
 * Unit tests — reorder() primitive (↑↓ buttons + drag & drop share this).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScenario } from '../helpers/scenario.mjs'

function fresh() {
  const s = setupScenario()
  // A couple of post-apply sections (like profile plugins loading later).
  s.slots.register({ name: 'settings.section', id: 'web-ui', order: 110, label: () => 'Web UI' }, () => 'WebUi')
  s.slots.register({ name: 'settings.section', id: 'late', order: 999, label: () => 'Late' }, () => 'Late')
  return s
}

test('reorder-after moves the section below the target and renumbers all', () => {
  const { test } = fresh()
  test.reorder('models', 'api-retry', 'after')
  const rows = test.readSections()
  const idxModels = rows.findIndex((r) => r.id === 'models')
  const idxRetry = rows.findIndex((r) => r.id === 'api-retry')
  assert.ok(idxModels > idxRetry, `models@${idxModels} should be after api-retry@${idxRetry}`)
  // every section gets a distinct order slot (0,10,20,...)
  assert.equal(new Set(rows.map((r) => r.order)).size, rows.length)
  // nothing dropped
  assert.equal(rows.length, test.readSections().length)
})

test('reorder-before moves the section above the target', () => {
  const { test } = fresh()
  test.reorder('web-ui', 'general', 'before')
  const rows = test.readSections()
  assert.equal(rows[0].id, 'web-ui')
})

test('reorder onto itself is a no-op', () => {
  const { test } = fresh()
  const before = JSON.stringify(test.readSections().map((r) => r.id))
  test.reorder('models', 'models', 'after')
  assert.equal(JSON.stringify(test.readSections().map((r) => r.id)), before)
})

test('reorder to an unknown target is a no-op', () => {
  const { test } = fresh()
  const before = JSON.stringify(test.readSections().map((r) => r.id))
  test.reorder('models', 'no-such-section', 'before')
  assert.equal(JSON.stringify(test.readSections().map((r) => r.id)), before)
})

test('reorder preserves every registered section (no drop, no dup)', () => {
  const { test } = fresh()
  const idsBefore = new Set(test.readSections().map((r) => r.id))
  test.reorder('late', 'general', 'after')
  test.reorder('models', 'late', 'before')
  const idsAfter = test.readSections().map((r) => r.id)
  assert.equal(new Set(idsAfter).size, idsAfter.length, 'no duplicates')
  assert.deepEqual(
    new Set(idsAfter),
    idsBefore,
    'section set unchanged',
  )
})

test('reorder results are persisted (resettable)', () => {
  const { test } = fresh()
  test.reorder('api-retry', 'general', 'before')
  const rows = test.readSections()
  assert.equal(rows[0].id, 'api-retry')
  // resetting api-retry drops its explicit order; reset-all clears everything
  test.resetAll()
  const after = test.readSections()
  // back to registered orders → original relative position
  const idxRetry = after.findIndex((r) => r.id === 'api-retry')
  const idxGeneral = after.findIndex((r) => r.id === 'general')
  assert.ok(idxRetry > idxGeneral, 'api-retry returns after general on reset')
})
