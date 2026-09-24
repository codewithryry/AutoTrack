import { useSyncExternalStore } from 'react'
import { askTobi, getTobiUsage } from '../services/tobi'

/**
 * TOBI's conversations, shared by the floating card and the full `/tobi` page.
 *
 * Saved on this device, per account, in localStorage — the recent chats list
 * survives closing the app. Nothing is stored on the server: the server only
 * ever sees the conversation for the length of one request. Signing out calls
 * `clearTobiHistory()`, so the next person on a shared device starts empty.
 *
 * A module-level store rather than component state, so the card and the page
 * read one conversation, and an answer that arrives after the card is closed
 * still lands in the chat that asked for it.
 */

const PREFIX = 'tooltrack.tobi.'
const MAX_CONVERSATIONS = 30
const MAX_MESSAGES = 60

const stores = new Map()

let nextId = 0
export const newId = (p = 'm') => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`


function read(userId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${PREFIX}${userId}`) || 'null')
    if (parsed && Array.isArray(parsed.conversations)) return parsed
  } catch {
    // Unreadable or blocked storage: start empty, the chat still works.
  }
  return { conversations: [], activeId: null }
}

function storeFor(userId) {
  if (stores.has(userId)) return stores.get(userId)
  const saved = read(userId)
  let state = { ...saved, pending: null, failure: null, usage: null }
  let usageRequested = false
  const listeners = new Set()

  const persist = () => {
    try {
      localStorage.setItem(
        `${PREFIX}${userId}`,
        JSON.stringify({
          activeId: state.activeId,
          conversations: state.conversations
            .filter((c) => c.messages.length)
            .slice(0, MAX_CONVERSATIONS)
            .map((c) => ({ ...c, messages: c.messages.slice(-MAX_MESSAGES) })),
        }),
      )
    } catch {
      // Private mode or full storage: this session keeps it in memory.
    }
  }
  const set = (patch) => {
    state = { ...state, ...patch }
    persist()
    listeners.forEach((listener) => listener())
  }
  const updateConversation = (id, fn) =>
    set({
      conversations: state.conversations
        .map((c) => (c.id === id ? fn(c) : c))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    })

  const send = async (conversationId, path) => {
    const conversation = state.conversations.find((c) => c.id === conversationId)
    if (!conversation) return
    set({ pending: conversationId, failure: null })
    try {
      const answer = await askTobi({ messages: conversation.messages, path })
      updateConversation(conversationId, (c) => ({
        ...c,
        // Named by TOBI after its first answer, for the topic rather than the
        // user's own words; a chat keeps the first title it is given.
        title: c.title || answer.title || '',
        updatedAt: Date.now(),
        messages: [
          ...c.messages,
          {
            id: newId(),
            role: 'assistant',
            content: answer.reply,
            links: answer.links,
            // Taken once, straight away, by whichever chat view is open.
            ...(answer.navigate ? { navigateTo: answer.navigate.to, navigated: false, at: Date.now() } : {}),
            actions: answer.actions.map((action) => ({ ...action, state: 'open' })),
          },
        ],
      }))
      set({ pending: null, usage: answer.usage ?? state.usage })
    } catch (err) {
      if (err?.usage) set({ usage: err.usage })
      // The daily limit is TOBI's own answer, not a fault: said in the chat,
      // with nothing to retry until tomorrow.
      if (err?.code === 'daily_limit') {
        updateConversation(conversationId, (c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: [...c.messages, { id: newId(), role: 'assistant', content: err.message, notice: 'limit' }],
        }))
        set({ pending: null })
        return
      }
      set({
        pending: null,
        failure: {
          conversationId,
          message: err?.message || 'TOBI ran into a problem.',
          retryable: err?.retryable !== false,
        },
      })
    }
  }

  const api = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => state,
    ask(text, path) {
      const question = text.trim()
      if (!question || state.pending) return
      const message = { id: newId(), role: 'user', content: question }
      let id = state.activeId
      if (!state.conversations.some((c) => c.id === id)) {
        id = newId('c')
        set({
          activeId: id,
          conversations: [{ id, title: '', updatedAt: Date.now(), messages: [] }, ...state.conversations],
        })
      }
      updateConversation(id, (c) => {
        const messages = [...c.messages, message]
        return { ...c, messages, updatedAt: Date.now() }
      })
      send(id, path)
    },
    retry(path) {
      if (state.failure?.conversationId) send(state.failure.conversationId, path)
    },
    /** Read today's usage once per session, for the "7 / 20 today" line. */
    async loadUsage() {
      if (usageRequested) return
      usageRequested = true
      const usage = await getTobiUsage()
      if (usage) set({ usage })
    },
    /** A navigation reply has been followed; never follow it again. */
    markNavigated(messageId) {
      const owner = state.conversations.find((c) => c.messages.some((m) => m.id === messageId))
      if (!owner) return
      updateConversation(owner.id, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, navigated: true } : m)),
      }))
    },
    newConversation: () => set({ activeId: null, failure: null }),
    openConversation: (id) => set({ activeId: id, failure: null }),
    deleteConversation: (id) =>
      set({
        conversations: state.conversations.filter((c) => c.id !== id),
        activeId: state.activeId === id ? null : state.activeId,
      }),
    resolveAction(messageId, index, actionState, followUp, links = []) {
      const owner = state.conversations.find((c) => c.messages.some((m) => m.id === messageId))
      if (!owner) return
      updateConversation(owner.id, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: [
          ...c.messages.map((m) =>
            m.id === messageId
              ? { ...m, actions: m.actions.map((a, i) => (i === index ? { ...a, state: actionState } : a)) }
              : m,
          ),
          ...(followUp ? [{ id: newId(), role: 'assistant', content: followUp, links }] : []),
        ],
      }))
    },
  }
  stores.set(userId, api)
  return api
}

const EMPTY = { conversations: [], activeId: null, pending: null, failure: null, usage: null }
const noop = { subscribe: () => () => {}, get: () => EMPTY }

export function useTobi(userId) {
  const store = userId ? storeFor(userId) : noop
  const state = useSyncExternalStore(store.subscribe, store.get)
  const conversation = state.conversations.find((c) => c.id === state.activeId) ?? null
  return {
    ...state,
    conversation,
    messages: conversation?.messages ?? [],
    pending: !!conversation && state.pending === conversation.id,
    busy: !!state.pending,
    failure: conversation && state.failure?.conversationId === conversation.id ? state.failure : null,
    actions: userId ? storeFor(userId) : null,
  }
}

/** Forget every saved TOBI chat on this device — called on sign-out. */
export function clearTobiHistory() {
  stores.clear()
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => localStorage.removeItem(key))
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => sessionStorage.removeItem(key))
  } catch {
    // Nothing stored, or storage is blocked — nothing to clear.
  }
}
