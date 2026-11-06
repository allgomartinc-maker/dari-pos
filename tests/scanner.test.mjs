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
