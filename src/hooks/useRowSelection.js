import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Which rows of a filtered list are selected.
 *
 * Holds ids, not records. A `Set` of ids stays small whatever the inventory
 * costs to render, and it means the selection cannot go stale against a row
 * that was edited or reloaded underneath it — the records are always read back
 * from the list itself.
 *
 * The rule that matters for correctness: a selection may only ever contain rows
 * the current filter is showing. Selecting ten tools, narrowing the search, and
 * then pressing "change status" must not touch the ones that scrolled out of
 * sight. `visible` below is intersected with the live list on every read, so a
 * hidden row cannot be acted on even if its id is still in the set.
 *
 * @param {Array<{id: string}>} rows the currently filtered, visible rows
 */
export function useRowSelection(rows) {
  const [ids, setIds] = useState(() => new Set())

  // The ids the filter is currently showing, as a stable lookup.
  const visibleIds = useMemo(() => new Set((rows ?? []).map((r) => r.id)), [rows])

  /*
   * Drop anything the filter has hidden.
   *
   * Without this, narrowing a search would leave the hidden rows selected and a
   * bulk action would quietly include them. Pruning here rather than clearing
   * outright keeps the useful case working: tick three tools, refine the search,
   * and the ones still on screen stay ticked.
   *
   * The write is guarded — `setIds` only runs when something actually changed —
   * so a filter that hides nothing does not re-render the table.
   */
  useEffect(() => {
    setIds((current) => {
      if (current.size === 0) return current
      let changed = false
      const next = new Set()
      for (const id of current) {
        if (visibleIds.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : current
    })
  }, [visibleIds])

  const toggle = useCallback((id) => {
    setIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clear = useCallback(() => setIds((current) => (current.size ? new Set() : current)), [])

  /** Select every visible row, or clear when they are already all selected. */
  const toggleAll = useCallback(() => {
    setIds((current) => {
      const allSelected = visibleIds.size > 0 && current.size >= visibleIds.size
      return allSelected ? new Set() : new Set(visibleIds)
    })
  }, [visibleIds])

  // The selected records, in the order the list shows them — never a separate
  // copy of the inventory, and never a row the filter has hidden.
  const selected = useMemo(
    () => (ids.size === 0 ? EMPTY : (rows ?? []).filter((r) => ids.has(r.id))),
    [rows, ids],
  )

  const count = selected.length
  const allVisibleSelected = visibleIds.size > 0 && count === visibleIds.size
  // Neither none nor all: what a checkbox shows as a dash rather than a tick.
  const someVisibleSelected = count > 0 && !allVisibleSelected

  return {
    selectedIds: ids,
    selected,
    count,
    isSelected: useCallback((id) => ids.has(id), [ids]),
    toggle,
    toggleAll,
    clear,
    allVisibleSelected,
    someVisibleSelected,
  }
}

/** One frozen empty array, so an empty selection is referentially stable. */
const EMPTY = Object.freeze([])

/**
 * A checkbox that can show the third state.
 *
 * `indeterminate` is a DOM property rather than an attribute, so React cannot
 * set it from JSX — it has to be written to the node. Wrapped here so every
 * select-all box in the app behaves the same way.
 */
export function useIndeterminate(indeterminate) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])
  return ref
}
