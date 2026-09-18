import { createClient } from '@supabase/supabase-js'

/**
 * The one and only Supabase client.
 *
 * Nothing else in `src/` calls `createClient` — importing `supabase` from here
 * is the only supported way to reach the backend. One client means one session,
 * one realtime connection, and one place to change configuration.
 *
 * The publishable (anon) key is public by design: it identifies the project and
 * authorises nothing on its own. What protects the data is Row Level Security,
 * which resolves the caller's role from their own `profiles` row server-side.
 * The service-role key bypasses RLS and must never appear in a browser bundle —
 * it is not read here, and no `VITE_` variable should ever hold it.
 */

/**
 * Whether this bundle is running inside the Capacitor shell.
 *
 * Deliberately not imported from `utils/native`: this module is the root of the
 * import graph and is loaded by the static verification suites under Node, where
 * `window` does not exist. The check is one line, so it is inlined rather than
 * pulling a dependency into the root.
 */
const isNativeShell = () =>
  typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()

const env = import.meta.env ?? {}

export const supabaseUrl = env.VITE_SUPABASE_URL ?? ''
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Exported so the short-lived client that provisions an account can be built
 * with the same project and key. It is the publishable key either way — there
 * is no elevated credential anywhere in this application.
 */
export const supabaseAnonKey = supabaseKey

const configured = !!(supabaseUrl && supabaseKey)

if (!configured && typeof window !== 'undefined') {
  // Failing here beats a hundred confusing "Invalid API key" errors from every
  // query the moment a screen tries to load anything. Only in a browser: the
  // static verification suites import this module graph under Node, where there
  // is no `import.meta.env` and no intention of reaching the network.
  throw new Error(
    'Supabase is not configured. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).',
  )
}

export const supabase = createClient(supabaseUrl || 'http://localhost', supabaseKey || 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // No OAuth redirect flow here; parsing the URL for tokens on every load
    // would only misread the query strings the scanner uses. In the native shell
    // a redirect *does* come back — on the app's own scheme, which the WebView
    // never navigates to — so it is read deliberately by `services/deepLinks.js`
    // rather than automatically, and this stays false on both platforms.
    detectSessionInUrl: false,
    // PKCE only in the native shell. A link that returns to the APK comes back
    // as a `code`, and exchanging it needs the verifier this client stored when
    // the flow began — which only happens under `pkce`. The web build keeps the
    // flow it has always used, so nothing about signing in a browser changes.
    ...(isNativeShell() ? { flowType: 'pkce' } : {}),
    storageKey: 'stms.auth',
  },
})

/**
 * Collection name → table name.
 *
 * The application talks in its own collection names; Postgres has its own. This
 * is the only place the two are reconciled.
 */
export const TABLES = {
  users: 'profiles',
  tools: 'tools',
  transactions: 'transactions',
  notifications: 'notifications',
  maintenance: 'maintenance',
  activityLogs: 'activity_logs',
  settings: 'settings',
  toolRequests: 'tool_requests',
  reservations: 'reservations',
  conversations: 'conversations',
  conversationParticipants: 'conversation_participants',
  messages: 'messages',
}
