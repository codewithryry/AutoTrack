/**
 * Automatic loan checkpoints — `node scripts/sql/verify-loan-tracking.mjs`
 * (also run by `npm run verify:sql`).
 *
 * Exercises `0038_loan_tracking_checkpoints.sql` against the real migrations in
 * an in-process Postgres: a checkpoint is stored only for the signed-in
 * borrower's own open loan, never twice, never past the cap, and never — by any
 * path — on a loan that has closed.
 */
import { readFileSync } from 'node:fs'
import { freshDb, become, seedUser } from './harness.mjs'

let pass = 0, fail = 0
const test = async (n, f) => {
  try { await f(); console.log('  ok  ' + n); pass++ }
  catch (e) { console.log('  FAIL ' + n + '\n       ' + e.message); fail++ }
}

const ADMIN = '11111111-1111-1111-1111-111111111111'
const STUDENT = '22222222-2222-2222-2222-222222222222'
const OTHER = '33333333-3333-3333-3333-333333333333'

async function asUser(db, uid, sql, params = []) {
  await become(db, uid)
  await db.exec(
    'grant usage on schema public to authenticated;' +
    'grant select,insert,update,delete on all tables in schema public to authenticated;',
  )
  await db.exec('set role authenticated')
  try { return await db.query(sql, params) }
  finally { await db.exec('reset role') }
}

const expectFail = async (fn, re) => {
  try { await fn() } catch (e) {
    if (re && !re.test(e.message)) throw new Error('wrong error: ' + e.message)
    return e.message
  }
  throw new Error('expected this to be refused, but it succeeded')
}

async function trackingDb() {
  const db = await freshDb()
  // 0019 is the current definition of the borrower guard trigger.
  await db.exec(readFileSync('supabase/migrations/0019_return_requests.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/0038_loan_tracking_checkpoints.sql', 'utf8'))
  await seedUser(db, { id: ADMIN, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: STUDENT, email: 'student@lab.test', role: 'Student', status: 'Active' })
  await seedUser(db, { id: OTHER, email: 'other@lab.test', role: 'Student', status: 'Active' })
  await db.query(`insert into public.tools (id, name, status) values ('TOOL-00001', 'Torque Wrench', 'Borrowed')`)
  await db.query(
    `insert into public.transactions (id, tool_id, tool_name, user_id, user_name, borrow_date, due_date, status)
     values ('TXN-1', 'TOOL-00001', 'Torque Wrench', $1, 'student', now() - interval '1 hour', now() + interval '2 days', 'Borrowed')`,
    [STUDENT],
  )
  return db
}

const append = (db, uid, { txn = 'TXN-1', lat = 14.5995, lng = 120.9842, accuracy = 12.5, at = 'now()' } = {}) =>
  asUser(
    db,
    uid,
    `select public.append_loan_checkpoint($1, $2, $3, $4, ${at}) as r`,
    [txn, lat, lng, accuracy],
  ).then((res) => res.rows[0].r)

/** Direct setup writes, as staff so the borrower guard triggers stand aside. */
const setup = async (db, sql, params = []) => {
  await become(db, ADMIN)
  return db.query(sql, params)
}

const checkpoints = async (db, txn = 'TXN-1') =>
  (await db.query('select location_checkpoints c from public.transactions where id = $1', [txn])).rows[0].c

console.log('\n- automatic loan checkpoints (0038) -')

await test('the borrower appends a checkpoint to their own open loan', async () => {
  const db = await trackingDb()
  const r = await append(db, STUDENT)
  if (r.status !== 'saved' || r.count !== 1) throw new Error(JSON.stringify(r))
  const [point] = await checkpoints(db)
  if (point.lat !== 14.5995 || point.lng !== 120.9842 || point.accuracy !== 12.5) {
    throw new Error('coordinates not stored as given: ' + JSON.stringify(point))
  }
  if (point.capturedById !== STUDENT || point.capturedByName !== 'student') {
    throw new Error('capturer not taken from the session: ' + JSON.stringify(point))
  }
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(point.capturedAt)) {
    throw new Error('capturedAt is not in toISOString() form: ' + point.capturedAt)
  }
})

await test('the same reading synced twice is stored once', async () => {
  const db = await trackingDb()
  const at = `'2020-01-01T00:00:00.000Z'::timestamptz`
  await setup(db, `update public.transactions set borrow_date = '2019-12-31T00:00:00Z'`)
  const first = await append(db, STUDENT, { at })
  const second = await append(db, STUDENT, { at })
  if (first.status !== 'saved' || second.status !== 'duplicate') {
    throw new Error(JSON.stringify({ first, second }))
  }
  if ((await checkpoints(db)).length !== 1) throw new Error('a duplicate was stored')
})

await test('another student cannot add a checkpoint to somebody else\'s loan', async () => {
  const db = await trackingDb()
  const r = await append(db, OTHER)
  if (r.status !== 'forbidden') throw new Error(JSON.stringify(r))
  if ((await checkpoints(db)).length !== 0) throw new Error('a stranger wrote a checkpoint')
})

await test('no session is refused', async () => {
  const db = await trackingDb()
  const r = await append(db, null)
  if (r.status !== 'forbidden') throw new Error(JSON.stringify(r))
})

await test('a closed loan gets no checkpoint and reports closed', async () => {
  const db = await trackingDb()
  await asUser(db, ADMIN, `update public.transactions set status = 'Returned', return_date = now() where id = 'TXN-1'`)
  const r = await append(db, STUDENT)
  if (r.status !== 'closed') throw new Error(JSON.stringify(r))
  if ((await checkpoints(db)).length !== 0) throw new Error('a checkpoint landed on a closed loan')
})

await test('a missing loan reports missing', async () => {
  const db = await trackingDb()
  const r = await append(db, STUDENT, { txn: 'TXN-NOPE' })
  if (r.status !== 'missing') throw new Error(JSON.stringify(r))
})

await test('an impossible or out-of-range reading is refused', async () => {
  const db = await trackingDb()
  for (const bad of [
    { lat: 91 },
    { lng: -181 },
    { accuracy: -1 },
    { at: `now() + interval '1 hour'` },
    { at: `now() - interval '5 hours'` }, // before the loan was opened
  ]) {
    const r = await append(db, STUDENT, bad)
    if (r.status !== 'invalid') throw new Error(`${JSON.stringify(bad)} → ${JSON.stringify(r)}`)
  }
  if ((await checkpoints(db)).length !== 0) throw new Error('an invalid reading was stored')
})

await test('the 100-checkpoint cap from 0008 is respected', async () => {
  const db = await trackingDb()
  const full = Array.from({ length: 100 }, (_, i) => ({
    lat: 1, lng: 1, accuracy: 1, capturedAt: new Date(Date.now() - (i + 1) * 1000).toISOString(),
  }))
  await setup(db, `update public.transactions set location_checkpoints = $1::jsonb`, [JSON.stringify(full)])
  const r = await append(db, STUDENT)
  if (r.status !== 'full') throw new Error(JSON.stringify(r))
  if ((await checkpoints(db)).length !== 100) throw new Error('the cap was exceeded')
})

await test('a borrower cannot edit checkpoints on a closed loan by a direct update', async () => {
  const db = await trackingDb()
  await asUser(db, ADMIN, `update public.transactions set status = 'Returned', return_date = now() where id = 'TXN-1'`)
  await expectFail(
    () => asUser(
      db,
      STUDENT,
      `update public.transactions set location_checkpoints = '[{"lat":1,"lng":1,"capturedAt":"2020-01-01T00:00:00.000Z"}]'::jsonb where id = 'TXN-1'`,
    ),
    /closed/,
  )
})

await test('the older direct append still works on an open loan', async () => {
  const db = await trackingDb()
  await asUser(
    db,
    STUDENT,
    `update public.transactions set location_checkpoints = location_checkpoints || '[{"lat":1,"lng":1,"capturedAt":"2020-01-01T00:00:00.000Z"}]'::jsonb where id = 'TXN-1'`,
  )
  if ((await checkpoints(db)).length !== 1) throw new Error('the existing checkpoint path broke')
})

await test('staff can still close a loan that carries checkpoints', async () => {
  const db = await trackingDb()
  await append(db, STUDENT)
  await asUser(db, ADMIN, `update public.transactions set status = 'Returned', return_date = now() where id = 'TXN-1'`)
  const { rows } = await db.query(`select status from public.transactions where id = 'TXN-1'`)
  if (rows[0].status !== 'Returned') throw new Error('the return was blocked')
})

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
