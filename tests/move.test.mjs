import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBackup, nextDeviceId, prepareSecondTill } from '../js/logic.js';

const backup = () => ({
  app: 'DariPOS', version: 1, tables: {
    products: [{ barcode: 111, name: 'پیاز', price: 3500.4, cost: 2500, stock: 48.25, unit: 'kg' }, { barcode: '222', name: 'آب', price: 2000, cost: 1200, stock: 30, unit: 'pc' }],
    sales: [{ receiptId: 'T1-1', total: 3000, cashReceived: 5000, changeGiven: 2000, items: [{ name: 'پیاز', qty: 0.5, price: 6000, cost: 4000, unit: 'kg' }, { name: 'آب', qty: 0.25, price: 2000, unit: 'kg' }] }],
    shifts: [{ shiftId: 'S1', startingFloat: '1000', variance: 'x', varianceStatus: '<b>' }],
    movements: [{ id: 'm1' }], receivings: [{ id: 'r1' }],
    users: [{ id: 'u1', name: 'Ali', role: 'admin', pinHash: 'h', salt: 's' }],
    settings: [{ key: 'deviceId', value: 'T1' }, { key: 'setupDone', value: true }, { key: 'internalSeq', value: 12 }, { key: 'receiptSeq', value: 40 }]
  }
});

test('cleanBackup keeps kilo amounts: 0.5 kg stays 0.5, 0.25 stays 0.25, 48.25 kg stock stays', () => {
  const d = cleanBackup(backup());
  assert.equal(d.tables.sales[0].items[0].qty, 0.5);
  assert.equal(d.tables.sales[0].items[1].qty, 0.25);
  assert.equal(d.tables.products[0].stock, 48.25);
});

test('cleanBackup still makes money whole pul, ids text, junk numbers 0, unknown status blank', () => {
  const d = cleanBackup(backup());
  assert.equal(d.tables.products[0].price, 3500);
  assert.equal(d.tables.products[0].barcode, '111');
  assert.equal(d.tables.shifts[0].startingFloat, 1000);
  assert.equal(d.tables.shifts[0].variance, 0);
  assert.equal(d.tables.shifts[0].varianceStatus, '');
});

test('cleanBackup refuses a file that is not a Dari POS backup', () => {
  assert.throws(() => cleanBackup({ hello: 1 }), /پشتیبان/);
  assert.throws(() => cleanBackup(null), /پشتیبان/);
});

test('nextDeviceId: T1→T2, T9→T10, SHOP→SHOP2, never over 6 characters', () => {
  assert.equal(nextDeviceId('T1'), 'T2');
  assert.equal(nextDeviceId('T9'), 'T10');
  assert.equal(nextDeviceId('SHOP'), 'SHOP2');
  assert.equal(nextDeviceId('ABCDE9'), 'ABCD10');
  assert.equal(nextDeviceId(''), 'T2');
});

test('prepareSecondTill: same users, products and shop settings; new code; no old sales or shifts; stock starts at 0', () => {
  const d = prepareSecondTill(cleanBackup(backup()));
  const set = Object.fromEntries(d.tables.settings.map((r) => [r.key, r.value]));
  assert.equal(set.deviceId, 'T2');
  assert.equal(set.setupDone, true);
  assert.equal(set.receiptSeq, 0);
  assert.ok(set.internalSeq >= 200000000, 'new in-store barcodes cannot clash with the first till');
  assert.equal(d.tables.users.length, 1);
  assert.deepEqual(d.tables.products.map((p) => p.stock), [0, 0]);
  for (const t of ['sales', 'shifts', 'movements', 'receivings']) assert.deepEqual(d.tables[t], [], t);
});

test('cleanBackup keeps the device code to letters and digits', () => {
  const d = backup(); d.tables.settings[0].value = 't1<img src=x>';
  assert.equal(cleanBackup(d).tables.settings[0].value, 'T1IMGS');
});

test('cleanBackup drops a sync address that is not a Google Apps Script link', () => {
  const d = backup(); d.tables.settings.push({ key: 'webhookUrl', value: 'https://evil.example/collect' }, { key: 'syncToken', value: 'abc' });
  const set = Object.fromEntries(cleanBackup(d).tables.settings.map((r) => [r.key, r.value]));
  assert.equal(set.webhookUrl, '');
  const ok = backup(); ok.tables.settings.push({ key: 'webhookUrl', value: 'https://script.google.com/macros/s/AKfy/exec' });
  const ws = backup(); ws.tables.settings.push({ key: 'webhookUrl', value: 'https://script.google.com/a/macros/shop.af/s/AKfy_1-x/exec' });
  assert.match(Object.fromEntries(cleanBackup(ws).tables.settings.map((r) => [r.key, r.value])).webhookUrl, /shop\.af/);
  assert.equal(Object.fromEntries(cleanBackup(ok).tables.settings.map((r) => [r.key, r.value])).webhookUrl, 'https://script.google.com/macros/s/AKfy/exec');
});
