/**
 * Write the released version into the README's download section.
 *
 *   node scripts/update-readme-version.mjs 0.2.6
 *   node scripts/update-readme-version.mjs v0.2.6      # a leading v is stripped
 *   node scripts/update-readme-version.mjs 0.2.6 --check
 *
 * The README carries a badge that reads the latest release live, so the page is
 * already correct the moment a release is published. This keeps the plain-text
 * line beside it in step as well — that is the one somebody sees in raw
 * markdown, in an editor, or with images blocked.
 *
 * Only the text between the two markers is touched:
 *
 *   <!-- latest-version:start -->
 *   **Latest version: 0.2.5**
 *   <!-- latest-version:end -->
 *
 * Everything else in the file is left byte for byte as it was, which is what
 * makes this safe to run from CI against a README somebody is also editing.
 *
 * Exit codes: 0 changed or already correct, 1 a problem worth stopping for.
 * With `--check` it writes nothing and exits 1 if the line is out of date.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const README = 'README.md'
const START = '<!-- latest-version:start -->'
const END = '<!-- latest-version:end -->'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const input = args.find((a) => !a.startsWith('--'))

if (!input) {
  console.error('Usage: node scripts/update-readme-version.mjs <version> [--check]')
  process.exit(1)
}

/** `v0.2.6` and `0.2.6` are the same release; the v is not part of the version. */
const version = input.replace(/^v/, '')

if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  console.error(`"${input}" is not a version this should publish. Expected MAJOR.MINOR.PATCH.`)
  process.exit(1)
}

const text = readFileSync(README, 'utf8')

const start = text.indexOf(START)
const end = text.indexOf(END)
if (start === -1 || end === -1 || end < start) {
  console.error(
    `Could not find the ${START} / ${END} markers in ${README}. ` +
      'They mark the only lines this script may rewrite — restore them rather than ' +
      'letting it guess where the version line is.',
  )
  process.exit(1)
}

const before = text.slice(0, start + START.length)
const after = text.slice(end)
const current = text.slice(start + START.length, end)

// Match the file's own line ending. This README is CRLF, and writing LF into it
// would rewrite the block's line endings on every run: the "already correct"
// check below would never fire, so each release would commit a diff even when
// the version had not moved.
const eol = text.includes('\r\n') ? '\r\n' : '\n'

// The block is rebuilt rather than pattern-matched, so a hand-edit inside the
// markers is corrected rather than leaving two version lines behind.
const replacement = `${eol}**Latest version: ${version}**${eol}`

if (current === replacement) {
  console.log(`ok       README already says ${version}`)
  process.exit(0)
}

const shown = current.match(/Latest version:\s*([^*\n]+)/)?.[1]?.trim() ?? '(nothing)'

if (checkOnly) {
  console.log(`differs  README says ${shown}, expected ${version}`)
  process.exit(1)
}

writeFileSync(README, before + replacement + after)
console.log(`set      README: ${shown} -> ${version}`)
