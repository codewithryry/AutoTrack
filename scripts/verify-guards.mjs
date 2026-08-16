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
    'Scan',
    'Transactions',
    'Requests',
    'Messages',
    'Users',
    'Maintenance',
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
    'Scan',
    'Transactions',
    'Requests',
    'Messages',
    'Users',
    'Maintenance',
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
  for (const label of ['Users', 'Maintenance', 'Reports', 'Settings']) {
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
  assert.equal(shown, pkg.version, 'the loading screen shows a different version')
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
