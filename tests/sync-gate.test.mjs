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
