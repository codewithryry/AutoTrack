import { ROLE } from '../utils/constants'
import { supabase, TABLES } from '../supabase/config'

/**
 * Data layer — Supabase Postgres.
 *
 * Keeps the exact public API every service above it already uses: `list`,
 * `get`, `insert`, `update`, `runAtomic`, `subscribe`, `setScope` and the rest.
 * `tools.js`, `transactions.js`, `users.js`, `notifications.js`, `reports.js`,
 * `settings.js`, `activity.js` and `data/seed.js` are unchanged, because this is
 * the only module that knows where records live.
 *
 * Naming
 * ------
 * The application speaks camelCase and its own collection names; Postgres uses
 * snake_case tables. Both directions are converted here, so neither side bends
 * to the other and a column rename never reaches a screen.
 *
 * Authorisation
 * -------------
 * `setScope()` is kept because callers rely on it, but it is no longer the
 * boundary: Row Level Security decides what a request may see, server-side,
 * from the caller's own `profiles` row. A student issuing "select all
 * transactions" now receives only their own rows rather than being refused —
 * the scope is applied as a query filter where it helps the database, never as
 * the thing standing between a role and someone else's data.
 */

const STAFF_ROLES = [ROLE.ADMIN, ROLE.INSTRUCTOR]

export const COLLECTIONS = {
  users: 'users',
  tools: 'tools',
  transactions: 'transactions',
  notifications: 'notifications',
  maintenance: 'maintenance',
  activityLogs: 'activityLogs',
  settings: 'settings',
}

export const ALL_COLLECTIONS = Object.values(COLLECTIONS)

export class DataError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'DataError'
    this.cause = cause
    this.code = cause?.code
  }
}

/** Postgres error codes the user can do something about. */
const FRIENDLY = {
  '42501': 'Your account is not allowed to do that. Ask the laboratory administrator to check your role.',
  PGRST301: 'Your session has expired. Sign in again to continue.',
  '23505': 'That record already exists.',
  '23503': 'Another record still refers to this one, so it cannot be removed.',
  '23514': 'Those details are not valid for this record.',
}

function wrap(error, what) {
  if (error instanceof DataError) return error
  const friendly = FRIENDLY[error?.code]
  const err = new DataError(friendly ?? error?.message ?? `Could not ${what}.`, error)
  err.code = error?.code
  return err
}

const tableFor = (name) => {
  const table = TABLES[name]
  if (!table) throw new DataError(`Unknown collection "${name}".`)
  return table
}

/* ------------------------------------------------------------------ *
 * Naming: camelCase <-> snake_case
 * ------------------------------------------------------------------ */

const toSnake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())

/** A record on its way to Postgres. */
function toRow(document) {
  if (!document) return document
  const row = {}
  for (const [key, value] of Object.entries(document)) {
    if (value === undefined) continue
    row[toSnake(key)] = value
  }
  return row
}

/** A row on its way back to the application. */
function toDoc(row) {
  if (!row) return row
  const document = {}
  for (const [key, value] of Object.entries(row)) document[toCamel(key)] = value
  return document
}

const toDocs = (rows) => (rows ?? []).map(toDoc)

/* ------------------------------------------------------------------ *
 * Access scope
 * ------------------------------------------------------------------ */

/** @type {{ uid: string|null, role: string|null }} */
let scope = { uid: null, role: null }

/**
 * Point the data layer at the signed-in user. Called by the app shell whenever
 * the session or the user's profile changes.
 */
export function setScope({ uid = null, role = null } = {}) {
  if (scope.uid === uid && scope.role === role) return
  scope = { uid, role }
  emit('*')
}

export function clearScope() {
  setScope({ uid: null, role: null })
}

export const currentScope = () => ({ ...scope })

const isStaff = () => STAFF_ROLES.includes(scope.role)

/**
 * Narrow a query the way the policies will anyway.
 *
 * This is an optimisation and a clarity measure, not a security boundary: RLS
 * returns the same rows with or without it. Sending the filter means the
 * database does the work near the data instead of shipping rows that policies
 * would then drop.
 */
function scopedQuery(name, query) {
  if (isStaff() || !scope.role || !scope.uid) return query

  switch (name) {
    case COLLECTIONS.transactions:
      return query.eq('user_id', scope.uid)
    case COLLECTIONS.notifications:
      return query.or(`user_id.eq.${scope.uid},user_id.is.null`)
    case COLLECTIONS.users:
      return query.eq('id', scope.uid)
    default:
      return query
  }
}

/**
 * Collections a non-staff role cannot read at all. The policies refuse these
 * too; short-circuiting saves a round trip that can only come back empty.
 */
const deniedForRole = (name) =>
  !isStaff() &&
  scope.role &&
  (name === COLLECTIONS.maintenance || name === COLLECTIONS.activityLogs)

/* ------------------------------------------------------------------ *
 * Change notification
 * ------------------------------------------------------------------ */

const listeners = new Set()

/** Subscribe to data changes. The listener receives a collection name or '*'. */
export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(name) {
  for (const listener of listeners) {
    try {
      listener(name)
    } catch (err) {
      console.error('[db] a change listener threw', err)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function list(name) {
  if (deniedForRole(name)) return []
  try {
    const { data, error } = await scopedQuery(name, supabase.from(tableFor(name)).select('*'))
    if (error) throw error
    return toDocs(data)
  } catch (err) {
    throw wrap(err, `read "${name}"`)
  }
}

export async function listMany(names) {
  const entries = await Promise.all(names.map(async (name) => [name, await list(name)]))
  return Object.fromEntries(entries)
}

export async function get(name, id) {
  if (id == null || deniedForRole(name)) return null
  try {
    const { data, error } = await scopedQuery(
      name,
      supabase.from(tableFor(name)).select('*').eq('id', id),
    ).maybeSingle()
    if (error) throw error
    return toDoc(data) ?? null
  } catch (err) {
    throw wrap(err, `read ${name}/${id}`)
  }
}

/**
 * Read a record ignoring the current scope.
 *
 * Used for the signed-in user's own profile at sign-in, when the scope cannot
 * be set yet because the role is not known. RLS still applies — the policies
 * permit reading your own profile, and nothing else this bypasses.
 */
export async function getDirect(name, id) {
  if (id == null) return null
  try {
    const { data, error } = await supabase
      .from(tableFor(name))
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return toDoc(data) ?? null
  } catch (err) {
    throw wrap(err, `read ${name}/${id}`)
  }
}

/** Filter in the client. The predicate is a JS function, so the rows come first. */
export async function query(name, predicate) {
  const rows = await list(name)
  return rows.filter(predicate)
}

export async function exists(name, id) {
  return (await get(name, id)) != null
}

/**
 * A targeted server-side query. Same `[field, op, value]` signature the callers
 * already use, translated to PostgREST filters.
 */
export async function findWhere(name, filters = [], { max } = {}) {
  if (deniedForRole(name)) return []
  try {
    let builder = supabase.from(tableFor(name)).select('*')
    for (const [field, op, value] of filters) {
      const column = toSnake(field)
      switch (op) {
        case '==': builder = value === null ? builder.is(column, null) : builder.eq(column, value); break
        case '!=': builder = value === null ? builder.not(column, 'is', null) : builder.neq(column, value); break
        case '>': builder = builder.gt(column, value); break
        case '>=': builder = builder.gte(column, value); break
        case '<': builder = builder.lt(column, value); break
        case '<=': builder = builder.lte(column, value); break
        case 'in': builder = builder.in(column, value); break
        case 'not-in': builder = builder.not(column, 'in', `(${value.join(',')})`); break
        case 'array-contains': builder = builder.contains(column, [value]); break
        default: throw new DataError(`Unsupported filter operator "${op}".`)
      }
    }
    builder = scopedQuery(name, builder)
    if (max) builder = builder.limit(max)
    const { data, error } = await builder
    if (error) throw error
    return toDocs(data)
  } catch (err) {
    throw wrap(err, `search "${name}"`)
  }
}

/* ------------------------------------------------------------------ *
 * Schema capability
 * ------------------------------------------------------------------ */

/** One answer per column, per session. */
const columnSupport = new Map()

/**
 * Whether a table really has a column.
 *
 * Migrations are applied by hand in the SQL editor, so a deployed bundle can be
 * ahead of the database it is talking to. Writing an unknown column would fail
 * the whole statement with `42703` — which, on the borrow path, would mean a
 * pending migration silently breaks issuing tools. Asking once, cheaply, lets a
 * feature that depends on a new column switch itself off instead.
 *
 * The probe is a `head` select: no rows are transferred, and RLS applies to it
 * exactly as it does to any other read, so a `false` from a permission error is
 * indistinguishable from a missing column — and both mean the same thing to the
 * caller, which is "do not try to write this".
 */
export async function supportsColumn(name, field) {
  const column = toSnake(field)
  const key = `${name}.${column}`
  if (columnSupport.has(key)) return columnSupport.get(key)

  const answer = (async () => {
    try {
      const { error } = await supabase
        .from(tableFor(name))
        .select(column, { head: true, count: undefined })
        .limit(1)
      // 42703 is "undefined column"; PGRST204 is PostgREST's schema-cache miss
      // for the same thing.
      if (error && (error.code === '42703' || error.code === 'PGRST204')) return false
      if (error) throw error
      return true
    } catch (err) {
      console.warn(`[db] could not confirm ${key}; treating it as absent`, err)
      return false
    }
  })()

  columnSupport.set(key, answer)
  return answer
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export async function insert(name, document) {
  if (!document?.id) throw new DataError(`Cannot insert into "${name}" without an id.`)
  try {
    const { data, error } = await supabase
      .from(tableFor(name))
      .insert(toRow(document))
      .select()
      .single()
    if (error) throw error
    emit(name)
    return toDoc(data)
  } catch (err) {
    throw wrap(err, `save the ${name} record`)
  }
}

export async function insertMany(name, documents) {
  if (!documents?.length) return []
  for (const document of documents) {
    if (!document?.id) throw new DataError(`Cannot insert into "${name}" without an id.`)
  }
  try {
    const { data, error } = await supabase
      .from(tableFor(name))
      .insert(documents.map(toRow))
      .select()
    if (error) throw error
    emit(name)
    return toDocs(data)
  } catch (err) {
    throw wrap(err, `save the ${name} records`)
  }
}

export async function update(name, id, patch) {
  try {
    const { id: _ignored, ...fields } = patch ?? {}
    const { data, error } = await supabase
      .from(tableFor(name))
      .update(toRow(fields))
      .eq('id', id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) throw new DataError(`No record "${id}" in "${name}".`)
    emit(name)
    return toDoc(data)
  } catch (err) {
    throw wrap(err, `update ${name}/${id}`)
  }
}

export async function upsert(name, document) {
  if (!document?.id) throw new DataError(`Cannot upsert into "${name}" without an id.`)
  try {
    const { data, error } = await supabase
      .from(tableFor(name))
      .upsert(toRow(document), { onConflict: 'id' })
      .select()
      .single()
    if (error) throw error
    emit(name)
    return toDoc(data)
  } catch (err) {
    throw wrap(err, `save the ${name} record`)
  }
}

export async function remove(name, id) {
  try {
    const { data, error } = await supabase
      .from(tableFor(name))
      .delete()
      .eq('id', id)
      .select()
    if (error) throw error
    emit(name)
    return (data?.length ?? 0) > 0
  } catch (err) {
    throw wrap(err, `delete ${name}/${id}`)
  }
}

/**
 * Call a server-side function.
 *
 * The one place the app steps outside the table API: account deletion runs as a
 * SECURITY DEFINER function because removing the sign-in credential is not
 * something the anon key — or Row Level Security — can express.
 */
export async function rpc(name, payload = {}) {
  try {
    const { data, error } = await supabase.rpc(name, payload)
    if (error) throw error
    return data
  } catch (err) {
    throw wrap(err, `run ${name}`)
  }
}

/** Deletes matching a client-side predicate: the rows are fetched, then removed. */
export async function removeWhere(name, predicate) {
  const rows = await list(name)
  const doomed = rows.filter(predicate).map((row) => row.id)
  if (!doomed.length) return 0
  try {
    const { error } = await supabase.from(tableFor(name)).delete().in('id', doomed)
    if (error) throw error
    emit(name)
    return doomed.length
  } catch (err) {
    throw wrap(err, `delete from "${name}"`)
  }
}

export async function replaceAll(name, documents) {
  await clearCollection(name)
  return insertMany(name, documents)
}

export async function clearCollection(name) {
  try {
    // `delete()` requires a filter; every id is non-null, so this matches all
    // rows the caller is allowed to remove.
    const { error } = await supabase.from(tableFor(name)).delete().not('id', 'is', null)
    if (error) throw error
    emit(name)
  } catch (err) {
    throw wrap(err, `clear "${name}"`)
  }
}

export async function clearAll() {
  // Children before parents: transactions and maintenance reference tools.
  const order = [
    COLLECTIONS.activityLogs,
    COLLECTIONS.notifications,
    COLLECTIONS.transactions,
    COLLECTIONS.maintenance,
    COLLECTIONS.tools,
    COLLECTIONS.settings,
  ]
  for (const name of order) await clearCollection(name)
  emit('*')
}

/**
 * Run `fn` as one step.
 *
 * Postgres has transactions; PostgREST does not expose them to the client, so
 * this cannot be one. Instead every write is journalled and undone in reverse
 * if the callback throws, which preserves what callers depend on: a loan record
 * and the tool's status never drift apart.
 *
 * What it does *not* provide is isolation against a concurrent writer. The
 * check that stops the same tool being issued twice therefore lives in the
 * database: `tools_update` and its trigger only allow `Available -> Borrowed`,
 * so the second writer is refused by the policy rather than overwriting the
 * first.
 */
export async function runAtomic(fn) {
  /** @type {Array<() => Promise<void>>} */
  const undo = []

  const helper = {
    async get(name, id) {
      return getDirect(name, id)
    },
    async set(name, document) {
      const before = await getDirect(name, document.id)
      await upsert(name, document)
      undo.push(async () => {
        if (before) await upsert(name, before)
        else await remove(name, document.id)
      })
    },
    async update(name, id, patch) {
      const before = await getDirect(name, id)
      await update(name, id, patch)
      if (before) undo.push(async () => void (await upsert(name, before)))
    },
    async remove(name, id) {
      const before = await getDirect(name, id)
      await remove(name, id)
      if (before) undo.push(async () => void (await insert(name, before)))
    },
  }

  try {
    const result = await fn(helper)
    emit('*')
    return result
  } catch (err) {
    for (const step of undo.reverse()) {
      await step().catch((rollbackError) =>
        console.error('[db] could not roll back part of a failed operation', rollbackError),
      )
    }
    emit('*')
    throw wrap(err, 'complete the operation')
  }
}

/* ------------------------------------------------------------------ *
 * Housekeeping
 * ------------------------------------------------------------------ */

export async function stats() {
  const entries = await Promise.all(
    ALL_COLLECTIONS.map(async (name) => {
      if (deniedForRole(name)) return [name, 0]
      const { count, error } = await supabase
        .from(tableFor(name))
        .select('id', { count: 'exact', head: true })
      return [name, error ? 0 : (count ?? 0)]
    }),
  )
  return Object.fromEntries(entries)
}

export async function exportDatabase() {
  const collections = await listMany(ALL_COLLECTIONS)
  return { exportedAt: new Date().toISOString(), collections }
}

export async function importDatabase(payload) {
  const incoming = payload?.collections ?? payload
  if (!incoming || typeof incoming !== 'object') {
    throw new DataError('That file does not contain a laboratory database export.')
  }
  // Parents before children, so foreign keys resolve.
  const order = [
    COLLECTIONS.tools,
    COLLECTIONS.transactions,
    COLLECTIONS.maintenance,
    COLLECTIONS.notifications,
    COLLECTIONS.activityLogs,
    COLLECTIONS.settings,
  ]
  for (const name of order) {
    if (Array.isArray(incoming[name]) && incoming[name].length) {
      await insertMany(name, incoming[name])
    }
  }
  emit('*')
  return stats()
}
