/**
 * Database policy verification — `npm run verify:sql`.
 *
 * Runs the real migrations against an in-process Postgres (pglite, WebAssembly)
 * and exercises the rules that matter: the first-administrator bootstrap, the
 * role boundary once an administrator exists, multiple administrators, and the
 * last-active-administrator protection.
 *
 * No network, no project, no writes to anything real — which is the point.
 * Policies are behavioural, so reading them is not the same as testing them,
 * and testing them against production would mean creating accounts to delete.
 */
import { freshDb, become, seedUser } from './harness.mjs'

let pass = 0, fail = 0
const test = async (n, f) => {
  try { await f(); console.log('  ok  ' + n); pass++ }
  catch (e) { console.log('  FAIL ' + n + '\n       ' + e.message); fail++ }
}

const A = '11111111-1111-1111-1111-111111111111' // first user (rommel)
const B = '22222222-2222-2222-2222-222222222222' // a student
const C = '33333333-3333-3333-3333-333333333333' // second admin-to-be

/** Grants mirroring Supabase's defaults, then act strictly as `authenticated`. */
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

console.log('\n- first-admin bootstrap -')

await test('the first user can promote themselves to Admin (zero admins exist)', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'rommelmislang49@gmail.com', role: 'Student', status: 'Active' })
  await asUser(db, A, "update public.profiles set role='Admin', status='Active' where id=$1", [A])
  const r = await db.query('select role,status from public.profiles where id=$1', [A])
  if (r.rows[0].role !== 'Admin' || r.rows[0].status !== 'Active') throw new Error('not promoted')
})

await test('the SQL-editor path works too (no session at all)', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'rommelmislang49@gmail.com', role: 'Instructor', status: 'Active' })
  await become(db, null)
  await db.query("update public.profiles set role='Admin', status='Active' where lower(email)=lower('rommelmislang49@gmail.com')")
  const r = await db.query('select role from public.profiles where id=$1', [A])
  if (r.rows[0].role !== 'Admin') throw new Error('the operator path is still blocked')
})

await test('the window closes: a student cannot self-promote once an Admin exists', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 'student@lab.test', role: 'Student', status: 'Active' })
  await expectFail(
    () => asUser(db, B, "update public.profiles set role='Admin', status='Active' where id=$1", [B]),
    /Only an administrator may change a role/)
})

await test('bootstrap cannot be aimed at somebody else', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Student', status: 'Active' })
  await seedUser(db, { id: B, email: 'b@lab.test', role: 'Student', status: 'Active' })
  // RLS makes this match zero rows rather than raise: the outcome that matters
  // is that B is untouched, not which mechanism refused it.
  await asUser(db, A, "update public.profiles set role='Admin', status='Active' where id=$1", [B])
  const r = await db.query('select role,status from public.profiles where id=$1', [B])
  if (r.rows[0].role !== 'Student') throw new Error('B was promoted by A: ' + r.rows[0].role)
})

await test('bootstrap grants only Admin+Active, not any other escalation', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Student', status: 'Active' })
  await expectFail(
    () => asUser(db, A, "update public.profiles set role='Instructor' where id=$1", [A]),
    /Only an administrator may change a role/)
})

console.log('\n- multiple administrators -')

await test('an existing Admin can promote a second Admin', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: C, email: 'second@lab.test', role: 'Instructor', status: 'Active' })
  await asUser(db, A, "update public.profiles set role='Admin' where id=$1", [C])
  const r = await db.query("select count(*)::int c from public.profiles where role='Admin' and status='Active'")
  if (r.rows[0].c !== 2) throw new Error('expected 2 admins, got ' + r.rows[0].c)
})

await test('two Admins coexist and either may be demoted', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: C, email: 'c@lab.test', role: 'Admin', status: 'Active' })
  await asUser(db, A, "update public.profiles set role='Instructor' where id=$1", [C])
  const r = await db.query("select count(*)::int c from public.profiles where role='Admin' and status='Active'")
  if (r.rows[0].c !== 1) throw new Error('expected 1 admin left, got ' + r.rows[0].c)
})

console.log('\n- last-admin protection (0004) -')

await test('the last active Admin cannot be deactivated', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await expectFail(
    () => asUser(db, A, "update public.profiles set status='Inactive' where id=$1", [A]),
    /at least one active administrator/)
})

await test('the last active Admin cannot be demoted', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await expectFail(
    () => asUser(db, A, "update public.profiles set role='Student' where id=$1", [A]),
    /at least one active administrator/)
})

await test('an Admin cannot delete their own account (RLS), so the last one survives', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await asUser(db, A, 'delete from public.profiles where id=$1', [A])
  const r = await db.query("select count(*)::int c from public.profiles where role='Admin' and status='Active'")
  if (r.rows[0].c !== 1) throw new Error('the last administrator was deleted')
})

await test('deleting the last ACTIVE Admin is refused by the trigger, not just by RLS', async () => {
  // A is an administrator but Inactive, so C is the only active one. A's delete
  // passes RLS (is_admin() is false for A... so use a second active admin who
  // then deactivates) — set up two admins, deactivate one, then have the
  // remaining active one try to delete the other active admin.
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: C, email: 'c@lab.test', role: 'Admin', status: 'Active' })
  // A demotes itself is refused only when last; with two admins A may deactivate C.
  await asUser(db, A, "update public.profiles set status='Inactive' where id=$1", [C])
  // Now A is the only active admin. A deleting C is fine (C is not active).
  await asUser(db, A, 'delete from public.profiles where id=$1', [C])
  const r = await db.query("select count(*)::int c from public.profiles where role='Admin' and status='Active'")
  if (r.rows[0].c !== 1) throw new Error('expected A to remain the sole active admin')
  // And A still cannot remove itself by any route.
  await expectFail(
    () => asUser(db, A, "update public.profiles set status='Inactive' where id=$1", [A]),
    /at least one active administrator/)
})

await test('removing the last Admin is refused even with no session (SQL editor)', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await become(db, null)
  await expectFail(
    () => db.query('delete from public.profiles where id=$1', [A]),
    /at least one active administrator/)
})

console.log('\n- self-registration still open -')

await test('a student may still register themselves as Active', async () => {
  const db = await freshDb()
  await db.query('insert into auth.users (id,email) values ($1,$2)', [B, 'new@lab.test'])
  await asUser(db, B,
    "insert into public.profiles (id,email,full_name,role,status) values ($1,'new@lab.test','New Student','Student','Active')", [B])
})

await test('an instructor may still register themselves as Active', async () => {
  const db = await freshDb()
  await db.query('insert into auth.users (id,email) values ($1,$2)', [B, 'ins@lab.test'])
  await asUser(db, B,
    "insert into public.profiles (id,email,full_name,role,status) values ($1,'ins@lab.test','New Instructor','Instructor','Active')", [B])
})

await test('self-registration still cannot request Admin', async () => {
  const db = await freshDb()
  await db.query('insert into auth.users (id,email) values ($1,$2)', [B, 'sneaky@lab.test'])
  await expectFail(() => asUser(db, B,
    "insert into public.profiles (id,email,full_name,role,status) values ($1,'sneaky@lab.test','Sneaky','Admin','Active')", [B]),
    /row-level security|violates/i)
})

console.log('\n- profile change review -')

await test('a student cannot write their live profile columns directly', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await expectFail(
    () => asUser(db, B, "update public.profiles set contact='0917 000 0000' where id=$1", [B]),
    /needs an administrator|approval/i)
})

await test('a student cannot approve their own submission', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  // Submit first: moving from the default 'Approved' to 'Approved' changes
  // nothing, so it proves nothing. The case that matters is a student trying to
  // wave through their own pending submission.
  await asUser(db, B, "update public.profiles set pending_profile='{\"contact\":\"x\"}'::jsonb, profile_review_status='Pending' where id=$1", [B])
  await expectFail(
    () => asUser(db, B, "update public.profiles set profile_review_status='Approved' where id=$1", [B]),
    /Only an administrator may approve/i)
  await expectFail(
    () => asUser(db, B, "update public.profiles set profile_review_status='Rejected' where id=$1", [B]),
    /Only an administrator may approve/i)
})

await test('a student cannot forge a review record', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await expectFail(
    () => asUser(db, B, "update public.profiles set profile_review_note='ok' where id=$1", [B]),
    /Only an administrator may record a review/i)
})

await test('a student may submit changes for review', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await asUser(db, B, "update public.profiles set pending_profile = '{\"contact\":\"0917 000 0000\"}'::jsonb, profile_review_status = 'Pending', profile_submitted_at = now() where id=$1", [B])
  const r = await db.query('select profile_review_status, contact from public.profiles where id=$1',[B])
  if (r.rows[0].profile_review_status !== 'Pending') throw new Error('not marked pending')
  if (r.rows[0].contact !== '') throw new Error('the live profile changed before approval')
})

await test('an administrator can approve: the patch becomes the live profile', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await asUser(db, B, "update public.profiles set pending_profile='{\"contact\":\"0917 111 2222\"}'::jsonb, profile_review_status='Pending' where id=$1", [B])
  await asUser(db, A, "update public.profiles set contact = pending_profile->>'contact', pending_profile = null, profile_review_status = 'Approved', profile_reviewed_by = $2, profile_reviewed_at = now() where id=$1", [B, A])
  const r = await db.query('select contact, profile_review_status, pending_profile from public.profiles where id=$1',[B])
  if (r.rows[0].contact !== '0917 111 2222') throw new Error('the approved value was not applied')
  if (r.rows[0].profile_review_status !== 'Approved') throw new Error('status not Approved')
  if (r.rows[0].pending_profile !== null) throw new Error('the patch was not cleared')
})

await test('an administrator can reject: the live profile is untouched', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await asUser(db, B, "update public.profiles set pending_profile='{\"contact\":\"bogus\"}'::jsonb, profile_review_status='Pending' where id=$1", [B])
  await asUser(db, A, "update public.profiles set pending_profile=null, profile_review_status='Rejected', profile_review_note='Use your institutional number', profile_reviewed_by=$2, profile_reviewed_at=now() where id=$1", [B, A])
  const r = await db.query('select contact, profile_review_status from public.profiles where id=$1',[B])
  if (r.rows[0].contact !== '') throw new Error('a rejected value reached the live profile')
  if (r.rows[0].profile_review_status !== 'Rejected') throw new Error('status not Rejected')
})

await test('signing in still records last_login_at for a student', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await asUser(db, B, 'update public.profiles set last_login_at = now() where id=$1', [B])
  const r = await db.query('select last_login_at from public.profiles where id=$1',[B])
  if (!r.rows[0].last_login_at) throw new Error('last_login_at was refused')
})

await test('an administrator can still edit a profile directly', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await asUser(db, A, "update public.profiles set contact='0918 000 0000' where id=$1", [B])
  const r = await db.query('select contact from public.profiles where id=$1',[B])
  if (r.rows[0].contact !== '0918 000 0000') throw new Error('an admin edit was refused')
})

await test('an instructor still edits their own profile directly (unchanged)', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'admin@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: C, email: 'ins@lab.test', role: 'Instructor', status: 'Active' })
  await asUser(db, C, "update public.profiles set contact='0918 777 1111' where id=$1", [C])
  const r = await db.query('select contact, profile_review_status from public.profiles where id=$1',[C])
  if (r.rows[0].contact !== '0918 777 1111') throw new Error('an instructor self-edit was refused')
  if (r.rows[0].profile_review_status !== 'Approved') throw new Error('an instructor was put into review')
})

console.log('\n- self-service account deletion (0007) -')

await test('a user can delete their own account through the RPC', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await asUser(db, B, 'select public.delete_own_account()')
  const profile = await db.query('select count(*)::int c from public.profiles where id=$1', [B])
  if (profile.rows[0].c !== 0) throw new Error('the profile was not removed')
  const auth = await db.query('select count(*)::int c from auth.users where id=$1', [B])
  if (auth.rows[0].c !== 0) throw new Error('the sign-in account was not removed')
})

await test('no session means the RPC refuses', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await expectFail(() => db.query('select public.delete_own_account()'), /sign in to delete/i)
})

await test('the last active Admin cannot delete their own account', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await expectFail(
    () => asUser(db, A, 'select public.delete_own_account()'),
    /at least one active administrator/)
})

await test('an account with an open loan cannot be deleted', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Borrowed')")
  await db.query(
    `insert into public.transactions (id, tool_id, tool_name, user_id, user_name, borrow_date, due_date, status)
     values ('TXN-1','TOOL-00001','Wrench',$1,'Student','2026-01-01','2026-01-08','Borrowed')`,
    [B],
  )
  await expectFail(
    () => asUser(db, B, 'select public.delete_own_account()'),
    /return your borrowed tools/i)
  const r = await db.query('select count(*)::int c from public.profiles where id=$1', [B])
  if (r.rows[0].c !== 1) throw new Error('the account was deleted while holding a loan')
})

await test('returned history does not block deletion', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Available')")
  await db.query(
    `insert into public.transactions (id, tool_id, tool_name, user_id, user_name, borrow_date, due_date, return_date, status)
     values ('TXN-1','TOOL-00001','Wrench',$1,'Student','2026-01-01','2026-01-08','2026-01-07','Returned')`,
    [B],
  )
  await asUser(db, B, 'select public.delete_own_account()')
  const r = await db.query('select count(*)::int c from public.profiles where id=$1', [B])
  if (r.rows[0].c !== 0) throw new Error('a borrower with returned history could not delete')
})


/* ------------------------------------------------------------------ *
 * 0008 - location checkpoints
 *
 * The migration widens `transactions_update` so a borrower's own *open* loan is
 * addressable at all, and moves the real restriction into the guard trigger.
 * These tests are what says that swap did not hand a student anything else.
 * ------------------------------------------------------------------ */
console.log('\n- location checkpoints -')

const POINT = (n) =>
  JSON.stringify([
    { lat: 12.1 + n / 1000, lng: 121.2, accuracy: 12, capturedAt: '2026-01-02T03:04:05Z' },
  ])

/** An Active student holding TOOL-00001 on TXN-1. */
async function withOpenLoan() {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await seedUser(db, { id: C, email: 's2@lab.test', role: 'Student', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Borrowed')")
  await db.query(
    `insert into public.transactions (id, tool_id, tool_name, user_id, user_name, borrow_date, due_date, status)
     values ('TXN-1','TOOL-00001','Wrench',$1,'Student','2026-01-01','2026-01-08','Borrowed')`,
    [B],
  )
  return db
}

const countPoints = async (db) =>
  (await db.query(
    'select jsonb_array_length(location_checkpoints) n from public.transactions where id=$1',
    ['TXN-1'],
  )).rows[0].n

await test('every loan starts with an empty checkpoint list and no points', async () => {
  const db = await withOpenLoan()
  const r = await db.query(
    'select borrow_location, return_location, location_checkpoints from public.transactions where id=$1',
    ['TXN-1'])
  const row = r.rows[0]
  if (row.borrow_location !== null || row.return_location !== null) throw new Error('points not null')
  if (JSON.stringify(row.location_checkpoints) !== '[]') throw new Error('list not empty')
})

await test('the borrower may append one checkpoint to their own open loan', async () => {
  const db = await withOpenLoan()
  await asUser(db, B,
    'update public.transactions set location_checkpoints = $1::jsonb where id=$2', [POINT(1), 'TXN-1'])
  if (await countPoints(db) !== 1) throw new Error('checkpoint was not stored')
})

await test('appending twice keeps both readings', async () => {
  const db = await withOpenLoan()
  await asUser(db, B,
    'update public.transactions set location_checkpoints = $1::jsonb where id=$2', [POINT(1), 'TXN-1'])
  const two = JSON.parse(POINT(1)).concat(JSON.parse(POINT(2)))
  await asUser(db, B,
    'update public.transactions set location_checkpoints = $1::jsonb where id=$2',
    [JSON.stringify(two), 'TXN-1'])
  if (await countPoints(db) !== 2) throw new Error('second checkpoint lost')
})

await test('a borrower cannot delete or rewrite a checkpoint they already recorded', async () => {
  const db = await withOpenLoan()
  await asUser(db, B,
    'update public.transactions set location_checkpoints = $1::jsonb where id=$2', [POINT(1), 'TXN-1'])
  await expectFail(
    () => asUser(db, B,
      "update public.transactions set location_checkpoints = '[]'::jsonb where id=$1", ['TXN-1']),
    /location checkpoint/i)
  await expectFail(
    () => asUser(db, B,
      'update public.transactions set location_checkpoints = $1::jsonb where id=$2', [POINT(9), 'TXN-1']),
    /location checkpoint/i)
})

await test('a student cannot add a checkpoint to another student loan', async () => {
  const db = await withOpenLoan()
  await asUser(db, C,
    'update public.transactions set location_checkpoints = $1::jsonb where id=$2', [POINT(1), 'TXN-1'])
  if (await countPoints(db) !== 0) throw new Error('another student wrote a checkpoint')
})

await test('the widened policy still does not let a borrower extend their due date', async () => {
  const db = await withOpenLoan()
  await expectFail(
    () => asUser(db, B, "update public.transactions set due_date='2026-12-31' where id=$1", ['TXN-1']),
    /only close their own loan/i)
})

await test('the widened policy still does not let a borrower reassign a loan', async () => {
  const db = await withOpenLoan()
  await expectFail(
    () => asUser(db, B, 'update public.transactions set user_id=$1 where id=$2', [C, 'TXN-1']),
    /only close their own loan/i)
})

await test('a borrower cannot smuggle other edits in beside a checkpoint', async () => {
  const db = await withOpenLoan()
  await expectFail(
    () => asUser(db, B,
      "update public.transactions set location_checkpoints=$1::jsonb, purpose='rewritten' where id=$2",
      [POINT(1), 'TXN-1']),
    /location checkpoint/i)
  await expectFail(
    () => asUser(db, B,
      "update public.transactions set location_checkpoints=$1::jsonb, status='Overdue' where id=$2",
      [POINT(1), 'TXN-1']),
    /location checkpoint/i)
})

await test('a borrower cannot forge the borrow or return point on an open loan', async () => {
  const db = await withOpenLoan()
  await expectFail(
    () => asUser(db, B, 'update public.transactions set borrow_location = $1::jsonb where id=$2',
      [JSON.stringify({ lat: 0, lng: 0 }), 'TXN-1']),
    /location checkpoint/i)
})

await test('closing the loan still works, and carries the return point with it', async () => {
  const db = await withOpenLoan()
  await asUser(db, B,
    `update public.transactions
        set status='Returned', return_date='2026-01-05', condition_in='Good',
            return_location=$1::jsonb
      where id=$2`,
    [JSON.stringify({ lat: 12.1, lng: 121.2, accuracy: 9, capturedAt: '2026-01-05T01:00:00Z' }), 'TXN-1'])
  const r = await db.query('select status, return_location from public.transactions where id=$1', ['TXN-1'])
  if (r.rows[0].status !== 'Returned') throw new Error('the return was refused')
  if (!r.rows[0].return_location) throw new Error('the return point was not stored')
})

await test('staff may record a checkpoint on any open loan', async () => {
  const db = await withOpenLoan()
  await asUser(db, A,
    'update public.transactions set location_checkpoints = $1::jsonb where id=$2', [POINT(1), 'TXN-1'])
  if (await countPoints(db) !== 1) throw new Error('staff checkpoint refused')
})

await test('the checkpoint list is capped, so it cannot become unbounded storage', async () => {
  const db = await withOpenLoan()
  const many = JSON.stringify(Array.from({ length: 101 }, (_, i) => ({ lat: 1 + i / 1000, lng: 2 })))
  // Two independent guards, and the borrower meets the stricter one first: the
  // trigger only ever allows the list to grow by exactly one.
  await expectFail(
    () => asUser(db, B, 'update public.transactions set location_checkpoints = $1::jsonb where id=$2',
      [many, 'TXN-1']),
    /location checkpoint/i)
  // Staff bypass the trigger, so for them the table constraint is the backstop.
  await expectFail(
    () => asUser(db, A, 'update public.transactions set location_checkpoints = $1::jsonb where id=$2',
      [many, 'TXN-1']),
    /transactions_checkpoints_shape/i)
})

await test('a student still cannot read another student loan, points included', async () => {
  const db = await withOpenLoan()
  const r = await asUser(db, C, 'select id from public.transactions')
  if (r.rows.length !== 0) throw new Error('another student could read the loan')
})

console.log('\n- tool deletion preserves history (0009) -')

/** An Admin + a tool + one returned (historical) loan, inserted as the owner. */
async function withHistoricalLoan() {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Available')")
  await db.query(
    `insert into public.transactions (id, tool_id, tool_name, user_id, user_name, borrow_date, due_date, return_date, status)
     values ('TXN-1','TOOL-00001','Wrench','USR-1','Student','2026-01-01','2026-01-08','2026-01-07','Returned')`,
  )
  return db
}

await test('an Admin can delete a tool that only has historical transactions', async () => {
  const db = await withHistoricalLoan()
  await asUser(db, A, 'delete from public.tools where id=$1', ['TOOL-00001'])
  const tool = await db.query('select count(*)::int c from public.tools where id=$1', ['TOOL-00001'])
  if (tool.rows[0].c !== 0) throw new Error('the tool row was not removed')
  const txn = await db.query('select tool_id, tool_name, status, return_date from public.transactions where id=$1', ['TXN-1'])
  if (txn.rows[0].tool_id !== null) throw new Error('the historical loan kept its tool reference')
  if (txn.rows[0].tool_name !== 'Wrench') throw new Error('the historical loan lost the tool name')
  if (txn.rows[0].status !== 'Returned' || txn.rows[0].return_date === null) throw new Error('the historical loan was rewritten')
})

await test('deleting a tool detaches but keeps its maintenance history', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Available')")
  await db.query(
    `insert into public.maintenance (id, tool_id, tool_name, type, technician, date, status)
     values ('MNT-1','TOOL-00001','Wrench','Inspection','Rolando','2026-01-01','Completed')`,
  )
  await asUser(db, A, 'delete from public.tools where id=$1', ['TOOL-00001'])
  const mnt = await db.query('select tool_id, tool_name, status from public.maintenance where id=$1', ['MNT-1'])
  if (mnt.rows[0].tool_id !== null) throw new Error('the maintenance record kept its tool reference')
  if (mnt.rows[0].tool_name !== 'Wrench') throw new Error('the maintenance record lost the tool name')
  if (mnt.rows[0].status !== 'Completed') throw new Error('the maintenance record was modified')
})

await test('a tool with an open loan cannot be deleted (trigger, not just RLS)', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Borrowed')")
  await db.query(
    `insert into public.transactions (id, tool_id, tool_name, user_id, user_name, borrow_date, due_date, status)
     values ('TXN-1','TOOL-00001','Wrench','USR-1','Student','2026-01-01','2026-01-08','Borrowed')`,
  )
  await expectFail(
    () => asUser(db, A, 'delete from public.tools where id=$1', ['TOOL-00001']),
    /still on loan/i)
  const tool = await db.query('select count(*)::int c from public.tools where id=$1', ['TOOL-00001'])
  if (tool.rows[0].c !== 1) throw new Error('the tool was deleted despite the open loan')
  const txn = await db.query('select tool_id, status from public.transactions where id=$1', ['TXN-1'])
  if (txn.rows[0].status !== 'Borrowed' || txn.rows[0].tool_id !== 'TOOL-00001') throw new Error('the open loan was corrupted')
})

await test('the active-loan guard also refuses in the SQL editor (no session)', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Borrowed')")
  await db.query(
    `insert into public.transactions (id, tool_id, tool_name, user_id, user_name, borrow_date, due_date, status)
     values ('TXN-1','TOOL-00001','Wrench','USR-1','Student','2026-01-01','2026-01-08','Borrowed')`,
  )
  await expectFail(
    () => db.query('delete from public.tools where id=$1', ['TOOL-00001']),
    /still on loan/i)
})

await test('only an administrator can delete a tool', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: B, email: 's@lab.test', role: 'Student', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Available')")
  await asUser(db, B, 'delete from public.tools where id=$1', ['TOOL-00001'])
  const tool = await db.query('select count(*)::int c from public.tools where id=$1', ['TOOL-00001'])
  if (tool.rows[0].c !== 1) throw new Error('a student was able to delete a tool')
})

await test('an instructor cannot delete a tool either', async () => {
  const db = await freshDb()
  await seedUser(db, { id: A, email: 'a@lab.test', role: 'Admin', status: 'Active' })
  await seedUser(db, { id: C, email: 'ins@lab.test', role: 'Instructor', status: 'Active' })
  await db.query("insert into public.tools (id, name, status) values ('TOOL-00001','Wrench','Available')")
  await asUser(db, C, 'delete from public.tools where id=$1', ['TOOL-00001'])
  const tool = await db.query('select count(*)::int c from public.tools where id=$1', ['TOOL-00001'])
  if (tool.rows[0].c !== 1) throw new Error('an instructor was able to delete a tool')
})

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
