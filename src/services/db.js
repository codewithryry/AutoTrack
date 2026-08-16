import { ROLE } from '../utils/constants'
import { supabase, TABLES } from '../supabase/config'
import * as offlineCache from './offlineCache'
import { PENDING_FLAG } from './offlineCache'

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

/* ------------------------------------------------------------------ *
 * Working without a connection
 * ------------------------------------------------------------------ */

/**
 * Offline mode, set from the shell's Settings page. It is deliberately separate
 * from `navigator.onLine`: the device's real connectivity is still detected and
 * still decides whether a write can be attempted, while this flag is the
 * student's own instruction to read from the copy on this device.
 */
let offlineMode = false

export function setOfflineMode(value) {
  const next = !!value
  if (offlineMode === next) return
  offlineMode = next
  emit('*') // every open screen re-reads through the new source
}

/** True when nothing should be asked of the network. */
const isOffline = () =>
  offlineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)

/**
 * Did this request fail because it never reached the server?
 *
 * Supabase surfaces a lost connection as a `TypeError: Failed to fetch` from the
 * underlying `fetch`, with no Postgres code — a rejection from the database
 * always carries one, so the two are distinguishable without guessing.
 *
 * Exported for the sync engine, which stops a pass when the network has gone.
 */
export function isNetworkError(error) {
  if (!error) return false
  if (error.code) return false
  const message = String(error.message ?? '').toLowerCase()
  return (
    error.name === 'TypeError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('load failed') ||
    message.includes('network request failed')
  )
}

/**
 * Ordinary writes do not reach here: they queue in the outbox and sync later.
 * This guards the destructive, whole-collection operations that replaying could
 * never make safe — clearing, replacing or exporting the laboratory database.
 */
function assertWritable(what) {
  if (!isOffline()) return
  throw new DataError(
    `Cannot ${what} while offline. The change needs the laboratory database — ` +
      'reconnect and try again.',
  )
}

/**
 * Queue a mutation for the sync engine and reflect it in the cache immediately,
 * so every open screen shows the change while it waits to reach the server.
 */
async function enqueueAndApply(op) {
  try {
    await offlineCache.enqueueOp(scope.uid ?? null, op)
  } catch (err) {
    // IndexedDB unavailable: the change would be lost, so it must fail loudly
    // rather than pretend it was saved.
    throw new DataError(
      'This device cannot store the change while offline. Reconnect and try again.',
      err,
    )
  }
  await offlineCache.applyOpToCache(scope.uid ?? null, op)
  emit(op.kind === 'atomic' ? '*' : op.collection)
}

export const COLLECTIONS = {
  users: 'users',
  tools: 'tools',
  transactions: 'transactions',
  notifications: 'notifications',
  maintenance: 'maintenance',
  activityLogs: 'activityLogs',
  settings: 'settings',
  toolRequests: 'toolRequests',
  reservations: 'reservations',
  conversations: 'conversations',
  conversationParticipants: 'conversationParticipants',
  messages: 'messages',
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

/** A record on its way to Postgres. Internal (`__`-prefixed) fields never leave. */
function toRow(document) {
  if (!document) return document
  const row = {}
  for (const [key, value] of Object.entries(document)) {
    if (key.startsWith('__')) continue
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
  // An instructor reads the laboratory's operational stream, not the account and
  // profile-approval decisions an administrator addresses to individual
  // students — so their notification query is narrowed to the broadcasts plus
  // their own, the same shape `notifications.listFor` enforces. Every other
  // collection keeps the staff-wide read they already had.
  if (name === COLLECTIONS.notifications && scope.role === ROLE.INSTRUCTOR && scope.uid) {
    return query.or(`user_id.eq.${scope.uid},user_id.is.null`)
  }
  // An instructor's directory is the students in it, plus their own row. The
  // `profiles_select` policy says exactly the same and is what actually refuses
  // an administrator's or another instructor's record; this only keeps the work
  // near the data instead of asking for rows the server would drop anyway.
  if (name === COLLECTIONS.users && scope.role === ROLE.INSTRUCTOR && scope.uid) {
    return query.or(`role.eq.${ROLE.STUDENT},id.eq.${scope.uid}`)
  }
  if (isStaff() || !scope.role || !scope.uid) return query

  switch (name) {
    case COLLECTIONS.transactions:
      return query.eq('user_id', scope.uid)
    case COLLECTIONS.notifications:
      return query.or(`user_id.eq.${scope.uid},user_id.is.null`)
    case COLLECTIONS.users:
      // The directory is readable by every signed-in account, so that anybody
      // can be named when a conversation is started. `0013` says the same on
      // the server; changing a profile is still the owner's alone.
      return query
    // A student's requests and holds are their own; the policies say the same,
    // and sending the filter keeps the work near the data.
    case COLLECTIONS.toolRequests:
    case COLLECTIONS.reservations:
      return query.eq('user_id', scope.uid)
    default:
      // Conversations, their participants and messages are scoped by
      // membership, which is a join the policies already do — there is no
      // column here to filter on, so the query goes as it is.
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

  // Offline mode is answered from the cache without touching the network at
  // all — that is what makes it work with no connection rather than merely
  // looking as though it has none.
  if (isOffline()) return cachedOrFail(name)

  try {
    const { data, error } = await scopedQuery(name, supabase.from(tableFor(name)).select('*'))
    if (error) throw error
    const rows = toDocs(data)
    return overlayAndCache(name, rows, scope.uid)
  } catch (err) {
    // A request that never reached the server is a connectivity failure, not a
    // rejection: serve the last copy rather than an error the student cannot act
    // on. A real refusal from Postgres still surfaces.
    if (isNetworkError(err)) return cachedOrFail(name)
    throw wrap(err, `read "${name}"`)
  }
}

/**
 * Merge the account's queued changes over a freshly-read set of rows, cache the
 * merged view, and return it. Caching the merged view keeps the offline copy in
 * step with the pending changes even before they sync.
 */
async function overlayAndCache(name, rows, uid) {
  const overlaid = await offlineCache.overlayPendingRows(uid, name, rows)
  // Best-effort and not awaited on the read path, so a slow disk never delays a
  // screen.
  void offlineCache.putCollection(name, uid, overlaid)
  return overlaid
}

/**
 * The cached copy of a collection — with any pending changes overlaid — or an
 * honest failure.
 *
 * A collection that has never been read on this device is missing, not empty —
 * reporting it as an empty laboratory would be a lie the student would act on.
 */
async function cachedOrFail(name) {
  const rows = await offlineCache.getCollection(name, scope.uid)
  if (!rows) {
    throw new DataError(
      `"${name}" has not been downloaded to this device yet, so it cannot be opened offline. ` +
        'Reconnect once to store a copy.',
    )
  }
  return offlineCache.overlayPendingRows(scope.uid, name, rows)
}

export async function listMany(names) {
  const entries = await Promise.all(names.map(async (name) => [name, await list(name)]))
  return Object.fromEntries(entries)
}

export async function get(name, id) {
  if (id == null || deniedForRole(name)) return null
  if (isOffline()) return cachedRecord(name, id)
  try {
    const { data, error } = await scopedQuery(
      name,
      supabase.from(tableFor(name)).select('*').eq('id', id),
    ).maybeSingle()
    if (error) throw error
    const doc = toDoc(data) ?? null
    const overlaid = await offlineCache.overlayPendingRows(scope.uid, name, doc ? [doc] : [])
    return overlaid.find((row) => row.id === id) ?? null
  } catch (err) {
    if (isNetworkError(err)) return cachedRecord(name, id)
    throw wrap(err, `read ${name}/${id}`)
  }
}

/** One record out of the cached collection, or `null` if it was never stored. */
async function cachedRecord(name, id) {
  return cachedRecordFor(name, id, scope.uid)
}

/** The same, under an account id given explicitly rather than from the scope. */
async function cachedRecordFor(name, id, uid) {
  const rows = await offlineCache.getCollection(name, uid)
  if (!rows) return null
  const overlaid = await offlineCache.overlayPendingRows(uid, name, rows)
  return overlaid.find((row) => row.id === id) ?? null
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
  // Offline, the copy on this device is the answer. The scope is not set yet at
  // sign-in — that is the whole reason this function exists — so the cache is
  // read under the record's own id, which for the signed-in user's profile *is*
  // their account id, the key the cache is partitioned by.
  if (isOffline()) return cachedRecordFor(name, id, id)
  try {
    const { data, error } = await supabase
      .from(tableFor(name))
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    const doc = toDoc(data) ?? null
    // Keep a copy against the next launch without a connection. This is the one
    // read every session makes before anything else, and for a student it is
    // the only one that ever touches their own profile row — without this the
    // cache would have nothing to answer with offline.
    if (doc) {
      // `putServerRecord` only updates a collection the cache already holds, and
      // a student never lists the directory, so seed it here rather than relying
      // on one having been stored.
      try {
        const rows = (await offlineCache.getCollection(name, id)) ?? []
        await offlineCache.putCollection(name, id, [
          ...rows.filter((row) => row.id !== doc.id),
          doc,
        ])
      } catch {
        // No IndexedDB on this device: the app still works online, and offline
        // it will simply have nothing to restore from.
      }
    }
    return doc
  } catch (err) {
    // The connection went while the app was open, or the device came back
    // reporting online before it really was. Same answer as above.
    if (isNetworkError(err)) return cachedRecordFor(name, id, id)
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
  if (isOffline()) {
    const rows = await query(name, predicateForFilters(filters))
    return max ? rows.slice(0, max) : rows
  }
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
    return offlineCache.overlayPendingRows(scope.uid, name, toDocs(data))
  } catch (err) {
    throw wrap(err, `search "${name}"`)
  }
}

/** The client-side equivalent of the filters above, used for offline queries. */
function predicateForFilters(filters = []) {
  return (row) =>
    filters.every(([field, op, value]) => {
      const actual = row[field]
      switch (op) {
        case '==': return actual === value
        case '!=': return actual !== value
        case '>': return actual > value
        case '>=': return actual >= value
        case '<': return actual < value
        case '<=': return actual <= value
        case 'in': return Array.isArray(value) && value.includes(actual)
        case 'not-in': return Array.isArray(value) && !value.includes(actual)
        case 'array-contains': return Array.isArray(actual) && actual.includes(value)
        default: return true
      }
    })
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
  const op = { kind: 'insert', collection: name, document }
  if (isOffline()) {
    await enqueueAndApply(op)
    return { ...document, [PENDING_FLAG]: true }
  }
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
    if (isNetworkError(err)) {
      await enqueueAndApply(op)
      return { ...document, [PENDING_FLAG]: true }
    }
    throw wrap(err, `save the ${name} record`)
  }
}

export async function insertMany(name, documents) {
  if (!documents?.length) return []
  for (const document of documents) {
    if (!document?.id) throw new DataError(`Cannot insert into "${name}" without an id.`)
  }
  const op = { kind: 'insertMany', collection: name, documents }
  if (isOffline()) {
    await enqueueAndApply(op)
    return documents.map((document) => ({ ...document, [PENDING_FLAG]: true }))
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
    if (isNetworkError(err)) {
      await enqueueAndApply(op)
      return documents.map((document) => ({ ...document, [PENDING_FLAG]: true }))
    }
    throw wrap(err, `save the ${name} records`)
  }
}

const stripId = (patch) => {
  const { id: _ignored, ...fields } = patch ?? {}
  return fields
}

export async function update(name, id, patch) {
  const fields = stripId(patch)
  const op = { kind: 'update', collection: name, recordId: id, patch: fields }
  if (isOffline()) {
    const next = await optimisticUpdate(name, id, fields)
    await enqueueAndApply(op)
    return next
  }
  try {
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
    if (isNetworkError(err)) {
      const next = await optimisticUpdate(name, id, fields)
      await enqueueAndApply(op)
      return next
    }
    throw wrap(err, `update ${name}/${id}`)
  }
}

/** The optimistic shape of an update: what the caller will see before sync. */
async function optimisticUpdate(name, id, fields) {
  const current = await get(name, id)
  const merged = current ? { ...current, ...fields } : { id, ...fields }
  return { ...merged, [PENDING_FLAG]: true }
}

export async function upsert(name, document) {
  if (!document?.id) throw new DataError(`Cannot upsert into "${name}" without an id.`)
  const op = { kind: 'upsert', collection: name, document }
  if (isOffline()) {
    await enqueueAndApply(op)
    return { ...document, [PENDING_FLAG]: true }
  }
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
    if (isNetworkError(err)) {
      await enqueueAndApply(op)
      return { ...document, [PENDING_FLAG]: true }
    }
    throw wrap(err, `save the ${name} record`)
  }
}

export async function remove(name, id) {
  const op = { kind: 'remove', collection: name, recordId: id }
  if (isOffline()) {
    await enqueueAndApply(op)
    return true
  }
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
    if (isNetworkError(err)) {
      await enqueueAndApply(op)
      return true
    }
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
  assertWritable(`run ${name}`)
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
  const op = { kind: 'removeMany', collection: name, ids: doomed }
  if (isOffline()) {
    await enqueueAndApply(op)
    return doomed.length
  }
  try {
    const { error } = await supabase.from(tableFor(name)).delete().in('id', doomed)
    if (error) throw error
    emit(name)
    return doomed.length
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueAndApply(op)
      return doomed.length
    }
    throw wrap(err, `delete from "${name}"`)
  }
}

export async function replaceAll(name, documents) {
  await clearCollection(name)
  return insertMany(name, documents)
}

export async function clearCollection(name) {
  assertWritable(`clear the ${name} records`)
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

/**
 * Every stored record, in the order the references allow.
 *
 * Accounts are deliberately absent. `profiles` is who may sign in — clearing it
 * would lock the laboratory out of its own database — and the profile pictures
 * in the `avatars` bucket belong to those accounts, so neither the rows nor the
 * objects are touched here. Everything else the app writes is: the messaging
 * threads, the requests and the holds behind them, the loans, the inventory,
 * servicing, alerts, the activity log and the settings document.
 */
const CLEARABLE = [
  // Messaging: messages reference their conversation, participants reference
  // both, so they go first.
  COLLECTIONS.messages,
  COLLECTIONS.conversationParticipants,
  COLLECTIONS.conversations,
  // The borrowing chain: a hold points at a request, a request at a tool.
  COLLECTIONS.reservations,
  COLLECTIONS.toolRequests,
  COLLECTIONS.activityLogs,
  COLLECTIONS.notifications,
  COLLECTIONS.transactions,
  COLLECTIONS.maintenance,
  COLLECTIONS.tools,
  COLLECTIONS.settings,
]

export async function clearAll() {
  // A collection this database does not have yet — a migration not applied —
  // must not stop the rest from being cleared, so each one is reported and
  // skipped rather than aborting the sweep.
  const failed = []
  for (const name of CLEARABLE) {
    try {
      await clearCollection(name)
    } catch (err) {
      console.warn(`[db] "${name}" could not be cleared`, err)
      failed.push(name)
    }
  }
  emit('*')
  if (failed.length === CLEARABLE.length) {
    throw new DataError('Nothing could be cleared. Check your connection and your permissions.')
  }
  return { cleared: CLEARABLE.filter((name) => !failed.includes(name)), failed }
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
  if (isOffline()) {
    // No connection: record every step the callback takes instead of executing
    // them, then queue the whole group as one op so the loan record and the
    // tool's status sync together and can never drift apart.
    const steps = []
    const recording = {
      async get(name, id) {
        return get(name, id)
      },
      async set(name, document) {
        steps.push({ type: 'set', collection: name, document })
      },
      async update(name, id, patch) {
        steps.push({ type: 'update', collection: name, recordId: id, patch: stripId(patch) })
      },
      async remove(name, id) {
        steps.push({ type: 'remove', collection: name, recordId: id })
      },
    }
    const result = await fn(recording)
    await enqueueAndApply({ kind: 'atomic', steps })
    return result
  }

  assertWritable('complete that change')
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
 * Direct server writes — for the sync engine only
 *
 * The public write functions above queue when the network is down and wrap
 * errors for the UI. These skip both, so the sync engine can replay queued ops
 * exactly, reading raw Postgres error codes (like `23505`) to decide how to
 * proceed. Nothing above the sync engine imports them.
 * ------------------------------------------------------------------ */

export async function insertDirect(name, document) {
  const { data, error } = await supabase
    .from(tableFor(name))
    .insert(toRow(document))
    .select()
    .single()
  if (error) throw error
  emit(name)
  return toDoc(data)
}

export async function updateDirect(name, id, patch) {
  const { data, error } = await supabase
    .from(tableFor(name))
    .update(toRow(stripId(patch)))
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw error
  emit(name)
  // `null` means the server has no such row; the caller treats that as a
  // completed no-op rather than a failure.
  return toDoc(data) ?? null
}

/* ------------------------------------------------------------------ *
 * Push subscriptions
 *
 * Kept out of `COLLECTIONS` deliberately: a subscription is keyed by the
 * endpoint the push service issues rather than by an id, it is never streamed,
 * cached offline or exported, and nothing renders it. These two calls are the
 * whole surface, so the rule that only this module talks to the database holds
 * for them as it does for everything else. The rows themselves are protected by
 * RLS — a caller can only ever write or delete its own.
 * ------------------------------------------------------------------ */

const PUSH_SUBSCRIPTIONS = 'push_subscriptions'

export async function savePushSubscription(row) {
  const { error } = await supabase
    .from(PUSH_SUBSCRIPTIONS)
    .upsert(row, { onConflict: 'endpoint' })
  if (error) throw wrap(error, 'save the push subscription')
}

export async function removePushSubscription(endpoint) {
  const { error } = await supabase.from(PUSH_SUBSCRIPTIONS).delete().eq('endpoint', endpoint)
  if (error) throw wrap(error, 'remove the push subscription')
}

export async function upsertDirect(name, document) {
  const { data, error } = await supabase
    .from(tableFor(name))
    .upsert(toRow(document), { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  emit(name)
  return toDoc(data)
}

export async function removeDirect(name, id) {
  const { data, error } = await supabase.from(tableFor(name)).delete().eq('id', id).select()
  if (error) throw error
  emit(name)
  return (data?.length ?? 0) > 0
}

export async function insertManyDirect(name, documents) {
  if (!documents?.length) return []
  const { data, error } = await supabase
    .from(tableFor(name))
    .insert(documents.map(toRow))
    .select()
  if (error) throw error
  emit(name)
  return toDocs(data)
}

export async function removeManyDirect(name, ids) {
  if (!ids?.length) return 0
  const { data, error } = await supabase.from(tableFor(name)).delete().in('id', ids).select()
  if (error) throw error
  emit(name)
  return data?.length ?? 0
}

/** Tell every open screen to re-read — used once a sync pass finishes. */
export function notifyAll() {
  emit('*')
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

/* ------------------------------------------------------------------ *
 * Live rows
 *
 * Everything above is request/response: a screen re-reads when this client
 * writes, because `emit()` says something changed. A message someone else sends
 * has no such moment, so the tables behind the threads are subscribed to
 * instead — `0012` publishes them, and Realtime applies the same policies per
 * subscriber, so a subscription can only ever deliver rows the caller was
 * already allowed to read.
 *
 * Kept here with every other backend call. A caller names a collection and gets
 * an unsubscribe function; it never sees a channel.
 * ------------------------------------------------------------------ */

/**
 * Watch a collection for changes made anywhere, including by other people.
 *
 * @param {string} name          a COLLECTIONS value
 * @param {(payload: object) => void} [onChange] called with the changed row
 * @param {{ column?: string, value?: string }} [filter] narrow to one parent row
 * @returns {() => void} unsubscribe
 */
/**
 * One open channel per subscription key, shared by everyone watching it.
 *
 * A channel's `postgres_changes` callbacks may only be registered before
 * `subscribe()`, and two components watching the same table would otherwise
 * open two channels on one topic — the second `.on()` then lands after the
 * first has joined and the socket refuses it. So the channel is opened once,
 * its single callback fans out to the watchers, and it is closed again when
 * the last of them leaves.
 */
const openChannels = new Map()

export function watchCollection(name, onChange, filter) {
  const table = tableFor(name)
  // Offline mode never opens a socket: it is the state that means "do not touch
  // the network", and the cache is the source until it is turned off.
  if (isOffline()) return () => {}

  const key = filter?.column
    ? `${table}:${filter.column}=${filter.value}`
    : `${table}:all`

  let entry = openChannels.get(key)
  if (!entry) {
    entry = { channel: null, watchers: new Set() }
    const channel = supabase.channel(`stms:${key}`)
    // Registered before `subscribe()`, once and only once for this key.
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        ...(filter?.column ? { filter: `${filter.column}=eq.${filter.value}` } : {}),
      },
      (payload) => {
        // The same signal a local write raises, so every hook already listening
        // re-reads without knowing where the change came from.
        emit(name)
        const document = toDoc(payload.new ?? payload.old)
        for (const watcher of entry.watchers) {
          try {
            watcher.onChange?.({ ...payload, document })
          } catch (err) {
            console.error('[db] a realtime listener threw', err)
          }
        }
      },
    )
    // A refused or dropped subscription is logged and nothing more: the pages
    // read through `useAsyncData`, which has already loaded, so losing the live
    // feed must never take a screen down with it.
    channel.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn(`[db] realtime for "${key}" is ${status.toLowerCase()}`, err ?? '')
      }
    })
    entry.channel = channel
    openChannels.set(key, entry)
  }

  // An object rather than the callback itself, so two watchers without one are
  // still two entries in the set.
  const watcher = { onChange }
  entry.watchers.add(watcher)

  return () => {
    entry.watchers.delete(watcher)
    if (entry.watchers.size === 0 && openChannels.get(key) === entry) {
      openChannels.delete(key)
      void supabase.removeChannel(entry.channel)
    }
  }
}

/**
 * Announce this account as present, and report who else is.
 *
 * Presence is a property of the connection rather than a row: it disappears
 * when the tab closes, which is exactly what "online" means. An account that is
 * not here is judged on `last_seen_at` instead — see `services/presence.js`.
 *
 * @param {{ uid: string, name?: string, role?: string }} identity
 * @param {(online: string[]) => void} onChange receives the uids present
 * @returns {() => void} leave
 */
/** The one presence channel, shared the same way the collection channels are. */
let presenceEntry = null

export function joinPresence(identity, onChange) {
  if (!identity?.uid || isOffline()) return () => {}

  if (!presenceEntry) {
    const entry = { channel: null, watchers: new Set(), uids: [] }
    const channel = supabase.channel('stms:presence', {
      config: { presence: { key: identity.uid } },
    })

    const report = () => {
      entry.uids = Object.keys(channel.presenceState())
      for (const watcher of entry.watchers) {
        try {
          watcher.onChange?.(entry.uids)
        } catch (err) {
          console.error('[db] a presence listener threw', err)
        }
      }
    }

    channel
      .on('presence', { event: 'sync' }, report)
      .on('presence', { event: 'join' }, report)
      .on('presence', { event: 'leave' }, report)
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[db] presence is ${status.toLowerCase()}`, err ?? '')
          return
        }
        if (status !== 'SUBSCRIBED') return
        void channel.track({
          uid: identity.uid,
          name: identity.name ?? '',
          role: identity.role ?? '',
          at: new Date().toISOString(),
        })
      })

    entry.channel = channel
    presenceEntry = entry
  }

  const entry = presenceEntry
  const watcher = { onChange }
  entry.watchers.add(watcher)
  // A watcher that joins an already-open channel is told who is here now
  // rather than waiting for the next sync.
  if (entry.uids.length) onChange?.(entry.uids)

  return () => {
    entry.watchers.delete(watcher)
    if (entry.watchers.size === 0 && presenceEntry === entry) {
      presenceEntry = null
      void supabase.removeChannel(entry.channel)
    }
  }
}

/* ------------------------------------------------------------------ *
 * File storage
 *
 * The same rule as the tables above: the backend is reached from here and
 * nowhere else, so a bucket is a detail of the data layer rather than something
 * a component or a domain service knows about. Buckets are created by
 * migration; these three only read and write objects inside one.
 * ------------------------------------------------------------------ */

/** Upload a file and return the public URL it is served from. */
export async function uploadFile(bucket, path, file, { contentType, upsert = false } = {}) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: contentType ?? file?.type, upsert })
  if (error) {
    throw new DataError(
      error.message?.includes('Bucket not found')
        ? `Storage bucket "${bucket}" does not exist on this database yet.`
        : (error.message ?? 'The file could not be uploaded.'),
      error,
    )
  }
  return publicFileUrl(bucket, path)
}

/** The public URL for an object, without fetching it. */
export function publicFileUrl(bucket, path) {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

/**
 * A time-limited URL for an object in a private bucket.
 *
 * Message attachments are not public: the object is reachable only through a
 * link minted for a caller the policies already let read it, and that link
 * stops working on its own.
 */
export async function signedFileUrl(bucket, path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds)
  if (error) throw new DataError(error.message ?? 'That file could not be opened.', error)
  return data.signedUrl
}

/** Delete an object. Throws like any other write; callers decide how to react. */
export async function removeFile(bucket, path) {
  const { error } = await supabase.storage.from(bucket).remove([path])
  if (error) throw new DataError(error.message ?? 'The file could not be removed.', error)
  return true
}
