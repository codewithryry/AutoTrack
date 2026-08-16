import {
  BarChart3,
  Bell,
  LayoutDashboard,
  MessageSquare,
  Package,
  QrCode,
  Settings,
  Undo2,
  UserRound,
  Users,
  ClipboardList,
  FileCheck2,
  HardHat,
} from 'lucide-react'
import { PERM } from '../utils/permissions'
import { ROLE } from '../utils/constants'

/**
 * Single navigation definition, shared by the desktop sidebar, the mobile drawer
 * and the bottom bar. There is deliberately no second copy anywhere.
 *
 * `roles` decides who sees the item; `permission` is the matching route guard in
 * `App.jsx`. Both are listed together so the two can never drift apart — and
 * both are enforced again by the read scoping in `services/db.js`.
 *
 *   Admin       Dashboard · Inventory · Scan · Borrow/Return · Transactions ·
 *               Requests · Messages · Users · Maintenance ·
 *               Notifications · Reports · Settings
 *   Instructor  Dashboard · Inventory · Scan · Borrow/Return · Transactions ·
 *               Requests · Messages · Maintenance · Notifications
 *               (arranged for the tool crib — see the Instructor block below:
 *                the rail leads with inventory, transactions and maintenance and
 *                lifts Scan/Borrow/Return into their own action group, and the
 *                bottom bar is Home · Requests · Scan · Messages · Transactions.)
 *   Student     Dashboard · Inventory · Request · Scan · Return · Messages ·
 *               Transactions
 *
 * The student's list is the borrowing lifecycle in order, and each destination
 * owns exactly one step of it: Inventory and Scan identify a tool, Request is
 * where one ask is raised and followed to Approved, Return closes a loan that
 * is actually out, and Transactions is the history afterwards. Borrow / Return
 * is the crib's own desk and is staff-only — a student never issues a tool to
 * themselves from it. Messages is independent of all of it.
 */

const ALL_ROLES = [ROLE.ADMIN, ROLE.INSTRUCTOR, ROLE.STUDENT]
const STAFF = [ROLE.ADMIN, ROLE.INSTRUCTOR]
const ADMIN_ONLY = [ROLE.ADMIN]

export const NAV_ITEMS = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Laboratory overview',
    roles: ALL_ROLES,
  },
  {
    // The tool inventory, named as what it is for every role. The route, the
    // page and the records behind it are unchanged — only the name is.
    to: '/tools',
    label: 'Inventory',
    icon: Package,
    description: 'Laboratory tool inventory',
    roles: ALL_ROLES,
    permission: PERM.TOOL_VIEW,
  },
  {
    to: '/scan',
    label: 'Scan',
    icon: QrCode,
    description: 'Scan a tool QR code',
    roles: ALL_ROLES,
    primary: true,
  },
  // The crib's counter — issuing an approved tool and receiving it back — is
  // not a destination any more: staff reach it from the request it belongs to,
  // on Requests, so the same handover is not offered from two places. The route
  // and its guard are unchanged.
  {
    // Handing a tool back. Staff reach the same route from the borrow desk and
    // their quick actions, so it is listed as a destination for the student,
    // for whom returning is a step of their own lifecycle.
    to: '/return',
    label: 'Return',
    icon: Undo2,
    description: 'Hand a borrowed tool back',
    roles: [ROLE.STUDENT],
    permission: PERM.RETURN,
  },
  {
    // Borrowing history. Staff read the laboratory's; a student reads their
    // own — the data layer scopes the same page to each.
    to: '/transactions',
    label: 'Transactions',
    icon: ClipboardList,
    description: 'Borrowing history',
    roles: ALL_ROLES,
  },
  {
    // Staff work the queue of everyone's asks and decide them; a student sees
    // their own requests and their states. One page, scoped by role.
    to: '/requests',
    label: 'Requests',
    icon: FileCheck2,
    description: 'Tool requests',
    roles: ALL_ROLES,
    permission: PERM.REQUEST_CREATE,
  },
  {
    to: '/messages',
    label: 'Messages',
    icon: MessageSquare,
    description: 'Conversations',
    roles: ALL_ROLES,
    permission: PERM.MESSAGE_SEND,
  },
  {
    to: '/users',
    label: 'Users',
    icon: Users,
    description: 'Directory',
    roles: STAFF,
    permission: PERM.USER_MANAGE,
  },
  {
    to: '/maintenance',
    label: 'Maintenance',
    icon: HardHat,
    description: 'Service records',
    roles: STAFF,
    permission: PERM.MAINTENANCE_VIEW,
  },
  {
    to: '/notifications',
    label: 'Notifications',
    icon: Bell,
    description: 'Alerts',
    roles: ALL_ROLES,
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: BarChart3,
    description: 'Analytics and exports',
    roles: STAFF,
    permission: PERM.REPORTS_VIEW,
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
    description: 'Configuration',
    roles: STAFF,
    permission: PERM.SETTINGS_VIEW,
  },
]

/**
 * The student's bottom bar — their only navigation, five fixed slots:
 * Dashboard · Inventory · action · Messages · Transactions.
 *
 * The middle slot is the raised action rather than a destination: Scan by
 * default, and the page's own "+" while Requests or Messages is open (see the
 * slots in `AppLayout`). Requests is reached from the inventory — asking for a
 * tool is what starts one — and Return from the borrowing on Transactions.
 * Notifications sits beside the account pill in the top bar.
 */
export const MOBILE_NAV = ['/dashboard', '/tools', '/scan', '/messages', '/transactions']

/**
 * The student's rail, in lifecycle order rather than in the shared list's
 * order. Same items, same permissions — only the sequence differs, exactly as
 * `instructorRailItems` does for the crib.
 */
const STUDENT_RAIL_ORDER = [
  '/dashboard',
  '/tools',
  '/requests',
  '/scan',
  '/return',
  '/messages',
  '/transactions',
]

export function studentRailItems(items = []) {
  return [...items].sort((a, b) => {
    const ai = STUDENT_RAIL_ORDER.indexOf(a.to)
    const bi = STUDENT_RAIL_ORDER.indexOf(b.to)
    return (
      (ai === -1 ? STUDENT_RAIL_ORDER.length : ai) - (bi === -1 ? STUDENT_RAIL_ORDER.length : bi)
    )
  })
}

/**
 * The administrator's bottom bar: Home · Requests · Scan · Transactions, plus a
 * Menu slot the shell adds itself, which opens the drawer below. Notifications
 * leaves the bar because the bell now sits beside the account pill in the top
 * bar — same route, same badge.
 */
export const ADMIN_MOBILE_NAV = ['/dashboard', '/requests', '/scan', '/transactions']

/**
 * The administrator's drawer: only what the bottom bar and the top bar do not
 * already carry. Dashboard, Requests and Transactions are reached from the bar,
 * Notifications from the bell, and account actions — Sign out included — from
 * the account dropdown, so none of them is repeated here.
 */
export const ADMIN_DRAWER_NAV = [
  '/tools',
  '/messages',
  '/users',
  '/maintenance',
  '/reports',
]

/* ------------------------------------------------------------------ *
 * Instructor — the laboratory / tool-crib operational role
 *
 * Everything below is read only when the signed-in role is Instructor. The
 * shared `NAV_ITEMS`, `MOBILE_NAV` and the permission matrix are untouched, so
 * the Admin and Student shells are byte-for-byte what they were.
 * ------------------------------------------------------------------ */

/**
 * The instructor's desktop rail, in the order the job is actually done: the
 * room's state first (inventory), then the paperwork (transactions), then the
 * bench (maintenance), then alerts. Scan, Borrow and Return are lifted out of
 * this list entirely — they are actions, not places, and they get their own
 * prominent block above it (`INSTRUCTOR_QUICK_ACTIONS`).
 */
const INSTRUCTOR_RAIL_ORDER = [
  '/dashboard',
  '/tools',
  '/requests',
  '/transactions',
  '/maintenance',
  '/users',
  '/reports',
  '/messages',
  '/notifications',
  '/settings',
]

/**
 * Routes an instructor reaches from the quick-action block above the rail
 * rather than from the list itself. Settings is *not* one of them: it is a
 * destination on the rail, and only the account dropdown drops it on desktop.
 */
const INSTRUCTOR_RAIL_EXCLUDED = new Set(['/scan', '/borrow'])

/**
 * The three counter actions, as a raised block at the top of the rail.
 *
 * `/return` has never been a rail item — it is reached from Borrow / Return and
 * from a transaction row — but for an instructor receiving equipment all day it
 * is a first-class action, so it is named here alongside the other two. These
 * are the existing routes with their existing guards; nothing new is added.
 */
export const INSTRUCTOR_QUICK_ACTIONS = [
  {
    to: '/scan',
    label: 'Scan',
    icon: QrCode,
    description: 'Read a tool label',
    permission: null,
    primary: true,
  },
]

/**
 * The instructor's bottom bar: Home · Requests · Scan · Messages · Transactions.
 *
 * Scan keeps the middle slot, where the raised primary button is drawn. Tools
 * and Maintenance leave the bar — both are reached from the dashboard cards —
 * and Notifications sits beside the account pill in the top bar.
 */
export const INSTRUCTOR_MOBILE_NAV = [
  '/dashboard',
  '/requests',
  '/scan',
  '/messages',
  '/transactions',
]

/**
 * Pages an instructor reaches that are not rail items, so the shell's top bar
 * can still name them. Only consulted for the Instructor role — the Admin and
 * Student title lookup is unchanged.
 */
/**
 * Routes the top bar names although they are not rail items for any role — the
 * activity log is reached from the dashboard panel rather than the navigation.
 */
export const EXTRA_PAGES = [{ to: '/activity', label: 'Logs' }]

export const INSTRUCTOR_EXTRA_PAGES = [
  { to: '/borrow', label: 'Borrow a tool' },
  { to: '/return', label: 'Return a tool' },
]

/** The instructor's rail list: their visible items, minus the actions, reordered. */
export function instructorRailItems(items = []) {
  const kept = items.filter((item) => !INSTRUCTOR_RAIL_EXCLUDED.has(item.to))
  return [...kept].sort((a, b) => {
    const ai = INSTRUCTOR_RAIL_ORDER.indexOf(a.to)
    const bi = INSTRUCTOR_RAIL_ORDER.indexOf(b.to)
    return (ai === -1 ? INSTRUCTOR_RAIL_ORDER.length : ai) - (bi === -1 ? INSTRUCTOR_RAIL_ORDER.length : bi)
  })
}

/** Bottom-bar route list for one role. */
export function mobileNavForRole(role) {
  // Staff share one bar: four destinations plus the Menu slot the shell adds,
  // which opens the drawer carrying the rest. An instructor now reaches the
  // same places an administrator does, so they get the same shape.
  if (role === ROLE.ADMIN || role === ROLE.INSTRUCTOR) return ADMIN_MOBILE_NAV
  return MOBILE_NAV
}

/**
 * The signed-in user's own account — `/profile`. Deliberately not a rail item:
 * every role has exactly one account, so it is reached from the avatar menu in
 * the top bar rather than the sidebar or the mobile bottom bar, which stay
 * reserved for the places laboratory work happens.
 */
export const ACCOUNT_NAV = {
  to: '/profile',
  label: 'My account',
  studentLabel: 'Student account',
  instructorLabel: 'Instructor account',
  adminLabel: 'Admin account',
  icon: UserRound,
  description: 'Your account and borrowing records',
}

/**
 * The name of the account section — `My account`, for every role.
 *
 * It used to be named after the role ("Student account", "Admin account"), but
 * the role is already on the badge in the same menu, and the destination is the
 * same page whoever opens it. One label, so the menu reads the same everywhere.
 */
export function accountNavLabel() {
  return ACCOUNT_NAV.label
}

/** Navigation for one role — the only way the sidebars are built. */
export function navItemsForRole(role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}

/**
 * Items the signed-in user may see: their role's list, intersected with the
 * permission matrix so a role/permission mismatch fails closed.
 *
 * @param {string} role  the authenticated user's stored role
 * @param {(permission: string) => boolean} can
 */
export function visibleNavItems(role, can) {
  return navItemsForRole(role).filter((item) => !item.permission || can(item.permission))
}
