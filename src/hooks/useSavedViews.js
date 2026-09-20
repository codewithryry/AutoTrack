import { useCallback } from 'react'
import { useLocalStorage } from './index'
import { uid } from '../utils/helpers'

/**
 * Named filter combinations, per person and per device.
 *
 * A view stores the *filter state* and nothing else — six short strings — so it
 * can never go stale against the inventory, and opening one is applying the
 * filters the page already has rather than loading a second copy of anything.
 *
 * Deliberately `localStorage` rather than a table. These are a personal
 * convenience, like the sort order or the theme; a server-side view would mean
 * a migration, a policy, and a row per person for something nobody else can see
 * or needs. `useLocalStorage` is the mechanism the project already uses for
 * exactly this kind of preference, and it writes only when the list changes —
 * never on a filter keystroke.
 *
 * Scoped by account id, so two people sharing a workshop tablet do not inherit
 * each other's views.
 *
 * Nothing here decides what a person may *see*: a view is a set of filters, and
 * the rows behind it are still fetched through the same RLS-governed read as
 * the unfiltered page. A student opening a view named "Under maintenance" gets
 * the same tools they would get by choosing those filters by hand.
 */

/** The filter fields a view remembers. Anything else is not part of a view. */
export const VIEW_FIELDS = ['search', 'status', 'category', 'condition', 'location', 'sort']

/** Views beyond this are more list than shortcut, and the menu stops being one. */
const MAX_VIEWS = 12

export function useSavedViews(userId) {
  const [views, setViews] = useLocalStorage(`stms.toolViews.${userId ?? 'anon'}`, [])

  /**
   * Remember the filters currently applied, under a name.
   *
   * Saving the same name twice replaces it rather than accumulating duplicates,
   * which is what somebody adjusting a view and saving it again means.
   */
  const save = useCallback(
    (name, filters) => {
      const label = String(name ?? '').trim()
      if (!label) return { ok: false, error: 'Give the view a name.' }
      if (label.length > 40) return { ok: false, error: 'Keep the name under 40 characters.' }

      // Only the known fields, so a future filter cannot leak into storage
      // unnoticed and a stored view cannot carry something unexpected back.
      const state = {}
      for (const field of VIEW_FIELDS) {
        const value = filters?.[field]
        if (value != null && value !== '' && value !== 'all') state[field] = String(value)
      }

      let result = { ok: true }
      setViews((current) => {
        const existing = current.findIndex(
          (v) => v.name.toLowerCase() === label.toLowerCase(),
        )
        if (existing === -1 && current.length >= MAX_VIEWS) {
          result = { ok: false, error: `You can keep up to ${MAX_VIEWS} views.` }
          return current
        }
        const view = { id: current[existing]?.id ?? uid('VIEW'), name: label, state }
        if (existing >= 0) {
          const next = [...current]
          next[existing] = view
          return next
        }
        return [...current, view]
      })
      return result
    },
    [setViews],
  )

  const remove = useCallback(
    (id) => setViews((current) => current.filter((v) => v.id !== id)),
    [setViews],
  )

  return { views, save, remove }
}
