import {
  BarChart3,
  Bell,
  LayoutDashboard,
  QrCode,
  Repeat,
  Settings,
  Users,
  Wrench,
  ClipboardList,
  HardHat,
} from 'lucide-react'
import { PERM } from '../utils/permissions'

/**
 * Single navigation definition, shared by the desktop sidebar, the mobile
 * drawer and the bottom bar. `permission` decides whether a role sees the item;
 * routes are guarded independently in App.jsx.
 */
export const NAV_ITEMS = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Laboratory overview',
  },
  { to: '/tools', label: 'Tools', icon: Wrench, description: 'Inventory', permission: PERM.TOOL_VIEW },
  {
    to: '/scan',
    label: 'Scan',
    icon: QrCode,
    description: 'Scan a tool QR code',
    primary: true,
  },
  {
    to: '/borrow',
    label: 'Borrow / Return',
    icon: Repeat,
    description: 'Issue and receive tools',
    permission: PERM.BORROW,
  },
  {
    to: '/transactions',
    label: 'Transactions',
    icon: ClipboardList,
    description: 'Borrowing history',
  },
  { to: '/users', label: 'Users', icon: Users, description: 'Directory', permission: PERM.USER_VIEW },
  {
    to: '/maintenance',
    label: 'Maintenance',
    icon: HardHat,
    description: 'Service records',
    permission: PERM.MAINTENANCE_VIEW,
  },
  { to: '/notifications', label: 'Notifications', icon: Bell, description: 'Alerts' },
  {
    to: '/reports',
    label: 'Reports',
    icon: BarChart3,
    description: 'Analytics and exports',
    permission: PERM.REPORTS_VIEW,
  },
  { to: '/settings', label: 'Settings', icon: Settings, description: 'Configuration' },
]

/** Four destinations plus the scan action for the mobile bottom bar. */
export const MOBILE_NAV = ['/dashboard', '/tools', '/scan', '/transactions', '/notifications']

export function visibleNavItems(can) {
  return NAV_ITEMS.filter((item) => !item.permission || can(item.permission))
}
