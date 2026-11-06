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
let cam = null;
let lastCode = '', lastAt = 0;

export async function startCamera(elementId, onCode) {
  await stopCamera();
  const F = window.Html5QrcodeSupportedFormats;
  cam = new window.Html5Qrcode(elementId, {
    verbose: false,
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE],
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  });
  await cam.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.9, 360), height: Math.min(h * 0.6, 200) }) },
    (text) => {
      const code = normalizeBarcode(text);
      const now = Date.now();
      // Same code still in view counts once; any dialog open (not-found, weight, add product) pauses the camera.
      const repeat = code === lastCode && now - lastAt < 1500;
      lastCode = code; lastAt = now;
      if (repeat || document.querySelector('.modal-back')) return;
      onCode(code, 'camera');
    }, () => {});
}

export async function stopCamera() {
  if (cam) {
    try { if (cam.isScanning) await cam.stop(); cam.clear(); } catch { /* ignore */ }
    cam = null;
  }
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
