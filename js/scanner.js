// Barcode / QR input, fully offline:
//  - USB / Bluetooth handheld scanners in "keyboard wedge" mode (fast keystrokes + Enter)
//  - Device camera via html5-qrcode (ZXing, Apache-2.0), using native BarcodeDetector when available
import { normalizeBarcode } from './logic.js';

let handler = null;
let buf = '';
let last = 0;

// Map by physical key (e.code) so scans still read correctly when the OS keyboard is set to Dari/Persian.
function keyFromCode(e) {
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^Numpad\d$/.test(e.code)) return e.code.slice(6);
  if (/^Key[A-Z]$/.test(e.code)) return e.shiftKey ? e.code.slice(3) : e.code.slice(3).toLowerCase();
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return '-';
  if (e.code === 'Period' || e.code === 'NumpadDecimal') return '.';
  if (e.code === 'Slash') return '/';
  return e.key && e.key.length === 1 ? e.key : '';
}

export function setScanHandler(fn) { handler = fn; }

export function initWedge() {
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    // Inputs (including scan boxes, which handle Enter themselves) receive keys normally.
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    if (typing || !handler || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = performance.now();
    if (now - last > 80) buf = '';
    last = now;
    if (e.key === 'Enter') {
      if (buf.length >= 3) { e.preventDefault(); const code = normalizeBarcode(buf); buf = ''; handler(code, 'wedge'); }
      buf = '';
      return;
    }
    const ch = keyFromCode(e);
    if (ch && ch !== ' ') { buf += ch; e.preventDefault(); }
  }, true);
}

// ---------- camera ----------
// One pipeline for every phone: our own HD video + a crop of the centre strip at full resolution.
//  - Fast path: the phone's built-in BarcodeDetector (Android Chrome etc.).
//  - Fallback (e.g. iPhone): the ZXing decoder bundled in html5-qrcode, fed the full-resolution crop.
// (html5-qrcode's own live loop shrinks the frame to the on-screen box, ~350px on a phone, which
//  squeezes each bar to ~1px — that is why scanning used to need many seconds or a very close phone.)
let cam = null;  // { stream, video, stopped, timer }
let lastCode = '', lastAt = 0;
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
const VIDEO = { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] };
const CROP_W = 0.9, CROP_H = 0.5, MAX_W = 1280; // centre strip at full HD resolution: small/far barcodes need ~2px per bar

function emit(text, onCode) {
  const code = normalizeBarcode(text);
  const now = Date.now();
  // Same code still in view counts once; any dialog open (not-found, weight, add product) pauses the camera.
  const repeat = code === lastCode && now - lastAt < 1500;
  lastCode = code; lastAt = now;
  if (repeat || document.querySelector('.modal-back')) return;
  onCode(code, 'camera');
}

async function makeDecoder() {
  if ('BarcodeDetector' in window && !window.__noNativeScan) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (formats.includes('ean_13')) {
        const det = new window.BarcodeDetector({ formats });
        return async (video) => { const r = await det.detect(video); return r[0]?.rawValue || null; };
      }
    } catch { /* fall through to ZXing */ }
  }
  const F = window.Html5QrcodeSupportedFormats;
  const holder = document.createElement('div');
  holder.id = 'zxingHolder'; holder.hidden = true;
  document.getElementById('zxingHolder')?.remove();
  document.body.appendChild(holder);
  const zx = new window.Html5Qrcode('zxingHolder', {
    verbose: false,
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE],
    experimentalFeatures: { useBarCodeDetectorIfSupported: false }
  });
  const shim = zx.qrcode;
  if (!shim || typeof shim.decodeAsync !== 'function') throw new Error('ZXing decoder not available');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    const sw = Math.round(vw * CROP_W), sh = Math.round(vh * CROP_H);
    const scale = Math.min(1, MAX_W / sw);
    canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    try { return (await shim.decodeAsync(canvas)).text; } catch { return null; } // throws when nothing found
  };
}

export async function startCamera(elementId, onCode) {
  await stopCamera();
  const decode = await makeDecoder();
  const box = document.getElementById(elementId);
  const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  box.innerHTML = '<div class="scan-guide"></div>';
  box.prepend(video);
  const c = cam = { stream, video, stopped: false, timer: 0 };
  await video.play();
  // Each decode finishes before the next one starts, and the pause after it is as long as the decode took,
  // so on a slow phone the scanner uses at most about half the CPU and buttons stay responsive.
  const tick = async () => {
    if (c.stopped) return;
    const t0 = performance.now();
    if (video.readyState >= 2 && video.videoWidth) {
      try { const text = await decode(video); if (text && !c.stopped) emit(text, onCode); } catch { /* frame not ready */ }
    }
    if (!c.stopped) c.timer = setTimeout(tick, Math.max(20, Math.min(400, performance.now() - t0)));
  };
  tick();
}

export async function stopCamera() {
  if (!cam) return;
  const c = cam; cam = null;
  c.stopped = true;
  clearTimeout(c.timer);
  c.stream.getTracks().forEach((t) => t.stop());
  if (c.video.parentElement) c.video.parentElement.innerHTML = '';
}

export function cameraActive() { return !!cam; }

// ---------- feedback sounds (Web Audio, no files) ----------
let actx = null;
export function beep(kind = 'ok') {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = { ok: [[1200, 0.08]], new: [[700, 0.12], [900, 0.12]], err: [[220, 0.3]], done: [[880, 0.1], [1320, 0.15]] }[kind];
    let t = actx.currentTime;
    for (const [f, d] of tones) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.type = 'square'; g.gain.value = 0.08;
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d); t += d + 0.03;
    }
  } catch { /* audio not available */ }
  if (kind === 'err') navigator.vibrate?.(200);
}
