/**
 * Build dsh-settings-manager.
 *
 *   node scripts/build.mjs
 *
 * Produces `lib/`:
 *   - lib/client.js — the browser half, bundled by esbuild and wrapped in the
 *     DSH module format (`window.__ModuleLoader__.load`). `react` stays an
 *     external require (a shell seed). No official @deepseek-ai package is
 *     imported at runtime.
 *   - lib/host.mjs  — the host half (ESM, `import type` erased → zero imports).
 */
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const lib = join(root, 'lib')
mkdirSync(lib, { recursive: true })

const esbuildOptions = {
  bundle: true,
  target: 'es2020',
  logLevel: 'info',
}

// 1) Client bundle (CJS, wrapped in the DSH __ModuleLoader__.load format).
const client = await build({
  ...esbuildOptions,
  entryPoints: [join(root, 'src/client.ts')],
  format: 'cjs',
  platform: 'browser',
  external: ['react'],
  write: false,
})

const bundled = client.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({
  id: 'dsh-settings-manager',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
${bundled}
    return module.exports
  },
});
`
writeFileSync(join(lib, 'client.js'), wrapped)

// 2) Host bundle (ESM, node).
await build({
  ...esbuildOptions,
  entryPoints: [join(root, 'src/host.ts')],
  format: 'esm',
  platform: 'node',
  outfile: join(lib, 'host.mjs'),
  write: true,
})
