// Receipts & Z-reports. One document model -> two outputs:
//  1) HTML in a hidden iframe + window.print()  (any printer the OS knows, USB/system thermal printers)
//  2) Canvas -> 1-bit raster -> ESC/POS over Web Bluetooth (Dari text can't use printer code pages,
//     so we draw it with the browser's font shaping and send it as an image — works on any ESC/POS printer).
import { formatMoney, dariDate, receiptQr, packRaster, escposRasterCommand, toDariDigits, AFN_DENOMS, formatNumber, formatQty, lineTotal } from './logic.js';
import { loadScript, LIBS } from './lazy.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- document builders ----------
export function receiptDoc(sale, s) {
  const d = [
    { t: 'text', text: s.storeName, size: 'xl', bold: true, align: 'center' },
    s.storeAddress && { t: 'text', text: s.storeAddress, align: 'center' },
    s.storePhone && { t: 'text', text: 'تلفن: ' + toDariDigits(s.storePhone), align: 'center' },
    { t: 'hr' },
    { t: 'row', a: 'رسید:', b: sale.receiptId },
    { t: 'row', a: 'تاریخ:', b: dariDate(sale.timestamp) },
    { t: 'row', a: 'صندوقدار:', b: sale.cashierName },
    sale.voided && { t: 'text', text: '*** باطل شده ***', bold: true, size: 'lg', align: 'center' },
    { t: 'hr' }
  ];
  for (const l of sale.items) {
    d.push({ t: 'text', text: l.name });
    d.push({ t: 'row', a: `${formatQty(l.qty, l.unit)} × ${formatMoney(l.price)}${l.unit === 'kg' ? '/کیلو' : ''}`, b: formatMoney(lineTotal(l)), indent: true });
  }
  d.push({ t: 'hr2' },
    { t: 'row', a: 'مجموع:', b: formatMoney(sale.total), bold: true, size: 'lg' },
    { t: 'row', a: 'نقد دریافتی:', b: formatMoney(sale.cashReceived) },
    { t: 'row', a: 'باقی:', b: formatMoney(sale.changeGiven), bold: true },
    { t: 'hr' },
    { t: 'qr', text: receiptQr(sale) },
    { t: 'text', text: s.receiptFooter, align: 'center' });
  return d.filter(Boolean);
}

export function zReportDoc(shift, s) {
  const st = { balanced: 'برابر', short: 'کمبود', over: 'اضافه' }[shift.status === 'closed' ? shift.varianceStatus : ''] || '';
  const d = [
    { t: 'text', text: '*** گزارش Z ***', size: 'xl', bold: true, align: 'center' },
    { t: 'text', text: s.storeName, bold: true, align: 'center' },
    { t: 'text', text: 'تصفیه ختم شفت', align: 'center' },
    { t: 'hr' },
    { t: 'row', a: 'شماره شفت:', b: shift.shiftId },
    { t: 'row', a: 'صندوقدار:', b: shift.cashierName },
    { t: 'row', a: 'باز شد:', b: dariDate(shift.openedAt) },
    { t: 'row', a: 'بسته شد:', b: dariDate(shift.closedAt) },
    { t: 'hr2' },
    { t: 'text', text: '— خلاصه فروش —', bold: true, align: 'center' },
    { t: 'row', a: 'فروش ناخالص:', b: formatMoney(shift.grossSales) },
    { t: 'row', a: 'باطل شده‌ها:', b: '-' + formatMoney(shift.voidTotal) },
    { t: 'row', a: 'فروش خالص نقدی:', b: formatMoney(shift.netCash), bold: true },
    { t: 'row', a: 'تعداد معاملات:', b: toDariDigits(shift.txCount) },
    { t: 'hr' },
    { t: 'text', text: '— بررسی دخل —', bold: true, align: 'center' },
    { t: 'row', a: 'پول آغاز شفت:', b: formatMoney(shift.startingFloat) },
    { t: 'row', a: '+ فروش خالص:', b: formatMoney(shift.netCash) },
    { t: 'row', a: '+ پول اضافه شده:', b: formatMoney(shift.payins) },
    { t: 'row', a: '- برداشت به گاوصندوق:', b: formatMoney(shift.drops) },
    { t: 'row', a: '- مصارف:', b: formatMoney(shift.payouts) },
    { t: 'row', a: 'متوقع در دخل:', b: formatMoney(shift.expectedCash), bold: true },
    { t: 'hr' },
    { t: 'text', text: '— پول شمارش شده —', bold: true, align: 'center' }
  ];
  for (const den of AFN_DENOMS) {
    const n = +(shift.denoms?.[den] || 0);
    if (n) d.push({ t: 'row', a: `${toDariDigits(den)} × ${toDariDigits(n)}`, b: formatMoney(den * n * 100), indent: true });
  }
  d.push({ t: 'row', a: 'مجموع شمارش:', b: formatMoney(shift.countedCash), bold: true },
    { t: 'hr2' },
    { t: 'row', a: 'تفاوت:', b: `${shift.variance > 0 ? '+' : ''}${formatMoney(shift.variance)} (${st})`, bold: true, size: 'lg' },
    { t: 'hr' },
    { t: 'text', text: 'امضای صندوقدار: ______________' },
    { t: 'text', text: 'امضای مدیر: ______________' },
    { t: 'text', text: '*** پایان سند ***', align: 'center' });
  return d;
}

export function labelDoc(p) {
  return [
    { t: 'text', text: p.name, bold: true, align: 'center' },
    { t: 'qr', text: p.barcode, small: true },
    { t: 'text', text: p.barcode, align: 'center' },
    { t: 'text', text: formatMoney(p.price), size: 'xl', bold: true, align: 'center' }
  ];
}

// ---------- HTML output ----------
function qrSvg(text, cell = 3) {
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

function docHtml(doc, widthMm) {
  const px = widthMm === 58 ? 200 : 280;
  const body = doc.map((b) => {
    if (b.t === 'hr') return '<div class="hr"></div>';
    if (b.t === 'hr2') return '<div class="hr2"></div>';
    if (b.t === 'qr') return `<div class="qr" style="width:${b.small ? 90 : 120}px">${qrSvg(b.text)}</div>`;
    const cls = [b.bold && 'b', b.size, b.indent && 'in'].filter(Boolean).join(' ');
    if (b.t === 'row') return `<div class="row ${cls}"><span>${esc(b.a)}</span><span>${esc(b.b)}</span></div>`;
    return `<div class="${cls}" style="text-align:${b.align === 'center' ? 'center' : 'right'}">${esc(b.text)}</div>`;
  }).join('');
  const font = new URL('vendor/fonts/Vazirmatn.woff2', document.baseURI).href;
  return `<!doctype html><html lang="fa-AF" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:Vazirmatn;src:url("${font}") format("woff2");font-weight:100 900}
@page{size:${widthMm}mm auto;margin:0}
body{font-family:Vazirmatn,Tahoma,sans-serif;width:${px}px;margin:0 auto;padding:8px;font-size:13px;line-height:1.5;color:#000;background:#fff}
.row{display:flex;justify-content:space-between;gap:8px}.b{font-weight:700}.lg{font-size:16px}.xl{font-size:19px}
.in{padding-right:10px}.hr{border-top:1px dashed #000;margin:5px 0}.hr2{border-top:2px solid #000;margin:5px 0}
.qr{margin:6px auto}.qr svg{width:100%;height:auto;display:block}
</style></head><body>${body}</body></html>`;
}

export async function printHtml(doc, widthMm = 80) {
  await loadScript(LIBS.qr);
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0';
    document.body.appendChild(iframe);
    iframe.srcdoc = docHtml(doc, widthMm);
    iframe.onload = async () => {
      try { await iframe.contentDocument.fonts.ready; } catch { /* ignore */ }
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => { iframe.remove(); resolve(); }, 1000);
    };
  });
}

// ---------- Canvas / ESC/POS output ----------
export function renderCanvas(doc, widthMm = 80) {
  const W = widthMm === 58 ? 384 : 576; // printer dots (203 dpi)
  const pad = 8;
  const sizes = { undefined: 24, lg: 30, xl: 36 };
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  // first pass to compute height
  let h = pad;
  const qrCache = new Map();
  for (const b of doc) {
    if (b.t === 'hr' || b.t === 'hr2') h += 16;
    else if (b.t === 'qr') {
      const q = window.qrcode(0, 'M'); q.addData(b.text); q.make();
      qrCache.set(b, q);
      const cell = b.small ? 4 : 5;
      h += q.getModuleCount() * cell + 16;
    } else h += Math.round(sizes[b.size] * 1.45);
  }
  c.width = W; c.height = h + pad + 40;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000'; ctx.direction = 'rtl'; ctx.textBaseline = 'top';
  let y = pad;
  for (const b of doc) {
    if (b.t === 'hr' || b.t === 'hr2') {
      if (b.t === 'hr') { for (let x = pad; x < W - pad; x += 10) ctx.fillRect(x, y + 7, 6, 2); }
      else ctx.fillRect(pad, y + 6, W - pad * 2, 4);
      y += 16; continue;
    }
    if (b.t === 'qr') {
      const q = qrCache.get(b), cell = b.small ? 4 : 5, n = q.getModuleCount();
      const x0 = Math.round((W - n * cell) / 2);
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) ctx.fillRect(x0 + k * cell, y + 8 + r * cell, cell, cell);
      y += n * cell + 16; continue;
    }
    const fs = sizes[b.size];
    ctx.font = `${b.bold ? 700 : 400} ${fs}px Vazirmatn, Tahoma, sans-serif`;
    if (b.t === 'row') {
      ctx.textAlign = 'right'; ctx.fillText(b.a, W - pad - (b.indent ? 16 : 0), y);
      ctx.textAlign = 'left'; ctx.fillText(b.b, pad, y);
    } else {
      ctx.textAlign = b.align === 'center' ? 'center' : 'right';
      ctx.fillText(b.text, b.align === 'center' ? W / 2 : W - pad, y, W - pad * 2);
    }
    y += Math.round(fs * 1.45);
  }
  return c;
}

export function escposFromDoc(doc, widthMm) {
  const c = renderCanvas(doc, widthMm);
  const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  return escposRasterCommand(packRaster(img), c.height);
}

// Common BLE service UUIDs used by cheap 58/80mm thermal printers.
const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb'
];
let bt = null; // { device, char }

export function bluetoothSupported() { return !!navigator.bluetooth; }
export function bluetoothName() { return bt?.device?.name || null; }

export async function connectBluetooth() {
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  const server = await device.gatt.connect();
  for (const svc of await server.getPrimaryServices()) {
    for (const ch of await svc.getCharacteristics()) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) { bt = { device, char: ch }; return device.name; }
    }
  }
  throw new Error('چاپگر قابل نوشتن پیدا نشد');
}

export async function printBluetooth(doc, widthMm) {
  if (!bt) await connectBluetooth();
  if (!bt.device.gatt.connected) await bt.device.gatt.connect();
  try { await document.fonts.load('24px Vazirmatn'); } catch { /* ignore */ }
  await loadScript(LIBS.qr);
  const data = escposFromDoc(doc, widthMm);
  const chunk = 180;
  for (let i = 0; i < data.length; i += chunk) {
    const part = data.slice(i, i + chunk);
    if (bt.char.properties.writeWithoutResponse) {
      await bt.char.writeValueWithoutResponse(part);
      await new Promise((r) => setTimeout(r, 8));
    } else await bt.char.writeValue(part);
  }
}

export { docHtml, formatNumber };
