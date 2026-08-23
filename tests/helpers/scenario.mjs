/**
 * Shared scenario for unit tests: load the bundle, declare settings.section,
 * register base sections (as the shell does before any profile plugin), then
 * apply the manager. Returns the test seam + handy helpers.
 */
import { loadEnv } from './load-env.mjs'

export function setupScenario(globals = {}) {
  const env = loadEnv(globals)
  const { slots, plugin, ctx } = env

  slots.declare('settings.section')
  slots.register({ name: 'settings.section', id: 'general', order: 0, label: () => '通用设置' }, () => 'General')
  slots.register({ name: 'settings.section', id: 'models', order: 10, label: () => '模型' }, () => 'Models')
  slots.register({ name: 'settings.section', id: 'api-retry', order: 95, label: () => 'API 重试' }, () => 'ApiRetry')

  plugin.apply(ctx)
  const test = plugin.__test
  if (!test) throw new Error('__test seam missing (TEST flag not applied?)')

  // The mock register() returns a disposer (like the real API), so capture the
  // stored entry objects from the store for identity checks.
  const rawEntry = (id) => slots.raw('settings.section').find((entry) => entry.options.id === id)
  const general = rawEntry('general')
  const models = rawEntry('models')
  const retry = rawEntry('api-retry')

  /** Raw stored entry (policy NOT applied), by id. */
  const raw = (id) => slots.raw('settings.section').find((entry) => entry.options.id === id)

  /** Nav order exactly like the shell computes it: read entries, sort by order.
   *  Array.from normalizes the VM-realm array back into the test realm so
   *  deepStrictEqual (which checks [[Prototype]]) matches against literals. */
  const navIds = () =>
    Array.from(
      slots
        .entries('settings.section')
        .map((entry) => ({ id: entry.options.id, order: entry.options.order ?? 0 }))
        .sort((a, b) => a.order - b.order)
        .map((row) => row.id),
    )

  return { ...env, test, raw, navIds, general, models, retry }
}
