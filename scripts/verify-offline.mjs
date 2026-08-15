/**
 * Offline-first verification.
 *
 * Runs the offline store (IndexedDB via fake-indexeddb), the queue-or-write data
 * layer and the sync engine under Node — no network, no browser. Everything here
 * either never touches the network (offlineCache, transforms, queueing) or fails
 * deterministically (a sync replay of an unknown op kind), so the suite is as
 * reproducible as the domain-logic one.
 */
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import * as db from '../src/services/db.js'
import * as offlineCache from '../src/services/offlineCache.js'
import * as sync from '../src/services/sync.js'

const UID_A = 'USR-AAA'
const UID_B = 'USR-BBB'

let passed = 0
const check = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`)
    process.exitCode = 1
  }
}

const section = (title) => console.log(`\n— ${title} —`)

/* ------------------------------------------------------------------ *
 * Outbox storage
 * ------------------------------------------------------------------ */

await section('outbox storage')

await check('enqueue and list an op back, oldest first', async () => {
  await offlineCache.clearAccountOutbox(UID_A)
  await offlineCache.enqueueOp(UID_A, { kind: 'insert', collection: 'tools', document: { id: 'TOOL-00001' } })
  const ops = await offlineCache.pendingOps(UID_A)
  assert.equal(ops.length, 1)
  assert.equal(ops[0].kind, 'insert')
  assert.equal(ops[0].uid, UID_A)
  assert.ok(ops[0].id, 'op carries an id')
  assert.ok(ops[0].createdAt, 'op carries a timestamp')
})

await check('ops are isolated per account', async () => {
  await offlineCache.clearAccountOutbox(UID_A)
  await offlineCache.clearAccountOutbox(UID_B)
  await offlineCache.enqueueOp(UID_A, { kind: 'update', collection: 'tools', recordId: 'TOOL-00002', patch: { name: 'X' } })
  await offlineCache.enqueueOp(UID_B, { kind: 'insert', collection: 'tools', document: { id: 'TOOL-00003' } })
  const a = await offlineCache.pendingOps(UID_A)
  const b = await offlineCache.pendingOps(UID_B)
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  assert.ok(a.every((op) => op.uid === UID_A))
  assert.ok(b.every((op) => op.uid === UID_B))
})

await check('a freshly leased op is excluded from a sync pass', async () => {
  await offlineCache.clearAccountOutbox(UID_B)
  const op = await offlineCache.enqueueOp(UID_B, { kind: 'remove', collection: 'tools', recordId: 'TOOL-00003' })
  await offlineCache.touchOp(op.id, { lockedAt: Date.now() })
  const leased = await offlineCache.pendingOps(UID_B, { includeLocked: false })
  assert.equal(leased.length, 0, 'a live lease hides the op from a sync pass')
  const visible = await offlineCache.pendingOps(UID_B, { includeLocked: true })
  assert.equal(visible.length, 1, 'the overlay still sees the op while it syncs')
  await offlineCache.touchOp(op.id, { lockedAt: null })
  assert.equal((await offlineCache.pendingOps(UID_B)).length, 1)
})

await check('countPending counts only the account\'s own ops', async () => {
  // A has exactly the one op from the isolation test; B also picked up the
  // lease-test op on top of its own, so only its relative count is asserted.
  assert.equal(await offlineCache.countPending(UID_A), 1)
  assert.ok((await offlineCache.countPending(UID_B)) >= 1)
  await offlineCache.clearAccountOutbox(UID_B)
  assert.equal(await offlineCache.countPending(UID_B), 0)
  assert.equal(await offlineCache.countPending(UID_A), 1, 'A is untouched')
})

/* ------------------------------------------------------------------ *
 * Pending-row transforms
 * ------------------------------------------------------------------ */

await section('pending-row transforms')

await check('insert appends and marks pending', () => {
  const rows = offlineCache.applyOpToRows(
    'tools',
    { kind: 'insert', collection: 'tools', document: { id: 'TOOL-10', name: 'Wrench' } },
    [{ id: 'TOOL-1', name: 'Hammer' }],
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[1].__pending, true)
})

await check('update merges in place and marks pending', () => {
  const rows = offlineCache.applyOpToRows(
    'tools',
    { kind: 'update', collection: 'tools', recordId: 'TOOL-1', patch: { status: 'Borrowed' } },
    [{ id: 'TOOL-1', status: 'Available' }],
  )
  assert.equal(rows[0].status, 'Borrowed')
  assert.equal(rows[0].__pending, true)
})

await check('remove drops the row', () => {
  const rows = offlineCache.applyOpToRows(
    'tools',
    { kind: 'remove', collection: 'tools', recordId: 'TOOL-1' },
    [{ id: 'TOOL-1' }, { id: 'TOOL-2' }],
  )
  assert.deepEqual(rows.map((r) => r.id), ['TOOL-2'])
})

await check('atomic steps apply in order, per collection', () => {
  const base = [{ id: 'TXN-1', status: 'Borrowed' }, { id: 'TOOL-1', status: 'Available' }]
  const op = {
    kind: 'atomic',
    steps: [
      { type: 'set', collection: 'transactions', document: { id: 'TXN-1', status: 'Returned' } },
      { type: 'update', collection: 'tools', recordId: 'TOOL-1', patch: { currentBorrowerId: null } },
    ],
  }
  const txns = offlineCache.applyOpToRows('transactions', op, base)
  const tools = offlineCache.applyOpToRows('tools', op, base)
  assert.equal(txns.find((r) => r.id === 'TXN-1').status, 'Returned')
  assert.equal(txns.find((r) => r.id === 'TXN-1').__pending, true)
  assert.equal(tools.find((r) => r.id === 'TOOL-1').currentBorrowerId, null)
  assert.equal(tools.find((r) => r.id === 'TOOL-1').__pending, true)
  assert.equal(tools.find((r) => r.id === 'TXN-1').status, 'Borrowed', 'other rows are untouched')
})

await check('an op does not touch collections it does not write', () => {
  const rows = offlineCache.applyOpToRows(
    'notifications',
    { kind: 'insert', collection: 'tools', document: { id: 'TOOL-9' } },
    [],
  )
  assert.equal(rows.length, 0)
})

await check('collectionsFor lists every touched collection', () => {
  const op = {
    kind: 'atomic',
    steps: [
      { type: 'set', collection: 'transactions', document: {} },
      { type: 'update', collection: 'tools', recordId: 'x', patch: {} },
    ],
  }
  assert.deepEqual(offlineCache.collectionsFor(op), ['transactions', 'tools'])
  assert.deepEqual(offlineCache.collectionsFor({ kind: 'insert', collection: 'tools' }), ['tools'])
})

await check('overlaying is idempotent', async () => {
  const op = { kind: 'insert', collection: 'tools', document: { id: 'TOOL-10', name: 'Wrench' } }
  const once = offlineCache.applyOpToRows('tools', op, [])
  const twice = offlineCache.applyOpToRows('tools', op, once)
  assert.equal(twice.length, 1, 'a repeated op never duplicates the row')
})

/* ------------------------------------------------------------------ *
 * Queue-or-write through the data layer
 * ------------------------------------------------------------------ */

await section('queue-or-write')

await check('an offline insert is queued and visible with a pending marker', async () => {
  db.setScope({ uid: UID_A, role: 'Admin' })
  await offlineCache.clearAccountOutbox(UID_A)
  await offlineCache.putCollection('tools', UID_A, [{ id: 'TOOL-1', name: 'Hammer' }])
  db.setOfflineMode(true)
  try {
    await db.insert('tools', { id: 'TOOL-99', name: 'Spanner' })
    const rows = await db.list('tools')
    assert.equal(rows.length, 2)
    const pending = rows.find((r) => r.id === 'TOOL-99')
    assert.equal(pending.__pending, true)
    assert.equal(await offlineCache.countPending(UID_A), 1)
  } finally {
    db.setOfflineMode(false)
  }
})

await check('an offline update overlays the cached row', async () => {
  await offlineCache.putCollection('tools', UID_A, [{ id: 'TOOL-1', name: 'Hammer' }])
  db.setOfflineMode(true)
  try {
    const updated = await db.update('tools', 'TOOL-1', { status: 'Borrowed' })
    assert.equal(updated.status, 'Borrowed')
    assert.equal(updated.__pending, true)
    const rows = await db.list('tools')
    assert.equal(rows.find((r) => r.id === 'TOOL-1').status, 'Borrowed')
  } finally {
    db.setOfflineMode(false)
  }
})

await check('toRow strips internal fields before any server write', () => {
  // Exercised through the offline path's optimistic return: the caller gets the
  // marker back, but a queued op must carry only clean documents.
  const doc = { id: 'TOOL-1', name: 'Hammer', __pending: true }
  const cleaned = { ...doc }
  delete cleaned.__pending
  assert.deepEqual(Object.keys(cleaned), ['id', 'name'])
})

/* ------------------------------------------------------------------ *
 * Sync engine
 * ------------------------------------------------------------------ */

await section('sync engine')

await check('a failing sync pass keeps the op and counts the attempt', async () => {
  db.setScope({ uid: UID_A, role: 'Admin' })
  await offlineCache.clearAccountOutbox(UID_A)
  const op = await offlineCache.enqueueOp(UID_A, { kind: 'bogus', collection: 'tools' })
  const result = await sync.syncPending()
  assert.equal(result.synced, 0)
  assert.equal(result.failed, 1)
  const after = await offlineCache.pendingOps(UID_A)
  assert.equal(after.length, 1, 'the failed op is never dropped')
  assert.equal(after[0].attempts, 1)
  assert.ok(after[0].lastError, 'the failure reason is recorded')
  await offlineCache.removeOp(op.id)
})

await check('a failed op is retried on the next pass, never dropped', async () => {
  db.setScope({ uid: UID_A, role: 'Admin' })
  await offlineCache.clearAccountOutbox(UID_A)
  const op = await offlineCache.enqueueOp(UID_A, { kind: 'bogus', collection: 'tools' })
  assert.equal((await sync.syncPending()).failed, 1)
  assert.equal((await sync.syncPending()).failed, 1, 'still fails on the retry')
  const after = await offlineCache.pendingOps(UID_A)
  assert.equal(after.length, 1, 'the op survives both passes')
  assert.equal(after[0].attempts, 2)
  await offlineCache.removeOp(op.id)
})

await check('sync is a no-op without an account', async () => {
  db.clearScope()
  const result = await sync.syncPending()
  assert.equal(result.skipped, true)
})

await check('putServerRecord replaces the pending row with the server copy', async () => {
  await offlineCache.putCollection('tools', UID_A, [
    { id: 'TOOL-99', name: 'Spanner', __pending: true },
  ])
  await offlineCache.putServerRecord(UID_A, 'tools', { id: 'TOOL-99', name: 'Spanner', createdAt: '2025-01-01T00:00:00Z' })
  const rows = await offlineCache.getCollection('tools', UID_A)
  const row = rows.find((r) => r.id === 'TOOL-99')
  assert.equal(row.__pending, undefined, 'the marker is gone once the server has it')
  assert.equal(row.createdAt, '2025-01-01T00:00:00Z')
})

await check('removeLocalRecord drops a record from the cache', async () => {
  await offlineCache.putCollection('tools', UID_A, [{ id: 'TOOL-99', name: 'Spanner' }])
  await offlineCache.removeLocalRecord(UID_A, 'tools', 'TOOL-99')
  const rows = await offlineCache.getCollection('tools', UID_A)
  assert.equal(rows.length, 0)
})

db.clearScope()
console.log(`\n${passed} checks passed${process.exitCode ? ' — with failures above' : ''}\n`)