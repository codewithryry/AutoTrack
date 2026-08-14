/**
 * Verification runner — `npm run verify`.
 *
 * The suites import application source directly, so they are bundled with
 * esbuild first (Node cannot resolve the extensionless imports Vite allows).
 * Output goes to node_modules/.cache so nothing lands in the repository.
 *
 * Two suites run without any network connection:
 *
 *   domain logic    the pure modules — dates, permissions, QR, helpers.
 *   access control  role → navigation, route guards, and the source-hygiene
 *                   invariants (no credentials in the bundle, no database call
 *                   outside the data layer).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cache = join(root, 'node_modules', '.cache')
mkdirSync(cache, { recursive: true })

const SUITES = [
  { name: 'domain logic', entry: 'scripts/verify-logic.mjs', out: 'verify-logic.mjs' },
  { name: 'access control', entry: 'scripts/verify-guards.mjs', out: 'verify-guards.mjs' },
]

let failed = false

for (const suite of SUITES) {
  const outfile = join(cache, suite.out)
  console.log(`\n=== ${suite.name} ===`)
  try {
    await build({
      absWorkingDir: root,
      entryPoints: [suite.entry],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile,
      logLevel: 'error',
      jsx: 'automatic',
      // Node-only test rigs stay external: jsdom loads JSON data files at
      // runtime that a bundle cannot resolve.
      external: ['jsdom', 'fake-indexeddb', 'fake-indexeddb/auto'],
      banner: {
        // qrcode reaches for `fs` through CommonJS; give the bundle a require().
        js: 'import{createRequire as __cr}from"module";const require=__cr(import.meta.url);',
      },
    })
    execFileSync(process.execPath, [outfile], { cwd: root, stdio: 'inherit' })
  } catch {
    failed = true
  }
}

if (failed) {
  console.error('\nVerification failed.\n')
  process.exit(1)
}
console.log('\nAll verification suites passed.\n')
