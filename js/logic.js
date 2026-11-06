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
  return formatNumber(pul, opts) + (opts.latin ? ' AFN' : ' ؋');
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
  let netCash = 0, payouts = 0, drops = 0, payins = 0;
  for (const s of sales) if (!s.voided) netCash += s.cashReceived - s.changeGiven;
  for (const m of movements) {
    if (m.type === 'payout') payouts += m.amount;
    else if (m.type === 'drop') drops += m.amount;
    else if (m.type === 'payin') payins += m.amount;
  }
  return { netCash, payouts, drops, payins, expected: startingFloat + netCash + payins - payouts - drops };
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
