import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptDoc, paymentSlipDoc, zReportDoc } from '../js/print.js';
import { formatMoney } from '../js/logic.js';

const s = { storeName: 'فروشگاه TR', receiptFooter: 'تشکر' };
const base = { receiptId: 'T1-1', timestamp: '2026-11-14T10:00:00.000Z', cashierName: 'Ali', items: [{ name: 'روغن', qty: 1, price: 50000, unit: 'pc' }], total: 50000 };
const row = (doc, a) => doc.find((r) => r.t === 'row' && r.a === a);

test('receipt: qarz sale shows qarz on this receipt and total still owed by name, no change line', () => {
  const d = receiptDoc({ ...base, cashReceived: 20000, changeGiven: 0, credit: 30000, customerId: 'c', customerName: 'احمد', customerPhone: '0799123456', balanceAfter: 230000 }, s);
  assert.equal(row(d, 'قرض این رسید:').b, formatMoney(30000));
  assert.equal(row(d, 'مانده کل قرض — احمد:').b, formatMoney(230000));
  assert.equal(row(d, 'باقی:'), undefined);
  assert.ok(!JSON.stringify(d).includes('0799123456'), 'phone never printed');
});

test('receipt: extra cash paid toward old qarz is shown', () => {
  const d = receiptDoc({ ...base, cashReceived: 50000, changeGiven: 0, credit: 0, overpaidToQarz: 50000, customerId: 'c', customerName: 'احمد', balanceAfter: 150000 }, s);
  assert.equal(row(d, 'از قرض کم شد:').b, formatMoney(50000));
  assert.equal(row(d, 'نقد دریافتی:').b, formatMoney(100000));
});

test('receipt: plain cash sale unchanged', () => {
  const d = receiptDoc({ ...base, cashReceived: 100000, changeGiven: 50000 }, s);
  assert.equal(row(d, 'باقی:').b, formatMoney(50000));
  assert.equal(row(d, 'قرض این رسید:'), undefined);
});

test('payment slip: received and still owed', () => {
  const d = paymentSlipDoc({ customerName: 'احمد', amount: -50000, timestamp: '2026-11-14T10:00:00.000Z', by: 'Ali' }, 150000, s);
  assert.equal(row(d, 'دریافت شد:').b, formatMoney(50000));
  assert.equal(row(d, 'مانده:').b, formatMoney(150000));
  assert.ok(d.some((r) => r.text === 'رسید دریافت قرض'));
});

test('Z report: qarz collected line', () => {
  const d = zReportDoc({ shiftId: 'S1', cashierName: 'Ali', status: 'closed', varianceStatus: 'balanced', openedAt: base.timestamp, closedAt: base.timestamp,
    startingFloat: 0, netCash: 0, payins: 0, payouts: 0, drops: 0, expectedCash: 50000, countedCash: 50000, variance: 0, qarzIn: 50000, txCount: 0 }, s);
  assert.equal(row(d, 'دریافت قرض:').b, formatMoney(50000));
});

test('Z report: a shift with no qarz has no empty rows (printers would break)', () => {
  const d = zReportDoc({ shiftId: 'S1', cashierName: 'Ali', status: 'closed', varianceStatus: 'balanced', openedAt: base.timestamp, closedAt: base.timestamp,
    startingFloat: 0, netCash: 0, payins: 0, payouts: 0, drops: 0, expectedCash: 0, countedCash: 0, variance: 0, qarzIn: 0, txCount: 0 }, s);
  assert.ok(d.every((r) => r && typeof r === 'object'));
  assert.equal(row(d, 'دریافت قرض:'), undefined);
});
