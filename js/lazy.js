// Loads a classic <script> once, on demand. Heavy libraries (QR printing, scanner engines) are not needed to open
// the app, so they load only when used; the service worker still caches them for offline use.
const loading = new Map();
export function loadScript(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loading.delete(src); reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return loading.get(src);
}
export const LIBS = {
  qr: 'vendor/qrcode.js',
  zxing: 'vendor/zxing/zxing-reader.js',
  html5qr: 'vendor/html5-qrcode.min.js'
};
