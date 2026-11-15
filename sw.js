// Service worker: caches the whole app so it opens and runs with no internet.
const VERSION = 'dari-pos-v20';
const SHARE_CACHE = 'dari-pos-shared'; // a move file shared from WhatsApp waits here until the app opens
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/qarz.js', 'js/lazy.js', 'js/icons.js', 'js/db.js', 'js/logic.js', 'js/print.js', 'js/scanner.js', 'js/sync.js', 'js/ui.js',
  'vendor/dexie.min.js', 'vendor/html5-qrcode.min.js', 'vendor/qrcode.js', 'vendor/zxing/zxing-reader.js', 'vendor/zxing/zxing_reader.wasm', 'vendor/fonts/Vazirmatn.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Google Sheets sync goes straight to network
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()));
      return hit || net; // cache first, refresh in background
    })
  );
});

// WhatsApp › Share › صندوق دری sends the move file here (manifest share_target). Keep it, then open the app.
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const file = form.getAll('file').find((f) => f && typeof f !== 'string');
    if (file) {
      const c = await caches.open(SHARE_CACHE);
      await c.put('shared-file', new Response(file, { headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent(file.name || 'move.txt') } }));
    }
  } catch (err) { /* opening the app still works; it just won't find a file */ }
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}
