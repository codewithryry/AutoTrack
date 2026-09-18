/**
 * Check the release keystore and its credentials — without revealing them.
 *
 * Answers the one question the CI failure cannot: do the keystore, its password
 * and the alias actually agree, and is each value free of the characters Java's
 * keystore loader rejects?
 *
 * Nothing is printed but PASS/FAIL lines and byte counts. The password is read
 * from the environment rather than the command line, so it does not reach the
 * shell history or the process list.
 *
 *   ANDROID_KEYSTORE_PASSWORD=... node scripts/check-keystore.mjs
 *
 * Optional:
 *   ANDROID_KEYSTORE_PATH   defaults to ./release.keystore
 *   ANDROID_KEY_ALIAS       defaults to "android"
 *   ANDROID_KEY_PASSWORD    defaults to the keystore password
 */

import { existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const path = process.env.ANDROID_KEYSTORE_PATH ?? 'release.keystore'
const alias = process.env.ANDROID_KEY_ALIAS ?? 'android'
const storePass = process.env.ANDROID_KEYSTORE_PASSWORD ?? ''
const keyPass = process.env.ANDROID_KEY_PASSWORD ?? storePass

let ok = true
const report = (pass, label, detail) => {
  if (!pass) ok = false
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

/** Shape checks only: never the value, only what is wrong with it. */
function inspect(label, value) {
  if (!value) {
    report(false, `${label} is set`, 'empty — pass it in the environment')
    return false
  }
  const bytes = Buffer.from(value, 'utf8')

  if (/[\r\n\t]/.test(value)) {
    report(false, `${label} has no line break or tab`, 'this is the usual cause of "Password is not ASCII"')
    return false
  }
  if (value !== value.trim()) {
    report(false, `${label} has no surrounding whitespace`)
    return false
  }
  // The exact condition Java enforces.
  const nonAscii = bytes.some((b) => b < 0x20 || b > 0x7e)
  if (nonAscii) {
    report(false, `${label} is plain ASCII`, 'contains a non-ASCII or control character')
    return false
  }
  if (bytes.length > 256) {
    report(false, `${label} is a plausible length`, `${bytes.length} bytes — is this the base64 keystore?`)
    return false
  }
  report(true, `${label} is ASCII and well-formed`, `${bytes.length} bytes`)
  return true
}

console.log(`Keystore: ${path}\n`)

if (!existsSync(path)) {
  report(false, 'the keystore file exists')
  process.exit(1)
}
report(true, 'the keystore file exists', `${statSync(path).size} bytes`)

const shapeOk = [
  inspect('ANDROID_KEYSTORE_PASSWORD', storePass),
  inspect('ANDROID_KEY_ALIAS', alias),
  inspect('ANDROID_KEY_PASSWORD', keyPass),
].every(Boolean)

if (!shapeOk) {
  console.log('\nFix the values above before testing the keystore itself.')
  process.exit(1)
}

// The real proof: keytool opens it, or it does not. Output is swallowed so no
// certificate detail or password echo reaches the terminal.
const list = spawnSync(
  'keytool',
  ['-list', '-keystore', path, '-storepass', storePass, '-alias', alias],
  { encoding: 'utf8' },
)

if (list.error) {
  report(false, 'keytool is available', 'install a JDK, or add keytool to PATH')
  process.exit(1)
}

if (list.status === 0) {
  report(true, 'the keystore opens with this password and contains the alias')
} else {
  const why = /password was incorrect|keystore password was incorrect/i.test(list.stderr ?? '')
    ? 'the store password is wrong'
    : /alias .* does not exist/i.test(list.stderr ?? '')
      ? `the keystore has no alias "${alias}"`
      : 'keytool refused the keystore'
  report(false, 'the keystore opens with this password and contains the alias', why)
}

console.log(
  ok
    ? '\nThe keystore and these credentials agree. If CI still fails, the GitHub\n' +
        'secret does not match what you just tested — re-enter it with no trailing newline.'
    : '\nSomething above is wrong. Nothing was printed that reveals a password.',
)
process.exit(ok ? 0 : 1)
