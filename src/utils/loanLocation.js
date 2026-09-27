/**
 * Where a loan's tool was last recorded — the one rule for the Tool Map, the
 * tool page and TOBI.
 *
 * Pure and dependency-free, so the same rule serves the app (re-exported from
 * `services/transactions.js`) and TOBI's server functions in `api/`, and they
 * can never disagree about where a tool is.
 *
 * An open loan's last recorded location:
 *
 *   1. the valid checkpoint with the newest `capturedAt` — never simply the last
 *      one in the array, which the Android tracker's offline queue and a manual
 *      checkpoint can append out of time order; else
 *   2. the point captured when the tool was collected; else
 *   3. null — "not recorded", never a default, and never `tools.location`,
 *      which is a free-text storage label with no coordinates.
 *
 * Only an open loan has a current location. A closed loan's points are history;
 * the one exception is an available tool's "last returned here" pin, which is
 * the return point of its most recent closed loan and is never a current
 * location.
 */

export const ACTIVE_LOAN_STATUSES = ['Borrowed', 'Overdue']

export const checkpointsOf = (txn) =>
  Array.isArray(txn?.locationCheckpoints) ? txn.locationCheckpoints : []

/** Milliseconds of a point's `capturedAt`, or NaN when it has none that parses. */
export const pointTime = (point) => {
  const value = point?.capturedAt
  return value ? new Date(value).getTime() : NaN
}

/** Coordinates on the globe, taken at a known moment. */
export const isValidPoint = (point) =>
  Number.isFinite(point?.lat) &&
  Number.isFinite(point?.lng) &&
  Math.abs(point.lat) <= 90 &&
  Math.abs(point.lng) <= 180 &&
  Number.isFinite(pointTime(point))

export const isOpenLoan = (txn) => ACTIVE_LOAN_STATUSES.includes(txn?.status)

/** The newest valid checkpoint by `capturedAt`; a tie goes to the later entry. */
export function latestCheckpoint(txn) {
  return checkpointsOf(txn)
    .filter(isValidPoint)
    .reduce((newest, point) => (!newest || pointTime(point) >= pointTime(newest) ? point : newest), null)
}

export function lastKnownLocation(txn) {
  const latest = latestCheckpoint(txn)
  if (latest) return { ...latest, source: 'checkpoint' }

  const borrow = txn?.borrowLocation
  if (isValidPoint(borrow)) return { ...borrow, source: 'borrow' }
  return null
}

/** A closed loan's return point, when one was recorded. */
export function returnLocationOf(txn) {
  const back = txn?.returnLocation
  return isValidPoint(back) ? { ...back, source: 'return' } : null
}

/**
 * Where to draw one tool, from the loans the viewer may read.
 *
 *   activeLoan   its open loan, or null
 *   current      that loan's last recorded location (`lastKnownLocation`), or
 *                null — a checked-out tool without one is "unlocated"
 *   resting      only for an available tool with no open loan: the return
 *                point of its most recent closed loan. An older loan's point —
 *                return or checkpoint — is never used, because a later loan may
 *                have gone back without a reading.
 */
export function resolveToolLocation(loans = [], { available = false } = {}) {
  const activeLoan = loans.find(isOpenLoan) ?? null
  const current = activeLoan ? lastKnownLocation(activeLoan) : null

  let resting = null
  if (!activeLoan && available) {
    const closedAt = (txn) => new Date(txn.returnDate ?? txn.borrowDate ?? 0).getTime() || 0
    const lastClosed = loans.reduce(
      (latest, txn) => (!latest || closedAt(txn) > closedAt(latest) ? txn : latest),
      null,
    )
    resting = lastClosed ? returnLocationOf(lastClosed) : null
  }

  return { activeLoan, current, resting }
}
