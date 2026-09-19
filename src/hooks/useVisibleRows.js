import { useEffect, useState } from 'react'

/**
 * Render a long list a screenful at a time.
 *
 * The inventory and the directory both render every row they hold. That is fine
 * on a laptop and expensive on a 2 GB phone: a few hundred cards is a few
 * thousand DOM nodes, each with its own styles and listeners, and the cost is
 * paid on the first paint of the page and again on every filter change.
 *
 * This caps what is *rendered* without touching what is *loaded*. The full list
 * stays in memory and in the offline cache, so search, filters, counts and the
 * outbox overlay all still see every row — only the slice on screen is smaller.
 * That distinction is what makes this safe to add to an existing page.
 *
 * Deliberately not windowing (react-window and friends): a virtualiser has to
 * own the scroll container and know each row's height, which would mean
 * rewriting these pages and adding a dependency. Showing more on demand gets
 * most of the benefit and changes nothing about how the page is built.
 *
 * @param {unknown[]} rows the full, already-filtered list
 * @param {number} step how many to add at a time
 * @returns {{ visible: unknown[], hasMore: boolean, showMore: () => void, remaining: number }}
 */
export function useVisibleRows(rows, step = 30) {
  const [limit, setLimit] = useState(step)
  const total = rows?.length ?? 0

  // A new filter or search term is a new list, so the window starts again —
  // otherwise narrowing a search would leave an unrelated "show more" count
  // behind, and widening it would silently reveal rows the person never asked
  // to expand.
  useEffect(() => {
    setLimit(step)
  }, [total, step])

  const visible = total > limit ? rows.slice(0, limit) : rows
  return {
    visible,
    hasMore: total > limit,
    remaining: Math.max(0, total - limit),
    showMore: () => setLimit((value) => value + step),
  }
}
