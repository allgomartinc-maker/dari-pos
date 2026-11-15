# QR Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A shop's Sheet shows a QR; the phone scans it in Settings and is connected.

**Architecture:** A pure payload format, shared by Code.gs (builder) and logic.js (parser). Code.gs gets a custom menu and a dialog that draws the QR client-side. The app's Settings reuse the existing camera scanner.

**Tech Stack:** Apps Script (HtmlService, ScriptApp), vanilla JS, node:test with the vm fake.

**Spec:** `docs/superpowers/specs/2026-11-14-qr-pairing-design.md`

## Global Constraints
- Payload: `DPOS|S|<url>|<token>`.
- URL regex: `^https://script\.google\.com/(a/macros/[\w.-]+|macros)/s/[\w-]+/exec$`.
- Token: `[A-Za-z0-9]{16,64}`.
- The key never goes to a third-party service.
- Dari UI. Bump `sw.js` to `dari-pos-v20`.

## Review Focus
1. A QR containing a lookalike URL (http, another host, `script.google.com.evil`) is refused. Covered in Task 1.
2. A product barcode scanned on the pairing screen doesn't change settings. Covered in Task 3 (it shows «این QR اتصال نیست»).
3. The script isn't deployed yet: the menu shows the Deploy help, not a broken QR. Covered in Task 2.

### Task 1: Payload format
**Files:** `js/logic.js` (`parsePairing`, `SCRIPT_URL_RE`, which cleanBackup now uses too), `apps-script/Code.gs` (`pairingPayload`). Tests: `tests/sync-gate.test.mjs`, `tests/apps-script.test.mjs`.
- [ ] **Failing tests:**
  - `parsePairing('DPOS|S|https://script.google.com/macros/s/AKfy_1/exec|abcdef0123456789abcd')` deep-equals `{ url, token }`.
  - These return null: http URL, `https://script.google.com.evil.af/macros/s/x/exec`, a token of 8 chars, a token containing `|` or `<`, any other prefix.
  - Code.gs: `pairingPayload(url, token)` returns the same string.
  - Code.gs: `showPairing` with `ScriptApp.getService().getUrl()` returning null calls `ui.alert` with text containing `Deploy`.
- [ ] Implement, run `npm test`, commit.

### Task 2: Sheet menu and dialog
**Files:** `apps-script/Code.gs` (`onOpen`, `showPairing`, `pairingHtml`).
- [ ] `onOpen` builds the menu `«صندوق دری»` with items `«راه‌اندازی» → setup` and `«QR اتصال» → showPairing`. Test with the fake `ui.createMenu`.
- [ ] `pairingHtml(payload, url, token)` returns HTML. It loads `https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js`, draws the QR, and lists the URL and key in `<code>`. Test: the HTML contains the payload and escapes `<` in the values.
- [ ] Run `npm test`, commit.

### Task 3: App pairing screen
**Files:** `js/app.js` (Settings button `#pairQr`, `pairByQr()`), `sw.js` (v20), README.
- [ ] `pairByQr()` opens a modal with a camera box and calls `startCamera(box, onCode, { isKnown: (c) => !!parsePairing(c) })`.
  - Valid code: stop the camera, `setSetting('webhookUrl')` and `setSetting('syncToken')`, run `syncNow()`, then toast «وصل شد ✔» or the error.
  - Invalid code: toast «این QR اتصال نیست».
- [ ] Playwright: Settings shows the button, and the modal opens with no page error at 375px.
- [ ] Update the README, bump to v20, run `npm test`, commit.
