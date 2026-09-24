# Changelog

Notable changes to ToolTrack, newest first.

This file starts at 0.2.6. Earlier releases are recorded in the
[GitHub releases](https://github.com/codewithryry/AutoTrack/releases), whose notes the Android
workflow generates from the commits behind each tag — nothing before 0.2.6 has been reconstructed
here, because the release notes already hold it.

The version is set in one place: `package.json`. `src/utils/constants.js` mirrors it for the
About screen, `android/app/build.gradle` derives the Android `versionName` and `versionCode` from
it, and `npm run verify` fails if the two drift apart. `scripts/set-version.mjs` writes all of
them together.

## 0.2.8

### What's new
- **Tool Map.** A new page at `/tools/map` shows where each tool was last recorded during its
  current loan, on a map with clustered markers. Borrowed and overdue tools show their latest
  checkpoint (or the borrow point if no checkpoint exists yet). Available tools get their own pin
  style. Past location points, including return points of closed loans, are listed per tool as
  history and never drawn as live markers. Staff see every loan's points. Students see only
  their own.
- **Tool Map in navigation** for every role, placed after Inventory. On the phone bottom bar it
  appears as a tab beside Inventory.
- **TOBI, the Tool Track assistant.** Tap the ✨ TOBI button beside the phone bottom bar (or in the
  desktop top bar) to open a floating chat card over the page. Ask in English, Filipino or Taglish: "Anong tools ang hiniram
  ko?", "Show overdue tools", "Nasaan yung drill?". TOBI answers from Tool Track records only:
  - Students: their own loans, due dates, overdue tools, requests, return status and where their
    borrowed tools were last recorded. Other students' loans are never shown.
  - Instructors and admins: active and overdue loans and who has them, availability, tool history,
    the requests queue, maintenance and problem reports. Admins also get account summaries.
  - Locations follow the Tool Map rule (latest checkpoint, else the borrow point, open loans only)
    and are always worded as "last recorded at".
  - TOBI can prepare a return request for your own borrowed tool. It asks you to confirm and pick
    the condition first, then uses the normal return-request workflow.
  - **Actions through conversation.** Every action is prepared by TOBI and shown as a card; only
    Continue runs Tool Track's existing workflow, with the usual permission and database checks:
    - "Request a hammer for me bukas": checks the tool, turns the dates into real days, and shows
      a request card with editable dates and purpose.
    - "The drill is broken": a problem-report card with the type and description.
    - Staff, "approve REQ-00009": an approve or reject card with an optional note. Batches are
      decided together, as on the Requests page.
  - **Open-page buttons.** "Show pending requests" answers with an **Open Requests** button, and
    "open the Tool Map" gives a button to it. TOBI only offers pages from the role's own
    navigation. A student asking for Users is told it isn't available, and the route guards
    still block restricted pages typed in by hand.
  - Chats get a short topic title, such as "Overdue tools check" or "Tool request steps",
    instead of the student's first message.
  - Suggested prompts per role and page, links to the relevant screens, retry on errors, and a
    new-conversation button.
  - **Voice.** Tap the mic to dictate, or the voice button to talk with TOBI hands-free: it
    listens, answers out loud, then listens again. It works in browsers with speech recognition
    (Chrome, Edge, Safari). The mic is hidden where it isn't supported, including the Android app.
  - **Full screen.** The maximise button on the card opens TOBI as a full page at `/tobi`, with
    your recent chats. Minimise goes back to where you were.
  - **Usage limits.** TOBI requests are limited per account, and enforced on the server before
    anything is sent to Cohere. Defaults are 20 a day and 5 a minute for students, 50 and 10
    for instructors, and 100 and 15 for admins. The daily quota resets at midnight Asia/Manila.
    Oversized messages are refused, the context is trimmed to the last 15 messages, and output
    is capped per role. A Cohere call is cut off after 15 seconds and retried at most once. A
    failed request doesn't use up quota. When the daily limit is reached TOBI says so in the chat.
    The rest of Tool Track is never limited. Limits are set through `TOBI_*` environment variables and need
    migration `0037_tobi_usage.sql`.
  - **Saved chats.** Conversations are saved on this device for your account, and cleared when
    you sign out. Nothing is stored on the server.
  - **Opens pages directly.** "Open Tool Map" or "punta sa requests" takes you there straight
    away, without a button and without using any of your daily quota. A page your role can't
    open is refused with a short reply.
  - **Animations.** The card grows out of the TOBI button and folds back into it when closed.
    Every reply ends with "TOBI can make mistakes. Check important info."
- **Dashboard mascot talks through AI.** What the mascot says is reworded by the assistant
  service, so tapping it gives a different line each time instead of the same fixed sentence.
  Its bubble has an **Ask TOBI** button that opens the TOBI chat. With no connection, or no
  Cohere key, it falls back to its written lines.
- **Search and link previews.** The sign-in and sign-up pages now have descriptive titles, meta
  descriptions, canonical URLs, Open Graph tags and structured data. Every other route is marked
  `noindex`, and the new `public/robots.txt` and `public/sitemap.xml` list only the public pages.

### Changed
- **New phone layout for every role.** The top bar uses the accent colour, with a short accent
  band under it. Pages sit on a rounded sheet above the band, and cards, buttons and fields are
  rounded.
- **Liquid Glass bottom bar.** The phone bottom bar is now liquid glass: frosted, with a bright
  top edge, a curved sheen and a soft shadow. The current page sits in a plain translucent lens
  that glides from tab to tab and opens into its name. Scan is the headline feature: a large
  amber circle in the centre, icon only, rising above the bar. Names are never cut short: on a
  narrow screen the spacing and padding tighten instead, so the tab's name and the button's
  word ("New chat") always fit whole. The TOBI / page-action button beside the bar is the same
  glass as the bar, so the amber is Scan's alone. When you're
  on a page the bar doesn't normally carry (Settings, Notifications, Requests, Return, Tool Map),
  that page is added to the bar while you're on it.
- **Page actions on the TOBI button.** Beside the bar, the amber ✨ TOBI button becomes the
  page's own action where there is one: New request (students, on Requests), New chat (on
  Messages), Schedule (instructors, on Maintenance), and Add tool, Add user or Schedule (admins).
- **Redesigned phone dashboard.** It now opens on the accent band with a two-line greeting, one line on where things stand ("1 tool ready to borrow today", "2 tools with you, 1
  due soon") and a single Scan button, with the mascot beside it. The "0 out / 0 due soon" chips
  are gone. There's more room above the mascot, so its bubble no longer runs into the greeting.
- **Plain summary cards.** Tools out, Due soon, Requests and Overdue are now plain white cards
  with grey icons. The only colour left is the Overdue count, which turns red when it's above 0.
- **"Home" for students.** A student's Dashboard is called Home, with a house icon. Admins and
  instructors keep Dashboard. The route is still `/dashboard` for everyone.
- **Staff hero.** On the admin and instructor dashboard the button reads "Scan a tool" (staff
  lend and check in tools, they don't request them), with "Review requests" under it on the
  phone. Students get "Scan to request" and "Return a tool".
- **Tidier staff Menu.** The phone Menu drawer is grouped into Tools, People, Insights and
  Account, and now holds Account and Settings. The account dropdown on the phone shows who is
  signed in and Sign out.
- **Account dropdown header.** Your avatar, name, and role and ID on one quiet line, in place of
  the coloured role badge.
- **Smoother phone transitions.** Pages slide in the direction you moved along the bottom bar,
  the bar's pages are loaded ahead of time, and signing in fades into the app. All of it is
  switched off when the device asks for reduced motion.
- **Settings without nested cards.** Sections in Settings no longer sit in a card inside another
  card. The About group is called "About app".
- **Fewer boxes inside boxes.** Removed the inner bordered or tinted panels in Account settings
  (change password, delete account), location capture, return decisions, scan results,
  transaction details, problem reports and tool location checkpoints. Content now sits directly
  in its card.

### Fixed
- On `/tools/map` only Tool Map is highlighted in navigation, not Inventory as well. A tool's
  own record (`/tools/:id`) still highlights Inventory.

## 0.2.7-beta.1

### Added
- Added role-based actions to the main **Scan QR** page.
- Students can now start a **tool return request** directly by scanning their borrowed tool.
- Added automatic detection of tool status, active loans, and return requests.

### Improved
- Made **Scan QR** the single QR scanning entry point.
- Unified Tool QR handling across Inventory, Tool Details, Requests, and Return Requests.
- Admin and Instructor now follow the same QR, request, and return workflow.
- Return Requests still display the Tool QR for easy reference.
- Removed the separate Return QR scanning page and consolidated scanning into `/scan`.

### Fixed
- Removed duplicate return-specific QR scanning logic.
- Improved handling of tools with active loans, pending requests, and return requests.

## 0.2.7

### Returns

- **QR-first return workflow.** Requesting a return now generates a return QR code, shown on the
  return page as soon as the request exists. Staff scan it from a dedicated Scan Return QR page to
  pull up the request instantly, instead of searching the return desk by hand. The manual return
  desk remains available as a fallback and shares the same underlying request/decide logic — there
  is no separate code path for the two.
- Scanning a return QR leads straight into inspection: staff can **Accept** the return, **Accept
  with an issue** (recording a damage/issue note against the loan and the tool's condition), or
  **Reject** it, sending the tool back to the borrower without closing the loan.
- A return request cannot be created twice for the same loan, and a QR that has already been
  decided is reported back as already processed rather than being actioned again.
- Every scan and decision — accepted, accepted with an issue, or rejected — is written to the
  activity log, alongside the existing borrow/return trail, so a tool's condition and handling
  history stays traceable end to end.
- Accepting or rejecting a return keeps the transaction, the tool's status, and the request in sync
  in one step, so the inventory can never show a tool as available while its loan is still open, or
  the reverse.
- The Scan page's camera flow was extended to recognise return QR codes on top of tool QR codes,
  without changing how an ordinary tool scan behaves.

### Fixed

- **Returned loans no longer block a new request for the same tool.** A tool with a past loan that
  has already been returned (or cancelled) is treated as available again; only a loan or reservation
  that is still active and genuinely overlaps the requested dates is treated as a conflict. A tool
  borrowed and returned Sept 10–12, for example, no longer refuses a fresh request for Sept 15–18.

## 0.2.6

### Inventory

- **Import** — bring an inventory in from a CSV file. A downloadable sample template
  (`ToolTrack_Inventory_Import_Template.csv`) shows the columns and carries three filled-in
  example rows. The file is validated and previewed before anything is written: missing fields,
  unknown categories or conditions, malformed Tool IDs, IDs that clash with the inventory, and IDs
  repeated inside the same file are each reported with their line number. Only new tools are
  created — a row whose Tool ID already exists is refused rather than overwriting it.
- **Export** — download the inventory as `ToolTrack_Inventory_<date>.csv`. Active filters are
  respected, so the file matches what the page is showing.
- **Print** — a print-ready A4 sheet of QR labels, for all tools or for the filtered set.
- Import, Export and Print are available to administrators and instructors. Students do not see
  them, and the service layer refuses the work regardless of the interface.

### QR labels

- Each label now carries only the QR code, the Tool ID and the tool name. The application name,
  category and location were removed, and the code grew from 34 mm to 46 mm in the space they
  freed. Three labels fit across an A4 sheet, up from two.
- The printed code uses the same payload the Scan page reads, so a freshly printed label scans
  straight away.
- Fixed: printing failed with `buildQRPayload is not defined`. A module re-export forwarded the
  name to other files without binding it locally, so the call inside the label renderer threw.
- Fixed: the print dialog could open before the QR images had finished decoding, leaving blank
  squares in the preview. It now waits for every image.

### Loading

- One loading design across the application: a branded full-screen loader for start-up and session
  restoration, and skeleton placeholders everywhere else. The second, inline spinner has been
  removed, so a page waiting for data no longer looks like the application restarting.

### Android

- Location, Camera and Notification permissions now report the real operating-system state and
  re-read it whenever the app returns to the foreground, so a permission changed in Android
  Settings is reflected on the way back in.
- Notifications are posted natively. Web Push does not work inside the Android WebView, so the
  alerts the app raises while it is running are delivered by the system instead.

### Performance

- Pages load on first visit rather than all at start-up. The sign-in screen no longer pulls in the
  QR scanner and the charting library, which cut what loads before the first paint from about
  1.7 MB to about 0.7 MB.
- The application logo was 1 254 × 1 254 px and 1.5 MB for a mark shown at 40 px; it is now 110 kB.
  The whole `public/` directory went from 2.5 MB to under 900 kB.
- Long inventory and directory lists render a screenful at a time, with a control to show more.

### Naming

- The product is now **ToolTrack** everywhere. The Android application ID, the deep-link scheme and
  the institutional email domains are unchanged — they are identifiers, not branding.
