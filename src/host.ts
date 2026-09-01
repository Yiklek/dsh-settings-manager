/**
 * dsh-settings-manager — host half, TypeScript source.
 *
 * The real work happens in the browser half (src/client.ts): it patches the
 * client slot registry so every `settings.section` registration passes through
 * the manager policy, and contributes its own "Settings Manager" section.
 *
 * This host half registers the plugin's `settings-manager` settings NAMESPACE
 * so the policy can be persisted server-side through the DSH settings seam
 * (SettingsProvider stores the user document on disk). The client reads/writes
 * it over the `remote.settings` RPC face. The plugin holds no own state here —
 * the settings service is the single source of truth.
 *
 * Runtime deps `@deepseek-ai/dsh-settings` and `@deepseek-ai/schemastery` are
 * provided by the DSH runtime (peerDependencies) and resolved at runtime, not
 * bundled into host.mjs.
 */
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls in the Context augmentation (`ctx.settings`) without a
// runtime import (the host bundle resolves nothing from this package).
import type {} from '@deepseek-ai/dsh-settings'

/**
 * Schemastery schema for the manager policy document. Keys are dynamic (any
 * registered section id), so the three maps are dicts (arbitrary keys, fixed
 * value type): hidden → boolean, order → number, labels → string.
 */
const policySchema = Schema.object({
  hidden: Schema.dict(Schema.boolean()).default({}),
  order: Schema.dict(Schema.number()).default({}),
  labels: Schema.dict(Schema.string()).default({}),
})

export const name = 'dsh-settings-manager'

export function apply(ctx: Context): void {
  // The settings service owns the value; the host keeps no shadow state. The
  // namespace string is validated by the settings service at runtime.
  ctx.inject(['settings'], (sctx) => {
    sctx.settings.register('settings-manager', policySchema)
  })
}
