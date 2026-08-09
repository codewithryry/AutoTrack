/**
 * Domain vocabulary for the automotive laboratory.
 * Everything that renders a status, condition, role or category reads from here so
 * labels and colours stay identical across the whole application.
 */

export const APP_NAME = 'Smart Tool Monitoring System'
export const APP_TAGLINE = 'Track • Manage • Return'

/* ------------------------------------------------------------------ *
 * Tool status
 * ------------------------------------------------------------------ */
export const TOOL_STATUS = {
  AVAILABLE: 'Available',
  BORROWED: 'Borrowed',
  OVERDUE: 'Overdue',
  MAINTENANCE: 'Maintenance',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  RETIRED: 'Retired',
}

export const TOOL_STATUSES = Object.values(TOOL_STATUS)

/** Statuses that block a borrow, with the reason shown to the user. */
export const NON_BORROWABLE_REASON = {
  [TOOL_STATUS.BORROWED]: 'This tool is currently borrowed by someone else.',
  [TOOL_STATUS.OVERDUE]: 'This tool is overdue and has not been returned yet.',
  [TOOL_STATUS.MAINTENANCE]: 'This tool is currently under maintenance.',
  [TOOL_STATUS.DAMAGED]: 'This tool is marked as damaged and cannot be borrowed.',
  [TOOL_STATUS.LOST]: 'This tool is reported lost and cannot be borrowed.',
  [TOOL_STATUS.RETIRED]: 'This tool has been retired from the laboratory inventory.',
}

/* ------------------------------------------------------------------ *
 * Tool condition
 * ------------------------------------------------------------------ */
export const CONDITION = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  FAIR: 'Fair',
  NEEDS_REPAIR: 'Needs Repair',
  DAMAGED: 'Damaged',
}

export const CONDITIONS = Object.values(CONDITION)

/** Conditions selectable by a student/instructor when handing a tool back. */
export const RETURN_CONDITIONS = [
  CONDITION.EXCELLENT,
  CONDITION.GOOD,
  CONDITION.FAIR,
  CONDITION.DAMAGED,
]

/* ------------------------------------------------------------------ *
 * Categories & locations — automotive laboratory specific
 * ------------------------------------------------------------------ */
export const CATEGORIES = [
  'Hand Tools',
  'Power Tools',
  'Measuring Tools',
  'Diagnostic Tools',
  'Engine Tools',
  'Electrical Tools',
  'Brake Tools',
  'Suspension Tools',
  'Transmission Tools',
  'Safety Equipment',
  'Other',
]

export const LOCATIONS = [
  'Tool Room Shelf A',
  'Tool Room Shelf B',
  'Tool Room Shelf C',
  'Engine Bay Cabinet A',
  'Engine Bay Cabinet B',
  'Diagnostic Room',
  'Brake System Cabinet',
  'Electrical Laboratory',
  'Transmission Bench',
  'Suspension Bay',
  'Safety Equipment Locker',
  'Instructor Workstation',
]

/** Categories where a serial number is operationally important. */
export const SERIAL_CRITICAL_CATEGORIES = [
  'Diagnostic Tools',
  'Electrical Tools',
  'Measuring Tools',
  'Power Tools',
]

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */
export const ROLE = {
  ADMIN: 'Admin',
  INSTRUCTOR: 'Instructor',
  STUDENT: 'Student',
}

export const ROLES = Object.values(ROLE)

export const USER_STATUS = { ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended' }
export const USER_STATUSES = Object.values(USER_STATUS)

export const COURSES = [
  'BS Automotive Engineering Technology',
  'Diploma in Automotive Technology',
  'Automotive Servicing NC II',
  'Automotive Servicing NC III',
  'BS Mechanical Engineering',
]

export const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'N/A']

/* ------------------------------------------------------------------ *
 * Transactions
 * ------------------------------------------------------------------ */
export const TXN_STATUS = {
  BORROWED: 'Borrowed',
  RETURNED: 'Returned',
  OVERDUE: 'Overdue',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
}

export const TXN_STATUSES = Object.values(TXN_STATUS)

/** A transaction in one of these states still has the tool out of the room. */
export const ACTIVE_TXN_STATUSES = [TXN_STATUS.BORROWED, TXN_STATUS.OVERDUE]

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */
export const NOTIF_TYPE = {
  OVERDUE: 'overdue',
  DUE_SOON: 'due_soon',
  RETURNED: 'returned',
  BORROWED: 'borrowed',
  DAMAGED: 'damaged',
  MAINTENANCE: 'maintenance',
  SYSTEM: 'system',
}

/* ------------------------------------------------------------------ *
 * Maintenance
 * ------------------------------------------------------------------ */
export const MAINTENANCE_TYPES = [
  'Preventive',
  'Corrective',
  'Calibration',
  'Inspection',
  'Cleaning',
  'Parts Replacement',
]

export const MAINTENANCE_STATUS = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const MAINTENANCE_STATUSES = Object.values(MAINTENANCE_STATUS)

/* ------------------------------------------------------------------ *
 * Activity log actions
 * ------------------------------------------------------------------ */
export const ACTIVITY = {
  TOOL_CREATED: 'tool_created',
  TOOL_UPDATED: 'tool_updated',
  TOOL_DELETED: 'tool_deleted',
  TOOL_BORROWED: 'tool_borrowed',
  TOOL_RETURNED: 'tool_returned',
  TOOL_OVERDUE: 'tool_overdue',
  STATUS_CHANGED: 'status_changed',
  CONDITION_CHANGED: 'condition_changed',
  MAINTENANCE_SCHEDULED: 'maintenance_scheduled',
  MAINTENANCE_COMPLETED: 'maintenance_completed',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  LOGIN: 'login',
  SYSTEM: 'system',
}

/* ------------------------------------------------------------------ *
 * Colour tokens — Tailwind class strings keyed by domain value.
 * Kept as complete literal strings so Tailwind's JIT can see them.
 * ------------------------------------------------------------------ */
export const STATUS_STYLES = {
  [TOOL_STATUS.AVAILABLE]:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
  [TOOL_STATUS.BORROWED]:
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
  [TOOL_STATUS.OVERDUE]:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30',
  [TOOL_STATUS.MAINTENANCE]:
    'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30',
  [TOOL_STATUS.DAMAGED]:
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
  [TOOL_STATUS.LOST]:
    'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30',
  [TOOL_STATUS.RETIRED]:
    'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20',
}

export const TXN_STATUS_STYLES = {
  [TXN_STATUS.BORROWED]: STATUS_STYLES[TOOL_STATUS.BORROWED],
  [TXN_STATUS.RETURNED]: STATUS_STYLES[TOOL_STATUS.AVAILABLE],
  [TXN_STATUS.OVERDUE]: STATUS_STYLES[TOOL_STATUS.OVERDUE],
  [TXN_STATUS.DAMAGED]: STATUS_STYLES[TOOL_STATUS.DAMAGED],
  [TXN_STATUS.LOST]: STATUS_STYLES[TOOL_STATUS.LOST],
}

export const CONDITION_STYLES = {
  [CONDITION.EXCELLENT]:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
  [CONDITION.GOOD]:
    'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/30',
  [CONDITION.FAIR]:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  [CONDITION.NEEDS_REPAIR]:
    'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30',
  [CONDITION.DAMAGED]:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30',
}

export const ROLE_STYLES = {
  [ROLE.ADMIN]:
    'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amberline-400/15 dark:text-amberline-300 dark:border-amberline-400/30',
  [ROLE.INSTRUCTOR]:
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30',
  [ROLE.STUDENT]:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30',
}

export const USER_STATUS_STYLES = {
  [USER_STATUS.ACTIVE]: STATUS_STYLES[TOOL_STATUS.AVAILABLE],
  [USER_STATUS.INACTIVE]: STATUS_STYLES[TOOL_STATUS.RETIRED],
  [USER_STATUS.SUSPENDED]: STATUS_STYLES[TOOL_STATUS.OVERDUE],
}

export const MAINTENANCE_STATUS_STYLES = {
  [MAINTENANCE_STATUS.SCHEDULED]:
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
  [MAINTENANCE_STATUS.IN_PROGRESS]:
    'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30',
  [MAINTENANCE_STATUS.COMPLETED]:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
  [MAINTENANCE_STATUS.CANCELLED]:
    'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20',
}

export const DEFAULT_SETTINGS = {
  id: 'app-settings',
  labName: 'Automotive Laboratory',
  labLocation: 'Technical Education Building — Ground Floor',
  institution: 'College of Engineering Technology',
  defaultBorrowDays: 3,
  maxBorrowDays: 30,
  dueSoonThresholdDays: 1,
  notifyOverdue: true,
  notifyDueSoon: true,
  notifyReturns: true,
  notifyMaintenance: true,
  theme: 'light',
  maintenanceIntervalDays: 90,
  updatedAt: null,
}
