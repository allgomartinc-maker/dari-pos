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

const URL_OK = 'https://script.google.com/macros/s/AKfy_1-x/exec';
const TOK = 'abcdef0123456789abcd';
test('pairing QR: a real Sheet QR gives the address and key', async () => {
  const { parsePairing } = await import('../js/logic.js');
  assert.deepEqual(parsePairing(`DPOS|S|${URL_OK}|${TOK}`), { url: URL_OK, token: TOK });
  const ws = 'https://script.google.com/a/macros/shop.af/s/AKfy/exec';
  assert.deepEqual(parsePairing(`DPOS|S|${ws}|${TOK}`), { url: ws, token: TOK });
});
test('pairing QR: lookalike addresses, short or odd keys, and other QRs are refused', async () => {
  const { parsePairing } = await import('../js/logic.js');
  for (const bad of [
    `DPOS|S|http://script.google.com/macros/s/x/exec|${TOK}`,
    `DPOS|S|https://script.google.com.evil.af/macros/s/x/exec|${TOK}`,
    `DPOS|S|${URL_OK}|short123`,
    `DPOS|S|${URL_OK}|abcdef0123456789<b>`,
    `DPOS|S|${URL_OK}|${TOK}|extra`,
    `DPOS|R|T1-1|100|2026`,
    '012000000133', ''
  ]) assert.equal(parsePairing(bad), null, bad);
});
