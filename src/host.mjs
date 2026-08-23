/**
 * dsh-settings-manager — host half.
 *
 * The actual work happens in the browser half (src/client.js): it patches the
 * client slot registry so every `settings.section` registration passes through
 * the manager policy (registration-time rewrite + read-path filter/reorder),
 * and contributes its own "Settings Manager" section to the global Settings
 * dialog. This host half exists only as the bundle mount anchor required by
 * the profile bundle stack; it registers nothing and keeps no state.
 */
export const name = 'dsh-settings-manager'

export function apply(_ctx) {
  // No host-side behavior for v1. The client half self-contained: policy is
  // persisted in localStorage (the settings RPC only exposes allowlisted
  // namespaces, so a profile plugin cannot open its own namespace upstream).
}
