import * as db from './db'
import { COLLECTIONS } from './db'
import * as notifications from './notifications'
import { ValidationError } from './tools'
import { CONVERSATION_KIND, NOTIF_TYPE, ROLE } from '../utils/constants'
import { PERM, assertCan, isStaff } from '../utils/permissions'
import { uid as makeId, sortBy } from '../utils/helpers'
import { nowISO } from '../utils/dates'

/**
 * Messaging.
 *
 * Two shapes of thread and no more: a `direct` one between two people, and a
 * `request` one attached to a tool request. Both are the same table, and both
 * are private to the people in them — a conversation is readable only through
 * membership, so staff get no back door into a thread they are not part of.
 *
 * Unread counts are derived, never stored: each participant row carries how far
 * that person has read, and the count is the messages after it. There is
 * nothing to keep in step and nothing to go stale.
 *
 * Messages arrive on their own through `db.watchCollection` — see `hooks`.
 */

export const ATTACHMENT_BUCKET = 'message-attachments'
export const ACCEPTED_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const ATTACHMENT_ACCEPT = ACCEPTED_ATTACHMENT_TYPES.join(',')
const MAX_BODY = 4000

/**
 * A standing room — the general thread and the staff room.
 *
 * They have no participant rows: being in one is having the role, which is what
 * `in_conversation` says on the server too. So they are recognised by kind
 * everywhere a membership test would otherwise be made.
 */
export const isBroadcast = (conversation) =>
  conversation?.kind === CONVERSATION_KIND.GENERAL ||
  conversation?.kind === CONVERSATION_KIND.STAFF

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listConversations() {
  return sortBy(await db.list(COLLECTIONS.conversations), 'lastMessageAt', 'desc')
}

export async function getConversation(id) {
  return db.get(COLLECTIONS.conversations, id)
}

export async function participantsOf(conversationId) {
  return db.query(
    COLLECTIONS.conversationParticipants,
    (p) => p.conversationId === conversationId,
  )
}

/** My own participant row — where "how far I have read" lives. */
export async function membership(conversationId, userId) {
  const rows = await participantsOf(conversationId)
  return rows.find((p) => p.userId === userId) ?? null
}

export async function listMessages(conversationId) {
  const rows = await db.query(
    COLLECTIONS.messages,
    (m) => m.conversationId === conversationId,
  )
  return sortBy(rows, 'createdAt', 'asc')
}

/**
 * The threads one account is in, each with the other people in it and how many
 * messages they have not read.
 *
 * One read of each table rather than one per thread: the policies already
 * return only the rows this caller may see, so the joining is done here.
 */
export async function inboxFor(user) {
  if (!user?.id) return []

  const [conversations, participants, messages] = await Promise.all([
    listConversations(),
    db.list(COLLECTIONS.conversationParticipants),
    db.list(COLLECTIONS.messages),
  ])

  const mine = new Set(
    participants.filter((p) => p.userId === user.id).map((p) => p.conversationId),
  )

  return conversations
    // A standing room has no participant rows — everyone with the role is in
    // it. The policies already refuse the staff room to a student, so whatever
    // came back is what this account may read.
    .filter((c) => mine.has(c.id) || isBroadcast(c))
    .map((conversation) => {
      const people = participants.filter((p) => p.conversationId === conversation.id)
      const me = people.find((p) => p.userId === user.id)
      const others = people.filter((p) => p.userId !== user.id)
      const since = me?.lastReadAt ? new Date(me.lastReadAt).getTime() : 0
      const unread = messages.filter(
        (m) =>
          m.conversationId === conversation.id &&
          m.senderId !== user.id &&
          new Date(m.createdAt).getTime() > since,
      ).length

      return { ...conversation, participants: people, others, unread }
    })
}

/** Everything unread across every thread — the badge in the navigation. */
export async function unreadCountFor(user) {
  return (await inboxFor(user)).reduce((total, row) => total + row.unread, 0)
}

/* ------------------------------------------------------------------ *
 * Opening a thread
 * ------------------------------------------------------------------ */

const participantRow = (conversationId, person, { read = false } = {}) => ({
  conversationId,
  userId: person.id,
  userName: person.fullName ?? person.userName ?? '',
  userRole: person.role ?? person.userRole ?? '',
  lastReadAt: read ? nowISO() : null,
  createdAt: nowISO(),
})

async function createConversation({ kind, subject, requestId = null }, actor, people) {
  const id = makeId('CNV')
  const timestamp = nowISO()

  await db.insert(COLLECTIONS.conversations, {
    id,
    kind,
    requestId,
    subject,
    createdBy: actor.id,
    lastMessageAt: null,
    lastMessagePreview: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  for (const person of people) {
    await db.insert(COLLECTIONS.conversationParticipants, {
      // A composite key in Postgres; the data layer needs a single `id`, and
      // this is the only value that is unique per row and stable.
      id: `${id}:${person.id}`,
      ...participantRow(id, person, { read: person.id === actor.id }),
    })
  }

  return db.get(COLLECTIONS.conversations, id)
}

/**
 * The 1-to-1 thread between two people, opened if it does not exist yet.
 *
 * A student talks to staff and staff talk to anyone: the pairing itself is the
 * rule, so two students cannot open a thread with each other.
 */
export async function openDirectConversation(otherUserId, actor) {
  assertCan(actor, PERM.MESSAGE_SEND, 'Your role is not allowed to send messages.')
  if (!otherUserId || otherUserId === actor.id) {
    throw new ValidationError({ recipient: 'Choose somebody to message.' })
  }

  const other = await db.get(COLLECTIONS.users, otherUserId)
  if (!other) throw new Error('That account could not be found.')

  if (!isStaff(actor) && !isStaff(other)) {
    throw new Error('Students can message laboratory staff.')
  }

  // An existing thread is reused rather than duplicated.
  const existing = (await inboxFor(actor)).find(
    (c) =>
      c.kind === CONVERSATION_KIND.DIRECT &&
      c.participants.length === 2 &&
      c.participants.some((p) => p.userId === otherUserId),
  )
  if (existing) return existing

  return createConversation(
    { kind: CONVERSATION_KIND.DIRECT, subject: other.fullName },
    actor,
    [actor, other],
  )
}

/**
 * The thread that belongs to a tool request.
 *
 * Opened with the request itself and carrying the requester plus the staff who
 * will decide it, so the discussion and the decision are in one place.
 */
export async function openRequestConversation(request, actor) {
  // One request, one thread. A retried submit or a second call for the same
  // request finds the thread it already has rather than opening a twin beside
  // it — the same reuse `openDirectConversation` does for a pairing.
  const existing = (await listConversations().catch(() => [])).find(
    (c) => c.kind === CONVERSATION_KIND.REQUEST && c.requestId === request.id,
  )
  if (existing) return existing

  const requester =
    request.userId === actor?.id ? actor : await db.get(COLLECTIONS.users, request.userId)

  // Whoever may decide requests is in the thread. Read from the directory the
  // application already has rather than a list kept anywhere else.
  const directory = await db.list(COLLECTIONS.users).catch(() => [])
  const staff = directory.filter((u) => isStaff(u) && u.status === 'Active')

  const people = [requester, ...staff, actor].filter(
    (person, index, all) =>
      person?.id && all.findIndex((other) => other?.id === person.id) === index,
  )

  return createConversation(
    {
      kind: CONVERSATION_KIND.REQUEST,
      subject: `${request.toolName} · ${request.id}`,
      requestId: request.id,
    },
    actor,
    people,
  )
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

export function validateAttachment(file) {
  if (!file) return null
  if (!ACCEPTED_ATTACHMENT_TYPES.includes(file.type)) {
    return 'Attach a JPEG, PNG, WebP or PDF file.'
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `That file is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB).`
  }
  return null
}

/**
 * Upload an attachment and return what to store on the message.
 *
 * The object goes in a folder named after the sender, which is what the storage
 * policy checks — nobody can write into anyone else's folder.
 */
export async function uploadAttachment(file, actor) {
  const invalid = validateAttachment(file)
  if (invalid) throw new ValidationError({ attachment: invalid })

  const safeName = String(file.name ?? 'attachment').replace(/[^\w.\-]/g, '_').slice(-80)
  const path = `${actor.id}/${Date.now()}-${safeName}`
  await db.uploadFile(ATTACHMENT_BUCKET, path, file, { contentType: file.type })

  return {
    attachmentUrl: path, // the object path; a link is minted on demand
    attachmentName: file.name ?? safeName,
    attachmentType: file.type,
    attachmentSize: file.size,
  }
}

/** A link to an attachment that works for a while and then stops. */
export async function attachmentLink(path, expiresInSeconds = 3600) {
  if (!path) return null
  return db.signedFileUrl(ATTACHMENT_BUCKET, path, expiresInSeconds)
}

/**
 * Post a message.
 *
 * `silent` is for the lines the application writes into a thread itself — a
 * decision on a request, say — which the recipient is already being notified
 * about through the request. Everything a person types notifies the others.
 */
export async function send({ conversationId, body = '', attachment = null }, actor, { silent = false } = {}) {
  assertCan(actor, PERM.MESSAGE_SEND, 'Your role is not allowed to send messages.')

  const text = String(body ?? '').trim()
  if (!text && !attachment) {
    throw new ValidationError({ body: 'Write a message or attach a file.' })
  }
  if (text.length > MAX_BODY) {
    throw new ValidationError({ body: `Keep the message under ${MAX_BODY} characters.` })
  }

  const conversation = await getConversation(conversationId)
  if (!conversation) throw new Error('That conversation could not be found.')

  const timestamp = nowISO()
  const record = {
    id: makeId('MSG'),
    conversationId,
    senderId: actor.id,
    senderName: actor.fullName,
    senderRole: actor.role,
    body: text,
    attachmentUrl: attachment?.attachmentUrl ?? null,
    attachmentName: attachment?.attachmentName ?? null,
    attachmentType: attachment?.attachmentType ?? null,
    attachmentSize: attachment?.attachmentSize ?? null,
    createdAt: timestamp,
  }

  await db.insert(COLLECTIONS.messages, record)

  // The thread carries its own last line so an inbox can be listed without
  // reading every message in every thread.
  await db
    .update(COLLECTIONS.conversations, conversationId, {
      lastMessageAt: timestamp,
      lastMessagePreview: text || record.attachmentName || 'Attachment',
      updatedAt: timestamp,
    })
    .catch((err) => console.warn('[messages] the thread summary was not updated', err))

  // Sending is reading: your own message cannot be unread by you.
  await markRead(conversationId, actor).catch(() => {})

  if (!silent) {
    const people = await participantsOf(conversationId)
    for (const person of people) {
      if (person.userId === actor.id) continue
      await notifications
        .create({
          type: NOTIF_TYPE.MESSAGE,
          title: `Message from ${actor.fullName}`,
          message: text || `${actor.fullName} sent an attachment.`,
          // One unread notification per thread per person, replaced as the
          // conversation moves on rather than one per message.
          dedupeKey: `message:${conversationId}:${person.userId}:${timestamp}`,
          userId: person.userId,
          link: `/messages/${conversationId}`,
        })
        .catch((err) => console.warn('[messages] a message notification failed', err))
    }
  }

  return record
}

/* ------------------------------------------------------------------ *
 * Removing a thread
 * ------------------------------------------------------------------ */

/**
 * Delete a conversation outright.
 *
 * Anybody in the thread may do it — a student, an instructor or an
 * administrator — because the people in a conversation own it. It is a shared
 * row, so this removes it for everyone in it rather than hiding it from one
 * inbox, which is what the confirmation says before it is done. Membership is
 * the whole boundary, here and in the `conversations_delete` policy: a thread
 * the caller is not part of cannot be read, let alone removed.
 *
 * The conversation row goes first, and the participant and message rows go with
 * it: they are declared `on delete cascade`, so Postgres removes them in the
 * same statement. Removing them here first — which is what an obvious reading of
 * "delete everything under it" suggests — is actively wrong: deleting the
 * administrator's own participant row ends their membership of the thread, and
 * `conversations_select` is membership, so the `delete … returning` that follows
 * comes back empty. The row is gone and the application reports that it could
 * not be deleted. One statement, in the right order, avoids all of it.
 *
 * The message notifications pointing at the thread go too: a notification whose
 * link opens a conversation that no longer exists is a dead end.
 *
 * A standing room is not deletable: it is the general or staff room, which the
 * application expects to exist for every account with that role.
 */
export async function remove(conversationId, actor) {
  assertCan(actor, PERM.MESSAGE_SEND, 'Your role is not allowed to delete a conversation.')

  const conversation = await getConversation(conversationId)
  if (!conversation) throw new Error('That conversation could not be found.')
  if (isBroadcast(conversation)) {
    throw new Error('The general and staff rooms cannot be deleted.')
  }

  // Membership, not role: an account that is not in the thread has no business
  // removing it. An administrator is in every thread they can open, so this
  // costs them nothing.
  const mine = await membership(conversationId, actor.id)
  if (!mine) throw new Error('You are not part of that conversation.')

  await notifications.removeForConversation(conversationId).catch(() => {})

  const deleted = await db.remove(COLLECTIONS.conversations, conversationId)
  if (!deleted) {
    throw new Error('That conversation could not be deleted. Check your permissions and try again.')
  }

  // Belt and braces for the device's own copy: the cascade happened on the
  // server, and this leaves nothing behind in the cache either. Neither call
  // finds anything to do once the cascade has run.
  await db
    .removeWhere(COLLECTIONS.messages, (m) => m.conversationId === conversationId)
    .catch(() => {})
  await db
    .removeWhere(COLLECTIONS.conversationParticipants, (p) => p.conversationId === conversationId)
    .catch(() => {})

  return true
}

/**
 * Clear the whole of messaging — every thread, for everybody.
 *
 * The same action as `remove`, applied to the lot: the threads themselves go,
 * and the standing rooms are emptied rather than deleted, because the general
 * and staff rooms are expected to exist for every account with the role. It is
 * one write per table rather than one per thread, so clearing a busy laboratory
 * is a handful of requests, not hundreds.
 *
 * Deleting is deleting for everyone. The rows leave the database, so an
 * instructor's and a student's inbox lose the thread exactly as the
 * administrator's does — there is no per-account copy to leave behind.
 */
export async function removeAll(actor) {
  assertCan(actor, PERM.DATA_MANAGE, 'Only an administrator can clear the conversations.')

  const conversations = await listConversations()
  const doomed = new Set(conversations.filter((c) => !isBroadcast(c)).map((c) => c.id))
  const rooms = conversations.filter(isBroadcast)

  // The threads first, for the reason `remove` explains: the participant rows
  // are the membership every read of a conversation is decided by, so removing
  // them before the thread would make the thread unreadable — and therefore
  // undeletable — half way through. The cascade takes them, and every message in
  // them, with the row itself.
  await db.removeWhere(COLLECTIONS.conversations, (c) => doomed.has(c.id))

  // What the cascade does not reach: the standing rooms cannot be deleted, so
  // they are emptied instead, which is what "clear the conversations" means for
  // a thread that has to go on existing.
  const roomIds = new Set(rooms.map((r) => r.id))
  await db.removeWhere(COLLECTIONS.messages, (m) => roomIds.has(m.conversationId)).catch(() => {})
  await db
    .removeWhere(COLLECTIONS.notifications, (n) => String(n.link ?? '').startsWith('/messages/'))
    .catch(() => {})

  // A room with nothing in it must not still advertise a last message.
  for (const room of rooms) {
    await db
      .update(COLLECTIONS.conversations, room.id, {
        lastMessageAt: null,
        lastMessagePreview: '',
        updatedAt: nowISO(),
      })
      .catch(() => {})
  }

  return doomed.size
}

/** Mark this thread read up to now, for this account. */
export async function markRead(conversationId, actor) {
  if (!actor?.id) return null
  const mine = await membership(conversationId, actor.id)

  // A standing room has no participant rows until somebody reads it: the row
  // is written on that first read, which is what gives them an unread count
  // from then on. Membership is still the role — this only records how far
  // they have read.
  if (!mine) {
    const conversation = await getConversation(conversationId).catch(() => null)
    if (!isBroadcast(conversation)) return null
    return db
      .insert(COLLECTIONS.conversationParticipants, {
        id: `${conversationId}:${actor.id}`,
        ...participantRow(conversationId, actor, { read: true }),
      })
      .catch(() => null)
  }

  return db.update(COLLECTIONS.conversationParticipants, mine.id ?? `${conversationId}:${actor.id}`, {
    lastReadAt: nowISO(),
  })
}

export { CONVERSATION_KIND, ROLE }
