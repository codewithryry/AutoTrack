/**
 * The web build, configured for the native shell.
 *
 * One difference from `npm run build`: `CAPACITOR_BUILD=true`, which tells
 * `vite.config.js` to drop the service worker and emit relative asset paths.
 * Both matter only inside the WebView, and neither touches the web build.
 *
 * A script rather than an inline `VAR=value vite build`, because that syntax is
 * a shell-ism — it fails on Windows, where this project is developed, and would
 * mean adding a dependency to work around.
 */

import { spawnSync } from 'node:child_process'

const result = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CAPACITOR_BUILD: 'true' },
})

process.exit(result.status ?? 1)
