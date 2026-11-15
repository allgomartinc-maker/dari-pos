# Easy Google Sheet setup: template copy + QR pairing — design

Date: 2026-11-14 · Status: approved by owner 2026-11-14 (small change)

## Why
Connecting a shop to its Google Sheet today means pasting code, deploying, and typing a long URL and key into the phone. That is too technical for shop owners. For now the app's maker (or someone he trains) does the setup for each shop. This change cuts it to a few minutes with no code and nothing typed on the phone. Later, paid customers get an own-server option (option 3, not part of this change).

## Approaches
- **Picked:** a template Sheet with the script bound to it, plus a QR made inside the Sheet that the phone scans.
- Rejected: a QR made by an online QR service, such as `=IMAGE()` with a QR API URL. It would send the secret key to a third party.
- Rejected: a pairing page served by the web app's `doGet`. Anyone with the URL could read the key, which defeats the key.
- Not possible here: automating Deploy and removing Google's «unsafe» screen. Only option 3 removes those.

## Design
- **Code.gs:**
  - `onOpen()` adds a menu «صندوق دری» with two items: «راه‌اندازی» runs `setup`, and «QR اتصال» runs `showPairing`.
  - `showPairing()` reads `ScriptApp.getService().getUrl()`. If the script isn't deployed yet, it shows a Dari alert explaining the Deploy steps.
  - Otherwise it opens a modal dialog (HtmlService). The dialog draws the QR in the browser with qrcode-generator (MIT, loaded from cdnjs; the key never leaves the page). It also shows the URL and key as text for manual entry.
  - Only editors of the Sheet can open the menu.
- **Payload:** `DPOS|S|<web app url>|<token>`. `pairingPayload(url, token)` builds it in Code.gs. `parsePairing(text)` in logic.js returns `{ url, token }` or null.
  - The URL must match the same Google Apps Script pattern used by the phone move.
  - The token must be 16–64 characters of [A-Za-z0-9].
- **App:**
  - Settings gets «اتصال با QR» → a camera modal (the existing scanner, which already reads QR).
  - When a valid code is read, the app saves `webhookUrl` and `syncToken`, runs a sync, and shows the result in a toast.
  - A non-pairing QR shows «این QR اتصال نیست».
  - It is manager-only, since Settings is already admin.
- **Template:** one Sheet in the owner's Google account, with the script, named «صندوق دری — نمونه», shared view-only by link. Its «Make a copy» URL goes in the README and the guide.

## Out of scope
- The Deploy step.
- Google's consent screen.
- Option 3 (own server).
- The owner page.
