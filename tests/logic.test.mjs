import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toLatinDigits, toDariDigits, parseMoney, formatMoney, cartTotals, changeDue,
  marginPct, countDenoms, AFN_DENOMS, shiftExpected, varianceStatus, hashPin,
  makeReceiptId, receiptQr, parseReceiptQr, eanValid, normalizeBarcode,
  packRaster, csvEscape, toCsv, parseCsv, applySaleToStock
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

test('formatMoney uses Dari digits and ؋, hides .00', () => {
  assert.equal(formatMoney(125000), '۱٬۲۵۰ ؋');
  assert.equal(formatMoney(1250), '۱۲٫۵۰ ؋');
  assert.equal(formatMoney(0), '۰ ؋');
  assert.equal(formatMoney(-800), '-۸ ؋');
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
