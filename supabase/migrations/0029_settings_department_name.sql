/* ------------------------------------------------------------------ *
 * 0029 — the department link gets a name of its own
 *
 * `0010` added the address. Until now the link was shown under a fixed label,
 * or under the raw URL, so a page called something other than "Department page"
 * could not be named. This adds the name that goes with the address.
 *
 * Optional and empty by default: with no name the address is shown instead, and
 * with no address nothing is rendered at all — exactly as before. The column is
 * asked for the same way `department_url` is (`services/settings.js` →
 * `writableDocument`), so a database that has not had this applied still saves
 * every other setting rather than failing the whole row.
 *
 * Policies are untouched: `settings_select` already lets any active account
 * read the row, and writing stays with the administrator.
 * ------------------------------------------------------------------ */

alter table public.settings
  add column if not exists department_name text not null default '';
