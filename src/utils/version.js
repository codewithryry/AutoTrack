/**
 * Version comparison for the "Check for updates" feature.
 *
 * The release tag is the source of truth, and a leading `v` is not part of a
 * version: `v0.2.6` and `0.2.6` are the same release. Each dot segment is read
 * as a number, so `0.2.10` belongs after `0.2.9` — the comparison a plain
 * string sort gets wrong. A missing segment counts as zero, so `0.2` is the
 * same release as `0.2.0`.
 */

/** Drop whitespace and a leading `v`, so `v0.2.6` reads as `0.2.6`. */
export function stripVersionPrefix(value) {
  return String(value ?? '').trim().replace(/^v/i, '')
}

/** Split a version into its dot segments. `0.2.10-beta.1` → [0, 2, 10, "beta", "1"]. */
export function versionParts(value) {
  return stripVersionPrefix(value)
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Compare two versions.
 *
 * @returns {-1 | 0 | 1} -1, 0 or 1, in the same sense as `Array.prototype.sort`.
 */
export function compareVersions(a, b) {
  const partsA = versionParts(a)
  const partsB = versionParts(b)
  const length = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < length; i += 1) {
    const textA = partsA[i] ?? '0'
    const textB = partsB[i] ?? '0'
    const numA = Number(textA)
    const numB = Number(textB)
    if (Number.isFinite(numA) && Number.isFinite(numB)) {
      if (numA !== numB) return numA < numB ? -1 : 1
    } else if (textA !== textB) {
      // A non-numeric segment — a pre-release marker — falls back to ordinary
      // string order rather than being coerced into a number.
      return textA < textB ? -1 : 1
    }
  }
  return 0
}

/** Whether `candidate` is a newer release than `installed`. */
export function isNewer(installed, candidate) {
  return compareVersions(candidate, installed) === 1
}