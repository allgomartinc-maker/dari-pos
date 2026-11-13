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
// One pipeline for every phone: our own HD video, the centre strip read at full resolution.
// Decoder, best available first:
//  1. the phone's built-in BarcodeDetector (most Android phones with Chrome)
//  2. zxing-wasm (ZXing C++ compiled to WebAssembly; iPhone, Huawei, Firefox, desktops) — fast and robust
//  3. the JavaScript ZXing inside html5-qrcode (only if WebAssembly is unavailable)
// html5-qrcode's own live loop is not used: it shrank frames to the on-screen box (~350px on a phone),
// squeezing each bar to ~1px, which is why scanning used to be slow.
let cam = null;  // { stream, track, video, stopped, timer }
export let decoderName = '';
// ITF and Code 39 are left out on purpose: they have weak or no check digits, are not used on shop goods,
// and are the usual source of "phantom" codes when the camera sees half a barcode.
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'];
const WASM_FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'QRCode'];
const VIDEO = { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] };
const CROP_W = 0.9, CROP_H = 0.5; // centre strip (matches the white guide box) at full HD: far barcodes need ~2px per bar
const ZOOM = 2; // 2x zoom: hold the phone ~25 cm away, where phone cameras can focus sharply

/**
 * Decides whether a camera read becomes a scan:
 *  'accept' → use it; 'wait' → unknown code seen once, wait for a second matching read; 'repeat' → same item still in view.
 * A known product is accepted at once (a misread almost never lands on another real product). An unknown code must be
 * read `confirm` times within `windowMs`, so a one-off misread of a blurry or half-visible barcode never pops up
 * "not found". The same item counts once until it has been out of view for `repeatMs`.
 */
export function makeScanGate({ confirm = 2, windowMs = 1200, repeatMs = 1500 } = {}) {
  let last = '', lastAt = -Infinity;
  const votes = new Map();
  return (code, now, known) => {
    if (code === last && now - lastAt < repeatMs) { lastAt = now; return 'repeat'; }
    if (!known) {
      const v = votes.get(code);
      const n = v && now - v.at < windowMs ? v.n + 1 : 1;
      votes.set(code, { n, at: now });
      if (n < confirm) return 'wait';
    }
    votes.clear();
    last = code; lastAt = now;
    return 'accept';
  };
}

let gate = makeScanGate();
async function emit(text, onCode, isKnown) {
  const code = normalizeBarcode(text);
  // Any dialog open (not-found, weight, add product) pauses the camera.
  if (document.querySelector('.modal-back')) return;
  let known = false;
  try { known = isKnown ? !!(await isKnown(code)) : false; } catch { /* treat as unknown */ }
  if (gate(code, Date.now(), known) !== 'accept') return;
  if (navigator.vibrate) navigator.vibrate(40);
  onCode(code, 'camera');
}

// Draws the centre strip of the current frame into a canvas at full resolution.
function cropper() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return (video) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    const sw = Math.round(vw * CROP_W), sh = Math.round(vh * CROP_H);
    if (canvas.width !== sw || canvas.height !== sh) { canvas.width = sw; canvas.height = sh; }
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, sw, sh);
    return { canvas, ctx };
  };
}

async function nativeDecoder() {
  if (!('BarcodeDetector' in window) || window.__scanDecoder && window.__scanDecoder !== 'native') return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (!formats.includes('ean_13')) return null;
    const det = new window.BarcodeDetector({ formats });
    const crop = cropper();
    return async (video) => { const r = await det.detect(crop(video).canvas); return r[0]?.rawValue || null; };
  } catch { return null; }
}

let wasmReady = null;
function loadWasm() {
  if (!wasmReady) {
    const Z = window.ZXingWASM;
    if (!Z || typeof WebAssembly !== 'object') return Promise.reject(new Error('no wasm'));
    const base = new URL('vendor/zxing/', document.baseURI).href; // served locally and cached for offline use
    wasmReady = Z.prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? base + path : prefix + path) },
      fireImmediately: true
    }).then(() => Z).catch((e) => { wasmReady = null; throw e; });
  }
  return wasmReady;
}
// Start downloading/compiling the decoder early so the first scan is not delayed.
export function warmUpScanner() { if (!('BarcodeDetector' in window)) loadWasm().catch(() => {}); }

async function wasmDecoder() {
  if (window.__scanDecoder && window.__scanDecoder !== 'wasm') return null;
  try {
    const Z = await loadWasm();
    const crop = cropper();
    const opts = { formats: WASM_FORMATS, maxNumberOfSymbols: 1, tryHarder: true, tryRotate: false, tryInvert: false, tryDownscale: true };
    let frame = 0;
    // Alternate frames: raw (best for sharp / far barcodes) and cleaned (best for dim shops and grainy cameras).
    return async (video) => {
      const { canvas, ctx } = crop(video);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (frame++ % 2) cleanFrame(img);
      const r = await Z.readBarcodes(img, opts);
      return r.find((x) => x.isValid)?.text || null;
    };
  } catch { return null; }
}

// In place: grey, 3x3 smoothing (removes sensor noise), then stretch contrast so dim bars become black/white.
// Plain JS because canvas filters are missing on older iPhones.
export function cleanFrame(img) {
  const { data, width: w, height: h } = img;
  const n = w * h, g = new Float32Array(n), t = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) t[r + x] = (g[r + Math.max(0, x - 1)] + g[r + x] + g[r + Math.min(w - 1, x + 1)]) / 3;
  }
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w, dn = Math.min(h - 1, y + 1) * w, r = y * w;
    for (let x = 0; x < w; x++) { const v = (t[up + x] + t[r + x] + t[dn + x]) / 3; g[r + x] = v; hist[v | 0]++; }
  }
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > n * 0.02) break; }
  for (acc = 0; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.02) break; }
  const k = hi > lo ? 255 / (hi - lo) : 1;
  for (let i = 0; i < n; i++) { const v = (g[i] - lo) * k; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return img;
}

function jsDecoder() {
  const F = window.Html5QrcodeSupportedFormats;
  document.getElementById('zxingHolder')?.remove();
  const holder = document.createElement('div');
  holder.id = 'zxingHolder'; holder.hidden = true;
  document.body.appendChild(holder);
  const zx = new window.Html5Qrcode('zxingHolder', {
    verbose: false,
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.QR_CODE],
    experimentalFeatures: { useBarCodeDetectorIfSupported: false }
  });
  const crop = cropper();
  return async (video) => { try { return (await zx.qrcode.decodeAsync(crop(video).canvas)).text; } catch { return null; } };
}

async function makeDecoder() {
  let d = await nativeDecoder();
  if (d) {
    decoderName = 'native';
    // Safety net: some phones report a built-in reader that never finds anything (e.g. Android without
    // Google services). Every third frame the built-in reader misses also goes through zxing-wasm.
    let backup = null, i = 0;
    if (!window.__scanDecoder) wasmDecoder().then((w) => { backup = w; });
    const native = d;
    return async (video) => (await native(video)) || (backup && ++i % 3 === 0 ? backup(video) : null);
  }
  d = await wasmDecoder();
  if (d) { decoderName = 'wasm'; return d; }
  decoderName = 'js';
  return jsDecoder();
}

// Zoom, flashlight and tap-to-focus, where the phone allows them.
async function setupControls(box, track, signal) {
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const bar = document.createElement('div');
  bar.className = 'cam-controls';
  if (caps.zoom && caps.zoom.max >= 1.5) {
    const z = Math.min(ZOOM, caps.zoom.max);
    try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch { /* ignore */ }
    let zoomed = true;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cam-btn'; b.textContent = `${z}×`;
    b.onclick = async (e) => {
      e.stopPropagation(); zoomed = !zoomed;
      try { await track.applyConstraints({ advanced: [{ zoom: zoomed ? z : caps.zoom.min || 1 }] }); } catch { /* ignore */ }
      b.textContent = zoomed ? `${z}×` : '1×';
    };
    bar.appendChild(b);
  }
  if (caps.torch) {
    let on = false;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cam-btn'; b.textContent = '🔦';
    b.onclick = async (e) => {
      e.stopPropagation(); on = !on;
      try { await track.applyConstraints({ advanced: [{ torch: on }] }); b.classList.toggle('on', on); } catch { on = !on; }
    };
    bar.appendChild(b);
  }
  if (bar.children.length) box.appendChild(bar);
  // Tap the picture to refocus (phones that support single-shot focus).
  const modes = caps.focusMode || [];
  if (modes.includes('single-shot') || modes.includes('continuous')) {
    box.addEventListener('click', async (e) => {
      if (e.target.closest('.cam-btn')) return;
      box.classList.add('focusing');
      try {
        if (modes.includes('single-shot')) await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
        if (modes.includes('continuous')) setTimeout(() => track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}), 800);
      } catch { /* ignore */ }
      setTimeout(() => box.classList.remove('focusing'), 600);
    }, { signal });
  }
}

// opts.isKnown(code) → true when the code is a product (or receipt) this device already has.
export async function startCamera(elementId, onCode, opts = {}) {
  await stopCamera();
  gate = makeScanGate();
  const box = document.getElementById(elementId);
  const [decode, stream] = await Promise.all([makeDecoder(), navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false })]);
  const track = stream.getVideoTracks()[0];
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  box.innerHTML = '<div class="scan-guide"></div>';
  box.prepend(video);
  const c = cam = { stream, track, video, box, stopped: false, timer: 0, ac: new AbortController() };
  await video.play();
  setupControls(box, track, c.ac.signal).catch(() => {});
  // Each decode finishes before the next starts; the pause after it is as long as the decode took,
  // so a slow phone spends at most about half its time scanning and buttons stay responsive.
  const tick = async () => {
    if (c.stopped) return;
    const t0 = performance.now();
    if (video.readyState >= 2 && video.videoWidth) {
      try { const text = await decode(video); if (text && !c.stopped) await emit(text, onCode, opts.isKnown); } catch { /* frame not ready */ }
    }
    if (!c.stopped) c.timer = setTimeout(tick, Math.max(15, Math.min(300, performance.now() - t0)));
  };
  tick();
}

export async function stopCamera() {
  if (!cam) return;
  const c = cam; cam = null;
  c.stopped = true;
  clearTimeout(c.timer);
  c.stream.getTracks().forEach((t) => t.stop());
  c.ac.abort(); // removes the tap-to-focus listener
  c.box.classList.remove('focusing');
  c.box.innerHTML = '';
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
