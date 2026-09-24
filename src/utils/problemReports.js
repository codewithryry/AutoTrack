/**
 * Problem reports among maintenance records.
 *
 * Pure and dependency-free, so the app (re-exported from
 * `services/maintenance.js`) and TOBI's server functions in `api/` tell a
 * report from a scheduled job the same way.
 */

/**
 * Was this maintenance record filed through `reportProblem()` rather than
 * scheduled by staff?
 *
 * There is no separate flag for it — see the comment on `reportProblem()` —
 * so it is read from the one thing the RPC always writes and staff scheduling
 * never does: the `Reported by <name> (<role>): ` prefix `0034` puts on
 * `notes`. Matched by prefix rather than by `technician === ''` alone, which a
 * staff-entered job could also leave blank.
 */
const REPORTED_PREFIX = /^Reported by (.+?) \(([^)]*)\):\s*/

export function isReport(record) {
  return REPORTED_PREFIX.test(record?.notes ?? '')
}

/**
 * Splits a report's `notes` back into the reporter's name, role and the
 * description they typed — the three pieces `0034` folded into one string.
 * Returns `null` for a record `isReport()` says is not one.
 */
export function parseReport(record) {
  const match = REPORTED_PREFIX.exec(record?.notes ?? '')
  if (!match) return null
  return {
    reporterName: match[1],
    reporterRole: match[2] || 'Unknown',
    description: record.notes.slice(match[0].length),
  }
}
