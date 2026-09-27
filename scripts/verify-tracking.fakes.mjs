/**
 * esbuild plugin for the loan-tracking suite.
 *
 * `services/loanTracking.js` talks to three things the suite replaces:
 *
 *   ./db, ./transactions      → the fake server in `verify-tracking.mjs`
 *   @capacitor/*              → the fake native plugin and App state
 *
 * Every stand-in reads `globalThis.__tracking` at call time, so the suite can
 * set up and change the world between steps.
 */
export const trackingFakes = {
  name: 'tracking-fakes',
  setup(build) {
    const virtual = (path) => ({ path, namespace: 'tracking-fake' })

    build.onResolve({ filter: /^\.\/(db|transactions)$/ }, (args) =>
      /loanTracking\.js$/.test(args.importer) ? virtual(args.path.slice(2)) : undefined,
    )
    build.onResolve({ filter: /^@capacitor\/(core|app|local-notifications)$/ }, (args) =>
      virtual(args.path),
    )

    const sources = {
      db: `
        const w = () => globalThis.__tracking
        export const COLLECTIONS = { transactions: 'transactions', tools: 'tools' }
        export const isOffline = () => w().offline
        export const subscribe = (listener) => w().db.subscribe(listener)
        export const watchCollection = () => () => {}
      `,
      transactions: `
        const w = () => globalThis.__tracking
        export const listOwnOpenLoans = (actor) => w().server.listOwnOpenLoans(actor)
        export const recordTrackedCheckpoint = (input) => w().server.record(input)
      `,
      // A proxy, like Capacitor's own: the handle is cached by the module, and
      // each call reaches whichever fake plugin the current test set up.
      '@capacitor/core': `
        export const registerPlugin = () => new Proxy({}, {
          get(_, key) {
            const native = globalThis.__tracking.native
            const value = native[key]
            return typeof value === 'function' ? value.bind(native) : value
          },
        })
      `,
      '@capacitor/app': `
        export const App = {
          getState: async () => ({ isActive: globalThis.__tracking.appActive }),
          addListener: async (event, fn) => globalThis.__tracking.app.addListener(event, fn),
        }
      `,
      '@capacitor/local-notifications': `
        export const LocalNotifications = {
          checkPermissions: async () => ({ display: 'granted' }),
          requestPermissions: async () => ({ display: 'granted' }),
        }
      `,
    }

    build.onLoad({ filter: /.*/, namespace: 'tracking-fake' }, (args) => ({
      contents: sources[args.path],
      loader: 'js',
    }))
  },
}
