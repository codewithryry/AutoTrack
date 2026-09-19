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
