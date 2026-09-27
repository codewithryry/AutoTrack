/**
 * Announcements — UI prototype.
 *
 * Staff post short notices that every account sees in the notification
 * centre. For now the records live in this device's storage only, so the
 * interaction flow can be tried out before a database table exists; the whole
 * feature is therefore enabled in development builds only
 * (`ANNOUNCEMENTS_PREVIEW`). Every write is still permission-checked, the same
 * way the real services are.
 */

import { PERM, assertCan } from '../utils/permissions'

export const ANNOUNCEMENTS_PREVIEW = import.meta.env.DEV

export const ANNOUNCEMENT_PRIORITY = {
  NORMAL: 'Normal',
  IMPORTANT: 'Important',
  URGENT: 'Urgent',
}

const STORE_KEY = 'stms.announcements'
const READ_KEY = (userId) => `stms.announcements-read.${userId ?? 'guest'}`
const CHANGE_EVENT = 'stms:announcements'

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: the change lasts until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** Every announcement, newest first. */
export function list() {
  const rows = readJSON(STORE_KEY, [])
  return Array.isArray(rows)
    ? [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    : []
}

/** Title and message are required; priority must be one of the known values. */
export function validate(form) {
  const errors = {}
  if (!form.title?.trim()) errors.title = 'Enter a title.'
  else if (form.title.trim().length > 80) errors.title = 'Keep the title under 80 characters.'
  if (!form.message?.trim()) errors.message = 'Enter a message.'
  else if (form.message.trim().length > 500) errors.message = 'Keep the message under 500 characters.'
  if (!Object.values(ANNOUNCEMENT_PRIORITY).includes(form.priority)) {
    errors.priority = 'Choose a priority.'
  }
  return errors
}

export function create(user, form) {
  assertCan(user, PERM.ANNOUNCEMENT_MANAGE)
  const now = new Date().toISOString()
  const row = {
    id: `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: form.title.trim(),
    message: form.message.trim(),
    priority: form.priority,
    published: !!form.published,
    authorName: user.fullName ?? user.role,
    createdAt: now,
    updatedAt: now,
  }
  writeJSON(STORE_KEY, [row, ...list()])
  return row
}

export function update(user, id, form) {
  assertCan(user, PERM.ANNOUNCEMENT_MANAGE)
  writeJSON(
    STORE_KEY,
    list().map((row) =>
      row.id === id
        ? {
            ...row,
            title: form.title.trim(),
            message: form.message.trim(),
            priority: form.priority,
            published: !!form.published,
            updatedAt: new Date().toISOString(),
          }
        : row,
    ),
  )
}

export function setPublished(user, id, published) {
  assertCan(user, PERM.ANNOUNCEMENT_MANAGE)
  writeJSON(
    STORE_KEY,
    list().map((row) =>
      row.id === id ? { ...row, published, updatedAt: new Date().toISOString() } : row,
    ),
  )
}

export function remove(user, id) {
  assertCan(user, PERM.ANNOUNCEMENT_MANAGE)
  writeJSON(
    STORE_KEY,
    list().filter((row) => row.id !== id),
  )
}

/** Ids this account has marked as read or dismissed. */
export function readIds(userId) {
  const ids = readJSON(READ_KEY(userId), [])
  return Array.isArray(ids) ? ids : []
}

export function markRead(userId, id) {
  const ids = readIds(userId)
  if (!ids.includes(id)) writeJSON(READ_KEY(userId), [...ids, id])
}

/** Calls `callback` whenever announcements or read state change. */
export function subscribe(callback) {
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

/* ---------------------- notification centre toggle ---------------------- */

const OPEN_EVENT = 'stms:notification-center'

/** Opens the notification centre from anywhere (header button, banner). */
export function openNotificationCenter() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

export function onOpenNotificationCenter(callback) {
  window.addEventListener(OPEN_EVENT, callback)
  return () => window.removeEventListener(OPEN_EVENT, callback)
}
