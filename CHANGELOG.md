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

## 0.2.7.1

### Added

- Role-based QR actions on `/scan`: what a scan offers is now decided from the signed-in role, the
  tool's live status, and its active loan or return request, rather than by which QR was scanned.
- Support for starting a student's tool-return workflow directly from `/scan` — scanning a tool
  currently on loan to you now offers the same "Request return"/"Return requested" action the
  return desk already used.

### Improved

- Made `/scan` the single, universal QR entry point. The separate return-QR scan page has been
  removed; a tool's QR is now the only QR the application reads, wherever it is shown.
- Unified Tool QR handling across the inventory, tool details, requests and return requests — the
  same QR resolves the same way everywhere, instead of a second code carrying a return request's
  own identity.
- Admin and Instructor now go through the exact same QR, request and return workflow — no role-
  specific branching between the two staff roles.
- Return requests keep showing their QR as a reference on the return page; it is the same Tool QR
  used everywhere else rather than a request-specific code.

### Fixed

- Removed the duplicated return-specific scanning logic that used to live on its own page, so
  scanning a tool with an existing loan, request, or return request is handled in one place instead
  of two.

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
