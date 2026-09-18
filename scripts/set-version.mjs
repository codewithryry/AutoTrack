/**
 * Apply a release version to the project.
 *
 *   node scripts/set-version.mjs 0.2.6
 *   node scripts/set-version.mjs v0.2.6      # a leading v is stripped
 *
 * The tag is the single source of truth for a release. This writes it into the
 * two files that actually decide what a build reports:
 *
 *   • `package.json`            — which `android/app/build.gradle` reads for
 *                                 `versionName` and packs into `versionCode`
 *   • `src/utils/constants.js`  — `APP_VERSION`, shown on the loading screen and
 *                                 in Settings → About
 *
 * Nothing else needs touching: the Android version is derived from the first of
 * those, so there is no Android file to edit when cutting a release.
 *
 * In CI this runs against the checked-out workspace and the change is never
 * committed — the tag already records the version, so writing it back into the
 * branch would only add a commit that says what the tag says.
 *
 * Run by hand, it is the tidy way to bump before tagging. `--check` reports
 * whether the files already match without writing anything.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const PACKAGE = 'package.json'
const CONSTANTS = 'src/utils/constants.js'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const input = args.find((a) => !a.startsWith('--'))

if (!input) {
  console.error('Usage: node scripts/set-version.mjs <version> [--check]')
  process.exit(1)
}

/** `v0.2.6` and `0.2.6` are the same release; the leading v is not part of it. */
const version = input.replace(/^v/, '')

// Refuse anything Android cannot turn into a versionName/versionCode pair. A
// three-part core is required; a pre-release suffix (0.3.0-beta.1) is allowed
// and is carried into versionName as written.
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  console.error(
    `"${input}" is not a usable version. Expected MAJOR.MINOR.PATCH, ` +
      'optionally with a -prerelease suffix — for example 0.2.6 or 0.3.0-beta.1.',
  )
  process.exit(1)
}

/**
 * The integer Android orders installs by. Two digits per part, so 0.2.6 is 206
 * and a later 0.3.0 is 300 — the same packing `android/app/build.gradle` does,
 * repeated here only to report it.
 */
const [major, minor, patch] = version.split(/[.-]/).map(Number)
const versionCode = major * 10000 + minor * 100 + patch

if (minor > 99 || patch > 99) {
  console.error(
    `Version ${version} cannot be packed into a versionCode: ` +
      'the minor and patch parts must each stay below 100.',
  )
  process.exit(1)
}

const edits = [
  {
    file: PACKAGE,
    // Only the first top-level "version" — npm writes the project's own in the
    // opening object, and a dependency could carry the same key further down.
    pattern: /("version"\s*:\s*")([^"]+)(")/,
    label: 'package.json version',
  },
  {
    file: CONSTANTS,
    pattern: /(APP_VERSION = ')([^']+)(')/,
    label: 'APP_VERSION',
  },
]

let changed = false
let mismatched = false

for (const { file, pattern, label } of edits) {
  const text = readFileSync(file, 'utf8')
  const match = text.match(pattern)
  if (!match) {
    console.error(`Could not find ${label} in ${file}.`)
    process.exit(1)
  }

  const current = match[2]
  if (current === version) {
    console.log(`ok       ${label} is already ${version}`)
    continue
  }

  mismatched = true
  if (checkOnly) {
    console.log(`differs  ${label} is ${current}, expected ${version}`)
    continue
  }

  // `replace` with a function: a `$` in a version string would otherwise be
  // read as a substitution pattern.
  writeFileSync(file, text.replace(pattern, () => `${match[1]}${version}${match[3]}`))
  console.log(`set      ${label}: ${current} -> ${version}`)
  changed = true
}

if (checkOnly) {
  if (mismatched) {
    console.log(`\nThe project does not report ${version}.`)
    process.exit(1)
  }
  console.log(`\nThe project reports ${version}.`)
  process.exit(0)
}

console.log(
  `\nVersion ${version} applied${changed ? '' : ' (nothing to change)'}.\n` +
    `Android versionName ${version}, versionCode ${versionCode}.`,
)
