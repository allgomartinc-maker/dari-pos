import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceOf, balancesById, splitQarzPayment, overLimit, findCustomers, ledgerEntry, qarzTotals, statementText } from '../js/qarz.js';
import { dayRange } from '../js/logic.js';

// Money in pul (1 AFN = 100 pul). Owner's example: owes 2,000, buys 500, gives 1,000 → owes 1,500.
test('split: owes 2,000, buys 500, gives 1,000 → 500 pays the purchase, 500 comes off the qarz', () => {
  assert.deepEqual(splitQarzPayment({ total: 50000, cash: 100000, balance: 200000 }),
    { cashReceived: 50000, credit: 0, overpaid: 50000, newBalance: 150000, overBalance: false });
});
test('split: gives 200 for a 500 purchase → 300 added to the qarz', () => {
  const r = splitQarzPayment({ total: 50000, cash: 20000, balance: 200000 });
  assert.equal(r.credit, 30000); assert.equal(r.cashReceived, 20000); assert.equal(r.newBalance, 230000);
});
test('split: gives exactly 500 → nothing added, nothing paid off', () => {
  const r = splitQarzPayment({ total: 50000, cash: 50000, balance: 200000 });
  assert.equal(r.credit, 0); assert.equal(r.overpaid, 0); assert.equal(r.newBalance, 200000);
});
test('split: gives 3,000 when owing 2,000 → goes 500 below zero and is flagged', () => {
  const r = splitQarzPayment({ total: 50000, cash: 300000, balance: 200000 });
  assert.equal(r.overpaid, 250000); assert.equal(r.newBalance, -50000); assert.equal(r.overBalance, true);
});
test('split: nothing owed and gives more than the purchase → flagged (would make the shop owe them)', () => {
  assert.equal(splitQarzPayment({ total: 50000, cash: 60000, balance: 0 }).overBalance, true);
});

const e = (customerId, type, amount, ts = '2026-11-10T10:00:00.000Z') => ({ customerId, type, amount, timestamp: ts });
test('balance: sale 300, paid 300, then that sale voided → -300 (the shop owes them)', () => {
  assert.equal(balanceOf([e('a', 'sale', 30000), e('a', 'payment', -30000), e('a', 'void', -30000), e('b', 'sale', 999)], 'a'), -30000);
});
test('balancesById: one total and the last activity per customer', () => {
  const m = balancesById([e('a', 'sale', 100, '2026-11-01T00:00:00Z'), e('a', 'payment', -40, '2026-11-03T00:00:00Z'), e('b', 'sale', 7)]);
  assert.equal(m.get('a').balance, 60); assert.equal(m.get('a').lastAt, '2026-11-03T00:00:00Z'); assert.equal(m.get('b').balance, 7);
});

test('limit: 0 means no limit; above a set limit is flagged', () => {
  assert.equal(overLimit({ limit: 0 }, 9e9), false);
  assert.equal(overLimit({}, 9e9), false);
  assert.equal(overLimit({ limit: 100000 }, 100000), false);
  assert.equal(overLimit({ limit: 100000 }, 100001), true);
});

const people = [
  { id: 'a', name: ' احمد ', phone: '0799123456' },
  { id: 'b', name: 'Karim', phone: '' },
  { id: 'c', name: 'محمود', phone: '0700000000', deleted: 1 },
  { id: 'd', name: 'Gul', deleted: 1 }
];
const bal = new Map([['a', { balance: 500 }], ['b', { balance: 9000 }], ['c', { balance: 0 }], ['d', { balance: 300 }]]);
test('search: finds a name with extra spaces, any letter case, or Dari digits of the phone', () => {
  assert.deepEqual(findCustomers(people, 'احمد', bal).map((c) => c.id), ['a']);
  assert.deepEqual(findCustomers(people, 'karim', bal).map((c) => c.id), ['b']);
  assert.deepEqual(findCustomers(people, '۰۷۹۹', bal).map((c) => c.id), ['a']);
});
test('search: empty query lists everyone, highest debt first; deleted at 0 hidden, deleted still owing shown', () => {
  assert.deepEqual(findCustomers(people, '', bal).map((c) => c.id), ['b', 'a', 'd']);
});

test('ledgerEntry: fills id, name, time and marks it for sync', () => {
  const x = ledgerEntry({ customer: { id: 'a', name: 'احمد' }, type: 'sale', amount: 30000, receiptId: 'T1-1', shiftId: 'S1', by: 'Ali' });
  assert.ok(x.id); assert.equal(x.customerId, 'a'); assert.equal(x.customerName, 'احمد'); assert.equal(x.synced, 0);
  assert.equal(x.amount, 30000); assert.equal(x.receiptId, 'T1-1'); assert.equal(x.timestamp, x.updatedAt);
});
test('ledgerEntry: a manager adjustment without a note is refused', () => {
  assert.throws(() => ledgerEntry({ customer: { id: 'a', name: 'x' }, type: 'adjust', amount: -1000, by: 'Ali' }), /یادداشت/);
  assert.throws(() => ledgerEntry({ customer: { id: 'a', name: 'x' }, type: 'gift', amount: 1, by: 'Ali' }), /type/);
});

test('qarzTotals: given = sales minus voids, collected = payments, only inside the dates', () => {
  const r = dayRange('2026-11-02', '2026-11-03');
  const at = (d) => new Date(`2026-11-${d}T12:00:00`).toISOString();
  const list = [e('a', 'sale', 50000, at('01')), e('a', 'sale', 30000, at('02')), e('a', 'void', -10000, at('03')),
    e('a', 'payment', -20000, at('03')), e('a', 'payment', -5000, at('04')), e('a', 'adjust', -1000, at('02'))];
  assert.deepEqual(qarzTotals(list, r), { given: 20000, collected: 20000 });
});

test('statementText: Dari text with name, what is owed and recent lines', () => {
  const t = statementText({ storeName: 'فروشگاه TR', customer: { name: 'احمد' }, balance: 150000,
    entries: [e('a', 'sale', 50000), e('a', 'payment', -50000)] });
  assert.match(t, /فروشگاه TR/); assert.match(t, /احمد/); assert.match(t, /مانده قرض: ۱٬۵۰۰ افغانی/);
  assert.match(t, /دریافت/); assert.equal(t.split('\n').filter((l) => / · /.test(l)).length, 2);
});
