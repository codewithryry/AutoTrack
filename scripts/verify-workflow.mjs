/**
 * End-to-end workflow verification.
 *
 * Runs the real service layer against an in-memory IndexedDB so the complete
 * laboratory workflow — seed → login → borrow → overdue → notify → return →
 * damage → maintenance → persistence — is exercised outside the browser.
 *
 *   node scripts/verify-workflow.mjs      (bundle first — see package.json)
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'

import * as db from '../src/services/db.js'
import { COLLECTIONS } from '../src/services/db.js'
import * as auth from '../src/services/auth.js'
import * as toolService from '../src/services/tools.js'
import * as txnService from '../src/services/transactions.js'
import * as userService from '../src/services/users.js'
import * as notificationService from '../src/services/notifications.js'
import * as maintenanceService from '../src/services/maintenance.js'
import * as activityService from '../src/services/activity.js'
import * as reportService from '../src/services/reports.js'
import { seedDatabase, seedIfEmpty } from '../src/data/seed.js'
import { addDaysISO, toDateInput, fromDateInput, todayInput } from '../src/utils/dates.js'
import { ACTIVITY, CONDITION, ROLE, TOOL_STATUS, TXN_STATUS } from '../src/utils/constants.js'

/* --------------------------- test harness --------------------------- */

let passed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures.push({ name, err })
    console.error(`  FAIL ${name}\n       ${err.message}`)
  }
}

const section = (title) => console.log(`\n— ${title} —`)

// localStorage shim for the auth session
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

/* ------------------------------ run ------------------------------ */

section('database boot and seeding')

await db.ready()
const seeded = await seedIfEmpty()

await test('first launch seeds a populated laboratory', async () => {
  assert.ok(seeded, 'seedIfEmpty returned a summary')
  assert.ok(seeded.tools >= 30, `at least 30 tools (got ${seeded.tools})`)
  assert.ok(seeded.users >= 10, `at least 10 users (got ${seeded.users})`)
  assert.ok(seeded.transactions >= 20, `at least 20 transactions (got ${seeded.transactions})`)
  assert.ok(seeded.notifications >= 10, `at least 10 notifications (got ${seeded.notifications})`)
  assert.ok(seeded.maintenance >= 5, `several maintenance records (got ${seeded.maintenance})`)
})

await test('seeding is idempotent — a second launch does not duplicate', async () => {
  const again = await seedIfEmpty()
  assert.equal(again, null, 'seedIfEmpty is a no-op when data exists')
  assert.equal((await db.list(COLLECTIONS.tools)).length, seeded.tools)
})

await test('every tool has a unique id and a QR payload', async () => {
  const tools = await db.list(COLLECTIONS.tools)
  const ids = new Set(tools.map((t) => t.id))
  assert.equal(ids.size, tools.length, 'tool ids are unique')
  for (const tool of tools) {
    const payload = JSON.parse(tool.qrCode)
    assert.equal(payload.type, 'tool')
    assert.equal(payload.toolId, tool.id)
  }
})

await test('serial numbers are unique across the inventory', async () => {
  const serials = (await db.list(COLLECTIONS.tools))
    .map((t) => t.serialNumber)
    .filter(Boolean)
  assert.equal(new Set(serials).size, serials.length)
})

/* --------------------------- authentication --------------------------- */

section('authentication')

let admin
let instructor
let student

await test('demo accounts sign in with their documented passwords', async () => {
  admin = await auth.login('admin', 'admin123')
  assert.equal(admin.role, ROLE.ADMIN)
  instructor = await auth.login('instructor', 'instructor123')
  assert.equal(instructor.role, ROLE.INSTRUCTOR)
  student = await auth.login('student', 'student123')
  assert.equal(student.role, ROLE.STUDENT)
})

await test('passwords are never exposed to the UI layer', async () => {
  assert.equal(admin.passwordHash, undefined)
  assert.equal(admin.salt, undefined)
  const stored = await db.get(COLLECTIONS.users, admin.id)
  assert.ok(stored.passwordHash?.length === 64, 'stored as a sha-256 hex digest')
  assert.notEqual(stored.passwordHash, 'admin123')
})

await test('a wrong password is rejected without revealing which field failed', async () => {
  await assert.rejects(() => auth.login('admin', 'wrong'), /Incorrect username or password/)
  await assert.rejects(() => auth.login('nobody', 'whatever'), /Incorrect username or password/)
})

await test('the session survives a restart (localStorage round-trip)', async () => {
  await auth.login('admin', 'admin123')
  const restored = await auth.restore()
  assert.equal(restored.username, 'admin')
  auth.logout()
  assert.equal(await auth.restore(), null)
  admin = await auth.login('admin', 'admin123')
})

/* ------------------------------ tools CRUD ------------------------------ */

section('tool CRUD and permissions')

let createdTool

await test('an admin can add a tool and it gets the next sequential id', async () => {
  const nextId = await toolService.nextToolId()
  createdTool = await toolService.create(
    {
      name: 'Cylinder Leak-Down Tester',
      category: 'Diagnostic Tools',
      brand: 'OTC',
      model: 'OTC5609',
      serialNumber: 'OTC-LD-99001',
      location: 'Diagnostic Room',
      condition: CONDITION.EXCELLENT,
      description: 'Dual-gauge leak-down tester for cylinder sealing diagnosis.',
    },
    admin,
  )
  assert.equal(createdTool.id, nextId)
  assert.equal(createdTool.status, TOOL_STATUS.AVAILABLE)
  assert.ok(createdTool.qrCode.includes(createdTool.id))
  assert.ok(await db.exists(COLLECTIONS.tools, createdTool.id))
})

await test('creating a tool writes an activity log entry', async () => {
  const entries = await activityService.listForTool(createdTool.id)
  assert.ok(entries.some((e) => e.action === ACTIVITY.TOOL_CREATED))
})

await test('a duplicate Tool ID is rejected', async () => {
  await assert.rejects(
    () =>
      toolService.create(
        {
          id: createdTool.id,
          name: 'Duplicate',
          category: 'Hand Tools',
          location: 'Tool Room Shelf A',
          condition: CONDITION.GOOD,
        },
        admin,
      ),
    (err) => {
      assert.ok(err.errors?.id?.includes('already exists'))
      return true
    },
  )
})

await test('a duplicate serial number is rejected', async () => {
  await assert.rejects(
    () =>
      toolService.create(
        {
          name: 'Another Leak Tester',
          category: 'Diagnostic Tools',
          location: 'Diagnostic Room',
          condition: CONDITION.GOOD,
          serialNumber: 'OTC-LD-99001',
        },
        admin,
      ),
    (err) => {
      assert.ok(err.errors?.serialNumber)
      return true
    },
  )
})

await test('required fields are validated', async () => {
  await assert.rejects(
    () => toolService.create({ name: '', category: '', location: '', condition: '' }, admin),
    (err) => {
      assert.ok(err.errors.name && err.errors.category && err.errors.location && err.errors.condition)
      return true
    },
  )
})

await test('a student cannot create, edit or delete a tool', async () => {
  await assert.rejects(
    () =>
      toolService.create(
        { name: 'X', category: 'Hand Tools', location: 'Tool Room Shelf A', condition: CONDITION.GOOD },
        student,
      ),
    /administrator|not allowed/i,
  )
  await assert.rejects(
    () => toolService.updateTool(createdTool.id, { name: 'Hacked' }, student),
    /not allowed/i,
  )
  await assert.rejects(() => toolService.remove(createdTool.id, student), /administrator/i)
})

await test('editing a tool records what changed', async () => {
  const updated = await toolService.updateTool(
    createdTool.id,
    { location: 'Engine Bay Cabinet A', condition: CONDITION.GOOD },
    admin,
  )
  assert.equal(updated.location, 'Engine Bay Cabinet A')
  const entries = await activityService.listForTool(createdTool.id)
  assert.ok(entries.some((e) => e.action === ACTIVITY.CONDITION_CHANGED))
  assert.ok(entries.some((e) => e.message.includes('location')))
})

/* ------------------------------ borrowing ------------------------------ */

section('borrowing workflow')

let loanTxn

await test('a student can borrow an available tool for themselves', async () => {
  loanTxn = await txnService.borrow(
    {
      toolId: createdTool.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 3),
      purpose: 'Engine sealing diagnosis practical',
    },
    student,
  )
  assert.equal(loanTxn.status, TXN_STATUS.BORROWED)
  assert.match(loanTxn.id, /^TXN-\d{8}-[0-9A-Z]{6}$/)
  assert.equal(loanTxn.userId, student.id)
  assert.equal(loanTxn.conditionOut, CONDITION.GOOD)
})

await test('borrowing flips the tool status to Borrowed', async () => {
  const tool = await toolService.getById(createdTool.id)
  assert.equal(tool.status, TOOL_STATUS.BORROWED)
})

await test('borrowing writes an activity entry and a notification', async () => {
  const entries = await activityService.listForTool(createdTool.id)
  assert.ok(entries.some((e) => e.action === ACTIVITY.TOOL_BORROWED))
  const notifs = await notificationService.listAll()
  assert.ok(notifs.some((n) => n.transactionId === loanTxn.id && n.type === 'borrowed'))
})

await test('the same tool cannot be borrowed twice', async () => {
  await assert.rejects(
    () =>
      txnService.borrow(
        {
          toolId: createdTool.id,
          userId: instructor.id,
          borrowDate: fromDateInput(todayInput()),
          dueDate: addDaysISO(new Date(), 2),
        },
        instructor,
      ),
    /not available|already/i,
  )
})

await test('a student cannot borrow on behalf of someone else', async () => {
  const spare = (await toolService.listAvailable())[0]
  await assert.rejects(
    () =>
      txnService.borrow(
        {
          toolId: spare.id,
          userId: instructor.id,
          borrowDate: fromDateInput(todayInput()),
          dueDate: addDaysISO(new Date(), 2),
        },
        student,
      ),
    /only borrow tools for themselves/i,
  )
})

await test('an instructor can issue a tool to a student', async () => {
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 2),
      purpose: 'Laboratory activity',
    },
    instructor,
  )
  assert.equal(txn.issuedByName, instructor.fullName)
  assert.equal(txn.userId, student.id)
  await txnService.returnTool({ transactionId: txn.id, condition: CONDITION.GOOD }, instructor)
})

await test('a due date before the borrow date is rejected', async () => {
  const spare = (await toolService.listAvailable())[0]
  await assert.rejects(
    () =>
      txnService.borrow(
        {
          toolId: spare.id,
          userId: student.id,
          borrowDate: fromDateInput(todayInput()),
          dueDate: addDaysISO(new Date(), -2),
        },
        student,
      ),
    (err) => {
      assert.ok(err.errors?.dueDate?.includes('before the borrow date'))
      return true
    },
  )
})

await test('a loan longer than the maximum is rejected', async () => {
  const spare = (await toolService.listAvailable())[0]
  await assert.rejects(
    () =>
      txnService.borrow(
        {
          toolId: spare.id,
          userId: student.id,
          borrowDate: fromDateInput(todayInput()),
          dueDate: addDaysISO(new Date(), 60),
        },
        student,
        { maxDays: 30 },
      ),
    (err) => {
      assert.ok(err.errors?.dueDate?.includes('more than 30 days'))
      return true
    },
  )
})

await test('tools under maintenance, damaged or lost cannot be borrowed', async () => {
  for (const [status, action] of [
    [TOOL_STATUS.MAINTENANCE, toolService.markMaintenance],
    [TOOL_STATUS.DAMAGED, toolService.markDamaged],
    [TOOL_STATUS.LOST, toolService.markLost],
  ]) {
    const spare = (await toolService.listAvailable())[0]
    await action(spare.id, admin, `Blocked-for-test (${status}).`)
    const blocked = await toolService.getById(spare.id)
    assert.equal(blocked.status, status)
    assert.equal(toolService.borrowEligibility(blocked).ok, false)
    await assert.rejects(
      () =>
        txnService.borrow(
          {
            toolId: spare.id,
            userId: student.id,
            borrowDate: fromDateInput(todayInput()),
            dueDate: addDaysISO(new Date(), 2),
          },
          student,
        ),
      /not available|maintenance/i,
    )
    await toolService.restore(spare.id, admin, 'Restored after test.')
  }
})

/* ------------------------------- overdue ------------------------------- */

section('automatic overdue detection')

await test('a loan past its due date becomes Overdue on the next sweep', async () => {
  // Backdate the open loan so today is past the due date.
  await db.update(COLLECTIONS.transactions, loanTxn.id, {
    borrowDate: addDaysISO(new Date(), -6),
    dueDate: addDaysISO(new Date(), -2),
  })

  const result = await txnService.runOverdueCheck({ dueSoonThresholdDays: 1 })
  assert.ok(result.overdue >= 1)

  const txn = await txnService.getById(loanTxn.id)
  assert.equal(txn.status, TXN_STATUS.OVERDUE)
  const tool = await toolService.getById(createdTool.id)
  assert.equal(tool.status, TOOL_STATUS.OVERDUE)
})

await test('going overdue raises exactly one notification, even after repeat sweeps', async () => {
  await txnService.runOverdueCheck({ dueSoonThresholdDays: 1 })
  await txnService.runOverdueCheck({ dueSoonThresholdDays: 1 })
  const notifs = await notificationService.listAll()
  const overdueForLoan = notifs.filter((n) => n.dedupeKey === `overdue:${loanTxn.id}`)
  assert.equal(overdueForLoan.length, 1, 'deduplicated by transaction id')
  assert.ok(overdueForLoan[0].message.includes(createdTool.name))
})

await test('the overdue event is written to the tool timeline', async () => {
  const entries = await activityService.listForTool(createdTool.id)
  assert.ok(entries.some((e) => e.action === ACTIVITY.TOOL_OVERDUE))
})

await test('a tool due tomorrow raises a due-soon notification, not an overdue one', async () => {
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 1),
    },
    student,
  )
  const result = await txnService.runOverdueCheck({ dueSoonThresholdDays: 1 })
  assert.ok(result.dueSoon >= 1)
  const notifs = await notificationService.listAll()
  assert.ok(notifs.some((n) => n.dedupeKey === `due-soon:${txn.id}`))
  assert.ok(!notifs.some((n) => n.dedupeKey === `overdue:${txn.id}`))
  await txnService.returnTool({ transactionId: txn.id, condition: CONDITION.GOOD }, student)
})

/* ------------------------------- returning ------------------------------- */

section('return workflow')

await test('a student cannot return a tool borrowed by someone else', async () => {
  const otherStudent = (await userService.listAll()).find(
    (u) => u.role === ROLE.STUDENT && u.id !== student.id && u.status === 'Active',
  )
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: otherStudent.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 2),
    },
    instructor,
  )
  await assert.rejects(
    () => txnService.returnTool({ transactionId: txn.id, condition: CONDITION.GOOD }, student),
    /only return tools that you borrowed/i,
  )
  await txnService.returnTool({ transactionId: txn.id, condition: CONDITION.GOOD }, instructor)
})

await test('returning an overdue tool closes it and puts the tool back in service', async () => {
  const returned = await txnService.returnTool(
    { transactionId: loanTxn.id, condition: CONDITION.FAIR, notes: 'Gauge glass scuffed.' },
    student,
  )
  assert.equal(returned.status, TXN_STATUS.RETURNED)
  assert.equal(returned.conditionIn, CONDITION.FAIR)
  assert.equal(returned.wasOverdue, true, 'the late return is recorded')
  assert.ok(returned.returnDate)

  const tool = await toolService.getById(createdTool.id)
  assert.equal(tool.status, TOOL_STATUS.AVAILABLE)
  assert.equal(tool.condition, CONDITION.FAIR, 'the tool takes the returned condition')
})

await test('closing a loan clears its overdue alert', async () => {
  const notifs = await notificationService.listAll()
  assert.ok(!notifs.some((n) => n.dedupeKey === `overdue:${loanTxn.id}`))
  assert.ok(notifs.some((n) => n.transactionId === loanTxn.id && n.type === 'returned'))
})

await test('a closed transaction cannot be returned twice', async () => {
  await assert.rejects(
    () => txnService.returnTool({ transactionId: loanTxn.id, condition: CONDITION.GOOD }, student),
    /not currently borrowed/i,
  )
})

await test('a damaged return pulls the tool out of circulation', async () => {
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 2),
    },
    student,
  )
  const closed = await txnService.returnTool(
    { transactionId: txn.id, condition: CONDITION.DAMAGED, notes: 'Handle sheared during use.' },
    student,
  )
  assert.equal(closed.status, TXN_STATUS.DAMAGED)

  const tool = await toolService.getById(spare.id)
  assert.equal(tool.status, TOOL_STATUS.DAMAGED)
  assert.equal(tool.condition, CONDITION.DAMAGED)
  assert.equal(toolService.borrowEligibility(tool).ok, false)

  const notifs = await notificationService.listAll()
  assert.ok(notifs.some((n) => n.type === 'damaged' && n.toolId === spare.id))

  await toolService.restore(spare.id, admin, 'Repaired after test.')
})

await test('an invalid return condition is rejected', async () => {
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 2),
    },
    student,
  )
  await assert.rejects(
    () => txnService.returnTool({ transactionId: txn.id, condition: 'Pristine' }, student),
    (err) => {
      assert.ok(err.errors?.condition)
      return true
    },
  )
  await txnService.returnTool({ transactionId: txn.id, condition: CONDITION.GOOD }, student)
})

/* --------------------------- due date extension --------------------------- */

section('administrative corrections')

await test('an instructor can extend a due date and clear the overdue flag', async () => {
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 1),
    },
    student,
  )
  await db.update(COLLECTIONS.transactions, txn.id, { dueDate: addDaysISO(new Date(), -1) })
  await txnService.runOverdueCheck({})
  assert.equal((await txnService.getById(txn.id)).status, TXN_STATUS.OVERDUE)

  await txnService.extendDueDate(txn.id, addDaysISO(new Date(), 5), instructor)
  const extended = await txnService.getById(txn.id)
  assert.equal(extended.status, TXN_STATUS.BORROWED)
  assert.equal((await toolService.getById(spare.id)).status, TOOL_STATUS.BORROWED)

  await txnService.returnTool({ transactionId: txn.id, condition: CONDITION.GOOD }, student)
})

await test('a student cannot extend a due date or write off a tool', async () => {
  const active = await txnService.listActive()
  if (active.length) {
    await assert.rejects(
      () => txnService.extendDueDate(active[0].id, addDaysISO(new Date(), 5), student),
      /administrator|not allowed/i,
    )
    await assert.rejects(() => txnService.markLost(active[0].id, student), /administrator|not allowed/i)
  }
})

/* ---------------------------- delete protection ---------------------------- */

section('data integrity')

await test('deleting a tool with an open loan requires explicit confirmation', async () => {
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 2),
    },
    student,
  )

  await assert.rejects(
    () => toolService.remove(spare.id, admin),
    (err) => {
      assert.equal(err.name, 'ActiveTransactionError')
      assert.equal(err.activeCount, 1)
      return true
    },
  )
  assert.ok(await db.exists(COLLECTIONS.tools, spare.id), 'the tool is still there')

  await toolService.remove(spare.id, admin, { force: true })
  assert.equal(await db.exists(COLLECTIONS.tools, spare.id), false)

  const closed = await txnService.getById(txn.id)
  assert.equal(closed.status, TXN_STATUS.LOST, 'the open loan is closed, not orphaned')
})

await test('a tool on loan cannot have its status hand-edited', async () => {
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 2),
    },
    student,
  )
  await assert.rejects(
    () => toolService.setStatus(spare.id, TOOL_STATUS.MAINTENANCE, admin),
    /currently on loan/i,
  )
  await assert.rejects(
    () => maintenanceService.schedule(
      {
        toolId: spare.id,
        type: 'Preventive',
        technician: 'Tester',
        date: fromDateInput(todayInput()),
      },
      admin,
    ),
    /currently on loan/i,
  )
  await txnService.returnTool({ transactionId: txn.id, condition: CONDITION.GOOD }, student)
})

await test('a suspended account cannot borrow', async () => {
  const target = (await userService.listAll()).find(
    (u) => u.role === ROLE.STUDENT && u.id !== student.id,
  )
  await userService.updateUser(target.id, { status: 'Suspended' }, admin)
  const spare = (await toolService.listAvailable())[0]
  await assert.rejects(
    () =>
      txnService.borrow(
        {
          toolId: spare.id,
          userId: target.id,
          borrowDate: fromDateInput(todayInput()),
          dueDate: addDaysISO(new Date(), 2),
        },
        admin,
      ),
    /suspended/i,
  )
  await userService.updateUser(target.id, { status: 'Active' }, admin)
})

await test('the last administrator cannot be demoted or deleted', async () => {
  const admins = (await userService.listAll()).filter((u) => u.role === ROLE.ADMIN)
  if (admins.length === 1) {
    await assert.rejects(
      () => userService.updateUser(admins[0].id, { role: ROLE.STUDENT }, admin),
      /at least one active administrator/i,
    )
  }
  await assert.rejects(() => userService.remove(admin.id, admin), /own account/i)
})

await test('a user holding tools cannot be deleted without confirmation', async () => {
  const spare = (await toolService.listAvailable())[0]
  const txn = await txnService.borrow(
    {
      toolId: spare.id,
      userId: student.id,
      borrowDate: fromDateInput(todayInput()),
      dueDate: addDaysISO(new Date(), 2),
    },
    student,
  )
  await assert.rejects(
    () => userService.remove(student.id, admin),
    (err) => {
      assert.equal(err.name, 'ActiveTransactionError')
      return true
    },
  )
  await txnService.returnTool({ transactionId: txn.id, condition: CONDITION.GOOD }, student)
})

await test('duplicate usernames and student IDs are rejected', async () => {
  await assert.rejects(
    () =>
      userService.create(
        { fullName: 'Copy Cat', username: 'admin', role: ROLE.INSTRUCTOR, password: 'secret123' },
        admin,
      ),
    (err) => {
      assert.ok(err.errors?.username)
      return true
    },
  )
  const existingStudent = (await userService.listAll()).find((u) => u.studentId)
  await assert.rejects(
    () =>
      userService.create(
        {
          fullName: 'Copy Student',
          username: 'copystudent',
          role: ROLE.STUDENT,
          studentId: existingStudent.studentId,
          course: 'BS Automotive Engineering Technology',
          password: 'secret123',
        },
        admin,
      ),
    (err) => {
      assert.ok(err.errors?.studentId)
      return true
    },
  )
})

/* ------------------------------ maintenance ------------------------------ */

section('maintenance')

await test('scheduling maintenance takes a tool out of circulation', async () => {
  const spare = (await toolService.listAvailable())[0]
  const record = await maintenanceService.schedule(
    {
      toolId: spare.id,
      type: 'Calibration',
      technician: 'Rolando Estrada',
      date: fromDateInput(todayInput()),
      nextDate: addDaysISO(new Date(), 90),
      cost: 1500,
      notes: 'Annual calibration.',
    },
    admin,
  )
  assert.equal(record.status, 'Scheduled')
  const tool = await toolService.getById(spare.id)
  assert.equal(tool.status, TOOL_STATUS.MAINTENANCE)
  assert.equal(toolService.borrowEligibility(tool).ok, false)
  assert.equal(
    toolService.borrowEligibility(tool).reason,
    'This tool is currently under maintenance.',
  )

  const completed = await maintenanceService.complete(record.id, admin, {
    conditionAfter: CONDITION.EXCELLENT,
    notes: 'Calibration certificate issued.',
    intervalDays: 90,
  })
  assert.equal(completed.status, 'Completed')

  const after = await toolService.getById(spare.id)
  assert.equal(after.status, TOOL_STATUS.AVAILABLE)
  assert.equal(after.condition, CONDITION.EXCELLENT)
  assert.ok(after.nextMaintenanceDate)

  const timeline = await activityService.listForTool(spare.id)
  assert.ok(timeline.some((e) => e.action === ACTIVITY.MAINTENANCE_SCHEDULED))
  assert.ok(timeline.some((e) => e.action === ACTIVITY.MAINTENANCE_COMPLETED))
})

await test('a student cannot schedule maintenance', async () => {
  const spare = (await toolService.listAvailable())[0]
  await assert.rejects(
    () =>
      maintenanceService.schedule(
        {
          toolId: spare.id,
          type: 'Preventive',
          technician: 'Someone',
          date: fromDateInput(todayInput()),
        },
        student,
      ),
    /not allowed/i,
  )
})

/* ------------------------------- reporting ------------------------------- */

section('dashboard and reports')

await test('dashboard counters match the underlying records exactly', async () => {
  const stats = await reportService.dashboardStats({ dueSoonThresholdDays: 1 })
  const tools = await db.list(COLLECTIONS.tools)
  const users = await db.list(COLLECTIONS.users)

  assert.equal(stats.totalTools, tools.length)
  assert.equal(stats.available, tools.filter((t) => t.status === TOOL_STATUS.AVAILABLE).length)
  assert.equal(stats.borrowed, tools.filter((t) => t.status === TOOL_STATUS.BORROWED).length)
  assert.equal(stats.overdue, tools.filter((t) => t.status === TOOL_STATUS.OVERDUE).length)
  assert.equal(stats.damaged, tools.filter((t) => t.status === TOOL_STATUS.DAMAGED).length)
  assert.equal(stats.totalUsers, users.length)
  assert.ok(stats.utilization >= 0 && stats.utilization <= 100)
})

await test('tool status and open transactions never disagree', async () => {
  const tools = await db.list(COLLECTIONS.tools)
  const active = await txnService.listActive()
  const outIds = new Set(active.map((t) => t.toolId))

  for (const tool of tools) {
    const isOut = tool.status === TOOL_STATUS.BORROWED || tool.status === TOOL_STATUS.OVERDUE
    assert.equal(
      isOut,
      outIds.has(tool.id),
      `${tool.id} (${tool.status}) ${isOut ? 'is marked out but has no open loan' : 'has an open loan but is not marked out'}`,
    )
  }
  // And no tool is issued to two people at once.
  assert.equal(new Set(active.map((t) => t.toolId)).size, active.length)
})

await test('reports aggregate without errors', async () => {
  const report = await reportService.fullReport({})
  assert.ok(report.stats.totalTools > 0)
  assert.ok(Array.isArray(report.mostBorrowed))
  assert.ok(Array.isArray(report.monthly) && report.monthly.length === 6)
  assert.ok(report.metrics.returnRate >= 0 && report.metrics.returnRate <= 100)
  assert.ok(report.metrics.onTimeRate >= 0 && report.metrics.onTimeRate <= 100)
  assert.ok(report.utilization.length === (await db.list(COLLECTIONS.tools)).length)
})

await test('date-filtered reports narrow the transaction scope', async () => {
  const wide = await reportService.returnMetrics({})
  const narrow = await reportService.returnMetrics({
    from: toDateInput(addDaysISO(new Date(), -1)),
    to: toDateInput(new Date()),
  })
  assert.ok(narrow.total <= wide.total)
})

/* ------------------------------ notifications ------------------------------ */

section('notification centre')

await test('notifications can be read, unread and deleted', async () => {
  const all = await notificationService.listAll()
  assert.ok(all.length > 0)
  const target = all[0]

  await notificationService.markRead(target.id, true)
  assert.equal((await db.get(COLLECTIONS.notifications, target.id)).read, true)

  await notificationService.markRead(target.id, false)
  assert.equal((await db.get(COLLECTIONS.notifications, target.id)).read, false)

  const before = (await notificationService.listAll()).length
  await notificationService.remove(target.id)
  assert.equal((await notificationService.listAll()).length, before - 1)
})

await test('mark-all-read clears the unread count', async () => {
  const all = await notificationService.listAll()
  await notificationService.markAllRead(all.map((n) => n.id))
  assert.equal(await notificationService.unreadCount(admin, { seeAll: true }), 0)
})

await test('students only see broadcast notifications and their own', async () => {
  await notificationService.create({
    type: 'system',
    title: 'Private note',
    message: 'For the instructor only.',
    userId: instructor.id,
  })
  const forStudent = await notificationService.listFor(student, { seeAll: false })
  assert.ok(!forStudent.some((n) => n.userId === instructor.id))
  const forAdmin = await notificationService.listFor(admin, { seeAll: true })
  assert.ok(forAdmin.some((n) => n.userId === instructor.id))
})

/* ------------------------------ persistence ------------------------------ */

section('persistence and backup')

await test('records survive a cache flush (a genuine re-read from IndexedDB)', async () => {
  const before = await db.list(COLLECTIONS.tools)
  db.invalidate() // drop every cached collection
  const after = await db.list(COLLECTIONS.tools)
  assert.equal(after.length, before.length)
  assert.deepEqual(
    after.map((t) => t.id).sort(),
    before.map((t) => t.id).sort(),
  )
})

await test('export produces a complete, re-importable snapshot', async () => {
  const snapshot = await db.exportDatabase()
  assert.equal(snapshot.meta.app, 'smart-tool-monitoring')
  for (const name of db.ALL_COLLECTIONS) assert.ok(Array.isArray(snapshot.data[name]), name)

  const toolCount = snapshot.data.tools.length
  await db.clearAll()
  assert.equal((await db.list(COLLECTIONS.tools)).length, 0)

  await db.importDatabase(snapshot)
  assert.equal((await db.list(COLLECTIONS.tools)).length, toolCount)
})

await test('a malformed backup is rejected before anything is deleted', async () => {
  const toolsBefore = (await db.list(COLLECTIONS.tools)).length
  await assert.rejects(() => db.importDatabase({ nope: true }), /Invalid backup file/)
  await assert.rejects(() => db.importDatabase({ data: {} }), /no recognised collections/)
  assert.equal((await db.list(COLLECTIONS.tools)).length, toolsBefore, 'nothing was lost')
})

await test('re-seeding replaces rather than duplicates', async () => {
  const result = await seedDatabase()
  assert.equal((await db.list(COLLECTIONS.tools)).length, result.tools)
  assert.equal((await db.list(COLLECTIONS.users)).length, result.users)
  assert.equal((await db.list(COLLECTIONS.transactions)).length, result.transactions)
})

/* --------------------------- seeded data sanity --------------------------- */

section('seeded laboratory is coherent')

await test('the seed produces live overdue loans and due-soon loans', async () => {
  const result = await txnService.runOverdueCheck({ dueSoonThresholdDays: 1 })
  assert.ok(result.overdue >= 1, 'at least one overdue loan on a fresh install')
  const overdue = await txnService.listOverdue()
  assert.ok(overdue.length >= 1)
  for (const txn of overdue) {
    const tool = await toolService.getById(txn.toolId)
    assert.equal(tool.status, TOOL_STATUS.OVERDUE)
  }
})

await test('seeded tool/transaction states are consistent after the sweep', async () => {
  const tools = await db.list(COLLECTIONS.tools)
  const active = await txnService.listActive()
  const outIds = new Set(active.map((t) => t.toolId))
  for (const tool of tools) {
    const isOut = tool.status === TOOL_STATUS.BORROWED || tool.status === TOOL_STATUS.OVERDUE
    assert.equal(isOut, outIds.has(tool.id), `${tool.id} — ${tool.name} (${tool.status})`)
  }
})

await test('every seeded transaction points at a real tool and user', async () => {
  const [tools, users, txns] = await Promise.all([
    db.list(COLLECTIONS.tools),
    db.list(COLLECTIONS.users),
    db.list(COLLECTIONS.transactions),
  ])
  const toolIds = new Set(tools.map((t) => t.id))
  const userIds = new Set(users.map((u) => u.id))
  for (const txn of txns) {
    assert.ok(toolIds.has(txn.toolId), `${txn.id} → missing tool ${txn.toolId}`)
    assert.ok(userIds.has(txn.userId), `${txn.id} → missing user ${txn.userId}`)
  }
})

await test('transaction ids are unique across the seeded set', async () => {
  const ids = (await db.list(COLLECTIONS.transactions)).map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
})

/* ------------------------------- summary ------------------------------- */

console.log(
  `\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED` : ''}\n`,
)
if (failures.length) {
  for (const { name, err } of failures) console.error(`FAILED: ${name}\n${err.stack}\n`)
  process.exit(1)
}
