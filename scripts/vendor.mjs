// Copies free open-source libraries from node_modules into /vendor so the app has zero CDN calls.
import { copyFileSync, mkdirSync } from 'node:fs';
const files = [
  ['node_modules/dexie/dist/dexie.min.js', 'vendor/dexie.min.js'],
  ['node_modules/dexie/LICENSE', 'vendor/LICENSE-dexie.txt'],
  ['node_modules/html5-qrcode/html5-qrcode.min.js', 'vendor/html5-qrcode.min.js'],
  ['node_modules/html5-qrcode/LICENSE', 'vendor/LICENSE-html5-qrcode.txt'],
  ['node_modules/qrcode-generator/qrcode.js', 'vendor/qrcode.js'],
  ['node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2', 'vendor/fonts/Vazirmatn.woff2'],
  ['node_modules/vazirmatn/OFL.txt', 'vendor/fonts/OFL-Vazirmatn.txt'],
];
mkdirSync('vendor/fonts', { recursive: true });
for (const [from, to] of files) { copyFileSync(from, to); console.log('copied', to); }
