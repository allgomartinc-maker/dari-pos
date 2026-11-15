// Pure business logic — no DOM, no IndexedDB. Unit-tested in tests/logic.test.mjs.
// All money values are integers in "pul" (1 Afghani = 100 pul) to avoid float errors.

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

export function toLatinDigits(s) {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => {
    const i = PERSIAN.indexOf(d);
    return String(i >= 0 ? i : ARABIC.indexOf(d));
  });
}

export function toDariDigits(s) {
  return String(s ?? '').replace(/[0-9]/g, (d) => PERSIAN[+d]);
}

export function parseMoney(input) {
  let s = toLatinDigits(input).trim()
    .replace(/[٬,\s]/g, '')   // thousands separators
    .replace(/٫/g, '.');       // Arabic decimal separator
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return 0;
  const [whole, frac = ''] = s.split('.');
  return parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
}

export function parseIntSafe(input) {
  const n = parseInt(toLatinDigits(input).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function groupThousands(n, sep) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function formatNumber(pul, { latin = false } = {}) {
  const neg = pul < 0;
  const abs = Math.abs(Math.round(pul));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let out = groupThousands(whole, latin ? ',' : '٬');
  if (frac) out += (latin ? '.' : '٫') + String(frac).padStart(2, '0');
  if (!latin) out = toDariDigits(out);
  return (neg ? '-' : '') + out;
}

export function formatMoney(pul, opts = {}) {
  return formatNumber(pul, opts) + (opts.latin ? ' AFN' : ' افغانی');
}

// ---------- quantities: pieces (integer) or kg (decimal, 3 places = grams) ----------
export const round3 = (n) => Math.round(n * 1000) / 1000;
export function addQty(a, b) { return round3((Number(a) || 0) + (Number(b) || 0)); }

export function parseQty(str) {
  const s = toLatinDigits(String(str ?? '')).trim().replace(/[٫,]/g, '.').replace(/[^\d.\-]/g, '');
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * 1000 + 1e-6) / 1000;
}

export function normalizeUnit(v) {
  return /^\s*(kg|kilo|kilogram|کیلو|کیلوگرام|کیلو گرام)\s*$/i.test(String(v ?? '')) ? 'kg' : 'pc';
}

export function formatQty(qty, unit) {
  if (unit !== 'kg') return toDariDigits(String(qty));
  const s = String(round3(qty)).replace('.', '٫');
  return toDariDigits(s) + ' کیلو';
}

// Weighed lines round to whole afghani (shops don't hand out pul), so "۵۰ افغانی پیاز" charges exactly ۵۰.
export function lineTotal(l) {
  return l.unit === 'kg' ? Math.round((l.price * l.qty) / 100) * 100 : Math.round(l.price * l.qty);
}

/** "Give me 50 AFN of tomatoes": weight (kg) for an amount at a price per kg, rounded down to the gram. */
export function weightForAmount(amount, pricePerKg) {
  if (!pricePerKg || amount <= 0) return 0;
  return Math.floor((amount / pricePerKg) * 1000 + 1e-6) / 1000;
}

export function cartTotals(lines) {
  let items = 0, total = 0;
  for (const l of lines) { items += l.unit === 'kg' ? 1 : l.qty; total += lineTotal(l); }
  return { items, total };
}

export function changeDue(total, tendered) {
  if (tendered >= total) return { change: tendered - total, short: 0, ok: true };
  return { change: 0, short: total - tendered, ok: false };
}

export function marginPct(cost, retail) {
  if (!retail) return 0;
  return Math.round(((retail - cost) / retail) * 100);
}

// Afghani notes (1000…10) and coins (5, 2, 1)
export const AFN_DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
export const QUICK_CASH = [50, 100, 500, 1000];

export function countDenoms(counts) {
  let total = 0;
  for (const d of AFN_DENOMS) total += d * 100 * Math.max(0, parseIntSafe(counts[d] ?? 0));
  return total;
}

export function shiftExpected({ startingFloat, sales, movements = [] }) {
  let netCash = 0, payouts = 0, drops = 0, payins = 0, qarzIn = 0;
  for (const s of sales) if (!s.voided) netCash += s.cashReceived - s.changeGiven;
  for (const m of movements) {
    if (m.type === 'payout') payouts += m.amount;
    else if (m.type === 'drop') drops += m.amount;
    else if (m.type === 'payin') payins += m.amount;
    else if (m.type === 'qarz') qarzIn += m.amount; // qarz collected (negative when an overpayment is handed back on a void)
  }
  return { netCash, payouts, drops, payins, qarzIn, expected: startingFloat + netCash + payins + qarzIn - payouts - drops };
}

export function varianceStatus(v) {
  return v === 0 ? 'balanced' : v < 0 ? 'short' : 'over';
}

export async function hashPin(pin, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${toLatinDigits(pin)}`);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomId(len = 12) {
  const a = new Uint8Array(len);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => (b % 36).toString(36)).join('');
}

export function makeReceiptId(deviceId, seq, date = new Date()) {
  const y = String(date.getFullYear()).slice(2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${deviceId}-${y}${m}${d}-${String(seq).padStart(4, '0')}`;
}

export function receiptQr({ receiptId, total, timestamp }) {
  return `DPOS|R|${receiptId}|${total}|${timestamp}`;
}

export function parseReceiptQr(text) {
  const p = String(text).split('|');
  if (p.length !== 5 || p[0] !== 'DPOS' || p[1] !== 'R') return null;
  return { receiptId: p[2], total: parseInt(p[3], 10), timestamp: p[4] };
}

export function normalizeBarcode(s) {
  return toLatinDigits(s).trim();
}

// True for what a scanner produces (printable ASCII, no spaces, 3+ chars); false for typed names like «پیاز».
export function looksLikeBarcode(s) {
  const v = normalizeBarcode(String(s || ''));
  return v.length >= 3 && /^[\x21-\x7E]+$/.test(v);
}

// Validates EAN-8 / UPC-A / EAN-13 / GTIN-14 check digits. Non-numeric codes pass.
export function eanValid(code) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return true;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

// Converts RGBA ImageData to 1-bit rows for ESC/POS "GS v 0" raster printing.
export function packRaster({ width, height, data }) {
  const bytesPerRow = Math.ceil(width / 8);
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] / 255;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
      if (lum < 128) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bytesPerRow, bits };
}

export function escposRasterCommand(raster, height) {
  const { bytesPerRow, bits } = raster;
  const header = [0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, height & 0xff, height >> 8];
  const out = new Uint8Array(2 + header.length + bits.length + 6);
  let o = 0;
  out.set([0x1b, 0x40], o); o += 2;                // ESC @ init
  out.set(header, o); o += header.length;
  out.set(bits, o); o += bits.length;
  out.set([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x00], o); // feed 4 lines, full cut
  return out;
}

export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function applySaleToStock(products, lines, direction) {
  for (const l of lines) {
    const p = products.get(l.barcode);
    if (p) p.stock = addQty(p.stock, direction * l.qty);
  }
  return products;
}

const DARI_MONTHS = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'];

// Solar Hijri date with Afghan (Dari) month names, e.g. "۱۴ عقرب ۱۴۰۵ ۱۰:۲۰"
export function dariDate(input, { time = true } = {}) {
  const d = new Date(input);
  if (isNaN(d)) return '';
  const parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  let out = `${parts.day} ${DARI_MONTHS[parseInt(parts.month, 10) - 1]} ${parseInt(parts.year, 10)}`;
  if (time) out += ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return toDariDigits(out);
}

// In-store EAN-13 (GS1 prefix "2" = restricted/internal use) for items without a barcode.
export function internalBarcode(seq) {
  const body = '2' + String(seq).padStart(11, '0');
  let sum = 0;
  body.split('').reverse().forEach((d, i) => { sum += +d * (i % 2 === 0 ? 3 : 1); });
  return body + ((10 - (sum % 10)) % 10);
}

// Decides what pulling one product from the Google Sheet does to the local copy.
//  - new barcode → add it (with the sheet's stock as a starting count)
//  - local copy already synced → take the sheet's name / price / cost / unit, keep local stock and quick button
//  - local copy has unsynced edits that differ → 'conflict': nothing is changed until the manager chooses
const PULL_FIELDS = ['name', 'price', 'cost', 'unit'];
export function mergePulledProduct(cur, p, nowIso) {
  const n = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.round(Number(v)) : d);
  const sheet = {
    name: String(p.name || cur?.name || ''),
    price: n(p.price, cur?.price ?? 0),
    cost: n(p.cost, cur?.cost ?? 0),
    unit: p.unit ? normalizeUnit(p.unit) : cur?.unit || 'pc'
  };
  if (!cur) {
    return { action: 'put', row: { barcode: String(p.barcode), ...sheet, stock: Math.max(0, Number(p.stock) || 0), quick: 0, updatedAt: nowIso, synced: 1 } };
  }
  const fields = PULL_FIELDS.filter((f) => (cur[f] ?? (f === 'unit' ? 'pc' : '')) !== sheet[f]);
  if (priceDirty(cur)) {
    return fields.length ? { action: 'conflict', fields, local: cur, sheet } : { action: 'same' };
  }
  // No unsent price edit: take the sheet's values. synced is kept, so a pending stock change is still sent.
  return { action: 'put', row: { ...cur, ...sheet } };
}

// A name / price / cost / unit edit made on this device that the sheet has not confirmed yet.
export function priceDirty(p) { return !!(p && p.priceAt && p.priceAt !== p.priceSentAt); }

// Sets priceAt (the time of the last name / price / cost / unit edit) on a product about to be saved.
// Stock-only changes keep the old priceAt, so the sheet never takes an old price from them.
export function stampPrice(cur, next, ts) {
  const changed = !cur || PULL_FIELDS.some((f) => (cur[f] ?? (f === 'unit' ? 'pc' : '')) !== (next[f] ?? (f === 'unit' ? 'pc' : '')));
  return { ...next, priceAt: changed ? ts : cur.priceAt, priceSentAt: cur?.priceSentAt };
}

// Practice (🧪 sample) items and real items must not be in the same sale.
export function cartMixError(cart, product) {
  if (!cart.length || !!cart[0].demo === !!product.demo) return null;
  return product.demo
    ? 'این جنس نمونه (تمرینی) است — با اجناس واقعی در یک فروش یکجا نمی‌شود'
    : 'سبد فروش تمرینی است (اجناس نمونه) — جنس واقعی را در فروش جداگانه بفروشید';
}
export function isPracticeSale(items) { return items.some((l) => l.demo); }
// Sales that count: practice sales never reach reports, shift totals or Google Sheets.
export function realSales(sales) { return sales.filter((s) => !s.practice); }

// "۵ دقیقه پیش" style text for status lines (last sync, last backup).
export function timeAgo(iso, nowMs = Date.now()) {
  if (!iso) return 'هرگز';
  const sec = Math.max(0, (nowMs - Date.parse(iso)) / 1000);
  if (sec < 60) return 'همین حالا';
  if (sec < 3600) return `${toDariDigits(Math.floor(sec / 60))} دقیقه پیش`;
  if (sec < 86400) return `${toDariDigits(Math.floor(sec / 3600))} ساعت پیش`;
  return `${toDariDigits(Math.floor(sec / 86400))} روز پیش`;
}

// A backup is due when there were sales since the last backup and the last one is older than a day (or never).
export function backupDue({ lastBackupAt, salesSince }, nowMs = Date.now()) {
  if (!salesSince) return false;
  return !lastBackupAt || nowMs - Date.parse(lastBackupAt) > 24 * 3600 * 1000;
}

// Which "add to home screen" help to show:
//  installed → already opened from the home-screen icon
//  prompt    → browser offers a one-tap install (Android Chrome, Edge, desktop Chrome)
//  ios       → iPhone / iPad: Share button → Add to Home Screen (iPadOS reports itself as a Mac with touch)
//  manual    → anything else: browser menu → Install / Add to Home screen
export function installMode({ ua = '', standalone = false, canPrompt = false, touch = 0 }) {
  if (standalone) return 'installed';
  if (canPrompt) return 'prompt';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'ios';
  return 'manual';
}

// ---------- reports over a range of days ----------
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localDay = (s) => { const [y, mo, d] = String(s).split('-').map(Number); return new Date(y, mo - 1, d); };
export const MAX_REPORT_DAYS = 366;

/** From–to (both days included, local time). Backwards picks are swapped; longer than a year keeps the last 366 days. */
export function dayRange(from, to) {
  let a = localDay(from), b = localDay(to || from);
  if (a > b) [a, b] = [b, a];
  const count = (x, y) => Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000) + 1;
  if (count(a, b) > MAX_REPORT_DAYS) a = new Date(b.getFullYear(), b.getMonth(), b.getDate() - (MAX_REPORT_DAYS - 1));
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1);
  return { from: isoDay(a), to: isoDay(b), start: a, end, days: count(a, b) };
}

/** Totals for real (non-practice) sales: money, profit, voids, best sellers, and one row per day. */
export function summarizeSales(sales) {
  const good = sales.filter((s) => !s.voided), voided = sales.filter((s) => s.voided);
  const net = good.reduce((a, s) => a + s.total, 0);
  const cost = good.reduce((a, s) => a + s.items.reduce((b, l) => b + Math.round((l.cost || 0) * l.qty), 0), 0);
  const top = new Map(), days = new Map();
  for (const s of good) {
    for (const l of s.items) {
      const t = top.get(l.barcode) || { barcode: l.barcode, name: l.name, qty: 0, total: 0, unit: l.unit };
      t.qty = addQty(t.qty, l.qty); t.total += lineTotal(l); top.set(l.barcode, t);
    }
    const k = isoDay(new Date(s.timestamp));
    const d = days.get(k) || { day: k, total: 0, count: 0 };
    d.total += s.total; d.count++; days.set(k, d);
  }
  const credit = good.reduce((a, s) => a + (s.credit || 0), 0);
  return {
    net, cost, profit: net - cost, count: good.length, cash: net - credit, credit,
    voids: { n: voided.length, total: voided.reduce((a, s) => a + s.total, 0) },
    top: [...top.values()].sort((a, b) => b.total - a.total),
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
  };
}

/** Plain Dari text of a report, for the body of an email or a message. */
export function reportText({ storeName, range, sum, qarz }) {
  const when = range.days === 1 ? dariDate(range.start, { time: false })
    : `از ${dariDate(range.start, { time: false })} تا ${dariDate(localDay(range.to), { time: false })}`;
  const lines = [
    `گزارش فروش — ${storeName || ''}`.trim(), when, '',
    `فروش خالص: ${formatMoney(sum.net)}`,
    `مفاد ناخالص: ${formatMoney(sum.profit)}`,
    `تعداد رسید: ${toDariDigits(sum.count)}`,
    `باطل شده: ${toDariDigits(sum.voids.n)} (${formatMoney(sum.voids.total)})`
  ];
  if (qarz && (qarz.given || qarz.collected || qarz.outstanding)) {
    lines.push('', `قرض داده شده: ${formatMoney(qarz.given)}`, `قرض گرفته شده: ${formatMoney(qarz.collected)}`, `مجموع قرض مردم: ${formatMoney(qarz.outstanding)}`);
  }
  if (sum.byDay.length > 1) {
    lines.push('', 'روز به روز:');
    for (const d of sum.byDay) lines.push(`${dariDate(localDay(d.day), { time: false })}: ${formatMoney(d.total)} · ${toDariDigits(d.count)} رسید`);
  }
  if (sum.top.length) {
    lines.push('', 'پرفروش‌ترین اجناس:');
    for (const t of sum.top.slice(0, 10)) lines.push(`${t.name}: ${formatQty(t.qty, t.unit)} · ${formatMoney(t.total)}`);
  }
  return lines.join('\n');
}

const localTime = (ts) => { const d = new Date(ts); return `${isoDay(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// Names typed by staff could start with = + - @ and run as a formula in Excel; a leading ' keeps them text.
const safeText = (v) => (/^[=+\-@]/.test(String(v ?? '')) ? `'${v}` : v ?? '');

/** One CSV (UTF-8 with BOM so Excel shows Dari): summary, per-day totals, then every sold line. */
export function reportCsv({ storeName, range, sum, sales, qarz = { given: 0, collected: 0, outstanding: 0 } }) {
  const afn = (p) => p / 100;
  const rows = [
    ['store', safeText(storeName)], ['from', range.from], ['to', range.to],
    ['net_sales_afn', afn(sum.net)], ['gross_profit_afn', afn(sum.profit)], ['receipts', sum.count],
    ['voided', sum.voids.n], ['voided_afn', afn(sum.voids.total)],
    ['qarz_given_afn', afn(qarz.given)], ['qarz_collected_afn', afn(qarz.collected)], ['qarz_outstanding_afn', afn(qarz.outstanding)], [],
    ['day', 'sales_afn', 'receipts'], ...sum.byDay.map((d) => [d.day, afn(d.total), d.count]), [],
    ['receiptId', 'timestamp', 'cashier', 'barcode', 'item', 'qty', 'unit', 'price', 'lineTotal', 'receiptTotal', 'cashReceived', 'change', 'voided', 'credit', 'customer']
  ];
  for (const x of sales) for (const l of x.items) {
    rows.push([x.receiptId, localTime(x.timestamp), safeText(x.cashierName), l.barcode, safeText(l.name), l.qty, l.unit || 'pc', afn(l.price), afn(lineTotal(l)),
      afn(x.total), afn(x.cashReceived || 0), afn(x.changeGiven || 0), x.voided ? 1 : 0, afn(x.credit || 0), safeText(x.customerName || '')]);
  }
  return '﻿' + toCsv(rows);
}

/** First day of the Afghan solar (Hijri Shamsi) month that `date` falls in. */
export function solarMonthStart(date = new Date()) {
  const day = parseInt(new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { day: 'numeric' }).format(date), 10);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (day - 1));
}
export { isoDay };

// ---------- moving a shop to a new phone ----------
/** Checks a backup file and makes every number safe. Money → whole pul; quantities and stock keep grams (kilo items). */
export function cleanBackup(data) {
  if (!data || data.app !== 'DariPOS' || !data.tables) throw new Error('فایل پشتیبان معتبر نیست');
  const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pul = (v) => Math.round(finite(v));
  const qty = (v) => round3(finite(v));
  const t = data.tables;
  for (const p of t.products || []) { p.barcode = String(p.barcode); p.name = String(p.name ?? ''); p.price = pul(p.price); p.cost = pul(p.cost); p.stock = qty(p.stock); }
  for (const s of t.sales || []) {
    for (const k of ['total', 'cashReceived', 'changeGiven']) s[k] = pul(s[k]);
    for (const k of ['credit', 'overpaidToQarz', 'balanceAfter']) if (k in s) s[k] = pul(s[k]);
    s.items = (s.items || []).map((l) => ({ ...l, name: String(l.name ?? ''), qty: qty(l.qty), price: pul(l.price), cost: pul(l.cost) }));
  }
  for (const s of t.shifts || []) {
    for (const k of ['startingFloat', 'countedCash', 'expectedCash', 'variance', 'netCash', 'payouts', 'drops', 'payins', 'grossSales', 'voidTotal', 'txCount']) if (k in s) s[k] = pul(s[k]);
    if (s.varianceStatus && !['balanced', 'short', 'over'].includes(s.varianceStatus)) s.varianceStatus = '';
  }
  // Sales only ever go to a Google Apps Script web app; a file pointing anywhere else loses the address.
  for (const r of t.settings || []) if (r.key === 'webhookUrl' && !/^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(String(r.value ?? ''))) r.value = '';
  // Qarz: a backup from before qarz has no such tables; restoring it must clear them (it is a full snapshot).
  t.customers = (t.customers || []).map((c) => ({ ...c, id: String(c.id), name: String(c.name ?? ''), phone: String(c.phone ?? ''), limit: pul(c.limit) }));
  t.ledger = (t.ledger || []).map((x) => ({ ...x, id: String(x.id), customerId: String(x.customerId), amount: pul(x.amount) }));
  for (const r of t.settings || []) if (r.key === 'deviceId') r.value = String(r.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'T1';
  return data;
}

/** Device code for the next till: T1 → T2, T9 → T10, SHOP → SHOP2 (max 6 characters). */
export function nextDeviceId(id) {
  const m = String(id || 'T1').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^(.*?)(\d*)$/);
  const n = String((parseInt(m[2] || '1', 10) || 1) + 1);
  return (m[1] || 'T').slice(0, Math.max(1, 6 - n.length)) + n;
}

/** Old phone keeps selling: the new phone becomes a second till with the same staff, products and shop
 *  settings, but its own code, no old sales or shifts, and empty stock (each till counts its own stock). */
export function prepareSecondTill(data) {
  const t = data.tables;
  const set = Object.fromEntries((t.settings || []).map((r) => [r.key, r.value]));
  const id = nextDeviceId(set.deviceId);
  const tillNo = parseInt(id.match(/\d+$/)?.[0] || '2', 10);
  Object.assign(set, {
    deviceId: id, setupDone: true, receiptSeq: 0, shiftSeq: 0, lastBackupAt: null,
    internalSeq: Math.max(Number(set.internalSeq) || 0, tillNo * 100000000)
  });
  t.settings = Object.entries(set).map(([key, value]) => ({ key, value }));
  t.products = (t.products || []).map((p) => ({ ...p, stock: 0 }));
  for (const k of ['sales', 'shifts', 'movements', 'receivings', 'customers', 'ledger']) t[k] = [];
  return data;
}

// Tables the app may mark as sent after a push. An older Google script answers ok but silently drops qarz
// rows, so customers / ledger stay queued until the script reports it knows 'qarz'.
const QARZ_TABLES = ['customers', 'ledger'];
export function syncedTables(features, tables) {
  return (features || []).includes('qarz') ? tables : tables.filter((t) => !QARZ_TABLES.includes(t));
}

/** Rows an older script already took but whose qarz columns it dropped: send again once the script knows qarz (upsert by ID, so no duplicates). */
export function needsQarzResend(table, row) {
  if (table === 'sales') return !!row.customerId;
  if (table === 'shifts') return !!row.qarzIn;
  return false;
}
