/**
 * Access-control verification.
 *
 * Checks the layers that have to agree with each other:
 *
 *   1. the role → navigation map (what each role can see),
 *   2. the permission matrix behind the route guards,
 *   3. that storage stays behind the data layer.
 *
 * These are static checks: they need no network, so they run anywhere. With the
 * backend removed, role enforcement lives entirely in `utils/permissions.js`,
 * the route guards in `App.jsx`, and the read scoping in `services/db.js` —
 * which is what makes these checks the whole story for now rather than one
 * layer of three.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// The suite is bundled into node_modules/.cache before it runs (Node cannot
// resolve the extensionless imports Vite allows), so paths are resolved from the
// working directory — which the runner sets to the project root — rather than
// from this file's location.
const root = process.cwd()
if (!existsSync(join(root, 'package.json'))) {
  console.error('Run this from the project root (npm run verify).')
  process.exit(1)
}
const read = (p) => readFileSync(join(root, p), 'utf8')

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

const {
  NAV_ITEMS,
  navItemsForRole,
  visibleNavItems,
  mobileNavForRole,
  studentRailItems,
  instructorRailItems,
  ADMIN_MOBILE_NAV,
  INSTRUCTOR_MOBILE_NAV,
} = await import('../src/components/navigation.js')
const perms = await import('../src/utils/permissions.js')
const { ROLE, ROLES } = await import('../src/utils/constants.js')

const labels = (items) => items.map((i) => i.label)
const can = (role) => (permission) => perms.can({ role }, permission)

/* ------------------------------ navigation ------------------------------ */

console.log('\n— role-based navigation —')

check('admin sidebar has every destination', () => {
  assert.deepEqual(labels(navItemsForRole(ROLE.ADMIN)), [
    'Dashboard',
    'Inventory',
    'Tool Map',
    'Scan',
    'Transactions',
    'Requests',
    'Messages',
    'Users',
    'Maintenance',
    'Report Problems',
    'Notifications',
    'Reports',
    'Settings',
  ])
})

check('instructor sidebar reaches every staff destination', () => {
  // Settings is reachable but read-only for them: `SETTINGS_VIEW` opens the
  // page, `SETTINGS_EDIT` — checked above — is what actually writes it.
  assert.deepEqual(labels(navItemsForRole(ROLE.INSTRUCTOR)), [
    'Dashboard',
    'Inventory',
    'Tool Map',
    'Scan',
    'Transactions',
    'Requests',
    'Messages',
    'Users',
    'Maintenance',
    'Report Problems',
    'Notifications',
    'Reports',
    'Settings',
  ])
})

check('student sidebar is the borrowing lifecycle, in order', () => {
  // Each destination owns one step: Inventory and Scan identify a tool,
  // Requests is where one ask lives from Pending to Approved to collected,
  // Return closes a loan, Transactions is the history afterwards.
  assert.deepEqual(labels(studentRailItems(navItemsForRole(ROLE.STUDENT))), [
    'Dashboard',
    'Inventory',
    'Tool Map',
    'Requests',
    'Scan',
    'Return',
    'Messages',
    'Transactions',
    'Notifications',
  ])
})

check('the counter is staff-only: a student never issues a tool to themselves', () => {
  // The counter is no longer a destination for anybody — staff reach /borrow
  // from the request it belongs to — so what has to hold is that no role's
  // navigation offers it, and that the permission behind it stays with staff.
  for (const role of [ROLE.ADMIN, ROLE.INSTRUCTOR, ROLE.STUDENT]) {
    assert.ok(!navItemsForRole(role).some((i) => i.to === '/borrow'), role)
    assert.ok(!mobileNavForRole(role).includes('/borrow'), role)
  }
  assert.equal(perms.can({ role: ROLE.INSTRUCTOR }, perms.PERM.BORROW_FOR_OTHERS), true)
  // And the permission behind it says the same thing.
  assert.equal(perms.can({ role: ROLE.STUDENT }, perms.PERM.BORROW_FOR_OTHERS), false)
})

check('requests are a destination for every role', () => {
  for (const role of [ROLE.ADMIN, ROLE.INSTRUCTOR, ROLE.STUDENT]) {
    assert.ok(labels(navItemsForRole(role)).includes('Requests'), role)
  }
})

check('the student bottom bar is the lifecycle, with Scan in the middle', () => {
  // Five fixed slots with the raised action in the middle; Requests is reached
  // from the inventory and Return from the borrowing on Transactions.
  assert.deepEqual(mobileNavForRole(ROLE.STUDENT), [
    '/dashboard',
    '/tools',
    '/scan',
    '/messages',
    '/transactions',
  ])
  assert.ok(ADMIN_MOBILE_NAV.includes('/requests'))
  assert.ok(INSTRUCTOR_MOBILE_NAV.includes('/requests'))
  assert.ok(!INSTRUCTOR_MOBILE_NAV.includes('/tools'), 'staff bars keep their own layout')
})

check('staff share the destinations; the student list is their own', () => {
  const admin = labels(navItemsForRole(ROLE.ADMIN))
  const instructor = labels(navItemsForRole(ROLE.INSTRUCTOR))
  const student = labels(navItemsForRole(ROLE.STUDENT))

  // Staff reach the same places — the difference between the two roles is what
  // they may *do* once there (see the permission checks above), not where they
  // may go. Settings is the clearest case: both open it, only one can write it.
  assert.deepEqual(instructor, admin, 'staff must reach the same destinations')

  // A student's navigation is genuinely their own, and carries none of the
  // laboratory-management destinations.
  assert.notDeepEqual(student, admin, 'a student must not get the staff navigation')
  for (const label of ['Users', 'Maintenance', 'Report Problems', 'Reports', 'Settings']) {
    assert.ok(!student.includes(label), `a student must not see ${label}`)
  }

  // The two staff rails are still ordered differently: an instructor's leads
  // with the room, and lifts Scan into its own action block.
  assert.notDeepEqual(
    labels(instructorRailItems(navItemsForRole(ROLE.INSTRUCTOR))),
    admin,
    'the instructor rail must keep its own order',
  )
})

check('navigation and the permission matrix agree', () => {
  for (const role of [ROLE.ADMIN, ROLE.INSTRUCTOR, ROLE.STUDENT]) {
    assert.deepEqual(
      labels(visibleNavItems(role, can(role))),
      labels(navItemsForRole(role)),
      `${role}: a nav item is listed for the role but its permission is missing`,
    )
  }
})

check('an unknown or missing role gets no navigation at all', () => {
  assert.deepEqual(visibleNavItems(undefined, can(undefined)), [])
  assert.deepEqual(visibleNavItems('Technician', can('Technician')), [])
})

/* ------------------------------ route guards ------------------------------ */

console.log('\n— route guards —')

const app = read('src/App.jsx')

check('every admin-only route is guarded, not just hidden', () => {
  // `/settings` is deliberately absent: every role has preferences of its own
  // there, and the laboratory configuration inside the page is gated on
  // SETTINGS_VIEW / SETTINGS_EDIT / DATA_MANAGE instead — checked below.
  for (const [route, permission] of [
    ['/users', 'PERM.USER_MANAGE'],
    ['/reports', 'PERM.REPORTS_VIEW'],
    ['/maintenance', 'PERM.MAINTENANCE_VIEW'],
  ]) {
    const pattern = new RegExp(
      `path="${route}"[\\s\\S]{0,200}?RequirePermission permission=\\{${permission.replace('.', '\\.')}\\}`,
    )
    assert.match(app, pattern, `${route} must be wrapped in RequirePermission ${permission}`)
  }
})

check('the settings page gates the laboratory configuration itself', () => {
  const page = read(join('src', 'pages', 'SettingsPage.jsx'))
  for (const permission of ['SETTINGS_VIEW', 'SETTINGS_EDIT', 'DATA_MANAGE']) {
    assert.match(page, new RegExp(`PERM\\.${permission}`), `${permission} is not checked`)
  }
})

check('deleting a conversation is bounded by membership, for every role', () => {
  // Anybody in a thread may remove it, so the boundary is membership rather
  // than role — and it is the same boundary in the service and in the policy.
  const service = read(join('src', 'services', 'messages.js'))
  const body = service.slice(service.indexOf('export async function remove(')).slice(0, 1600)
  assert.match(body, /assertCan\(actor, PERM\.MESSAGE_SEND/)
  assert.match(body, /membership\(conversationId, actor\.id\)/, 'the membership test is missing')
  assert.match(body, /isBroadcast\(conversation\)/, 'the standing rooms must stay')
  for (const role of [ROLE.ADMIN, ROLE.INSTRUCTOR, ROLE.STUDENT]) {
    assert.equal(perms.can({ role }, perms.PERM.MESSAGE_SEND), true, role)
  }
  const sql = read(join('supabase', 'migrations', '0025_participants_can_delete_conversation.sql'))
  assert.match(sql, /conversations_delete[\s\S]{0,240}?in_conversation\(id\)/)
})

check('clearing every conversation stays with the administrator', () => {
  const service = read(join('src', 'services', 'messages.js'))
  const body = service.slice(service.indexOf('export async function removeAll')).slice(0, 800)
  assert.match(body, /assertCan\(actor, PERM\.DATA_MANAGE/)
  assert.equal(perms.can({ role: ROLE.INSTRUCTOR }, perms.PERM.DATA_MANAGE), false)
  assert.equal(perms.can({ role: ROLE.STUDENT }, perms.PERM.DATA_MANAGE), false)
  assert.equal(perms.can({ role: ROLE.ADMIN }, perms.PERM.DATA_MANAGE), true)
})

check('admin-only routes are denied for instructors and students', () => {
  // What is left of "system" once the laboratory belongs to the instructor:
  // writing the configuration, and the data tools.
  for (const permission of [
    perms.PERM.SETTINGS_EDIT,
    perms.PERM.DATA_MANAGE,
  ]) {
    assert.equal(perms.can({ role: ROLE.INSTRUCTOR }, permission), false, permission)
    assert.equal(perms.can({ role: ROLE.STUDENT }, permission), false, permission)
    assert.equal(perms.can({ role: ROLE.ADMIN }, permission), true, permission)
  }
})

check('staff routes are denied for students', () => {
  for (const permission of [
    perms.PERM.USER_MANAGE,
    perms.PERM.USER_CREATE,
    perms.PERM.USER_EDIT,
    perms.PERM.USER_DELETE,
    perms.PERM.TOOL_CREATE,
    perms.PERM.TOOL_DELETE,
    perms.PERM.REPORTS_VIEW,
    perms.PERM.REPORTS_EXPORT,
    perms.PERM.SETTINGS_VIEW,
  ]) {
    assert.equal(perms.can({ role: ROLE.STUDENT }, permission), false, permission)
    assert.equal(perms.can({ role: ROLE.INSTRUCTOR }, permission), true, permission)
    assert.equal(perms.can({ role: ROLE.ADMIN }, permission), true, permission)
  }
})

/* ------------------------------ public routes ------------------------------ */

console.log('\n— public routes —')

const users = await import('../src/services/users.js')
const { USER_STATUS } = await import('../src/utils/constants.js')

check('the public entry point is /login, and sign-up stays public', () => {
  const protectedTree = app.slice(app.indexOf('<RequireAuth>'))
  // The landing page is hidden: `/` redirects to the login screen in a browser
  // tab and in the installed app alike.
  assert.match(
    app,
    /path="\/"\s+element=\{<Navigate to="\/login" replace \/>\}/,
    '/ must redirect to /login',
  )
  assert.match(app, /path="\/signup"/, 'no /signup route')
  assert.doesNotMatch(protectedTree, /<SignUpPage/, '/signup must not be inside RequireAuth')
  assert.doesNotMatch(protectedTree, /path="\/login"/, '/login must not be inside RequireAuth')
})

check('an authenticated visitor is redirected away from /login and /signup', () => {
  for (const route of ['/login', '/signup']) {
    const pattern = new RegExp(
      `path="${route}"[\\s\\S]{0,160}?isAuthenticated \\? <Navigate to="/dashboard" replace />`,
    )
    assert.match(app, pattern, `${route} should redirect when already signed in`)
  }
})

check('every dashboard route is still inside RequireAuth', () => {
  const protectedTree = app.slice(app.indexOf('<RequireAuth>'))
  for (const route of [
    '/dashboard',
    '/tools',
    '/scan',
    '/borrow',
    '/return',
    '/transactions',
    '/users',
    '/maintenance',
    '/notifications',
    '/reports',
    '/settings',
  ]) {
    assert.match(protectedTree, new RegExp(`path="${route}"`), `${route} left the protected tree`)
  }
})

/* ------------------------------ self sign-up ------------------------------ */

console.log('\n— public sign-up —')

check('only Student and Instructor can be requested', () => {
  assert.deepEqual(users.SIGNUP_ROLES, [ROLE.STUDENT, ROLE.INSTRUCTOR])
  assert.ok(!users.SIGNUP_ROLES.includes(ROLE.ADMIN), 'Admin must not be self-assignable')
})

check('the last active administrator cannot be removed', () => {
  // Two layers, and both are required: the service gives the good message, the
  // trigger is what a direct API call still hits.
  const usersService = read(join('src', 'services', 'users.js'))
  assert.match(usersService, /async function assertNotLastAdmin/, 'the service guard is missing')
  for (const fn of ['remove', 'setStatus', 'updateUser']) {
    const body = usersService.slice(usersService.indexOf(`export async function ${fn}`))
    assert.match(
      body.slice(0, 1600),
      /assertNotLastAdmin/,
      `${fn}() can remove the last administrator`,
    )
  }
  const sql = read(join('supabase', 'migrations', '0004_protect_last_admin.sql'))
  assert.match(sql, /before update or delete on public\.profiles/i, 'the trigger is not attached')
  assert.match(sql, /at least one active administrator/, 'the trigger does not refuse the removal')
})

check('self-registration activates immediately, and cannot be an administrator', () => {
  // Both self-service roles are usable at once — there is no approval step.
  assert.equal(users.signupStatusFor(ROLE.INSTRUCTOR), USER_STATUS.ACTIVE)
  assert.equal(users.signupStatusFor(ROLE.STUDENT), USER_STATUS.ACTIVE)
  // The privilege boundary is the role, not the status: Admin is not offered,
  // and the profiles_insert policy refuses it regardless of what is sent.
  assert.ok(!users.SIGNUP_ROLES.includes(ROLE.ADMIN), 'Admin must not be self-registerable')
  const rls = read(join('supabase', 'migrations', '0003_self_registration_active.sql'))
  assert.match(rls, /role in \('Instructor', 'Student'\)/, 'the policy must still exclude Admin')
  assert.match(rls, /id = auth\.uid\(\)/, 'the policy must still pin the row to its owner')
})

check('sign-up validation covers every required field', () => {
  const errors = users.validateSignUp({})
  for (const field of ['firstName', 'lastName', 'email', 'password', 'role']) {
    assert.ok(errors[field], `missing validation for ${field}`)
  }
  assert.match(users.validateSignUp({ password: 'short12' }).password, /at least 8/)
  assert.ok(!users.validateSignUp({ password: 'longenough1' }).password)
  assert.match(
    users.validateSignUp({ password: 'longenough1', confirmPassword: 'different' })
      .confirmPassword,
    /do not match/,
  )
  assert.match(users.validateSignUp({ email: 'not-an-email' }).email, /valid email/)
  assert.match(users.validateSignUp({ role: 'Admin' }).role, /valid role/)
})


check('role-specific identifiers are required', () => {
  const student = users.validateSignUp({ role: ROLE.STUDENT })
  assert.ok(student.studentId && student.department)
  const instructor = users.validateSignUp({ role: ROLE.INSTRUCTOR })
  assert.ok(instructor.employeeId && instructor.department)
})






check('git ignores env files', () => {
  const ignore = read('.gitignore')
  for (const pattern of ['.env.local', '.env']) {
    assert.ok(ignore.includes(pattern), `.gitignore is missing ${pattern}`)
  }
})

console.log(`\n${passed} checks passed${process.exitCode ? ' — with failures above' : ''}\n`)

/* ------------------------------ source hygiene ------------------------------ */

console.log('\n— source hygiene —')

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(join(root, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(root, rel)).isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(js|jsx)$/.test(entry)) out.push(rel)
  }
  return out
}

const files = sourceFiles('src').map((path) => ({ path, text: read(path) }))

check('only the data layer knows where records are stored', () => {
  // The property that made swapping the backend a single-file change: nothing
  // above services/db.js knows how records are persisted. Per-device UI
  // preferences (theme, dismissed prompts, tour state) legitimately use
  // localStorage too, so this looks for the record stores specifically.
  const allowed = [join('src', 'services', 'db.js'), join('src', 'services', 'localAuth.js')]
  const offenders = files.filter(
    ({ path, text }) => /stms\.local-(db|session)/.test(text) && !allowed.includes(path),
  )
  assert.deepEqual(
    offenders.map((f) => f.path),
    [],
    'read and write records through services/db.js instead',
  )
})

check('Admin is a normal role: no account is hardcoded anywhere', () => {
  // A hardcoded address or uuid would make "the administrator" a single account
  // that cannot be replaced, transferred or joined by a second one.
  for (const { path, text } of files) {
    assert.doesNotMatch(text, /ADMIN_(EMAIL|UID|ID)/, `${path} hardcodes an administrator`)
    assert.doesNotMatch(
      text,
      /(isAdminEmail|ADMIN_ACCOUNTS|SUPER_ADMIN)/,
      `${path} singles out one administrator`,
    )
  }
  // Every role is still offered to an administrator editing a profile, Admin
  // included, which is how a second one is promoted. The picker is filtered by
  // `canAssignRole` rather than hardcoded, so the filter is checked here and the
  // rule it applies is checked below.
  const usersPage = read(join('src', 'pages', 'UsersPage.jsx'))
  assert.match(
    usersPage,
    /options=\{roleOptions\}/,
    'the role picker must be built from the assignable roles',
  )
  assert.match(
    usersPage,
    /ROLES\.filter\(\(role\) => canAssignRole\(currentUser, role\)\)/,
    'the role picker must start from every role and filter by permission',
  )
  assert.deepEqual(
    ROLES.filter((role) => perms.canAssignRole({ role: ROLE.ADMIN }, role)),
    ROLES,
    'an administrator must still be offered every role',
  )
})

check('the displayed app version matches package.json', () => {
  const pkg = JSON.parse(read('package.json'))
  const constants = read(join('src', 'utils', 'constants.js'))
  const shown = constants.match(/APP_VERSION = '([^']+)'/)?.[1]
  assert.equal(shown, pkg.version, 'the app shows a different version')
})

check('Supabase is the only backend SDK in the bundle', () => {
  // An allowlist rather than a list of banned names: a second backend creeping
  // back in fails this whether or not anyone thought to name it here.
  const BACKEND = /@supabase\/supabase-js|from '[a-z0-9@/-]*\/(auth|db|database|storage|realtime)'/
  const allowed = [
    join('src', 'services', 'db.js'),
    join('src', 'services', 'localAuth.js'),
    join('src', 'supabase', 'config.js'),
  ]
  const offenders = files.filter(({ path, text }) => BACKEND.test(text) && !allowed.includes(path))
  assert.deepEqual(offenders.map((f) => f.path), [], 'reach the backend through services/db.js')

  const pkg = JSON.parse(read('package.json'))
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  const backendDeps = deps.filter((d) => /(^|[-/])(auth|db|database|sdk|admin|backend)|supabase|amplify|appwrite|pocketbase|parse|mongo|prisma/i.test(d))
  assert.deepEqual(
    backendDeps.sort(),
    ['@supabase/supabase-js'],
    `unexpected backend dependency: ${backendDeps.join(', ')}`,
  )
})

check('the service-role key never reaches the frontend', () => {
  // It bypasses Row Level Security, so a bundled copy would hand every browser
  // unrestricted access to the database. Anything named VITE_ is bundled.
  for (const { path, text } of files) {
    assert.doesNotMatch(text, /service_role|SERVICE_ROLE/, `${path} references the service-role key`)
    assert.doesNotMatch(text, /VITE_SUPABASE_SERVICE/, `${path} reads a service-role env var`)
  }
  for (const envFile of ['.env', '.env.example']) {
    if (!existsSync(join(root, envFile))) continue
    const text = read(envFile)
    assert.doesNotMatch(text, /^\s*VITE_[A-Z_]*SERVICE/m, `${envFile} exposes a service-role key`)
    assert.doesNotMatch(text, /service_role/i, `${envFile} contains a service-role key`)
  }
})

check('only the data layer talks to Supabase', () => {
  // The property that keeps the backend swappable: nothing above services/db.js
  // knows how records are stored.
  const allowed = [
    join('src', 'services', 'db.js'),
    join('src', 'services', 'localAuth.js'),
    join('src', 'supabase', 'config.js'),
  ]
  const offenders = files.filter(
    ({ path, text }) => /@supabase\/supabase-js|from '\.\.\/supabase\/config'/.test(text) && !allowed.includes(path),
  )
  assert.deepEqual(
    offenders.map((f) => f.path),
    [],
    'reach the database through services/db.js instead',
  )
})

/* ------------------------------------------------------------------ *
 * Concurrency and scheduling
 *
 * Two properties the application cannot enforce from the client, so both are
 * checked here against the migrations that do enforce them.
 * ------------------------------------------------------------------ */

const migrations = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => read(join('supabase', 'migrations', f)))
  .join('\n')

check('a tool can only have one open loan, enforced by the database', () => {
  // The check-then-insert in services/transactions.js cannot be atomic from a
  // browser: runAtomic records compensating steps, it does not hold a lock. Two
  // staff confirming the same tool at once would both pass. Only a database
  // constraint can refuse the second write.
  assert.match(
    migrations,
    /create unique index[\s\S]{0,120}transactions_one_active_per_tool/,
    'the partial unique index on active loans is missing',
  )
  // It must cover exactly the statuses that mean the tool is out. Including
  // Returned would make a tool unborrowable for ever after its first loan.
  const index = migrations.match(
    /transactions_one_active_per_tool[\s\S]{0,200}?where status in \(([^)]+)\)/,
  )
  assert.ok(index, 'the index must be scoped with a WHERE clause')
  const statuses = index[1].split(',').map((s) => s.trim().replace(/'/g, ''))
  assert.deepEqual(
    statuses.sort(),
    ['Borrowed', 'Overdue'],
    'the index must cover exactly the active statuses (ACTIVE_TXN_STATUSES)',
  )
})

check('the borrow path reports a conflict rather than a raw database error', () => {
  const borrow = read(join('src', 'services', 'transactions.js'))
  assert.match(
    borrow,
    /23505|one_active_per_tool/,
    'borrow() must catch the unique violation the index raises',
  )
  assert.match(
    borrow,
    /was just issued to|just issued to somebody else/,
    'the conflict needs a sentence the person can act on',
  )
})

check('the overdue sweep can run without a browser', () => {
  assert.match(
    migrations,
    /create or replace function public\.run_scheduled_sweep/,
    'the scheduled sweep function is missing',
  )
  // It writes to transactions, tools, notifications and activity_logs, none of
  // which a cron caller holds a session for.
  assert.match(migrations, /run_scheduled_sweep[\s\S]{0,400}security definer/)
  // And it must not be reachable from a signed-in browser: the client keeps its
  // own RLS-governed runOverdueCheck() for immediate freshness.
  assert.match(
    migrations,
    /revoke all on function public\.run_scheduled_sweep[^;]*from authenticated/,
    'the sweep function must not be callable by authenticated sessions',
  )
})

check('running the sweep twice cannot duplicate alerts or state', () => {
  // Idempotency is the whole point of a scheduled job that may overlap with the
  // client-side sweep. Three mechanisms, all required.
  //
  // The unique index is `notifications_dedupe_key`, from 0001_schema.sql — the
  // table's very first migration, standing since before the sweep existed. An
  // earlier draft of 0033 assumed it was missing, re-created it under a second
  // name, and deleted rows to make room for a constraint that was never absent.
  // Caught in review before it reached production; see 0033's own comment.
  // What actually has to hold is that a live partial unique index on
  // `dedupe_key` exists at all — under whichever name — for the `on conflict`
  // clauses below to mean anything.
  assert.match(
    migrations,
    /create unique index[\s\S]{0,120}on public\.notifications \(dedupe_key\)/,
    'dedupe_key must be unique for ON CONFLICT to suppress a repeat',
  )
  const sweep = migrations.slice(migrations.indexOf('run_scheduled_sweep'))
  assert.ok(
    (sweep.match(/on conflict \(dedupe_key\)/g) ?? []).length >= 4,
    'every notification insert in the sweep must be ON CONFLICT DO NOTHING',
  )
  assert.match(
    sweep,
    /if loan\.status <> 'Overdue' then/,
    'a loan already marked Overdue must not be written again',
  )
})

check('the client-side sweep is still in place for immediate freshness', () => {
  // The server job keeps the records correct; this keeps a staff member's own
  // screen correct the moment they open the app. Removing it was never the aim.
  const context = read(join('src', 'context', 'AppContext.jsx'))
  assert.match(context, /runOverdueCheck\(/)
  assert.match(context, /maintenanceService\.notifyDue\(\)/)
})

check('the sweep endpoint keeps its secret server-side', () => {
  const endpoint = read(join('api', 'sweep.js'))
  assert.match(endpoint, /CRON_SECRET/, 'the endpoint must authenticate its caller')
  // A VITE_ fallback is fine for a *public* value — `api/push.js` reads
  // VITE_SUPABASE_URL the same way, and the URL ships in the bundle anyway.
  // What must never happen is a secret being given that prefix, because the
  // prefix is what puts a value into every browser and into the APK.
  assert.doesNotMatch(
    endpoint,
    /VITE_[A-Z_]*(SECRET|SERVICE_ROLE|PRIVATE)/,
    'a secret must never be read from a bundled VITE_ variable',
  )
  assert.doesNotMatch(
    endpoint,
    /VITE_CRON_SECRET/,
    'the cron secret must stay server-side',
  )
  // The service-role key belongs here and nowhere in src/. The existing
  // service-role guard above already proves the second half.
  assert.match(endpoint, /SUPABASE_SERVICE_ROLE_KEY/)
})

/* ------------------------------------------------------------------ *
 * Batch 2 — password change, problem reports, form accessibility
 * ------------------------------------------------------------------ */

check('changing a password verifies the current one', () => {
  const auth = read(join('src', 'services', 'localAuth.js'))
  // Supabase's updateUser() accepts a valid session alone, which is too weak
  // for a shared phone left unlocked. The current password is checked first.
  assert.match(auth, /export async function changePassword/)
  assert.match(
    auth,
    /signInWithPassword\(\{ email, password: current \}\)/,
    'the current password must actually be verified',
  )
  // And verified on a throwaway client, so a wrong password cannot end the
  // session of somebody who was only visiting the screen.
  assert.match(auth, /storageKey: `stms\.reauth/, 'verification must not run on the shared client')
  assert.match(auth, /persistSession: false/)
})

check('no password is logged or kept', () => {
  const auth = read(join('src', 'services', 'localAuth.js'))
  const fn = auth.slice(auth.indexOf('export async function changePassword'))
  const body = fn.slice(0, fn.indexOf('\nexport '))
  assert.doesNotMatch(
    body,
    /console\.(log|warn|error|info)\([^)]*(password|current|next)/i,
    'a password must never reach the console',
  )
  assert.doesNotMatch(body, /localStorage|sessionStorage/, 'a password must never be stored')
})

check('the reset-by-email route is untouched', () => {
  const auth = read(join('src', 'services', 'localAuth.js'))
  assert.match(auth, /resetPasswordForEmail/, 'the existing recovery flow must remain')
})

check('a problem report reuses the maintenance record', () => {
  const svc = read(join('src', 'services', 'maintenance.js'))
  assert.match(svc, /export async function reportProblem/)
  // Through the database function, never a direct insert: maintenance_insert
  // is staff-only and stays that way.
  assert.match(
    svc,
    /db\.rpc\('report_tool_problem'/,
    'reports must go through the function, not a direct insert',
  )
  assert.doesNotMatch(
    svc.slice(svc.indexOf('reportProblem')),
    /COLLECTIONS\.maintenance\)/,
    'reportProblem must not insert into maintenance directly',
  )
})

check('the report function fixes what a caller may not choose', () => {
  assert.match(migrations, /create or replace function public\.report_tool_problem/)
  assert.match(migrations, /security definer/)
  // The reporter is taken from the session, never from the arguments.
  assert.match(
    migrations,
    /v_reporter_id text := auth\.uid\(\)::text/,
    'the reporter must come from the session',
  )
  // Only three inputs; everything else is decided by the function.
  assert.match(
    migrations,
    /report_tool_problem\(\s*p_tool_id\s+text,\s*p_type\s+text,\s*p_description text\s*\)/,
    'the function must accept only tool, type and description',
  )
  assert.match(migrations, /public\.is_active\(\)/, 'a pending account must be refused')
  // And a double tap must not file two reports.
  assert.match(migrations, /interval '5 minutes'/, 'a repeat submit must be collapsed')
})

check('reporting does not widen the maintenance policy', () => {
  // The exception is the function, not the table. If this ever fails, a
  // migration has loosened the insert policy and students can write any row.
  assert.match(
    migrations,
    /create policy maintenance_insert[\s\S]{0,120}is_staff\(\)/,
    'maintenance_insert must stay staff-only',
  )
})

check('the tool is attached to a report without being typed', () => {
  const dialog = read(join('src', 'components', 'ReportProblemDialog.jsx'))
  assert.match(dialog, /toolId: tool\.id/, 'the tool must come from what is on screen')
  assert.doesNotMatch(
    dialog,
    /label="Tool ID"|placeholder="TOOL-/,
    'nobody should be asked to type a Tool ID',
  )
  // Reachable from both places in the specified flow.
  assert.match(read(join('src', 'components', 'ToolScanResult.jsx')), /ReportProblemDialog/)
  assert.match(read(join('src', 'pages', 'ToolDetailPage.jsx')), /ReportProblemDialog/)
})

check('form errors are announced, not merely coloured', () => {
  const ui = read(join('src', 'components', 'ui.jsx'))
  // The message carries an id and each control points at it. Without this a
  // screen reader announces the field but never why it was rejected.
  assert.match(ui, /const describedBy = \(id, error, hint\)/)
  assert.equal(
    (ui.match(/aria-describedby=\{describedBy\(id, error, hint\)\}/g) ?? []).length,
    3,
    'TextField, SelectField and TextAreaField must all be wired',
  )
  assert.equal(
    (ui.match(/aria-invalid=\{error \? true : undefined\}/g) ?? []).length,
    3,
    'aria-invalid must be present only when there is an error',
  )
  // No dangling reference when there is nothing to describe.
  assert.match(
    ui,
    /error \|\| hint \? `\$\{id\}-message` : undefined/,
    'aria-describedby must be omitted when there is no message',
  )
})

/* ------------------------------------------------------------------ *
 * Batch 3 — row selection, saved views, tool photos
 * ------------------------------------------------------------------ */

check('a selection can never contain a row the filter has hidden', () => {
  const hook = read(join('src', 'hooks', 'useRowSelection.js'))
  // The rule that stops a bulk action touching tools that scrolled out of
  // sight. Without the prune, narrowing a search leaves hidden ids selected.
  assert.match(hook, /visibleIds\.has\(id\)/, 'the selection must be pruned to visible rows')
  assert.match(hook, /rows \?\? \[\]\)\.filter\(\(r\) => ids\.has\(r\.id\)\)/,
    'selected records must be read back from the visible list')
  // Ids, not records: a selection must not be a second copy of the inventory.
  assert.match(hook, /useState\(\(\) => new Set\(\)\)/)
  assert.doesNotMatch(hook, /useState\(\[\]\)/, 'the selection must hold ids, not rows')
})

check('selection state changes do not churn on an unchanged filter', () => {
  const hook = read(join('src', 'hooks', 'useRowSelection.js'))
  // A guarded write: pruning when nothing was hidden must return the same Set,
  // or every filter keystroke re-renders the whole table on a 2 GB phone.
  assert.match(hook, /return changed \? next : current/,
    'the prune must not allocate when nothing changed')
  assert.match(hook, /current\.size \? new Set\(\) : current/,
    'clearing an empty selection must be a no-op')
})

check('the select-all box can show the third state', () => {
  const hook = read(join('src', 'hooks', 'useRowSelection.js'))
  // `indeterminate` is a DOM property, not an attribute — React cannot set it
  // from JSX, so it has to be written to the node.
  assert.match(hook, /ref\.current\.indeterminate = !!indeterminate/)
  const page = read(join('src', 'pages', 'ToolsPage.jsx'))
  assert.match(page, /useIndeterminate\(selection\?\.someVisibleSelected\)/)
})

check('row selection is staff-only and does not touch a student view', () => {
  const page = read(join('src', 'pages', 'ToolsPage.jsx'))
  assert.match(page, /const selectable = can\(PERM\.TOOL_STATUS\)/,
    'selection must be gated on the permission its bulk action needs')
  // A student's hook is handed one frozen array, so it never re-runs on a new [].
  assert.match(page, /useRowSelection\(selectable \? filtered : EMPTY_ROWS\)/)
  assert.match(page, /const EMPTY_ROWS = Object\.freeze\(\[\]\)/)
})

check('a bulk status change authorises every tool individually', () => {
  const page = read(join('src', 'pages', 'ToolsPage.jsx'))
  // One service call per tool, through the same path a single change takes —
  // so assertCan and the active-loan guard apply to each one.
  assert.match(page, /toolService\.setStatus\(tool\.id, status, user\)/)
  // Partial failure is the normal case, so it must be reported per tool.
  assert.match(page, /failures\.push\(/, 'a failed tool must be recorded')
  assert.match(page, /\$\{failures\.length\} could not be changed/,
    'partial failures must be reported')
  // And it must be confirmed before anything is written.
  assert.match(page, /kind: 'bulk-status'[\s\S]{0,400}confirmLabel/,
    'a bulk change must be confirmed')
})

check('bulk status offers only the statuses that are safe to set by hand', () => {
  const page = read(join('src', 'pages', 'ToolsPage.jsx'))
  const bar = page.slice(page.indexOf('function BulkBar'))
  const block = bar.slice(0, bar.indexOf('\nfunction '))
  // Borrowed and Overdue follow a loan; setting either here would put the tool
  // and its transaction out of step.
  assert.doesNotMatch(block, /TOOL_STATUS\.BORROWED|TOOL_STATUS\.OVERDUE/,
    'loan-driven statuses must not be settable in bulk')
  assert.match(block, /TOOL_STATUS\.AVAILABLE/)
  assert.match(block, /TOOL_STATUS\.MAINTENANCE/)
})

check('print gained a selected scope rather than a second implementation', () => {
  const actions = read(join('src', 'components', 'InventoryActions.jsx'))
  assert.match(actions, /\{ all: tools, filtered, selected \}\[scope\]/,
    'the existing scope map must be extended')
  assert.match(actions, /printQRLabels\(forScope\)/, 'one print path only')
  // The option is hidden when nothing is selected — a radio that prints nothing
  // is not a choice.
  assert.match(actions, /selected\.length > 0 && \(/)
  // And there is still exactly one place that prints.
  assert.equal((actions.match(/printQRLabels\(/g) ?? []).length, 1)
})

check('a saved view stores filters, not inventory', () => {
  const hook = read(join('src', 'hooks', 'useSavedViews.js'))
  assert.match(hook, /export const VIEW_FIELDS/)
  // Only the known filter fields are persisted, so nothing unexpected can be
  // written to storage or read back out of it.
  assert.match(hook, /for \(const field of VIEW_FIELDS\)/)
  // Code, not prose: the comments explain *why* a view holds no records, so
  // they mention the inventory. What must not appear is a record being stored.
  const code = hook
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join('\n')
  assert.doesNotMatch(code, /tools:|records:|items:/, 'a view must not copy records')
  assert.match(code, /const state = \{\}/, 'a view stores a plain filter state')
  // The existing preference mechanism, not a new table and not a second engine.
  assert.match(hook, /useLocalStorage\(`stms\.toolViews\./)
  // Scoped per account, so a shared tablet does not leak views between people.
  assert.match(hook, /\$\{userId \?\? 'anon'\}/)
})

check('opening a view drives the existing filters and URL', () => {
  const page = read(join('src', 'pages', 'ToolsPage.jsx'))
  // It sets the same state the page already filters by — there is no second
  // filtering engine, and the status/category URL effect still runs.
  assert.match(page, /const applyView = useCallback\(/)
  assert.match(page, /setters\[field\]\?\.\(state\[field\] \?\? fallback\)/,
    'every view field must be applied, and the rest reset')
  assert.match(page, /toolService\.filterTools\(tools, \{/,
    'the one filtering engine must still be the service')
})

check('the scan result shows the tool photo', () => {
  const scan = read(join('src', 'components', 'ToolScanResult.jsx'))
  // The one place a picture was genuinely missing: confirming the thing in
  // your hand is the thing on the screen.
  assert.match(scan, /<ToolImage tool=\{tool\}/)
  // And it reuses the existing component rather than a second <img>.
  assert.doesNotMatch(scan, /<img /, 'the shared ToolImage must be used')
})

check('tool photos stay cheap on a long list', () => {
  const image = read(join('src', 'components', 'ToolImage.jsx'))
  // Already true before this batch, asserted so it stays true.
  assert.match(image, /loading="lazy"/, 'images must not all load at once')
  assert.match(image, /decoding="async"/)
  assert.match(image, /onError=\{\(\) => setFailed\(true\)\}/,
    'a broken URL must fall back, not show a broken image')
  // No image library was added for this.
  const pkg = JSON.parse(read('package.json'))
  assert.ok(
    !Object.keys(pkg.dependencies).some((d) => /sharp|jimp|image|canvas/i.test(d)),
    'no image-processing dependency may be added',
  )
})
