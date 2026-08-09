/**
 * Domain-logic smoke test. Runs the pure modules (no DOM, no IndexedDB) under
 * Node to verify dates, permissions, QR parsing, validation and filtering.
 */
import assert from 'node:assert/strict'
import * as dates from '../src/utils/dates.js'
import * as perms from '../src/utils/permissions.js'
import * as helpers from '../src/utils/helpers.js'
import * as qr from '../src/utils/qr.js'
import * as K from '../src/utils/constants.js'

assert.ok(globalThis.crypto?.getRandomValues, 'crypto.getRandomValues available')

let passed = 0
const check = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`)
    process.exitCode = 1
  }
}

console.log('\n— dates —')
check('overdue only after the due day has fully passed', () => {
  const today = new Date()
  assert.equal(dates.isOverdue(today), false, 'due today is not overdue')
  assert.equal(dates.isOverdue(dates.addDaysISO(today, -1)), true, 'yesterday is overdue')
  assert.equal(dates.isOverdue(dates.addDaysISO(today, 1)), false, 'tomorrow is not overdue')
})

check('due-soon window is inclusive of today and the threshold', () => {
  assert.equal(dates.isDueSoon(new Date(), 1), true)
  assert.equal(dates.isDueSoon(dates.addDaysISO(new Date(), 1), 1), true)
  assert.equal(dates.isDueSoon(dates.addDaysISO(new Date(), 2), 1), false)
  assert.equal(dates.isDueSoon(dates.addDaysISO(new Date(), -1), 1), false, 'overdue is not due-soon')
})

check('date input round-trips without a timezone off-by-one', () => {
  const input = '2025-05-20'
  const iso = dates.fromDateInput(input)
  assert.equal(dates.toDateInput(iso), input)
  assert.equal(dates.formatDate(iso), 'May 20, 2025')
})

check('daysBetween counts calendar days', () => {
  assert.equal(dates.daysBetween('2025-05-20T12:00:00', '2025-05-22T12:00:00'), 2)
  assert.equal(dates.daysBetween('2025-05-22T23:00:00', '2025-05-20T01:00:00'), -2)
})

check('dueLabel phrasing', () => {
  assert.equal(dates.dueLabel(new Date()), 'Due today')
  assert.equal(dates.dueLabel(dates.addDaysISO(new Date(), 1)), 'Due tomorrow')
  assert.equal(dates.dueLabel(dates.addDaysISO(new Date(), -3)), '3 days overdue')
})

check('withinRange respects inclusive bounds', () => {
  const d = dates.fromDateInput('2025-05-20')
  assert.equal(dates.withinRange(d, '2025-05-20', '2025-05-20'), true)
  assert.equal(dates.withinRange(d, '2025-05-21', ''), false)
  assert.equal(dates.withinRange(d, '', '2025-05-19'), false)
  assert.equal(dates.withinRange(d, '', ''), true)
})

check('lastMonths returns oldest-first buckets', () => {
  const months = dates.lastMonths(6, new Date('2025-05-15T12:00:00'))
  assert.equal(months.length, 6)
  assert.equal(months[0].key, '2024-12')
  assert.equal(months[5].key, '2025-05')
})

console.log('\n— permissions —')
const admin = { id: 'USR-0001', role: K.ROLE.ADMIN }
const instructor = { id: 'USR-0002', role: K.ROLE.INSTRUCTOR }
const student = { id: 'USR-0003', role: K.ROLE.STUDENT }

check('admin has every permission', () => {
  for (const p of Object.values(perms.PERM)) assert.equal(perms.can(admin, p), true, p)
})

check('student cannot manage tools or users', () => {
  assert.equal(perms.can(student, perms.PERM.TOOL_CREATE), false)
  assert.equal(perms.can(student, perms.PERM.TOOL_EDIT), false)
  assert.equal(perms.can(student, perms.PERM.TOOL_DELETE), false)
  assert.equal(perms.can(student, perms.PERM.USER_VIEW), false)
  assert.equal(perms.can(student, perms.PERM.REPORTS_VIEW), false)
  assert.equal(perms.can(student, perms.PERM.BORROW), true)
  assert.equal(perms.can(student, perms.PERM.RETURN), true)
})

check('instructor can manage transactions but not delete tools', () => {
  assert.equal(perms.can(instructor, perms.PERM.TOOL_DELETE), false)
  assert.equal(perms.can(instructor, perms.PERM.TOOL_CREATE), false)
  assert.equal(perms.can(instructor, perms.PERM.TOOL_EDIT), true)
  assert.equal(perms.can(instructor, perms.PERM.TXN_EDIT), true)
  assert.equal(perms.can(instructor, perms.PERM.USER_DELETE), false)
  assert.equal(perms.can(instructor, perms.PERM.REPORTS_VIEW), true)
})

check('students may only borrow and return for themselves', () => {
  assert.equal(perms.canBorrowFor(student, student.id), true)
  assert.equal(perms.canBorrowFor(student, 'USR-0009'), false)
  assert.equal(perms.canBorrowFor(instructor, 'USR-0009'), true)

  const otherTxn = { userId: 'USR-0009' }
  const ownTxn = { userId: student.id }
  assert.equal(perms.canReturnTransaction(student, otherTxn), false)
  assert.equal(perms.canReturnTransaction(student, ownTxn), true)
  assert.equal(perms.canReturnTransaction(instructor, otherTxn), true)
})

check('assertCan throws a PermissionError', () => {
  assert.throws(() => perms.assertCan(student, perms.PERM.TOOL_DELETE), /not allowed|permission/i)
  assert.doesNotThrow(() => perms.assertCan(admin, perms.PERM.TOOL_DELETE))
})

check('transaction visibility is scoped for students', () => {
  const rows = [{ userId: student.id }, { userId: 'USR-0009' }]
  assert.equal(perms.visibleTransactions(student, rows).length, 1)
  assert.equal(perms.visibleTransactions(instructor, rows).length, 2)
  assert.equal(perms.visibleTransactions(null, rows).length, 0)
})

console.log('\n— QR —')
check('JSON payload round-trips', () => {
  const payload = qr.buildQRPayload('TOOL-00014')
  assert.deepEqual(JSON.parse(payload), { type: 'tool', toolId: 'TOOL-00014', v: 1 })
  const parsed = qr.parseQRPayload(payload)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.toolId, 'TOOL-00014')
})

check('manual entry accepts bare and partial ids', () => {
  assert.equal(qr.parseQRPayload('14').toolId, 'TOOL-00014')
  assert.equal(qr.parseQRPayload('tool-14').toolId, 'TOOL-00014')
  assert.equal(qr.parseQRPayload('TOOL-00014').toolId, 'TOOL-00014')
  assert.equal(qr.parseQRPayload(' tool-00014 ').toolId, 'TOOL-00014')
})

check('URLs containing a tool id resolve', () => {
  const parsed = qr.parseQRPayload('https://lab.example/tools/TOOL-00021')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.toolId, 'TOOL-00021')
})

check('foreign codes are rejected with a message', () => {
  assert.equal(qr.parseQRPayload('').ok, false)
  assert.equal(qr.parseQRPayload('hello world').ok, false)
  assert.equal(qr.parseQRPayload('{"type":"user","id":1}').ok, false)
  assert.equal(qr.parseQRPayload('{broken').ok, false)
  assert.equal(qr.parseQRPayload('https://example.com/other').ok, false)
  assert.ok(qr.parseQRPayload('hello world').error.length > 5)
})

console.log('\n— helpers —')
check('transaction ids are unique and immutable in shape', () => {
  const ids = new Set()
  for (let i = 0; i < 3000; i++) ids.add(helpers.generateTxnId(new Date('2025-05-20')))
  assert.equal(ids.size, 3000, 'no collisions across 3000 ids')
  assert.match([...ids][0], /^TXN-20250520-[0-9A-Z]{6}$/)
})

check('padId formats sequential ids', () => {
  assert.equal(helpers.padId('TOOL', 1), 'TOOL-00001')
  assert.equal(helpers.padId('TOOL', 142), 'TOOL-00142')
  assert.equal(helpers.padId('USR', 7, 4), 'USR-0007')
})

check('sortBy handles strings, numbers, dates and nulls', () => {
  const rows = [
    { n: 'B', v: 2, d: '2025-01-02T00:00:00Z' },
    { n: 'a', v: 10, d: '2024-06-01T00:00:00Z' },
    { n: 'C', v: null, d: null },
  ]
  assert.deepEqual(helpers.sortBy(rows, 'n').map((r) => r.n), ['a', 'B', 'C'])
  assert.deepEqual(helpers.sortBy(rows, 'v').map((r) => r.v), [2, 10, null])
  assert.deepEqual(helpers.sortBy(rows, 'd').map((r) => r.n), ['a', 'B', 'C'])
  assert.deepEqual(helpers.sortBy(rows, 'v', 'desc').map((r) => r.v), [10, 2, null])
})

check('matchesQuery is case and accent insensitive', () => {
  const tool = { name: 'Torque Wrench', id: 'TOOL-00016', brand: 'Norbar' }
  assert.equal(helpers.matchesQuery(tool, 'torque', ['name']), true)
  assert.equal(helpers.matchesQuery(tool, 'WRENCH', ['name']), true)
  assert.equal(helpers.matchesQuery(tool, '00016', ['id']), true)
  assert.equal(helpers.matchesQuery(tool, 'hammer', ['name', 'brand']), false)
  assert.equal(helpers.matchesQuery(tool, '', ['name']), true)
  assert.equal(helpers.matchesQuery({ name: 'Café' }, 'cafe', ['name']), true)
})

check('CSV escapes quotes, commas and newlines', () => {
  const csv = helpers.toCSV(
    [{ a: 'plain', b: 'has,comma' }, { a: 'say "hi"', b: 'line\nbreak' }],
    [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
  )
  const lines = csv.split('\r\n')
  assert.equal(lines[0], 'A,B')
  assert.equal(lines[1], 'plain,"has,comma"')
  assert.ok(lines[2].startsWith('"say ""hi""","line'))
})

check('percent guards division by zero', () => {
  assert.equal(helpers.percent(5, 10), 50)
  assert.equal(helpers.percent(1, 0), 0)
  assert.equal(helpers.percent(0, 0), 0)
})

check('countBy / groupBy', () => {
  const rows = [{ s: 'a' }, { s: 'a' }, { s: 'b' }]
  assert.deepEqual(helpers.countBy(rows, 's'), { a: 2, b: 1 })
  assert.equal(helpers.groupBy(rows, 's').a.length, 2)
})

console.log('\n— constants integrity —')
check('every tool status has a colour token', () => {
  for (const s of K.TOOL_STATUSES) assert.ok(K.STATUS_STYLES[s], `missing style for ${s}`)
  for (const s of K.TXN_STATUSES) assert.ok(K.TXN_STATUS_STYLES[s], `missing style for ${s}`)
  for (const c of K.CONDITIONS) assert.ok(K.CONDITION_STYLES[c], `missing style for ${c}`)
  for (const r of K.ROLES) assert.ok(K.ROLE_STYLES[r], `missing style for ${r}`)
  for (const s of K.MAINTENANCE_STATUSES)
    assert.ok(K.MAINTENANCE_STATUS_STYLES[s], `missing style for ${s}`)
})

check('every non-available status explains why it blocks borrowing', () => {
  for (const s of K.TOOL_STATUSES) {
    if (s === K.TOOL_STATUS.AVAILABLE) continue
    assert.ok(K.NON_BORROWABLE_REASON[s], `missing reason for ${s}`)
  }
})

check('return conditions are a subset of conditions', () => {
  for (const c of K.RETURN_CONDITIONS) assert.ok(K.CONDITIONS.includes(c))
})

console.log(`\n${passed} checks passed${process.exitCode ? ' — with failures above' : ''}\n`)
