# Smart Tool Monitoring System

**Track • Manage • Return**

A Progressive Web App for an automotive laboratory / training workshop. Every tool carries a QR
code; students and instructors scan it to borrow and return equipment, and the system keeps the
inventory, transaction history, overdue alerts and maintenance schedule consistent across every
device in the laboratory.

Authentication is **Supabase Auth**, data is **Supabase Postgres**, and access is enforced by
**Row Level Security** — not only by the interface.

```
  /  (public homepage) ──► /signup ──► Supabase Auth ──► profiles row
                │                                             │
                └──────────────► /login ◄─── active / pending ─┘
                                    │
                                    ▼
                        Admin · Instructor · Student
                          role-based /dashboard
```

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # production bundle + service worker
npm run preview    # serve the build on http://localhost:4173

npm run verify           # logic + access-control checks; no network, no emulator
npm run verify:browser   # real Chromium against a running server (see Verification)
```

Install the PWA from the browser's install button or the in-app prompt. The app keeps working when
the workshop Wi-Fi drops: every collection that has been read once is cached on the device, and a
write made offline is queued and replayed when the connection returns (`services/offlineCache.js`
and `services/sync.js`, checked by `npm run verify` — the offline suite). A collection that has
never been downloaded reports itself as unavailable rather than as an empty laboratory.

### Supabase project

Copy `.env.example` to `.env` and fill in the two values from **Supabase dashboard → Project
settings → API**:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

Neither is a secret — the publishable (anon) key identifies the project and authorises nothing on
its own. What protects the data is Row Level Security. **Never** put the service-role key in this
repository or in any `VITE_` variable: it bypasses RLS, and everything under `src/` is shipped to
the browser.

### First-time setup

1. **Enable Email sign-in** — Supabase dashboard → Authentication → Providers → Email.
2. **Apply the migrations**, in order, in the SQL editor:

   ```
   supabase/migrations/0001_schema.sql   tables, keys, indexes, constraints
   supabase/migrations/0002_rls.sql      row level security policies
   supabase/migrations/0003…0025         everything added since, in number order
   ```

   Run every file in `supabase/migrations/`, in number order — they create the tables and their
   policies and insert nothing at all. The later ones add the pieces the current app depends on:
   tool images and profile photos (`0011`, `0022`), requests, reservations and messaging (`0012`),
   return requests (`0019`), request batches (`0020`), Realtime on the core tables (`0021`) and
   conversation deletion for the people in a thread (`0025`).

3. **Create the first administrator.** Every later account is created from the Users page, but the
   first one is a chicken-and-egg problem: only an administrator may write another profile, and
   self-registration deliberately cannot request the `Admin` role. So the first administrator signs
   up at `/signup` like anyone else, and is then promoted once, by hand, in the SQL editor:

   ```sql
   update public.profiles set role = 'Admin', status = 'Active'
    where lower(email) = lower('admin@autolab.edu.ph');
   ```

   The alternative — a policy letting anyone create their own administrator profile — is precisely
   the privilege-escalation hole the policies exist to close, so one manual statement is the safer
   trade.

4. **Sign in** at `/login`, then optionally load demo tools from **Settings → Data management →
   Seed demo data**. It never touches accounts, and it never runs by itself: an unattended write to
   a shared database is not something a page load should do.

Students and instructors do not need step 3 — they register themselves at `/signup`. Instructor
registrations arrive as **Pending** and appear for approval on the admin Users page.

### A second project for testing

There is no local emulator here. To exercise destructive actions or policy changes safely, create a
second Supabase project, apply the same migrations to it, and point `.env` at that one.

---

## Public pages and sign-up

| Route | Access | Notes |
| --- | --- | --- |
| `/` | public | Redirects to `/login`, in a browser tab and in the installed app alike. The landing page (`pages/HomePage.jsx`) is kept but not routed. |
| `/signup` | public | Self-registration. Redirects to the dashboard if already signed in. |
| `/login` | public | Redirects to the dashboard if already signed in. |
| everything else | protected | `RequireAuth` sends a signed-out visitor to `/login`. |

**Registration is student-or-instructor, never administrator.** The form offers two roles; the
service forces the role and derives the status from it; and the security rules pin exactly what a
self-created profile may contain. Editing the form, or calling the API directly, changes nothing —
the `profiles_insert` policy refuses anything but:

- the caller's own auth id as the row id,
- `role` of `Student` (status `Active`) or `Instructor` (status `Pending`).

There is no password, hash or salt column to smuggle anything into: Supabase Auth owns the
credential, and the table owns only the role and the directory details.

A **pending** instructor can sign in far enough to be told they are waiting — `is_active()` gates
everything else, so a pending profile authorises no reads or writes at all. An administrator
approves them from **Users**, where pending accounts appear in a panel above the directory; approval
flips the status to `Active` and notifies the account.

Sign-up signs the new account in just long enough to write its own profile row — which is exactly
what the `profiles_insert` policy requires, since it insists the row id equals `auth.uid()`. After
sign-up the visitor lands on `/login` with a confirmation, which is also what keeps a pending
instructor out of the application.

**A public form means anyone can create a Student account**, which is why Student is the least
privileged role in the system: it reads the inventory, reads and writes only its own loans, notifies
only itself, and cannot reach the directory, maintenance, reports or settings. Two levers tighten it
further:

- `VITE_SIGNUP_EMAIL_DOMAINS=autolab.edu.ph` restricts registration to institutional addresses. That
  check runs in the browser, so mirror it in the policy if it has to be enforced — add to
  `profiles_insert`:

  ```sql
  and lower(email) like '%@autolab.edu.ph'
  ```

- Requiring a verified address before the account is usable: register students as `Pending` too
  (`signupStatusFor` in `src/services/users.js`), or leave Supabase's email confirmation on so the
  account cannot sign in until the address is proven.

## Roles

The role lives in `profiles.role` and is read from the caller's own row on every request. Three
layers enforce it, and all three are required:

1. the sidebar hides what a role cannot reach (a courtesy),
2. route guards and `assertCan()` in the services refuse the action when the URL is typed by hand,
3. Row Level Security refuses the data even to a hand-rolled API call.

| | Admin | Instructor | Student |
| --- | --- | --- | --- |
| Navigation | Dashboard, Inventory, Scan, Transactions, Requests, Messages, Users, Maintenance, Notifications, Reports, Settings | Dashboard, Inventory, Requests, Transactions, Maintenance, Messages, Notifications (Scan is a raised quick action, not a list item) | Dashboard, Inventory, Requests, Scan, Return, Messages, Transactions, Notifications |
| Tools | full control | edit, change status | view only |
| Transactions | all | all, plus corrections | own only |
| Requests | view all, approve, reject, manage holds | view all, approve, reject, manage holds | raise their own and follow them |
| Messages | send; delete any thread they are in; clear messaging entirely | send; delete any thread they are in | send to laboratory staff; delete a thread they are in |
| Users | create, edit, deactivate, delete | read the directory to pick a borrower | own profile only |
| Maintenance | full | full | none |
| Reports | yes | no | no |
| Settings | own preferences **and** the laboratory configuration and data tools | own preferences | own preferences |
| Dashboard | laboratory-wide statistics | laboratory-wide operations | own loans only |

`/settings` is open to every role because everyone has preferences of their own there; the
laboratory configuration, the seeding and export tools and the destructive actions inside the page
are gated on `SETTINGS_VIEW`, `SETTINGS_EDIT` and `DATA_MANAGE`, which only an administrator holds.
The counter (`/borrow`) is no longer a destination in anybody's navigation — staff reach it from the
approved request it belongs to, so the same hand-over is never offered from two places — and its
`BORROW_FOR_OTHERS` guard still refuses a student who types the URL.

`src/components/navigation.js` is the single navigation definition; `src/utils/permissions.js` is
the single permission matrix. `npm run verify` fails if the two disagree, if an admin-only route
loses its guard, or if the three sidebars stop being distinct.

**A student's dashboard asks different questions rather than showing restricted answers.** Their
queries only return their own records, so a "total users" figure would be quietly wrong rather than
merely hidden. They see: my active loans, due soon, my overdue, my transactions, available tools.

---

## Workflows

### Borrowing — one request, followed to the counter

A student never issues a tool to themselves. Scanning a free tool, or opening it from the
inventory, offers **Request to borrow**, which raises one request on `/requests/new`. Staff work the
queue on `/requests`: approving one places a reservation holding the tool, and the hand-over itself
is recorded at the counter (`/borrow?tool=…`), reached from the request. Returning is the mirror —
a student asks for the hand-back from the loan, staff receive it on `/return`.

Every request opens a conversation of its own, carrying the requester and the staff who may decide
it, so the discussion and the decision sit in one place. The thread is reused if the request is
submitted twice; it is never duplicated.

### Scanning — one round trip

The scanner resolves a label to the canonical tool id (`TOOL-00014`, `tool-14` and `14` all resolve
to the same tool), then looks up the tool record and its open loan **together** rather than one
after the other, so a scan settles in one round trip. The camera is released on the first successful
read, and a page that is navigated away from while the camera is still opening hands the device
straight back — the next page that needs it is never told the camera is already in use. If the
camera is denied, missing, in use or the page is not on HTTPS, manual Tool ID entry takes over.

### Messaging

Two shapes of thread and no more: a direct one between two people, and one attached to a request.
Both are private to their participants — a conversation is readable only through membership, so
staff have no back door into a thread they are not part of. Alongside them are two standing rooms,
the general one and the staff one, where membership *is* the role. Students may open a thread with
laboratory staff; two students have no thread to open. Unread counts are derived from how far each
participant has read, never stored, so there is nothing to fall out of step.

**Anybody in a thread can delete it** — a student, an instructor or an administrator. The people in
a conversation own it, so the boundary is membership rather than role: the conversation row goes and
Postgres cascades its participant and message rows off it, the alerts that pointed at it go too, and
`conversations_delete` applies the same `in_conversation()` test the read policy does, so a
hand-rolled API call cannot touch a thread the caller is not in. It is a shared row, so this is a
deletion for everyone in the thread rather than a private hide — the confirmation says so before it
is done. The thread leaves the inbox on the same frame and the open pane closes. The two standing
rooms cannot be deleted; every account with the role is expected to have them.

The order matters and is deliberate: the thread first, its rows after. Deleting the participant rows
first would end the caller's own membership, and membership is what `conversations_select` is — so
the `delete … returning` that followed came back empty and the application reported a failure for a
row that had in fact been removed.

Beside the inbox search there is also **Delete all conversations**, which stays with the
administrator (`DATA_MANAGE`) because it clears messaging for the whole laboratory: every thread and
every message goes, the alerts pointing at them go, and the two standing rooms are emptied rather
than removed. It asks for the word `DELETE` first, because it cannot be undone.

---

## Architecture

```
src/
  supabase/
    config.js     the one and only createClient — env-driven
  services/       ← all business logic and every database call lives here
    db.js         Postgres data layer: role-scoped reads, camel/snake mapping
    localAuth.js  Supabase Auth: sign-in, session, error mapping, registration
    auth.js       session → profile row → application role
    tools.js      inventory, validation, status transitions
    transactions.js  borrow / return / overdue engine
    users.js      directory + account provisioning (no credentials stored)
    requests.js   tool requests: raise, decide, batch
    reservations.js  the hold an approved request places on a tool
    messages.js   conversations, messages, attachments, admin deletion
    presence.js   who is on the app right now
    storage.js    tool images and profile photos (private buckets, signed links)
    offlineCache.js sync.js  the device copy and the queue that replays writes
    notifications.js maintenance.js reports.js activity.js settings.js
  hooks/          useAsyncData + the domain hooks bound to it
  context/        AppContext (session, settings, revision), ToastContext
  components/     reusable UI, plus navigation.js (the role → sidebar map)
  layouts/        AppLayout — sidebar, top bar, mobile bottom bar
  pages/          one file per route (HomePage and SignUpPage are the public two)
  routes/         (route guards live in App.jsx: RequireAuth, RequirePermission)
  utils/          permissions, dates, qr, constants, helpers
  data/seed.js    admin-triggered demo data
supabase/migrations/
  0001_schema.sql tables, keys, indexes, constraints
  0002_rls.sql    the actual access-control boundary
```

### The rules that make it hold together

**No component touches the database.** Pages call hooks, hooks call services, services call
`services/db.js`. Only three modules import the Supabase client at all, and `npm run verify`
enforces that.

**Reads are scoped on the server, not filtered in the browser.** Row Level Security decides what a
request returns, from the caller's own `profiles` row. `db.setScope({ uid, role })` additionally
narrows the query the client sends — a student's `list('transactions')` adds `user_id = uid` — but
that is an optimisation, not the boundary: the same rows come back with or without it. Collections a
role cannot read at all resolve to `[]` without a request.

**Screens refresh on write, and on somebody else's write too.** Every write bumps a revision counter
the hooks watch, so a borrow updates every screen in that browser immediately. Changes made on
another device arrive over Supabase Realtime (`0021_realtime_core_tables.sql`), which only re-raises
the same change signal — the data still comes through the ordinary read, so the cache, the offline
path and the policies all apply exactly as they do everywhere else. Under that sits a quiet
revalidation while the tab is being looked at, and one the moment it is looked at again, for the
case where a sleeping phone dropped the socket.

**A borrow cannot leave the records inconsistent.** `db.runAtomic()` journals each write and undoes
them in reverse if any step fails, so a loan record and the tool's status never drift apart. It is
not a transaction — the API does not expose one to the browser — so the protection against two tabs
issuing the same wrench lives in the database instead: the `tools_update` policy and its trigger only
permit `Available → Borrowed`, and the second writer is refused. The follow-up work (activity entry,
notifications) is deliberately best-effort: the tool has physically changed hands, so a failed log
line must not be reported as a failed borrow.

**Passwords never reach the database.** There is no password, hash or salt column in any table —
Supabase Auth owns the credential. Changing a password is a reset email; the app never sees it.

**Overdue is detected, not declared.** `runOverdueCheck()` compares each open loan against the
calendar when staff open the app and when the tab regains focus (a laboratory PC is often left open
overnight, so "today" changes without a reload). It is staff-only, because it writes to transactions
and tools — a student's own late loan is instead derived from its due date at render time.

**Dashboard numbers are computed, never stored.** `services/reports.js` derives every figure from
the database at render time. Nothing on the dashboard is hardcoded and there is no cached aggregate
to drift.

**The boot can never hang.** `AppContext` holds a boot screen only until the session listener fires,
which happens exactly once after the stored session is read. A session whose profile is missing,
roleless, inactive or suspended is signed straight back out with the reason shown on the login
screen — the app is never left holding a session it cannot authorise.

### Data model

```
users/{uid}              uid, email, firstName, lastName, fullName, displayName,
                         role, status, studentId, course, yearLevel, employeeId,
                         department, contact, createdAt, updatedAt, lastLoginAt
tools/{toolId}           name, toolCode, category, status, condition, location,
                         serialNumber, qrCode, quantity, imageUrl, currentBorrowerId,
                         currentTransactionId, nextMaintenanceDate, createdAt, updatedAt
transactions/{txnId}     toolId, toolName, userId, userName, userRole, borrowDate,
                         dueDate, returnDate, status, conditionOut, conditionIn,
                         purpose, issuedById, receivedById, createdAt, updatedAt
maintenance/{id}         toolId, toolName, type, issue, technician, date, nextDate,
                         cost, status, reportedBy, createdAt, updatedAt
notifications/{id}       userId (null = laboratory-wide), title, message, type,
                         read, toolId, transactionId, link, dedupeKey, createdAt
activityLogs/{id}        action, toolId, userId, userName, transactionId, message,
                         meta, createdAt          (append-only, staff-readable)
settings/app-settings    labName, labLocation, defaultBorrowDays, maxBorrowDays,
                         dueSoonThresholdDays, notify*, maintenanceIntervalDays
toolRequests/{reqId}     toolId, toolName, userId, userName, status, purpose,
                         neededFrom, neededUntil, decidedBy, decidedAt, batchId,
                         collectionLocation, createdAt, updatedAt
reservations/{id}        requestId, toolId, userId, status, holdUntil, fulfilledAt
conversations/{cnvId}    kind (direct · request · general · staff), requestId,
                         subject, createdBy, lastMessageAt, lastMessagePreview
conversationParticipants/{cnvId:uid}  conversationId, userId, userName, userRole,
                         lastReadAt         (a standing room has no rows: the role is the membership)
messages/{msgId}         conversationId, senderId, senderName, senderRole, body,
                         attachmentUrl/Name/Type/Size, createdAt
```

The **id of a profile row is the Supabase Auth uuid**, which is what lets a policy compare
`auth.uid()` against the row without a lookup. Tool ids are sequential and permanent
(`TOOL-00001`) and double as the QR payload; transaction ids are immutable and time-sortable
(`TXN-20250520-4F2A9C`).

Two field names are worth calling out, because they carry authorisation weight:

- `transactions.userId` is the borrower (the schema sketch called it `borrowerId`). The existing
  field name was kept so the whole application did not have to be renamed around it; it is the field
  every student query filters on.
- `tools.currentBorrowerId` is set while a tool is out. It is how the rules let the person actually
  holding a tool hand it back without letting them touch anybody else's.

Dates are `timestamptz` columns and travel as ISO 8601 strings, which `utils/dates` parses
directly. `services/db.js` converts between the application's camelCase field names and the
database's snake_case columns, so neither side has to bend to the other.

---

## Row Level Security

`supabase/migrations/0002_rls.sql` is the access-control boundary. Highlights:

- **Deny by default.** RLS is enabled on every table, and a request with no matching policy is
  refused. `anon` is revoked outright, so nothing is readable without a session.
- **The role is read from the caller's own row.** The helpers (`is_admin()`, `is_staff()`, …) are
  `SECURITY DEFINER` with a pinned `search_path`, because a policy on `profiles` that reads
  `profiles` would otherwise recurse forever. Each answers one question about `auth.uid()` and takes
  no argument a caller can influence.
- **An inactive or suspended profile authorises nothing**, even though Supabase still considers the
  account signed in.
- **Students cannot change their own role or status.** `WITH CHECK` cannot see the previous row, so
  that rule is a `BEFORE UPDATE` trigger — still the database refusing it, not the UI hiding it.
- **Students cannot list the directory, maintenance records or the activity log** — those reads
  fail, they are not filtered.
- **Students cannot set an arbitrary tool status.** They may move a tool
  `Available → Borrowed` while booking it out to themselves, and back to `Available`/`Damaged` while
  it is booked out to them. `Maintenance`, `Lost` and `Retired` are staff-only, as is every other
  field on the record.
- **Credential fields are rejected outright** on any write to `users`.
- **Self-registration cannot mint an administrator** — see `selfRegistration()` above. Creating
  anyone *else's* profile requires `isAdmin()`.
- **A pending account authorises nothing.** Only `Active` passes `is_active()`, which everything
  else is gated on.
- **The activity log is append-only.** There is no UPDATE policy at all, so every update is refused.

Storage follows the same boundary. The tool-image, avatar and message-attachment buckets are
private; an object is written into a folder named after its owner, which is what the storage policy
checks, and a link to it is minted on demand and expires. Nothing is served from a public URL.

### Verifying the policies

`npm run verify` checks the source-side invariants — no credentials in the bundle, no database call
outside the data layer. The policies themselves are behavioural, so they are checked against a real
project, ideally a scratch one:

```bash
STMS_EMAIL=student@lab.test STMS_PASSWORD=… STMS_ROLE=Student node scripts/verify-browser.mjs
```

The checklist worth walking through with a signed-in session in the SQL editor or Studio:

- a student reading another student's transaction → **denied**
- a student querying `transactions` with no `where` clause → **denied**
- a student writing `users/{ownUid}.role = 'Admin'` → **denied**
- a student writing `tools/{id}.status = 'Maintenance'` → **denied**
- an instructor creating a `users` document → **denied**
- a signed-out client reading anything → **denied**
- self-registering with `role: 'Admin'` → **denied**
- self-registering as `Instructor` with `status: 'Active'` → **denied**
- self-registering with somebody else's uid or email → **denied**
- a pending instructor reading `tools` → **denied** (their own profile → allowed)

---

## Deploying to Vercel

The repository is deploy-ready: `vercel.json` pins the Vite preset, rewrites every unmatched path to
`index.html` so a hard refresh on `/tools/TOOL-00001` works, and sets the cache headers a PWA needs.

**From the dashboard** — import the GitHub repo at [vercel.com/new](https://vercel.com/new). The
build settings come from `vercel.json`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
as environment variables — there are no defaults, and the build will fail without them.

**From the CLI**

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

Add the deployment domain under **Supabase dashboard → Authentication → URL configuration** so
password-reset and confirmation links point back at it.

### Why `vercel.json` matters here

- **SPA rewrites.** React Router uses real URLs. Without the rewrite, opening `/dashboard` directly
  returns 404, because no such file exists in `dist/`. Vercel checks the filesystem *before*
  applying rewrites, so `/assets/*`, `/sw.js` and `/icons/*` still resolve normally.
- **`sw.js` must not be cached.** It is served `max-age=0, must-revalidate`; a cached service worker
  would pin users to an old build forever. Hashed assets get `immutable` instead.
- **`"framework": "vite"`** is pinned explicitly so Vercel cannot mis-detect the project.
- **HTTPS comes free**, which the QR scanner needs — browsers refuse camera access on plain HTTP
  outside `localhost`. `Permissions-Policy: camera=(self), geolocation=(self)` is set for the same
  reason — both must be `(self)`, not `()`. An empty allowlist disables the feature for the page
  itself, so `getCurrentPosition` fails with `PERMISSION_DENIED` in production while `localhost`
  (which sends no such header) keeps working.

---

## QR codes

Each tool's code carries JSON so the scanner can tell a tool tag from any other QR the camera sees:

```json
{ "type": "tool", "toolId": "TOOL-00001", "v": 1 }
```

Parsing is deliberately permissive: a URL ending in a tool id, a bare `TOOL-00014`, or just `14`
typed into the manual fallback all resolve to the same tool. Labels print at 60 mm for a sticker
that survives a workshop bench, and can be printed one at a time or for the whole filtered list.

If the camera is denied, missing, already in use, or the page is not on HTTPS, the scanner explains
which of those happened and offers manual Tool ID entry.

---

## Verification

`npm run verify` runs two suites against the real source, with no network and no emulator:

- **Domain logic** — overdue/due-soon boundaries, timezone-safe date round-trips, the permission
  matrix for all three roles, QR parsing and rejection, CSV escaping, sorting.
- **Access control** — the role → sidebar map, that the three sidebars are genuinely different and
  agree with the permission matrix, that every admin-only route is wrapped in a guard, that the
  homepage and sign-up sit *outside* the protected tree while every dashboard route stays inside it,
  that sign-up can only request Student or Instructor and that an instructor starts pending, that
  and the source-hygiene invariants: no service-role key anywhere in the source or the environment
  files, Supabase as the only backend dependency, and no database access outside the data layer.

`npm run verify:browser` drives real Chromium against a running server. Without credentials it
checks the public flow — the homepage renders every section and does not scroll horizontally at
360 px, **Get Started** reaches `/signup`, **Sign In** reaches `/login`, the sign-up form rejects an
incomplete submission and a short password before the backend is called, it offers no administrator
role, a protected route redirects to `/login`, and no demo passwords are on screen. With
`STMS_EMAIL`, `STMS_PASSWORD` and `STMS_ROLE` for a real account it also verifies the role's sidebar,
that its forbidden routes show *Restricted area*, and that a hard refresh keeps the session. Point
the app at the emulators first so test accounts stay out of production.

The end-to-end suites that used to run here (`verify-workflow`, `verify-boot`, `verify-ui`) drove a
retired local backend and its password check, so they were removed rather than left to rot. Their
equivalent needs a scratch project to write into; the checklist above is the interim.

---

## Responsive behaviour

Desktop gets a fixed dark rail and a sticky top bar. Below `lg`, navigation moves to a slide-in
drawer plus a bottom bar with a raised **Scan** button — the action someone standing at the tool crib
actually needs. Tables become stacked cards on phones rather than horizontal scrollers, so nothing
hides off-screen; where a table does scroll, only its own container moves, never the page. Modals
rise as bottom sheets with their own scroll area, and form controls are 16 px so iOS does not zoom
the viewport on focus.

---

## Known scope

- **Deleting an account is two steps.** Deleting the profile row revokes access immediately — no
  profile means no role, and the session is rejected at sign-in — but removing the Auth user itself
  needs the service-role key, which must not reach the browser. Prefer **Deactivate**, which keeps
  the audit trail intact. The same applies if a profile write fails right after an account is
  created: the app reports the orphaned sign-in and what to do about it.
- **An administrator cannot create somebody else's account yet.** That needs the admin API, which
  requires the service-role key, so it belongs in an Edge Function. Until one is deployed the person
  signs up themselves and an administrator sets their role. The Users page says so rather than
  failing silently.
- **Roles are table rows, not JWT claims.** Claims would remove one lookup per request, at the cost
  of a server to set them and a token refresh whenever a role changes.
- **A student could mark an available tool as borrowed without creating a loan.** The policy and
  its trigger bound them to that one transition; they cannot reach any other status or field.
  Closing the gap entirely means moving borrowing into a database function.
- **The theme is per-device**, stored in `localStorage` rather than the shared settings document, so
  one person choosing dark mode does not follow everyone onto every laboratory PC.
- **Sign-up is open by default.** Anyone with an email address can create a Student account unless
  `VITE_SIGNUP_EMAIL_DOMAINS` is set (and mirrored in the policy). Instructor registrations are
  pending until approved, and administrators cannot be self-registered at all.
- **A duplicate student ID is possible.** A visitor cannot read the directory, so self-registration
  cannot check uniqueness; an administrator sees the ID on the pending-approval panel and in the
  directory. `validate()` only re-checks a student ID that is actually being changed, so a duplicate
  cannot block unrelated edits to either profile.
- **The sign-up form tells you when an email is already registered.** A registration form has to
  surface that. The sign-in form deliberately does not: one wording covers a wrong password and an
  unknown account, so it never confirms which addresses exist.
- **Read state on laboratory-wide alerts is shared.** A broadcast notification (`userId: null`) has
  one `read` flag, so marking an overdue alert read clears it for everyone — the behaviour the
  previous build had. Per-user read state for broadcasts would need a `readBy` collection and a
  different unread count; alerts addressed to one person are already private to them.
- **The activity log is streamed as its newest 250 entries.** Bulk operations (clear, export, counts)
  read the full collection, and a tool's timeline is fetched with a targeted query, so nothing is
  silently truncated — but the dashboard feed is a window, not the whole history.
