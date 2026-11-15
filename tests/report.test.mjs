import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayRange, summarizeSales, reportText, reportCsv } from '../js/logic.js';

test('dayRange: 1st to 6th is six whole days, end is the start of the 7th', () => {
  const r = dayRange('2026-11-01', '2026-11-06');
  assert.equal(r.from, '2026-11-01');
  assert.equal(r.to, '2026-11-06');
  assert.equal(r.days, 6);
  assert.equal(r.start.getDate(), 1);
  assert.equal(r.end.getDate(), 7);
  assert.equal(r.end.getHours(), 0);
});

test('dayRange: dates picked backwards are swapped; one day is one day', () => {
  const r = dayRange('2026-11-09', '2026-11-01');
  assert.equal(r.from, '2026-11-01');
  assert.equal(r.days, 9);
  assert.equal(dayRange('2026-11-14', '2026-11-14').days, 1);
});

test('dayRange: a range over a year is cut to 366 days', () => {
  const r = dayRange('2024-01-01', '2026-11-14');
  assert.equal(r.days, 366);
  assert.equal(r.to, '2026-11-14');
});

const at = (d, h = 10) => new Date(`2026-11-${d}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const sales = [
  { receiptId: 'A', timestamp: at('01'), total: 5000, items: [{ barcode: '1', name: 'آب', qty: 2, price: 2000, cost: 1500, unit: 'pc' }, { barcode: '2', name: 'نان', qty: 1, price: 1000, cost: 500, unit: 'pc' }] },
  { receiptId: 'B', timestamp: at('01', 18), total: 3000, items: [{ barcode: '3', name: 'پیاز', qty: 0.5, price: 6000, cost: 4000, unit: 'kg' }] },
  { receiptId: 'C', timestamp: at('03'), total: 2000, items: [{ barcode: '1', name: 'آب', qty: 1, price: 2000, cost: 1500, unit: 'pc' }] },
  { receiptId: 'D', timestamp: at('03'), total: 9000, voided: true, items: [{ barcode: '1', name: 'آب', qty: 1, price: 9000, unit: 'pc' }] }
];

test('summarizeSales: totals, profit and voids', () => {
  const s = summarizeSales(sales);
  assert.equal(s.net, 10000);
  assert.equal(s.cost, 1500 * 2 + 500 + 2000 + 1500);
  assert.equal(s.profit, 10000 - 7000);
  assert.equal(s.count, 3);
  assert.deepEqual(s.voids, { n: 1, total: 9000 });
});

test('summarizeSales: one row per day with sales, oldest first; top items by money', () => {
  const s = summarizeSales(sales);
  assert.deepEqual(s.byDay.map((d) => [d.day, d.total, d.count]), [['2026-11-01', 8000, 2], ['2026-11-03', 2000, 1]]);
  assert.equal(s.top[0].name, 'آب');
  assert.equal(s.top[0].qty, 3);
  assert.equal(s.top[0].total, 6000);
});

test('reportText: Dari summary for email with store, dates and totals', () => {
  const r = dayRange('2026-11-01', '2026-11-06');
  const t = reportText({ storeName: 'فروشگاه TR', range: r, sum: summarizeSales(sales) });
  assert.match(t, /فروشگاه TR/);
  assert.match(t, /فروش خالص: ۱۰۰ افغانی/);
  assert.match(t, /تعداد رسید: ۳/);
  assert.match(t, /باطل شده: ۱/);
  assert.match(t, /\n/);
});

test('reportCsv: summary block, per-day block, then every sold line (Excel-safe UTF-8)', () => {
  const r = dayRange('2026-11-01', '2026-11-06');
  const csv = reportCsv({ storeName: 'TR', range: r, sum: summarizeSales(sales), sales });
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /from,2026-11-01/);
  assert.match(csv, /to,2026-11-06/);
  assert.match(csv, /net_sales_afn,100/);
  assert.match(csv, /2026-11-01,80,2/);
  assert.match(csv, /receiptId,timestamp,cashier,barcode,item/);
  assert.match(csv, /\nA,2026-11-01 10:00,/); // shop's own clock, not UTC
  assert.equal(csv.split('\n').filter((l) => /^(A|B|C|D),/.test(l)).length, 5);
});

test('solarMonthStart: 14 Nov 2026 is 23 Aqrab, so the month began 23 Oct 2026 (1 Aqrab)', async () => {
  const { solarMonthStart } = await import('../js/logic.js');
  const d = solarMonthStart(new Date(2026, 10, 14, 15));
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 10, 23]);
});
