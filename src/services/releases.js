/**
 * The client half of the "Check for updates" feature in Settings → About.
 *
 * It asks the public GitHub Releases API for the latest published release of
 * this repository and returns just the fields the page needs. Everything about
 * this module is written so that failing is free: no credentials are involved,
 * and every failure — a network problem, a rate limit, a malformed reply, a
 * timeout — reaches the caller as the same generic error, never as raw API
 * text.
 *
 * The check only ever runs when the user presses the button, so there is no
 * auto-check and no cache: each press is deliberately a fresh request.
 */

import { stripVersionPrefix } from '../utils/version'

const REPO = 'codewithryry/AutoTrack'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
/** Where the user is taken to review, or install from, the update. */
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

/** Slower than the assistant's own timeout, because GitHub can be slow. */
const TIMEOUT_MS = 8000

/**
 * The latest published release, or a reason-free failure.
 *
 * Rejects with a plain error that the interface shows as "Unable to check for
 * updates" — never with the underlying message, which could be a rate-limit
 * policy or an HTML page pretending to be JSON. Verifying the tag looks like a
 * real version keeps a mislabelled release from reading as an update either
 * way — a newer, or an older, one.
 */
export async function getLatestRelease() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(API_URL, {
      headers: { accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('the update service is unavailable')
    const { tag_name, html_url } = await response.json()
    if (typeof tag_name !== 'string' || !tag_name.trim()) {
      throw new Error('the update service returned no version')
    }
    const version = stripVersionPrefix(tag_name)
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      throw new Error('the update service returned no version')
    }
    return {
      version,
      htmlUrl:
        typeof html_url === 'string' && html_url ? html_url : RELEASES_PAGE,
    }
  } catch {
    // Network failure, timeout, rate limit, unreadable body or an invariant
    // above — the same outcome for the user, and no raw detail shown.
    throw new Error('Unable to check for updates')
  } finally {
    clearTimeout(timer)
  }
}