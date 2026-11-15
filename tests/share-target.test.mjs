import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// WhatsApp › long-press the move file › Share › صندوق دری: Android lists installed web apps that declare share_target.
test('manifest offers the app in the Android share menu for the move file', () => {
  const st = manifest.share_target;
  assert.ok(st, 'share_target present');
  assert.equal(st.method, 'POST');
  assert.equal(st.enctype, 'multipart/form-data');
  assert.equal(st.action, './share-target');
  const files = st.params.files[0];
  assert.equal(files.name, 'file');
  for (const t of ['text/plain', '.txt', 'application/json', '.json']) assert.ok(files.accept.includes(t), t);
});

test('service worker keeps the shared file and opens the app; app updates never delete it', () => {
  assert.match(sw, /share-target/);
  assert.match(sw, /formData\(\)/);
  assert.match(sw, /SHARE_CACHE/);
  assert.match(sw, /k !== VERSION && k !== SHARE_CACHE/);
});
