import {
  BarChart3,
  Bell,
  LayoutDashboard,
  QrCode,
  Repeat,
  Settings,
  Undo2,
  UserRound,
  Users,
  Wrench,
  ClipboardList,
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
 *   Admin       Dashboard · Tools · Scan · Borrow/Return · Transactions ·
 *               Users · Maintenance · Notifications · Reports · Settings
 *   Instructor  Dashboard · Tools · Scan · Borrow/Return · Transactions ·
 *               Maintenance · Notifications
 *               (arranged for the tool crib — see the Instructor block below:
 *                the rail leads with inventory, transactions and maintenance and
 *                lifts Scan/Borrow/Return into their own action group, and the
 *                bottom bar is Home · Tools · Scan · Transactions · Maintenance.)
 *   Student     Dashboard · Tools · Scan · Borrow/Return · Transactions ·
 *               Notifications
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
    to: '/tools',
    label: 'Tools',
    icon: Wrench,
    description: 'Inventory',
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
  {
    to: '/borrow',
    label: 'Borrow / Return',
    icon: Repeat,
    description: 'Issue and receive tools',
    roles: ALL_ROLES,
    permission: PERM.BORROW,
  },
  {
    to: '/transactions',
    label: 'Transactions',
    icon: ClipboardList,
    description: 'Borrowing history',
    roles: ALL_ROLES,
  },
  {
    to: '/users',
    label: 'Users',
    icon: Users,
    description: 'Directory',
    roles: ADMIN_ONLY,
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
    roles: ADMIN_ONLY,
    permission: PERM.REPORTS_VIEW,
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
    description: 'Configuration',
    roles: ADMIN_ONLY,
    permission: PERM.SETTINGS_VIEW,
  },
]

/** Four destinations plus the scan action for the mobile bottom bar. */
export const MOBILE_NAV = ['/dashboard', '/tools', '/scan', '/transactions', '/notifications']

/**
 * The administrator's bottom bar: Home · Tools · Scan · Transactions, plus a
 * Menu slot the shell adds itself, which opens the drawer below. Notifications
 * leaves the bar because the bell now sits beside the account pill in the top
 * bar — same route, same badge.
 */
export const ADMIN_MOBILE_NAV = ['/dashboard', '/tools', '/scan', '/transactions']

/**
 * The administrator's drawer: only what the bottom bar and the top bar do not
 * already carry. Dashboard, Tools, Transactions and Settings are reached from
 * the bar, Notifications from the bell, and account actions — Sign out included
 * — from the account dropdown, so none of them is repeated here.
 */
export const ADMIN_DRAWER_NAV = ['/borrow', '/users', '/maintenance', '/reports']

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
  '/transactions',
  '/maintenance',
  '/notifications',
]

/** Routes an instructor reaches from the quick-action block, not from the list. */
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
  {
    to: '/borrow',
    label: 'Borrow',
    icon: Repeat,
    description: 'Issue a tool',
    permission: PERM.BORROW,
  },
  {
    to: '/return',
    label: 'Return',
    icon: Undo2,
    description: 'Receive a tool',
    permission: PERM.RETURN,
  },
]

/**
 * The instructor's bottom bar: Home · Tools · Scan · Transactions · Maintenance.
 *
 * Scan keeps the middle slot, where the raised primary button is drawn. Every
 * slot is a real destination — there is no "More" control and no second menu:
 * Notifications sits beside the account pill in the top bar, and the counter
 * actions are on the dashboard hero and the Scan result.
 */
export const INSTRUCTOR_MOBILE_NAV = [
  '/dashboard',
  '/tools',
  '/scan',
  '/transactions',
  '/maintenance',
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
  if (role === ROLE.INSTRUCTOR) return INSTRUCTOR_MOBILE_NAV
  if (role === ROLE.ADMIN) return ADMIN_MOBILE_NAV
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

/** Role-appropriate name for the account section. */
export function accountNavLabel(role) {
  if (role === ROLE.STUDENT) return ACCOUNT_NAV.studentLabel
  if (role === ROLE.INSTRUCTOR) return ACCOUNT_NAV.instructorLabel
  if (role === ROLE.ADMIN) return ACCOUNT_NAV.adminLabel
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
