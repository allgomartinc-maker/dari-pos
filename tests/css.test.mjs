import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

// iPhone Safari zooms the whole page when a focused field's text is under 16px,
// which left sheets (e.g. the weigh sheet) cut off on the side.
test('form fields use at least 16px text so iPhone does not zoom on focus', () => {
  const m = css.match(/input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(m, 'a rule sets font-size on input, select, textarea');
  assert.ok(+m[1] >= 16, `font-size is ${m[1]}px`);
});

test('weigh sheet presets sit on one row', () => {
  assert.match(css, /\.weigh-presets\s*\{[^}]*grid-template-columns:\s*repeat\(5,/);
});
