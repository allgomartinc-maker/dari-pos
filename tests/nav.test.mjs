import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIDES, sideOf, navFor, firstViewOf } from '../js/nav.js';

// Research: a phone bottom bar holds 3-5 items (Material); keep menus visible (NN/g);
// split the till (front of the shop) from managing (back of the shop) like Loyverse POS / back office.

test('front of the shop is selling; back of the shop is managing', () => {
  assert.deepEqual(SIDES.front.views, ['register', 'qarz', 'shift']);
  assert.deepEqual(SIDES.back.views, ['receive', 'products', 'reports', 'settings']);
});

test('sideOf tells which side a screen belongs to', () => {
  assert.equal(sideOf('register'), 'front');
  assert.equal(sideOf('qarz'), 'front');
  assert.equal(sideOf('products'), 'back');
  assert.equal(sideOf('settings'), 'back');
  assert.equal(sideOf('nonsense'), 'front');
});

test('a cashier sees only the 3 front tabs and no switch button', () => {
  const n = navFor('cashier', 'register');
  assert.deepEqual(n.tabs, ['register', 'qarz', 'shift']);
  assert.equal(n.switchTo, null);
  assert.equal(n.side, 'front');
});

test('a cashier asking for a back screen still gets the front', () => {
  const n = navFor('cashier', 'settings');
  assert.equal(n.side, 'front');
  assert.equal(n.switchTo, null);
});

test('a manager at the front sees the 3 front tabs plus a switch to the back', () => {
  const n = navFor('admin', 'qarz');
  assert.deepEqual(n.tabs, ['register', 'qarz', 'shift']);
  assert.equal(n.switchTo, 'back');
});

test('a manager at the back sees the 4 back tabs plus a switch to the front', () => {
  const n = navFor('admin', 'reports');
  assert.equal(n.side, 'back');
  assert.deepEqual(n.tabs, ['receive', 'products', 'reports', 'settings']);
  assert.equal(n.switchTo, 'front');
});

test('the phone bar never holds more than 5 buttons', () => {
  for (const role of ['cashier', 'admin'])
    for (const v of [...SIDES.front.views, ...SIDES.back.views]) {
      const n = navFor(role, v);
      assert.ok(n.tabs.length + (n.switchTo ? 1 : 0) <= 5, `${role} ${v}`);
    }
});

test('switching side opens the last screen used there, else its first screen', () => {
  assert.equal(firstViewOf('back', {}), 'receive');
  assert.equal(firstViewOf('back', { back: 'reports' }), 'reports');
  assert.equal(firstViewOf('front', { front: 'shift' }), 'shift');
  assert.equal(firstViewOf('back', { back: 'register' }), 'receive'); // stale memory from the wrong side is ignored
});

test('every side has a Dari name and icon', () => {
  for (const k of ['front', 'back']) { assert.ok(SIDES[k].label); assert.ok(SIDES[k].icon); }
});

const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
test('the back of the shop has its own top-bar colour so you know where you are', () => {
  assert.match(css, /body\.side-back\s+\.topbar\s*\{[^}]*background/);
});
test('the switch button stands out from the tabs', () => {
  assert.match(css, /\.nav\s+\.nav-switch\s*\{[^}]*background/);
});
