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

import { makeScanGate } from '../js/scanner.js';

test('scan gate: a known product is accepted on the first read', () => {
  const gate = makeScanGate();
  assert.equal(gate('4006381333931', 0, true), 'accept');
});

test('scan gate: an unknown code needs two reads before it is accepted (one-off misreads are ignored)', () => {
  const gate = makeScanGate();
  assert.equal(gate('4006381333932', 0, false), 'wait');      // misread seen once
  assert.equal(gate('4006381333931', 40, true), 'accept');    // the real item wins
  assert.equal(gate('9999999999994', 100, false), 'wait');
  assert.equal(gate('9999999999994', 160, false), 'accept');  // genuinely new item: confirmed by a 2nd read
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
