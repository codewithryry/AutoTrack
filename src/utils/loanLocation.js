/**
 * Where a loan's tool was last recorded — the rule the Tool Map draws with.
 *
 * Pure and dependency-free, so the same rule serves the app (re-exported from
 * `services/transactions.js`) and TOBI's server functions in `api/`, and the
 * two can never disagree about where a tool is.
 *
 *   1. the loan's newest valid usage checkpoint, else
 *   2. the point captured when the tool was collected, else
 *   3. null — "not recorded", never a default.
 *
 * Only an open loan has a current location. A closed loan's points are history.
 */

export const checkpointsOf = (txn) =>
  Array.isArray(txn?.locationCheckpoints) ? txn.locationCheckpoints : []

export function lastKnownLocation(txn) {
  const stamped = (point) => new Date(point?.capturedAt ?? 0).getTime() || 0
  const latest = checkpointsOf(txn)
    .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
    .reduce((newest, point) => (!newest || stamped(point) >= stamped(newest) ? point : newest), null)

  if (latest) return { ...latest, source: 'checkpoint' }

  const borrow = txn?.borrowLocation
  if (Number.isFinite(borrow?.lat) && Number.isFinite(borrow?.lng)) {
    return { ...borrow, source: 'borrow' }
  }
  return null
}
