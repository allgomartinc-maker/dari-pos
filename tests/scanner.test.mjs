import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFrame } from '../js/scanner.js';

// Dim, low-contrast stripes (grey 110 vs 140) with noise, like a barcode in a dark shop.
function dimStripes(w = 60, h = 20) {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (Math.floor(x / 6) % 2 ? 140 : 110) + rnd() * 30, i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

test('cleanFrame stretches dim bars to near black and white', () => {
  const img = cleanFrame(dimStripes());
  const mid = (x) => img.data[(10 * img.width + x) * 4];
  // Input gap between dark (110) and light (140) stripes is 30; after cleaning it should be > 120.
  assert.ok(mid(8) - mid(2) > 120, `gap should grow: dark ${mid(2)}, light ${mid(8)}`);
  assert.ok(mid(2) < 70, `dark bar should be dark, got ${mid(2)}`);
});

test('cleanFrame output is grey and opaque', () => {
  const img = cleanFrame(dimStripes());
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(img.data[i], img.data[i + 1]);
    assert.equal(img.data[i + 1], img.data[i + 2]);
    assert.equal(img.data[i + 3], 255);
  }
});

import { makeScanGate, upcVariants, paperCut } from '../js/scanner.js';

test('scan gate: a known product is accepted on the first read', () => {
  const gate = makeScanGate();
  assert.equal(gate('4006381333931', 0, true), 'accept');
});

test('scan gate: an unknown code needs three reads before it is accepted (one-off misreads are ignored)', () => {
  const gate = makeScanGate();
  assert.equal(gate('4006381333932', 0, false), 'wait');      // misread seen once
  assert.equal(gate('4006381333931', 40, true), 'accept');    // the real item wins
  assert.equal(gate('9999999999994', 100, false), 'wait');
  assert.equal(gate('9999999999994', 160, false), 'wait');
  assert.equal(gate('9999999999994', 220, false), 'accept');  // genuinely new item: confirmed by a 3rd read
});

test('scan gate: when one item gives two different unknown numbers, neither is accepted until one clearly leads', () => {
  const gate = makeScanGate();
  // Camera alternates between a consistent misread (M) and the true code (C) of a new item.
  assert.equal(gate('0091104666636', 0, false), 'wait');   // M 1
  assert.equal(gate('049000041194', 40, false), 'wait');   // C 1
  assert.equal(gate('0091104666636', 80, false), 'wait');  // M 2
  assert.equal(gate('049000041194', 120, false), 'wait');  // C 2
  assert.equal(gate('0091104666636', 160, false), 'wait'); // M 3, but C has 2: not a clear lead
  assert.equal(gate('049000041194', 200, false), 'wait');  // C 3 ties M 3
  assert.equal(gate('049000041194', 240, false), 'wait');  // C 4 vs M 3: lead of 1 is not enough
  assert.equal(gate('049000041194', 280, false), 'accept'); // C 5 vs M 3: clear lead of 2
});

test('scan gate: votes expire, so two misreads far apart do not add up', () => {
  const gate = makeScanGate({ windowMs: 1200 });
  assert.equal(gate('1111111111116', 0, false), 'wait');
  assert.equal(gate('1111111111116', 5000, false), 'wait');
});

test('scan gate: the same item held in view counts once until it leaves for 1.5 s', () => {
  const gate = makeScanGate();
  assert.equal(gate('4006381333931', 0, true), 'accept');
  assert.equal(gate('4006381333931', 500, true), 'repeat');
  assert.equal(gate('4006381333931', 1900, true), 'repeat');  // still in view (last seen 500 → 1900 < 1.5 s apart)
  assert.equal(gate('4006381333931', 3500, true), 'accept');  // gone for 1.6 s, scanned again = second item
});

test('upcVariants: a 12-digit UPC-A and its 13-digit EAN form find the same product', () => {
  assert.deepEqual(upcVariants('049000041194'), ['049000041194', '0049000041194']);
  assert.deepEqual(upcVariants('0049000041194'), ['0049000041194', '049000041194']);
  assert.deepEqual(upcVariants('4006381333931'), ['4006381333931']); // real EAN-13, no UPC form
  assert.deepEqual(upcVariants('2000000000121'), ['2000000000121']);
  assert.deepEqual(upcVariants('ABC-12'), ['ABC-12']);
});

// Repeating stripes: dark bar, white, pale bar, white (6 px each), like a two-tone barcode on a can.
function twoToneBars(dark, pale, w = 96, h = 10) {
  const data = new Uint8ClampedArray(w * h * 4), white = [255, 255, 255];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = [dark, white, pale, white][Math.floor(x / 6) % 4], i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}
const at = (img, x) => img.data[(5 * img.width + x) * 4];

test('cleanFrame red channel (like a red laser) makes pale blue bars darker than normal grey does', () => {
  const dark = [20, 40, 140], pale = [120, 150, 230];
  const red = cleanFrame(twoToneBars(dark, pale), { smooth: false });
  const luma = cleanFrame(twoToneBars(dark, pale), { smooth: false, channel: 'luma' });
  // pale bar centre is x = 15; white is x = 9
  assert.ok(at(red, 15) + 15 < at(luma, 15), `pale bar: red ${at(red, 15)} vs luma ${at(luma, 15)}`);
  assert.ok(at(red, 9) > 240, 'white stays white');
});

test('cleanFrame red channel: black bars on a yellow pack stay readable (background stays light)', () => {
  const data = new Uint8ClampedArray(60 * 10 * 4);
  for (let p = 0; p < 600; p++) { const bar = Math.floor((p % 60) / 6) % 2 === 0; const c = bar ? [20, 20, 20] : [250, 210, 30]; data.set([...c, 255], p * 4); }
  const img = cleanFrame({ data, width: 60, height: 10 }, { smooth: false });
  assert.ok(at(img, 8) - at(img, 2) > 200, `black bar ${at(img, 2)} vs yellow ${at(img, 8)}`);
});

test('paperCut: pale bars (much lighter than the dark bars) still become black; white paper stays white', () => {
  const img = paperCut(twoToneBars([20, 40, 140], [180, 190, 205]));
  assert.equal(at(img, 3), 0);    // dark bar
  assert.equal(at(img, 15), 0);   // pale bar — lost by normal grey + contrast
  assert.equal(at(img, 9), 255);  // white paper
});
