import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import * as announcementService from '../services/announcements'

/**
 * Everything the notification centre shows: the published announcements with this account's read state. The management
 * section reads `all` for the unpublished drafts as well. Every instance stays
 * in step through the service's change event.
 */
export function useAnnouncements() {
  const { user } = useApp()
  const userId = user?.id
  const [all, setAll] = useState(announcementService.list)
  const [readIds, setReadIds] = useState(() => announcementService.readIds(userId))

  useEffect(() => {
    const refresh = () => {
      setAll(announcementService.list())
      setReadIds(announcementService.readIds(userId))
    }
    refresh()
    return announcementService.subscribe(refresh)
  }, [userId])

  const published = all.filter((row) => row.published)
  const unread = published.filter((row) => !readIds.includes(row.id))

  const markRead = useCallback((id) => announcementService.markRead(userId, id), [userId])

  return {
    all,
    published,
    unread,
    readIds,
    markRead,
    unreadCount: unread.length,
  }
}
