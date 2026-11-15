import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncedTables } from '../js/logic.js';

// Old Google script answers ok but drops qarz rows: they must stay queued until a script that knows qarz says so.
const ALL = ['sales', 'receivings', 'shifts', 'movements', 'products', 'customers', 'ledger'];
test('old script: qarz tables are not marked sent', () => {
  assert.deepEqual(syncedTables(undefined, ALL), ['sales', 'receivings', 'shifts', 'movements', 'products']);
  assert.ok(!syncedTables([], ALL).includes('ledger'));
});
test('updated script: everything is marked sent', () => {
  assert.deepEqual(syncedTables(['qarz'], ALL), ALL);
});

test('review fix: after the script is updated, earlier qarz sales and shifts are sent again (their qarz columns were dropped)', async () => {
  const { needsQarzResend } = await import('../js/logic.js');
  assert.equal(needsQarzResend('sales', { customerId: 'c' }), true);
  assert.equal(needsQarzResend('sales', { total: 1 }), false);
  assert.equal(needsQarzResend('shifts', { qarzIn: 500 }), true);
  assert.equal(needsQarzResend('shifts', { qarzIn: 0 }), false);
  assert.equal(needsQarzResend('movements', { type: 'qarz' }), false);
});
