import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toLatinDigits, toDariDigits, parseMoney, formatMoney, cartTotals, changeDue,
  marginPct, countDenoms, AFN_DENOMS, shiftExpected, varianceStatus, hashPin,
  makeReceiptId, receiptQr, parseReceiptQr, eanValid, normalizeBarcode, looksLikeBarcode,
  packRaster, csvEscape, toCsv, parseCsv, applySaleToStock, mergePulledProduct, timeAgo, backupDue
} from '../js/logic.js';

test('digit conversion handles Persian, Arabic-Indic and Latin', () => {
  assert.equal(toLatinDigits('۱۲۳٤٥٦'), '123456');
  assert.equal(toDariDigits('1250'), '۱۲۵۰');
});

test('parseMoney returns integer pul (x100), accepts Dari digits and separators', () => {
  assert.equal(parseMoney('125'), 12500);
  assert.equal(parseMoney('۱۲٫۵'), 1250);
  assert.equal(parseMoney('1,250.75'), 125075);
  assert.equal(parseMoney('۱٬۲۵۰'), 125000);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney('abc'), 0);
  assert.equal(parseMoney('-5'), 0);
});

test('formatMoney uses Dari digits and the word افغانی, hides .00', () => {
  assert.equal(formatMoney(125000), '۱٬۲۵۰ افغانی');
  assert.equal(formatMoney(1250), '۱۲٫۵۰ افغانی');
  assert.equal(formatMoney(0), '۰ افغانی');
  assert.equal(formatMoney(-800), '-۸ افغانی');
  assert.equal(formatMoney(125000, { latin: true }), '1,250 AFN');
});

test('cartTotals sums integer lines without float drift', () => {
  const r = cartTotals([{ price: 10, qty: 3 }, { price: 20, qty: 1 }, { price: 1, qty: 7 }]);
  assert.deepEqual(r, { items: 11, total: 57 });
  assert.deepEqual(cartTotals([]), { items: 0, total: 0 });
});

test('changeDue reports change or shortfall', () => {
  assert.deepEqual(changeDue(4500, 10000), { change: 5500, short: 0, ok: true });
  assert.deepEqual(changeDue(4500, 4500), { change: 0, short: 0, ok: true });
  assert.deepEqual(changeDue(4500, 2000), { change: 0, short: 2500, ok: false });
});

test('marginPct on retail price', () => {
  assert.equal(marginPct(55, 125), 56);
  assert.equal(marginPct(100, 0), 0);
});

test('countDenoms totals Afghani notes and coins', () => {
  assert.deepEqual(AFN_DENOMS, [1000, 500, 100, 50, 20, 10, 5, 2, 1]);
  const total = countDenoms({ 1000: 1, 500: 2, 100: 3, 1: 4 });
  assert.equal(total, (1000 + 1000 + 300 + 4) * 100);
  assert.equal(countDenoms({ 100: '۲' }), 20000);
});

test('shiftExpected = float + net cash of non-voided sales - payouts - drops', () => {
  const sales = [
    { cashReceived: 10000, changeGiven: 5500, voided: false },
    { cashReceived: 5000, changeGiven: 0 },
    { cashReceived: 99999, changeGiven: 0, voided: true }
  ];
  const r = shiftExpected({ startingFloat: 150000, sales, movements: [
    { type: 'payout', amount: 2000 }, { type: 'drop', amount: 50000 }, { type: 'payin', amount: 1000 }
  ] });
  assert.deepEqual(r, { netCash: 9500, payouts: 2000, drops: 50000, payins: 1000, expected: 108500 });
});

test('varianceStatus', () => {
  assert.equal(varianceStatus(0), 'balanced');
  assert.equal(varianceStatus(-800), 'short');
  assert.equal(varianceStatus(300), 'over');
});

test('hashPin is deterministic, salted, hex', async () => {
  const a = await hashPin('1212', 'salt1');
  const b = await hashPin('1212', 'salt1');
  const c = await hashPin('1212', 'salt2');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await hashPin('۱۲۱۲', 'salt1'), a);
});

test('receipt ids and QR payload round-trip', () => {
  const id = makeReceiptId('T1', 42, new Date('2026-11-05T10:00:00Z'));
  assert.equal(id, 'T1-261105-0042');
  const q = receiptQr({ receiptId: id, total: 4500, timestamp: '2026-11-05T10:00:00Z' });
  assert.equal(q, 'DPOS|R|T1-261105-0042|4500|2026-11-05T10:00:00Z');
  assert.deepEqual(parseReceiptQr(q), { receiptId: id, total: 4500, timestamp: '2026-11-05T10:00:00Z' });
  assert.equal(parseReceiptQr('012000000133'), null);
});

test('EAN/UPC checksum validation and barcode normalisation', () => {
  assert.equal(eanValid('4006381333931'), true);
  assert.equal(eanValid('4006381333932'), false);
  assert.equal(eanValid('012000000133'), true);
  assert.equal(eanValid('ABC123'), true); // non-numeric codes (Code128 etc.) are not checked
  assert.equal(normalizeBarcode('  ۴۰۰۶۳۸۱۳۳۳۹۳۱\n'), '4006381333931');
});

test('packRaster packs 1-bit pixels MSB-first, dark = 1', () => {
  // 10px wide x 1px tall, RGBA: first and last pixel black, rest white
  const w = 10, h = 1, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const x of [0, 9]) { data[x * 4] = data[x * 4 + 1] = data[x * 4 + 2] = 0; }
  const { bytesPerRow, bits } = packRaster({ width: w, height: h, data });
  assert.equal(bytesPerRow, 2);
  assert.deepEqual([...bits], [0b10000000, 0b01000000]);
});

test('CSV escape, write and parse round-trip incl. Dari text, quotes, commas', () => {
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  const rows = [['barcode', 'name', 'price'], ['123', 'روغن، ۵ لیتر', '1250'], ['9', 'x "y"', '1']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('applySaleToStock decrements and never fails on unknown items', () => {
  const products = new Map([['1', { barcode: '1', stock: 5 }]]);
  applySaleToStock(products, [{ barcode: '1', qty: 2 }, { barcode: 'zz', qty: 1 }], -1);
  assert.equal(products.get('1').stock, 3);
  applySaleToStock(products, [{ barcode: '1', qty: 2 }], +1); // void puts back
  assert.equal(products.get('1').stock, 5);
});

test('internalBarcode makes valid in-store EAN-13 (prefix 2) from a sequence', async () => {
  const { internalBarcode } = await import('../js/logic.js');
  const c = internalBarcode(17);
  assert.equal(c.length, 13);
  assert.ok(c.startsWith('20000000'));
  assert.equal(eanValid(c), true);
  assert.notEqual(internalBarcode(18), c);
});

// ---------- sold by weight (kg) ----------
import { parseQty, formatQty, lineTotal, addQty, normalizeUnit, weightForAmount } from '../js/logic.js';

test('parseQty reads decimal kg in Dari or Latin digits, max 3 decimals', () => {
  assert.equal(parseQty('1.25'), 1.25);
  assert.equal(parseQty('۱٫۲۵'), 1.25);
  assert.equal(parseQty('0,5'), 0.5);
  assert.equal(parseQty('۰٫۳۳۳۳'), 0.333);
  assert.equal(parseQty('3'), 3);
  assert.equal(parseQty(''), 0);
  assert.equal(parseQty('abc'), 0);
  assert.equal(parseQty('-2'), 0);
});

test('formatQty shows kg with Dari decimal and unit, pieces as plain numbers', () => {
  assert.equal(formatQty(1.25, 'kg'), '۱٫۲۵ کیلو');
  assert.equal(formatQty(2, 'kg'), '۲ کیلو');
  assert.equal(formatQty(0.5, 'kg'), '۰٫۵ کیلو');
  assert.equal(formatQty(3), '۳');
  assert.equal(formatQty(3, 'pc'), '۳');
});

test('lineTotal rounds weight × price-per-kg to whole pul', () => {
  assert.equal(lineTotal({ price: 6000, qty: 1.25 }), 7500);
  assert.equal(lineTotal({ price: 6000, qty: 0.333 }), 1998);
  assert.equal(lineTotal({ price: 1999, qty: 0.7 }), 1399);
  assert.equal(lineTotal({ price: 4000, qty: 3 }), 12000);
});

test('cartTotals counts a weighed line as one item and rounds money', () => {
  const r = cartTotals([{ price: 6000, qty: 1.25, unit: 'kg' }, { price: 4000, qty: 2 }]);
  assert.deepEqual(r, { items: 3, total: 15500 });
  assert.equal(cartTotals([{ price: 1999, qty: 0.7, unit: 'kg' }]).total, 1400);
});

test('stock math on kg does not drift', () => {
  assert.equal(addQty(10, -0.1 * 3), 9.7);
  assert.equal(addQty(0.1, 0.2), 0.3);
  const products = new Map([['200000000001X', { stock: 10 }]]);
  applySaleToStock(products, [{ barcode: '200000000001X', qty: 0.7 }, { barcode: '200000000001X', qty: 0.1 }], -1);
  assert.equal(products.get('200000000001X').stock, 9.2);
});

test('normalizeUnit accepts kg in English or Dari, defaults to piece', () => {
  assert.equal(normalizeUnit('kg'), 'kg');
  assert.equal(normalizeUnit('KG'), 'kg');
  assert.equal(normalizeUnit('کیلو'), 'kg');
  assert.equal(normalizeUnit('کیلوگرام'), 'kg');
  assert.equal(normalizeUnit(''), 'pc');
  assert.equal(normalizeUnit(undefined), 'pc');
  assert.equal(normalizeUnit('دانه'), 'pc');
});

test('weightForAmount: "give me 50 AFN of tomatoes" at 60 AFN/kg', () => {
  assert.equal(weightForAmount(5000, 6000), 0.833);
  assert.equal(weightForAmount(6000, 6000), 1);
  assert.equal(weightForAmount(5000, 0), 0);
});

test('weighed line totals round to whole afghani, so "50 AFN of onions" charges exactly 50', () => {
  const w = weightForAmount(5000, 3500);
  assert.equal(w, 1.428);
  assert.equal(lineTotal({ price: 3500, qty: w, unit: 'kg' }), 5000);
  assert.equal(lineTotal({ price: 6000, qty: 0.333, unit: 'kg' }), 2000);
  assert.equal(lineTotal({ price: 6000, qty: 1.25, unit: 'kg' }), 7500);
});

test('looksLikeBarcode: scanner output vs typed product names', () => {
  assert.equal(looksLikeBarcode('4006381333931'), true);
  assert.equal(looksLikeBarcode('۴۰۰۶۳۸۱۳۳۳۹۳۱'), true); // Dari digits typed on a Dari keyboard
  assert.equal(looksLikeBarcode('AB-1234'), true);
  assert.equal(looksLikeBarcode('پیاز'), false);
  assert.equal(looksLikeBarcode('red apple'), false);
  assert.equal(looksLikeBarcode('12'), false);
  assert.equal(looksLikeBarcode(''), false);
});

test('mergePulledProduct: new sheet product is added with its stock', () => {
  const r = mergePulledProduct(null, { barcode: '111', name: 'چای', price: 5000, cost: 4000, stock: 12, unit: 'pc' }, 'T');
  assert.equal(r.action, 'put');
  assert.deepEqual(r.row, { barcode: '111', name: 'چای', price: 5000, cost: 4000, stock: 12, quick: 0, unit: 'pc', updatedAt: 'T', synced: 1 });
});

test('mergePulledProduct: synced local product takes sheet name/price/cost but keeps local stock and quick', () => {
  const cur = { barcode: '111', name: 'چای', price: 5000, cost: 4000, stock: 3, quick: 1, unit: 'pc', updatedAt: 'A', synced: 1 };
  const r = mergePulledProduct(cur, { barcode: '111', name: 'چای سبز', price: 5500, cost: 4000, stock: 99, unit: 'pc' }, 'T');
  assert.equal(r.action, 'put');
  assert.equal(r.row.name, 'چای سبز');
  assert.equal(r.row.price, 5500);
  assert.equal(r.row.stock, 3);
  assert.equal(r.row.quick, 1);
  assert.equal(r.row.synced, 1);
});

test('mergePulledProduct: unsynced local edit that differs from the sheet is a conflict, not overwritten', () => {
  const cur = { barcode: '111', name: 'چای', price: 6000, cost: 4000, stock: 3, quick: 0, unit: 'pc', updatedAt: 'A', synced: 0 };
  const r = mergePulledProduct(cur, { barcode: '111', name: 'چای', price: 5000, cost: 4000, stock: 3, unit: 'pc' }, 'T');
  assert.equal(r.action, 'conflict');
  assert.deepEqual(r.fields, ['price']);
  assert.equal(r.sheet.price, 5000);
  assert.equal(r.local.price, 6000);
});

test('mergePulledProduct: unsynced local edit equal to the sheet is left alone', () => {
  const cur = { barcode: '111', name: 'چای', price: 5000, cost: 4000, stock: 3, quick: 0, unit: 'pc', updatedAt: 'A', synced: 0 };
  assert.equal(mergePulledProduct(cur, { barcode: '111', name: 'چای', price: 5000, cost: 4000, stock: 8, unit: 'pc' }, 'T').action, 'same');
});

test('timeAgo: short Dari "how long ago" text', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  assert.equal(timeAgo(null, now), 'هرگز');
  assert.equal(timeAgo('2026-11-07T11:59:30Z', now), 'همین حالا');
  assert.equal(timeAgo('2026-11-07T11:55:00Z', now), '۵ دقیقه پیش');
  assert.equal(timeAgo('2026-11-07T09:00:00Z', now), '۳ ساعت پیش');
  assert.equal(timeAgo('2026-11-05T12:00:00Z', now), '۲ روز پیش');
});

test('backupDue: needs a backup when there are sales and none in the last 24 hours', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  assert.equal(backupDue({ lastBackupAt: null, salesSince: 0 }, now), false);
  assert.equal(backupDue({ lastBackupAt: null, salesSince: 3 }, now), true);
  assert.equal(backupDue({ lastBackupAt: '2026-11-07T08:00:00Z', salesSince: 3 }, now), false);
  assert.equal(backupDue({ lastBackupAt: '2026-11-06T08:00:00Z', salesSince: 3 }, now), true);
  assert.equal(backupDue({ lastBackupAt: '2026-11-06T08:00:00Z', salesSince: 0 }, now), false);
});
