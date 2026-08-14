import {
  BarChart3,
  Bell,
  LayoutDashboard,
  QrCode,
  Repeat,
  Settings,
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
 * The signed-in user's own account — `/profile`. Deliberately not a rail item:
 * every role has exactly one account, so it is reached from the avatar menu in
 * the top bar rather than the sidebar or the mobile bottom bar, which stay
 * reserved for the places laboratory work happens.
 */
export const ACCOUNT_NAV = {
  to: '/profile',
  label: 'My account',
  studentLabel: 'Student account',
  icon: UserRound,
  description: 'Your account and borrowing records',
}

/** Role-appropriate name for the account section. */
export function accountNavLabel(role) {
  return role === ROLE.STUDENT ? ACCOUNT_NAV.studentLabel : ACCOUNT_NAV.label
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
