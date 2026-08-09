# Smart Tool Monitoring System

**Track • Manage • Return**

A Progressive Web App for an automotive laboratory / training workshop. Every tool carries a QR
code; students and instructors scan it to borrow and return equipment, and the system keeps the
inventory, transaction history, overdue alerts and maintenance schedule consistent — entirely
offline, with no backend.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # production bundle + service worker
npm run preview    # serve the build on http://localhost:4173

npm run verify           # 123 checks (logic, workflow, boot, UI) — no browser needed
npm run verify:browser   # 22 checks in real Chromium; needs a server running

# against the dev server            against the production build
npm run dev                          npm run build && npm run serve:dist
npm run verify:browser               npm run verify:browser http://localhost:4180
```

Install the PWA from the browser's install button, or from the in-app prompt. Once installed it
runs with no internet connection — which is the point, because workshop Wi-Fi rarely reaches the
back of the bay.

### Demo accounts

| Role | Username | Password | Can do |
| --- | --- | --- | --- |
| Administrator | `admin` | `admin123` | Everything: tools, users, transactions, maintenance, reports, settings |
| Instructor | `instructor` | `instructor123` | Issue/receive tools for any student, manage maintenance, view reports and users |
| Student | `student` | `student123` | Scan, borrow under their own name, return what they borrowed |

The first launch seeds a realistic laboratory: **42 tools, 12 users, 24 transactions, 11
maintenance records, 12 notifications and 61 activity-log entries**. The seeded dates are relative
to today, so there are always loans due tomorrow and loans already overdue.

---

## Deploying to Vercel

The repository is deploy-ready: `vercel.json` pins the Vite preset, rewrites every unmatched path
to `index.html` so a hard refresh on `/tools/TOOL-00001` works, and sets the cache headers a PWA
needs.

**From the dashboard** — import the GitHub repo at [vercel.com/new](https://vercel.com/new).
Everything is read from `vercel.json`, so leave the build settings alone and deploy. No environment
variables are required; the app has no backend.

**From the CLI**

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

### Why `vercel.json` matters here

- **SPA rewrites.** React Router uses real URLs. Without the rewrite, opening `/dashboard`
  directly returns 404, because no such file exists in `dist/`. Vercel checks the filesystem
  *before* applying rewrites, so `/assets/*`, `/sw.js` and `/icons/*` still resolve normally.
- **`sw.js` must not be cached.** It is served `max-age=0, must-revalidate`; a cached service
  worker would pin users to an old build forever. Hashed assets get `immutable` instead.
- **`"framework": "vite"`** is pinned explicitly so Vercel cannot mis-detect the project.
- **HTTPS comes free**, which the QR scanner needs — browsers refuse camera access on plain HTTP
  outside `localhost`. `Permissions-Policy: camera=(self)` is set for the same reason.

Verify the deployable artifact locally before pushing — `scripts/serve-static.mjs` reproduces
Vercel's filesystem-then-rewrite routing and applies the same headers:

```bash
npm run build && npm run serve:dist
npm run verify:browser http://localhost:4180
```

### Data lives in the browser, not on Vercel

There is no backend, so nothing is shared between devices or visitors. Each browser seeds its own
demo laboratory on first visit and keeps its records in that browser's IndexedDB. Two people
opening the deployed URL get two independent datasets. That is the intended behaviour for this
build; wiring `services/db.js` to a real API is the step that would change it.

---

## Architecture

```
src/
  components/     reusable UI (ui.jsx, QRScanner, QRCodeDisplay, ToolForm, tables…)
  pages/          one file per route
  layouts/        AppLayout — sidebar, top bar, mobile bottom bar
  hooks/          useAsyncData + the domain hooks bound to it
  context/        AppContext (session, settings, boot), ToastContext
  services/       ← all business logic and every database call lives here
    db.js         Localbase wrapper: list/get/insert/update/remove/replaceAll
    auth.js       local demo authentication, salted-hash credentials
    tools.js      inventory, validation, status transitions
    transactions.js  borrow / return / overdue engine
    users.js      directory + password handling
    notifications.js maintenance.js reports.js activity.js settings.js
  utils/          dates, permissions, qr, constants, helpers
  data/seed.js    first-run demo laboratory
```

### The rules that make it hold together

**No component touches the database.** Pages call service functions; services own IndexedDB. To
replace Localbase with a REST API, reimplement the six primitives in `services/db.js` — the UI
does not change.

**Permissions are enforced twice.** `utils/permissions.js` is the single source of truth. The UI
uses `can()` to hide controls; every service mutation calls `assertCan()` before writing. Hiding a
button is a courtesy — the guard in the service is the actual rule. A student who reaches
`/users` by typing the URL gets a *Restricted area* page, and a student who somehow calls
`tools.remove()` gets a `PermissionError`.

**A borrow is never one write.** `transactions.borrow()` creates the transaction, flips the tool to
`Borrowed`, appends an activity-log entry and raises a notification. `returnTool()` closes the
transaction, updates the tool's status *and* condition, logs the change, notifies, and clears the
loan's stale overdue alert. That is why the dashboard, the tool page and the notification centre
can never disagree about where a tool is.

**Overdue is detected, not declared.** `runOverdueCheck()` runs on every app load and whenever the
tab regains focus (a laboratory PC is often left open overnight, so "today" changes without a
reload). It compares each open loan's due date against the calendar, flips the transaction and the
tool, and raises one notification per event — deduplicated by transaction id, so repeat sweeps
stay quiet.

**Dashboard numbers are computed, never stored.** `services/reports.js` derives every figure from
the tools and transactions collections at render time. There is no cached aggregate to drift.

**The boot can never hang.** `AppContext` splits startup into a memoised
`prepareEnvironment()` — open the database, seed if empty, load settings, reconcile overdue loans —
and a fresh session read on every provider mount. Only `db.ready()` and `settings.load()` are on
the critical path; seeding and reconciliation are best-effort and downgrade to a warning, because a
technician must still reach the login screen when demo data fails to load. A 10-second failsafe
turns a stalled environment into an error screen with **Try again** rather than an endless spinner.

The boot work deliberately lives at *module* scope rather than inside the effect. An effect that
both starts the boot and owns a `cancelled` flag hits a trap under `React.StrictMode`, which mounts,
runs effects, tears them down and runs them again in development: the teardown sets `cancelled`, so
the in-flight boot can never apply its result, and a "boot only once" ref stops the second run from
starting a fresh one. `booting` then stays `true` forever — in `npm run dev` only, while
`npm run preview` works fine. `scripts/verify-boot.mjs` mounts the app inside `StrictMode`
specifically to keep that from coming back.

### Data model

`users` · `tools` · `transactions` · `notifications` · `maintenance` · `activityLogs` · `settings`

Tool ids are sequential and permanent (`TOOL-00001`) and double as the IndexedDB key and the QR
payload. Transaction ids are immutable and time-sortable (`TXN-20250520-4F2A9C`).

### A note on Localbase

Localbase stores the pending collection/document selection on the database *instance*, so two
overlapping chains can clobber each other's target. `services/db.js` therefore runs every
operation through a one-at-a-time promise queue. That also serialises IndexedDB object-store
creation, which avoids the version-upgrade races localforage hits when several new stores open at
once. `collection().delete()` is avoided entirely — it drops the object store; documents are
removed individually instead.

---

## QR codes

Each tool's code carries JSON so the scanner can tell a tool tag from any other QR the camera sees:

```json
{ "type": "tool", "toolId": "TOOL-00001", "v": 1 }
```

Parsing is deliberately permissive: a URL ending in a tool id, a bare `TOOL-00014`, or just `14`
typed into the manual fallback all resolve to the same tool. Labels print at 60 mm for a sticker
that survives a workshop bench, and can be printed one at a time or for the whole filtered list.

If the camera is denied, missing, already in use, or the page is not on HTTPS, the scanner
explains which of those happened and offers manual Tool ID entry.

---

## Verification

`npm run verify` runs four suites against the real source — 123 checks, no mocking of the
domain layer:

- **Domain logic** (27) — overdue/due-soon boundaries, timezone-safe date round-trips, the
  permission matrix for all three roles, QR parsing and rejection, CSV escaping, sorting.
- **Workflow** (59) — the full lifecycle against an in-memory IndexedDB: seed → sign in → borrow →
  go overdue → notify → return → damage → maintenance → export/import. It also asserts the
  invariant that *tool status and open transactions never disagree*, and that no tool is issued to
  two people at once.
- **Boot sequence** (15) — the shell must always leave the loading state: under `StrictMode`, on a
  cold empty database, on a warm one, with no session, with a corrupt session, with a session
  pointing at a deleted user, when the database throws, when seeding throws, and when the database
  hangs (the failsafe timeout). It also drives the **Try again** and **Continue anyway** controls.
- **User interface** (22) — mounts the real app in jsdom, signs in as each role, walks every route
  and fails on any console error or unhandled rejection. It checks that students are refused
  `/users` and `/reports`, do not see the *Add tool* control, and cannot see another user's
  transactions.

`npm run verify:browser` adds 21 checks in real Chromium against a running dev server: the cold
boot with a genuinely empty IndexedDB, sign-in, a hard refresh proving persistence, every route,
a borrow through the actual UI, student route restrictions, and a browser with IndexedDB disabled.
This suite exists because the boot hang described above only reproduced in a real dev server —
`StrictMode` double-invokes effects in development but not in a production build, so jsdom-only
coverage missed it.

---

## Responsive behaviour

Desktop gets a fixed dark rail and a sticky top bar. Below `lg`, navigation moves to a slide-in
drawer plus a bottom bar with a raised **Scan** button — the action someone standing at the tool
crib actually needs. Tables become stacked cards on phones rather than horizontal scrollers, so
nothing hides off-screen; where a table does scroll, only its own container moves, never the page.
Modals rise as bottom sheets with their own scroll area, and form controls are 16 px so iOS does
not zoom the viewport on focus.

---

## Known scope

Authentication is local demo authentication. Passwords are stored as salted SHA-256 digests rather
than plaintext, which keeps the record shape honest for a future backend, but it is not a
substitute for a real KDF on a server. All data lives in this browser's IndexedDB: it survives
refreshes and restarts, and clearing site data deletes it. Export a JSON backup from **Settings →
Data management** before doing that.
