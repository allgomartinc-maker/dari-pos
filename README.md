# صندوق دری — Dari Offline POS

Cash-only point-of-sale for small shops, fully in **Dari (right-to-left, Afghani ؋, Solar Hijri dates with Afghan month names)**.
Runs in the browser as an installable app (PWA) and works **without internet**. When internet is available it copies everything to a Google Sheet "back office".

Everything used is free and open source — no paid service, no CDN, no account needed except your own Google account for the sheet.

## What works offline vs. what needs internet

| Works with NO internet (on the device) | Needs internet |
|---|---|
| PIN login, admin / cashier roles | Sending sales, stock, shifts to Google Sheets (automatic when online) |
| Scanning: USB/Bluetooth handheld scanner, phone camera (barcodes + QR) | Pulling users / PIN changes from the sheet's **Users** tab |
| Selling, cash math, change due, price override with admin PIN | Pulling prices edited in the sheet's **Inventory** tab (button in اجناس) |
| Receiving deliveries, new items, cost / retail / margin | First install of the app (one time) |
| Products, stock counts, low-stock list, CSV import/export | |
| Shift open, drops / payouts, blind close, variance, Z-report | |
| Receipts with QR code, re-print, void (admin) | |
| Printing: system printer (USB) and Bluetooth thermal printers | |
| Reports: daily sales, profit, top items, shift history | |
| Full backup / restore to a JSON file | |

Records stay in the device's queue (badge: 🟠 *N در انتظار*) until Google Sheets confirms it saved them. A failed sync never loses data.

## Run it

```bash
cd dari-pos && npm install && npm run vendor && npm test
```

```bash
npm run serve
```

Open `http://localhost:8080`. First screen asks for store name, device code (T1) and the admin PIN.

**Use on phones/tablets:** the camera and "install app" need **HTTPS**. Free options: GitHub Pages, Cloudflare Pages, or Netlify — upload the folder (everything except `node_modules`, `tests`, `scripts`). Open the URL once with internet, tap **Add to Home Screen**; after that it runs offline. All data stays on that device.

## Google Sheets back office (optional)

1. New Google Sheet → **Extensions › Apps Script** → paste `apps-script/Code.gs` → Save.
2. Run `setup` once and approve. It creates the tabs: Sales, Sale_Items, Inventory, Purchases, Shift_Reconciliation (red/yellow/green variance), Cash_Movements, Users, Daily_Summary — and puts a **SYNC_TOKEN** in the *Setup* tab.
3. **Deploy › New deployment › Web app** — Execute as *Me*, access *Anyone*. Copy the `/exec` URL.
4. In the app: **تنظیمات** → paste the URL and the SYNC_TOKEN → Save → **همگام‌سازی اکنون**.

Users tab: `Name | Role (admin/cashier or مدیر/صندوقدار) | PIN (4–6 digits) | Active`. Changing a PIN there reaches the till the next time it is online. The sheet only sends salted hashes, never the PINs.

## Features

- **Register:** scan box, name search, quick buttons for loose items (bread, eggs), +/− qty, cash keys (exact, +50, +100, +500, +1000), big green change box, red shortfall box.
- **Scanner:** keyboard-wedge scanners work even when Windows/Android keyboard is set to Dari/Persian (read by physical key), Persian digits are normalised, EAN/UPC check digits reject misreads. Camera uses ZXing via html5-qrcode with the native BarcodeDetector when available.
- **Items with no barcode:** «تولید کد داخلی» makes a valid in-store EAN-13 (prefix 2); print a QR shelf label from the product screen.
- **Receive stock (admin):** supplier + invoice, scan, auto-fill known items, alert tone for new items, cost/retail/live margin, +1/+6/+12/+24/+48 case buttons, invoice total, logs to *Purchases*.
- **Roles:** cashier sees only فروش and شفت — no costs, margins, suppliers, reports. Price changes, payouts, pay-ins and voids need the admin PIN.
- **Blind close:** cashier counts notes 1000…10 and coins 5/2/1; expected cash is hidden; admin PIN reveals variance; Z-report prints.
- **Printing:** HTML print for any installed printer (58/80 mm). Bluetooth ESC/POS (Chrome on Android/desktop): the receipt is drawn as an image so Dari letters print correctly on cheap printers that have no Persian font.
- **Receipt QR:** every receipt has a QR; scan it in گزارش‌ها (or the register) to open it for reprint/void.

## Security notes (please read)

- 4–6 digit PINs are hashed (SHA-256 + salt) on the device. They stop casual misuse; they are not strong protection against someone who has the device and technical skill.
- Anyone with the Web App URL **and** the SYNC_TOKEN can write to your sheet. Keep both private; if leaked, change `SYNC_TOKEN` in *Apps Script › Project Settings › Script Properties* and in the app.
- Data lives in the browser's storage. Install the app (so storage is "persistent") and download a backup weekly (تنظیمات › پشتیبان).
- One device per sheet is assumed for stock numbers. Several tills can sync to one sheet (receipt IDs include the device code), but stock counts are per device.

## Files

```
index.html  sw.js  manifest.webmanifest   app shell + offline cache
js/logic.js     pure money / shift / barcode / CSV / ESC-POS math (tested)
js/db.js        IndexedDB (Dexie) tables, users, backup
js/sync.js      Google Sheets push/pull — the only online part
js/print.js     receipt, Z-report, label → HTML print or Bluetooth raster
js/scanner.js   wedge scanner, camera, beeps
js/app.js js/ui.js   Dari UI
apps-script/Code.gs  Google Sheets back office
tests/          node --test (logic + Apps Script against a fake Sheets API)
```

## Open-source credits

Dexie.js (Apache-2.0) · html5-qrcode / ZXing (Apache-2.0) · qrcode-generator (MIT) · Vazirmatn font (SIL OFL 1.1). Licenses are in `vendor/`.
