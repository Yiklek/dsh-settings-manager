/**
 * dsh-settings-manager — host half, TypeScript source.
 *
 * The actual work happens in the browser half (src/client.ts): it patches the
 * client slot registry so every `settings.section` registration passes through
 * the manager policy (registration-time + read-path interception), and
 * contributes its own "Settings Manager" section to the global Settings
 * dialog. This host half exists only as the bundle mount anchor required by
 * the profile bundle stack; it registers nothing and keeps no state.
 *
 * Types come from the official `@deepseek-ai/cordis` package via `import type`
 * only — the compiled output has zero runtime imports.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-settings-manager'

export function apply(_ctx: Context): void {
  // No host-side behavior for v1. The client half is self-contained: the
  // policy is persisted in localStorage (the settings RPC only exposes
  // allowlisted namespaces, so a profile plugin cannot open its own namespace
  // upstream).
}
