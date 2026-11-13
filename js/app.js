// Dari POS — app controller. Views: lock, setup, register, receive, products, shift, reports, settings.
import {
  formatMoney, formatNumber, parseMoney, parseIntSafe, toDariDigits, cartTotals, changeDue, marginPct, QUICK_CASH,
  AFN_DENOMS, countDenoms, shiftExpected, varianceStatus, makeReceiptId, parseReceiptQr, eanValid, normalizeBarcode, looksLikeBarcode,
  randomId, internalBarcode, toCsv, parseCsv, dariDate, timeAgo, backupDue, stampPrice, cartMixError, isPracticeSale, realSales, installMode, parseQty, formatQty, lineTotal, addQty, normalizeUnit, weightForAmount, round3
} from './logic.js';
import {
  db, getSettings, setSetting, nextSeq, createUser, setUserPin, findUserByPin, pinInUse, openShift, pendingCount,
  exportBackup, importBackup, requestPersistentStorage
} from './db.js';
import { syncNow, startAutoSync, onSyncChange, pullUsers, pullProducts, takeSheetVersion, keepLocalVersion } from './sync.js';
import { receiptDoc, zReportDoc, labelDoc, printHtml, printBluetooth, connectBluetooth, bluetoothSupported, bluetoothName } from './print.js';
import { initWedge, setScanHandler, startCamera, stopCamera, cameraActive, beep, warmUpScanner, decoderName, upcVariants } from './scanner.js';
import { $, $$, esc, toast, modal, confirmBox, formBox, keypadHtml, bindPinPad, askPin, download, pickFile } from './ui.js';

// On screen the word «افغانی» is drawn small after the number; plain text (toasts, confirms, receipts) uses formatMoney.
const m = (p) => `${formatNumber(p)} <small class="cur">افغانی</small>`;
const now = () => new Date().toISOString();
const state = { user: null, s: null, view: 'register', cart: [], tendered: '', batch: null, item: null };

// [id, icon + label, role, short label for the phone tab bar]
const VIEWS = [
  ['register', '🛒 فروش', 'cashier', 'فروش'],
  ['shift', '💵 شفت', 'cashier', 'شفت'],
  ['receive', '📦 دریافت جنس', 'admin', 'دریافت'],
  ['products', '🏷️ اجناس', 'admin', 'اجناس'],
  ['reports', '📊 گزارش‌ها', 'admin', 'گزارش'],
  ['settings', '⚙️ تنظیمات', 'admin', 'تنظیمات']
];
const isAdmin = () => state.user?.role === 'admin';

async function requireAdmin(reason) {
  if (isAdmin()) return state.user;
  return askPin(reason || 'تأیید مدیر لازم است', { role: 'admin' });
}

// ====================================================================== boot
// ---------- free install to the home screen ----------
let installPrompt = null, installedNow = false;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; refreshInstallBoxes(); });
window.addEventListener('appinstalled', () => { installPrompt = null; installedNow = true; refreshInstallBoxes(); toast('اپ روی صفحه اصلی نصب شد ✔', 'ok'); });
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const currentInstallMode = () => installMode({ ua: navigator.userAgent, standalone: isStandalone(), canPrompt: !!installPrompt, touch: navigator.maxTouchPoints || 0 });

// Card that tells the shop how to put the app on the home screen (hidden once installed).
function installCardHtml() {
  const mode = currentInstallMode();
  if (mode === 'installed') return '';
  if (installedNow) return `<div class="install-card"><b>✔ نصب شد</b><p class="small">از این به بعد اپ را از آیکن «صندوق دری» روی صفحه اصلی باز کنید.</p></div>`;
  if (mode === 'prompt') {
    return `<div class="install-card"><b>📲 نصب رایگان روی صفحه اصلی</b>
      <p class="small">یک بار نصب کنید؛ بعد مثل اپ باز می‌شود و بدون انترنت کار می‌کند.</p>
      <button class="btn primary block" type="button" data-install>نصب اپ (رایگان)</button></div>`;
  }
  if (mode === 'ios') {
    return `<div class="install-card"><b>📲 نصب رایگان روی آیفون / آیپد</b>
      <ol class="small"><li>در <b>Safari</b> دکمه اشتراک <span class="ios-share" aria-hidden="true">⬆︎</span> را بزنید (پایین یا بالای صفحه).</li>
      <li>پایین بروید و <b>Add to Home Screen</b> (افزودن به صفحه اصلی) را بزنید.</li>
      <li><b>Add</b> را بزنید. از این به بعد اپ را از آیکن «صندوق دری» باز کنید.</li></ol>
      <p class="small warn-text">⚠️ تا نصب نکنید، آیفون ممکن است اطلاعات فروش را بعد از ۷ روز استفاده نکردن پاک کند.</p></div>`;
  }
  return `<div class="install-card"><b>📲 نصب رایگان روی صفحه اصلی</b>
    <p class="small">منوی مرورگر <b>⋮</b> را باز کنید و <b>Install app</b> یا <b>Add to Home screen</b> (افزودن به صفحه اصلی) را بزنید.</p></div>`;
}
function fillInstallBox(el) {
  if (!el) return;
  el.innerHTML = installCardHtml();
  el.querySelector('[data-install]')?.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { if ((await installPrompt.userChoice).outcome === 'accepted') installedNow = true; } catch { /* ignore */ }
    installPrompt = null;
    refreshInstallBoxes();
  });
}
function refreshInstallBoxes() { document.querySelectorAll('.install-box').forEach(fillInstallBox); }

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  requestPersistentStorage();
  state.s = await getSettings();
  initWedge();
  setScanHandler((code) => onScan(code));
  onSyncChange(() => refreshBadge());
  window.addEventListener('online', refreshBadge);
  window.addEventListener('offline', refreshBadge);
  setInterval(refreshBadge, 15000);
  $('#lockBtn').onclick = lock;
  $('#syncBadge').onclick = async () => {
    if (!state.s.webhookUrl) return toast('آدرس گوگل شیت در تنظیمات وارد نشده است');
    const r = await syncNow();
    if (r.ok) toast(`همگام شد (${toDariDigits(r.sent)} ریکارد)`, 'ok');
    else if (r.reason === 'offline') toast('انترنت وصل نیست — اطلاعات در دستگاه محفوظ است');
    else if (r.error) toast('خطای همگام‌سازی: ' + r.error, 'err');
  };
  startAutoSync();
  idleLock();
  if (!state.s.setupDone) renderSetup(); else renderLock();
}

// Downloads a full backup and remembers when, so the app can remind the manager.
async function doBackup() {
  download(`dari-pos-backup-${state.s.deviceId}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportBackup()), 'application/json');
  await setSetting('lastBackupAt', now());
  state.s = await getSettings();
  toast('پشتیبان دانلود شد — فایل را در جای امن نگه دارید', 'ok');
}

// Manager-only warnings on the sale screen: no recent backup, or records stuck waiting for Google Sheets.
async function statusStrip() {
  if (!isAdmin()) return '';
  const s = await getSettings();
  const out = [];
  const since = await (s.lastBackupAt ? db.sales.where('timestamp').above(s.lastBackupAt) : db.sales.toCollection()).filter((x) => !x.practice).count();
  if (backupDue({ lastBackupAt: s.lastBackupAt, salesSince: since })) {
    out.push(`<div class="status-warn"><span>💾 آخرین پشتیبان: <b>${esc(timeAgo(s.lastBackupAt))}</b> — ${toDariDigits(since)} فروش پشتیبان ندارد.</span><button class="btn small" type="button" data-backup>گرفتن پشتیبان</button></div>`);
  }
  const pending = await pendingCount();
  const stale = !s.lastSyncAt || Date.now() - Date.parse(s.lastSyncAt) > 3600 * 1000;
  if (s.webhookUrl && pending && (stale || s.lastSyncError)) {
    out.push(`<div class="status-warn"><span>☁️ ${toDariDigits(pending)} ریکارد هنوز به گوگل شیت نرفته · آخرین همگام‌سازی موفق: <b>${esc(timeAgo(s.lastSyncAt))}</b></span><button class="btn small" type="button" data-syncnow>همگام کن</button></div>`);
  }
  return out.join('');
}
function bindStatusStrip(after) {
  $('[data-backup]')?.addEventListener('click', async () => { await doBackup(); after(); });
  $('[data-syncnow]')?.addEventListener('click', () => $('#syncBadge').click());
}

// Installed version = the service-worker cache name (sw.js VERSION), so shops can tell us what they run.
async function appVersion() {
  try { const k = (await caches.keys()).find((x) => x.startsWith('dari-pos-v')); return k ? k.replace('dari-pos-', '') : ''; }
  catch { return ''; }
}

function idleLock() {
  let t;
  const reset = () => { clearTimeout(t); t = setTimeout(() => { if (state.user) lock(); }, 15 * 60 * 1000); };
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, reset, true));
  reset();
}

async function refreshBadge() {
  const b = $('#syncBadge');
  if (!b) return;
  const n = await pendingCount();
  const s = await getSettings();
  state.s = s;
  // Label + detail in separate spans so phones can show just the short label.
  const set = (cls, dot, label, detail, title = '') => {
    b.className = 'badge ' + cls; b.title = `${title || `${label} ${detail}`} · آخرین همگام‌سازی: ${timeAgo(s.lastSyncAt)}`;
    b.innerHTML = `${dot} <span class="bl">${esc(label)}</span>${detail ? ` <span class="bd">${esc(detail)}</span>` : ''}`;
  };
  const cnt = toDariDigits(n);
  if (!s.webhookUrl) set('offline', '⚪', 'فقط دستگاه', `(${cnt} ریکارد محلی)`, 'گوگل شیت در تنظیمات وصل نشده');
  else if (!navigator.onLine) set('offline', '🟠', 'آفلاین', `(${cnt} در انتظار)`);
  else if (s.lastSyncError && n) set('error', '🔴', 'خطا', `(${cnt} در انتظار)`, s.lastSyncError);
  else if (n) set('offline', '🟡', 'آنلاین', `(${cnt} در انتظار)`);
  else set('online', '🟢', 'آنلاین', '(همگام)');
}

// ====================================================================== setup & lock
function renderSetup() {
  $('#topbar').classList.add('hidden');
  $('#main').innerHTML = `<div class="center-screen"><form class="card setup stack" id="setupForm">
    <div class="install-box"></div>
    <h2>راه‌اندازی صندوق</h2>
    <p class="muted">این تنظیمات فقط یک بار انجام می‌شود. همه اطلاعات در همین دستگاه ذخیره می‌شود و بدون انترنت کار می‌کند.</p>
    <label class="field">نام فروشگاه<input name="storeName" required value="فروشگاه من"></label>
    <label class="field">کد این دستگاه (برای شماره رسید)<input name="deviceId" required value="T1" maxlength="6" class="ltr"></label>
    <label class="field">نام مدیر<input name="adminName" required></label>
    <div class="grid2">
      <label class="field">رمز مدیر (۴ تا ۶ رقم)<input name="pin" required inputmode="numeric" type="password" autocomplete="new-password"></label>
      <label class="field">تکرار رمز<input name="pin2" required inputmode="numeric" type="password" autocomplete="new-password"></label>
    </div>
    <label class="check"><input type="checkbox" name="sample"> 🧪 افزودن اجناس نمونه برای تمرین (قبل از فروش واقعی حذف شود)</label>
    <button class="btn primary big" type="submit">شروع</button>
  </form></div>`;
  refreshInstallBoxes();
  $('#setupForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!/^\d{4,6}$/.test(toLatin(f.pin))) return toast('رمز باید ۴ تا ۶ رقم باشد', 'err');
    if (toLatin(f.pin) !== toLatin(f.pin2)) return toast('رمزها یکسان نیستند', 'err');
    await createUser({ name: f.adminName.trim(), role: 'admin', pin: toLatin(f.pin) });
    await setSetting('storeName', f.storeName.trim());
    await setSetting('deviceId', f.deviceId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'T1');
    if (f.sample) await addSampleProducts();
    await setSetting('setupDone', true);
    state.s = await getSettings();
    toast('صندوق آماده است. با رمز مدیر وارد شوید.', 'ok');
    renderLock();
  };
}
const toLatin = (s) => String(s ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();

async function addSampleProducts() {
  const items = [['نان', 1000, 700, 1], ['شیر ۱ لیتر', 6000, 4800, 1], ['تخم مرغ (دانه)', 1000, 800, 1], ['برنج ۱ کیلو', 9000, 7500, 0],
    ['روغن ۵ لیتر', 65000, 56000, 0], ['چای سبز ۲۵۰ گرم', 12000, 9000, 0], ['بوره ۱ کیلو', 7000, 6000, 0], ['آب معدنی', 2000, 1200, 1],
    ['بادنجان رومی (کیلو)', 6000, 4500, 1, 'kg'], ['کچالو (کیلو)', 4000, 3000, 1, 'kg'], ['پیاز (کیلو)', 3500, 2500, 1, 'kg']];
  for (const [name, price, cost, quick, unit = 'pc'] of items) {
    const seq = await nextSeq('internalSeq');
    // demo:1 marks practice items; synced:1 keeps them out of the real Google Sheet.
    await db.products.put({ barcode: internalBarcode(seq), name, price, cost, stock: 50, quick, unit, demo: 1, updatedAt: now(), synced: 1 });
  }
}
const demoCount = () => db.products.filter((p) => !!p.demo).count();
async function deleteDemoProducts() {
  const n = await db.products.filter((p) => !!p.demo).delete();
  const ns = await db.sales.filter((x) => !!x.practice).delete();
  await db.receivings.filter((x) => !!x.practice).delete();
  toast(`${toDariDigits(n)} جنس نمونه و ${toDariDigits(ns)} فروش تمرینی حذف شد`, 'ok');
  return n;
}
// Warning strip shown while practice items are still in the system.
async function demoBanner() {
  const n = await demoCount();
  if (!n) return '';
  return `<div class="demo-banner"><span>🧪 ${toDariDigits(n)} جنس نمونه (تمرینی) هنوز در سیستم است. قبل از فروش واقعی حذف کنید.</span>
    ${isAdmin() ? '<button class="btn small" type="button" data-deldemo>حذف اجناس نمونه</button>' : ''}</div>`;
}
function bindDemoBanner(after) {
  $('[data-deldemo]')?.addEventListener('click', async () => {
    if (!(await confirmBox('همه اجناس نمونه و فروش‌های تمرینی حذف شوند؟', { okText: 'حذف', danger: true }))) return;
    await deleteDemoProducts(); after();
  });
}

let failCount = 0, lockedUntil = 0;
function renderLock() {
  stopCamera();
  state.user = null;
  $('#topbar').classList.add('hidden');
  $('#main').innerHTML = `<div class="center-screen"><div class="card lock">
    <h2>${esc(state.s.storeName)}</h2><p class="muted">رمز خود را وارد کنید</p>
    <div class="pin-dots"></div>${keypadHtml()}
    <button class="btn primary block" data-k="E" style="margin-top:8px">ورود</button>
    <div class="muted small app-ver" id="appVer">نسخه رایگان</div>
    <div class="install-box"></div>
  </div></div>`;
  appVersion().then((v) => { const el = $('#appVer'); if (el && v) el.textContent = `نسخه رایگان ${v}`; });
  refreshInstallBoxes();
  bindPinPad($('.lock'), async (pin) => {
    if (Date.now() < lockedUntil) return toast('چند بار رمز اشتباه شد. ۳۰ ثانیه صبر کنید.', 'err');
    const u = await findUserByPin(pin);
    if (!u) {
      beep('err');
      if (++failCount >= 5) { lockedUntil = Date.now() + 30000; failCount = 0; }
      return toast('رمز نادرست است', 'err');
    }
    failCount = 0;
    state.user = u;
    renderShell();
    go(isAdmin() ? state.view : 'register');
  }, { autoLen: 0 });
}

function lock() { state.cart = []; state.tendered = ''; renderLock(); }

function renderShell() {
  $('#topbar').classList.remove('hidden');
  $('#storeTitle').textContent = state.s.storeName;
  $('#userChip').textContent = `${state.user.name} · ${isAdmin() ? 'مدیر' : 'صندوقدار'}`;
  $('#nav').innerHTML = VIEWS.filter(([, , r]) => r === 'cashier' || isAdmin())
    .map(([id, label, , short]) => {
      const [icon, ...rest] = label.split(' ');
      return `<button data-view="${id}"><span class="ni">${icon}</span><span class="nl">${rest.join(' ')}</span><span class="ns">${short}</span></button>`;
    }).join('');
  $('#nav').onclick = (e) => { const v = e.target.closest('[data-view]')?.dataset.view; if (v) go(v); };
  refreshBadge();
}

async function go(view) {
  const def = VIEWS.find((v) => v[0] === view);
  if (!def || (def[2] === 'admin' && !isAdmin())) view = 'register';
  await stopCamera();
  state.view = view;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ({ register: renderRegister, shift: renderShift, receive: renderReceive, products: renderProducts, reports: renderReports, settings: renderSettings })[view]();
}

function onScan(code) {
  if (!state.user || document.querySelector('.modal-back')) return;
  if (state.view === 'register') return registerCode(code);
  if (state.view === 'receive') return receiveCode(code);
  if (state.view === 'products') { const i = $('#prodSearch'); if (i) { i.value = code; i.dispatchEvent(new Event('input')); } return; }
  if (state.view === 'reports') return reportsCode(code);
}

function bindScanInput(input, handler, { onType } = {}) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const v = normalizeBarcode(input.value); input.value = ''; onType?.(''); if (v) handler(v); }
  });
  if (onType) input.addEventListener('input', () => onType(input.value.trim()));
}

async function toggleCamera(boxId, handler, btn) {
  const box = $('#' + boxId);
  if (cameraActive()) { await stopCamera(); box.classList.add('hidden'); btn.textContent = '📷 کمره'; return; }
  box.classList.remove('hidden');
  btn.textContent = '✖ بستن کمره';
  // Known products / receipt QRs are accepted at once; unknown codes must be read twice (stops misread "not found").
  const isKnown = async (c) => !!parseReceiptQr(c) || !!(await findProduct(c));
  try { await startCamera(boxId, handler, { isKnown }); }
  catch (err) {
    box.classList.add('hidden'); btn.textContent = '📷 کمره';
    toast('کمره باز نشد: اجازه کمره را بدهید (فقط روی HTTPS یا localhost کار می‌کند)', 'err');
    console.warn(err);
  }
}

// ====================================================================== register
async function renderRegister() {
  const shift = await openShift();
  if (!shift) {
    $('#main').innerHTML = `<div class="center-screen"><div class="card setup stack">
      <h2>شفت باز نیست</h2><p class="muted">برای شروع فروش، اول شفت را با پول موجود در دخل باز کنید.</p>
      <button class="btn primary big" id="goShift">باز کردن شفت</button></div></div>`;
    $('#goShift').onclick = () => go('shift');
    return;
  }
  const banner = (await demoBanner()) + (await statusStrip());
  $('#main').innerHTML = `${banner}<section class="register">
    <div class="card">
      <div class="scanbar">
        <input id="scanInput" data-scan placeholder="بارکد را اسکن کنید یا نام جنس را بنویسید" autocomplete="off" autofocus>
        <button class="btn" id="camBtn" type="button">📷 کمره</button>
      </div>
      <div id="camBox" class="cam hidden"></div>
      <div id="results" class="results"></div>
      <div id="quickGrid" class="quick-grid"></div>
      <div id="cart" class="cart"></div>
    </div>
    <button type="button" id="payJump" class="pay-jump hidden"><span id="payJumpCount"></span><span class="pj-total num" id="payJumpTotal"></span><span class="pj-go">پرداخت ⬅</span></button>
    <div class="pay stack">
      <div class="total-due"><div class="k">مجموع قابل پرداخت</div><div class="v num" id="totalDue"></div><div class="small" id="itemCount"></div></div>
      <div class="card stack">
        <label class="field tendered">نقد دریافتی<input id="tendered" inputmode="decimal" autocomplete="off" placeholder="۰"></label>
        <div class="quick-cash">
          <button class="btn" data-cash="exact">دقیق</button>
          ${QUICK_CASH.map((d) => `<button class="btn" data-cash="${d}">+${toDariDigits(d)}</button>`).join('')}
        </div>
        <div id="changeBox" class="change-box"><div>باقی پول مشتری</div><div class="v num" id="changeDue"></div></div>
        <button class="btn primary big block" id="completeBtn">✔ تکمیل فروش</button>
        <div class="row"><button class="btn grow" id="clearTender">پاک کردن پول</button><button class="btn grow" id="clearCart">لغو سبد</button></div>
      </div>
    </div>
  </section>`;
  bindDemoBanner(() => renderRegister());
  bindStatusStrip(() => renderRegister());
  const input = $('#scanInput');
  bindScanInput(input, registerCode, { onType: searchProducts });
  $('#camBtn').onclick = (e) => toggleCamera('camBox', registerCode, e.currentTarget);
  warmUpScanner();
  $('#tendered').value = state.tendered;
  $('#tendered').oninput = (e) => { state.tendered = e.target.value; drawPay(); };
  $('#tendered').onkeydown = (e) => { if (e.key === 'Enter') completeSale(); };
  $('.quick-cash').onclick = (e) => {
    const c = e.target.closest('[data-cash]')?.dataset.cash;
    if (!c) return;
    const { total } = cartTotals(state.cart);
    const cur = parseMoney(state.tendered);
    const next = c === 'exact' ? total : cur + parseInt(c, 10) * 100;
    state.tendered = formatNumber(next);
    $('#tendered').value = state.tendered;
    drawPay();
  };
  $('#clearTender').onclick = () => { state.tendered = ''; $('#tendered').value = ''; drawPay(); };
  $('#clearCart').onclick = async () => { if (state.cart.length && await confirmBox('سبد خرید خالی شود؟')) { state.cart = []; state.tendered = ''; renderRegister(); } };
  $('#completeBtn').onclick = completeSale;
  $('#payJump').onclick = () => { $('.pay').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('#tendered')?.focus({ preventScroll: true }), 350); };
  // Hide the floating pay bar while the pay panel itself is on screen.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([en]) => { state.payVisible = en.isIntersecting; drawPay(); }, { threshold: 0.15 });
    io.observe($('.pay'));
  }
  $('#cart').onclick = cartClick;
  $('#results').onclick = (e) => {
    const n = e.target.closest('[data-addname]')?.dataset.addname;
    if (n) { input.value = ''; $('#results').innerHTML = ''; return addNewProduct({ name: n }); }
    const b = e.target.closest('[data-bc]')?.dataset.bc; if (b) { registerCode(b); input.value = ''; $('#results').innerHTML = ''; input.focus(); } };
  $('#quickGrid').onclick = (e) => { const b = e.target.closest('[data-bc]')?.dataset.bc; if (b) registerCode(b); };
  const quick = await db.products.where('quick').equals(1).toArray();
  $('#quickGrid').innerHTML = quick.map((p) => `<button class="btn" data-bc="${esc(p.barcode)}"><span>${p.demo ? '🧪 ' : ''}${p.unit === 'kg' ? '⚖ ' : ''}${esc(p.name)}</span><span class="small muted">${priceLabel(p)}</span></button>`).join('');
  drawCart();
}

async function searchProducts(q) {
  const box = $('#results');
  if (!box) return;
  if (!q || /^\d+$/.test(normalizeBarcode(q))) { box.innerHTML = ''; return; }
  const list = await db.products.filter((p) => p.name.includes(q)).limit(8).toArray();
  box.innerHTML = list.map((p) => `<button class="btn" data-bc="${esc(p.barcode)}"><span>${p.unit === 'kg' ? '⚖ ' : ''}${esc(p.name)}</span><span>${priceLabel(p)}</span></button>`).join('')
    || `<button class="btn nf-add" data-addname="${esc(q)}">➕ «${esc(q)}» پیدا نشد — اضافه کردن جنس</button>`;
}

async function registerCode(code) {
  const r = parseReceiptQr(code);
  if (r) return showReceipt(r.receiptId);
  if (!looksLikeBarcode(code)) return registerByName(code);
  const p = await findProduct(code);
  if (!p) {
    beep('err');
    if (!eanValid(code)) return toast('بارکد درست خوانده نشد، دوباره اسکن کنید', 'err');
    return notFound({ barcode: code });
  }
  const mix = cartMixError(state.cart, p);
  if (mix) { beep('err'); return toast(mix, 'err'); }
  beep('ok');
  if (p.unit === 'kg') {
    const w = await askWeight(p);
    if (!w) return;
    state.cart.unshift({ barcode: p.barcode, name: p.name, price: p.price, cost: p.cost || 0, qty: w, unit: 'kg', ...(p.demo ? { demo: 1 } : {}) });
    if ((p.stock || 0) <= 0) toast(`موجودی «${p.name}» در سیستم صفر است`);
    drawCart();
    return;
  }
  const line = state.cart.find((l) => l.barcode === p.barcode && !l.override);
  if (line) line.qty++;
  else state.cart.unshift({ barcode: p.barcode, name: p.name, price: p.price, cost: p.cost || 0, qty: 1, ...(p.demo ? { demo: 1 } : {}) });
  if ((p.stock || 0) <= 0) toast(`موجودی «${p.name}» در سیستم صفر است`);
  drawCart();
}

// Finds a product by scanned code, also trying the other UPC-A / EAN-13 form (12 vs 13 digits).
async function findProduct(code) {
  for (const v of upcVariants(code)) { const p = await db.products.get(v); if (p) return p; }
  return null;
}

// Enter pressed on a typed name: one match → add it; several → show the list; none → offer to add.
async function registerByName(q) {
  const name = q.trim();
  const list = await db.products.filter((p) => p.name.includes(name)).limit(8).toArray();
  if (list.length === 1) return registerCode(list[0].barcode);
  if (list.length > 1) { const i = $('#scanInput'); if (i) i.value = name; searchProducts(name); return toast('یکی از اجناس را انتخاب کنید'); }
  beep('err');
  notFound({ name });
}

// Big, clear "not found" box with an add button (cashiers need the manager PIN to add).
function notFound({ barcode = '', name = '' }) {
  modal(`<div class="nf"><div class="nf-icon">🔍</div><h2>جنس پیدا نشد</h2>
    <p class="muted">این جنس هنوز در سیستم ثبت نیست:</p>
    <div class="nf-what">${barcode ? `<span class="ltr">${esc(barcode)}</span>` : `«${esc(name)}»`}</div>
    ${barcode ? '<p class="small muted">این عدد را با عدد زیر خط‌های بارکد روی جنس مقایسه کنید. اگر فرق دارد، «بستن» را بزنید و دوباره آرام اسکن کنید.</p>' : ''}
    <div class="actions"><button class="btn primary big grow" data-add>➕ اضافه کردن جنس</button><button class="btn big" data-no>بستن</button></div></div>`, {
    dismiss: false,
    onMount: (box, close) => {
      box.querySelector('[data-no]').onclick = () => { close(); $('#scanInput')?.focus(); };
      box.querySelector('[data-add]').onclick = () => { close(); addNewProduct({ barcode, name }); };
    }
  });
}

async function addNewProduct({ barcode = '', name = '' }) {
  if (!(await requireAdmin('برای اضافه کردن جنس جدید، رمز مدیر را وارد کنید'))) return;
  editProduct({ barcode, name }, (bc) => { if (state.view === 'register' && bc) registerCode(bc); }, { isNew: true });
}

function drawCart() {
  const c = $('#cart');
  if (!c) return;
  c.innerHTML = state.cart.length ? state.cart.map((l, i) => `<div class="cart-line">
      <div><div class="name">${esc(l.name)}</div><button class="price-btn" data-price="${i}">${priceLabel(l)}${l.override ? ' ✎' : ''}</button></div>
      ${l.unit === 'kg'
        ? `<div class="qty"><button class="weight-btn num" data-w="${i}" aria-label="تغییر وزن">⚖ ${formatQty(l.qty, 'kg')}</button></div>`
        : `<div class="qty"><button data-dec="${i}" aria-label="کم">−</button><span class="num">${toDariDigits(l.qty)}</span><button data-inc="${i}" aria-label="زیاد">+</button></div>`}
      <div class="line-total num">${m(lineTotal(l))}</div>
      <button class="btn small" data-del="${i}" aria-label="حذف">🗑</button></div>`).join('')
    : '<div class="empty">سبد خالی است — جنس را اسکن کنید</div>';
  drawPay();
}

function drawPay() {
  const { items, total } = cartTotals(state.cart);
  const tendered = parseMoney(state.tendered);
  const ch = changeDue(total, tendered);
  $('#totalDue').innerHTML = m(total);
  $('#itemCount').textContent = `${toDariDigits(items)} قلم`;
  const box = $('#changeBox');
  box.classList.toggle('short', !ch.ok && tendered > 0);
  box.firstElementChild.textContent = !ch.ok && tendered > 0 ? 'کمبود پول' : 'باقی پول مشتری';
  $('#changeDue').innerHTML = m(tendered === 0 ? 0 : ch.ok ? ch.change : ch.short);
  $('#completeBtn').disabled = !state.cart.length || !ch.ok || tendered === 0;
  const pj = $('#payJump');
  if (pj) {
    pj.classList.toggle('hidden', !state.cart.length || !!state.payVisible);
    $('#payJumpCount').textContent = `${toDariDigits(items)} قلم`;
    $('#payJumpTotal').innerHTML = m(total);
  }
}

async function cartClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (d.inc) state.cart[+d.inc].qty++;
  else if (d.dec) { const l = state.cart[+d.dec]; if (l.qty > 1) l.qty--; else state.cart.splice(+d.dec, 1); }
  else if (d.del) state.cart.splice(+d.del, 1);
  else if (d.w) {
    const l = state.cart[+d.w];
    const w = await askWeight(l, l.qty);
    if (!w) return;
    l.qty = w;
  }
  else if (d.price) {
    const l = state.cart[+d.price];
    const approver = await requireAdmin('تغییر قیمت به تأیید مدیر نیاز دارد');
    if (!approver) return;
    const v = await formBox('تغییر قیمت', [{ name: 'price', label: `قیمت جدید برای «${l.name}»${l.unit === 'kg' ? ' (فی کیلو)' : ''}`, value: formatNumber(l.price), inputmode: 'decimal' }]);
    if (!v) return;
    l.price = parseMoney(v.price);
    l.override = true;
    l.approvedBy = approver.name;
  }
  drawCart();
}

async function completeSale() {
  const { total } = cartTotals(state.cart);
  const tendered = parseMoney(state.tendered);
  if (!state.cart.length || tendered < total || !tendered) return;
  const shift = await openShift();
  if (!shift) return toast('شفت باز نیست', 'err');
  const seq = await nextSeq('receiptSeq');
  const ts = now();
  // Practice (🧪) sales are kept on the device only: never sent to Google Sheets, never in reports or shift totals.
  const practice = isPracticeSale(state.cart);
  const sale = {
    receiptId: makeReceiptId(state.s.deviceId, seq), shiftId: shift.shiftId, cashierId: state.user.id, cashierName: state.user.name,
    timestamp: ts, items: state.cart.map((l) => ({ ...l })), total, cashReceived: tendered, changeGiven: tendered - total,
    voided: 0, synced: practice ? 1 : 0, updatedAt: ts, ...(practice ? { practice: 1 } : {})
  };
  await db.transaction('rw', db.sales, db.products, async () => {
    await db.sales.add(sale);
    for (const l of sale.items) {
      const p = await db.products.get(l.barcode);
      if (p) await db.products.update(l.barcode, { stock: addQty(p.stock, -l.qty), updatedAt: ts, synced: p.demo ? 1 : 0 });
    }
  });
  if (practice) toast('🧪 فروش تمرینی — به گزارش و گوگل شیت نمی‌رود');
  beep('done');
  state.cart = []; state.tendered = '';
  renderRegister();
  refreshBadge();
  if (navigator.onLine) syncNow({ pull: false }).then(refreshBadge);
  if (state.s.autoPrint) printHtml(receiptDoc(sale, state.s), state.s.paperWidth);
  modal(`<h2>فروش ثبت شد ✔</h2>
    <div class="change-box"><div>باقی پول مشتری</div><div class="v num">${m(sale.changeGiven)}</div></div>
    <p class="muted">رسید <span class="ltr">${esc(sale.receiptId)}</span> · مجموع ${m(sale.total)} · دریافتی ${m(sale.cashReceived)}</p>
    <div class="actions">
      <button class="btn primary grow" data-new autofocus>فروش جدید</button>
      <button class="btn" data-print>🖨 چاپ رسید</button>
      ${bluetoothSupported() ? '<button class="btn" data-bt>📶 چاپ بلوتوث</button>' : ''}
    </div>`, {
    onMount: (box, close) => {
      box.querySelector('[data-new]').onclick = () => { close(); $('#scanInput')?.focus(); };
      box.querySelector('[data-print]').onclick = () => printHtml(receiptDoc(sale, state.s), state.s.paperWidth);
      box.querySelector('[data-bt]')?.addEventListener('click', () => btPrint(receiptDoc(sale, state.s)));
    }
  });
}

async function btPrint(doc) {
  try { await printBluetooth(doc, state.s.paperWidth); toast('چاپ شد', 'ok'); }
  catch (err) { toast('چاپ بلوتوث ناموفق: ' + err.message, 'err'); }
}

// ====================================================================== receipts (view / reprint / void)
async function showReceipt(receiptId) {
  const sale = await db.sales.get(receiptId);
  if (!sale) return toast('رسید در این دستگاه پیدا نشد', 'err');
  modal(`<h2>رسید <span class="ltr">${esc(sale.receiptId)}</span></h2>
    <p class="muted">${esc(dariDate(sale.timestamp))} · ${esc(sale.cashierName)} ${sale.voided ? '· <b style="color:var(--danger)">باطل شده</b>' : ''}</p>
    <div class="table-wrap"><table><thead><tr><th>جنس</th><th>تعداد</th><th>قیمت</th><th>مجموع</th></tr></thead><tbody>
    ${sale.items.map((l) => `<tr><td>${esc(l.name)}</td><td>${formatQty(l.qty, l.unit)}</td><td>${priceLabel(l)}</td><td>${m(lineTotal(l))}</td></tr>`).join('')}
    </tbody></table></div>
    <p><b>مجموع: ${m(sale.total)}</b> · دریافتی: ${m(sale.cashReceived)} · باقی: ${m(sale.changeGiven)}</p>
    <div class="actions">
      <button class="btn" data-print>🖨 چاپ دوباره</button>
      ${bluetoothSupported() ? '<button class="btn" data-bt>📶 بلوتوث</button>' : ''}
      ${!sale.voided ? '<button class="btn danger" data-void>باطل کردن رسید</button>' : ''}
      <button class="btn" data-close>بستن</button>
    </div>`, {
    onMount: (box, close) => {
      box.querySelector('[data-close]').onclick = close;
      box.querySelector('[data-print]').onclick = () => printHtml(receiptDoc(sale, state.s), state.s.paperWidth);
      box.querySelector('[data-bt]')?.addEventListener('click', () => btPrint(receiptDoc(sale, state.s)));
      box.querySelector('[data-void]')?.addEventListener('click', async () => {
        const admin = await requireAdmin('باطل کردن رسید به رمز مدیر نیاز دارد');
        if (!admin) return;
        if (!(await confirmBox(`رسید ${sale.receiptId} به مبلغ ${formatMoney(sale.total)} باطل شود؟ اجناس به گدام برمی‌گردد.`, { danger: true, okText: 'باطل شود' }))) return;
        await voidSale(sale, admin);
        close();
        toast('رسید باطل شد', 'ok');
        if (state.view === 'reports') renderReports();
      });
    }
  });
}

async function voidSale(sale, admin) {
  const ts = now();
  await db.transaction('rw', db.sales, db.products, async () => {
    await db.sales.update(sale.receiptId, { voided: 1, voidedBy: admin.name, voidedAt: ts, updatedAt: ts, synced: sale.practice ? 1 : 0 });
    for (const l of sale.items) {
      const p = await db.products.get(l.barcode);
      if (p) await db.products.update(l.barcode, { stock: addQty(p.stock, l.qty), updatedAt: ts, synced: p.demo ? 1 : 0 });
    }
  });
  refreshBadge();
}

// ====================================================================== shift
async function renderShift() {
  const shift = await openShift();
  if (!shift) {
    const recent = await db.shifts.orderBy('openedAt').reverse().limit(1).toArray();
    const banner = await demoBanner();
    $('#main').innerHTML = `<div class="center-screen"><form class="card setup stack" id="openForm">
      ${banner}
      <h2>باز کردن شفت</h2>
      <p class="muted">پول موجود در دخل را در آغاز شفت بشمارید و وارد کنید.</p>
      <label class="field">پول آغاز شفت (افغانی)<input name="float" inputmode="decimal" required autofocus></label>
      <button class="btn primary big" type="submit">باز کردن شفت</button>
      ${recent[0] && isAdmin() ? `<button class="btn" type="button" id="lastZ">نمایش آخرین گزارش Z</button>` : ''}
    </form></div>`;
    $('#openForm').onsubmit = async (e) => {
      e.preventDefault();
      const seq = await nextSeq('shiftSeq');
      const ts = now();
      await db.shifts.add({
        shiftId: `${state.s.deviceId}-SH-${String(seq).padStart(4, '0')}`, cashierId: state.user.id, cashierName: state.user.name,
        openedAt: ts, closedAt: null, startingFloat: parseMoney(new FormData(e.target).get('float')), status: 'open', synced: 0, updatedAt: ts
      });
      toast('شفت باز شد', 'ok');
      refreshBadge();
      go('register');
    };
    $('#lastZ')?.addEventListener('click', () => showShiftResult(recent[0]));
    bindDemoBanner(() => renderShift());
    return;
  }
  const moves = await db.movements.where('shiftId').equals(shift.shiftId).toArray();
  const label = { payout: 'مصرف / پرداخت', drop: 'برداشت به گاوصندوق', payin: 'افزودن پول' };
  $('#main').innerHTML = `<div class="stack">
    <div class="card"><h2>شفت جاری <span class="ltr">${esc(shift.shiftId)}</span></h2>
      <p>باز شده توسط <b>${esc(shift.cashierName)}</b> — ${esc(dariDate(shift.openedAt))}</p>
      ${isAdmin() ? `<p>پول آغاز شفت: <b>${m(shift.startingFloat)}</b></p>` : ''}
      <div class="row">
        <button class="btn" data-move="drop">⬆ برداشت به گاوصندوق</button>
        <button class="btn" data-move="payout">💸 مصرف / پرداخت</button>
        <button class="btn" data-move="payin">⬇ افزودن پول</button>
        <span class="spacer"></span>
        <button class="btn danger big" id="closeShift">بستن شفت (شمارش پول)</button>
      </div></div>
    <div class="card"><h3>حرکت پول در این شفت</h3>
      ${moves.length ? `<table><thead><tr><th>نوع</th><th>مبلغ</th><th>یادداشت</th><th>کاربر</th><th>زمان</th></tr></thead><tbody>
      ${moves.map((x) => `<tr><td>${label[x.type]}</td><td>${m(x.amount)}</td><td>${esc(x.note)}</td><td>${esc(x.userName)}</td><td>${esc(dariDate(x.timestamp))}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">هنوز ثبت نشده</p>'}</div></div>`;
  $$('[data-move]').forEach((b) => b.onclick = () => addMovement(shift, b.dataset.move, label[b.dataset.move]));
  $('#closeShift').onclick = () => preCloseCheck(shift);
}

async function addMovement(shift, type, label) {
  let approver = state.user;
  if (type !== 'drop') { approver = await requireAdmin(`${label} به تأیید مدیر نیاز دارد`); if (!approver) return; }
  const v = await formBox(label, [{ name: 'amount', label: 'مبلغ (افغانی)', inputmode: 'decimal', required: true }, { name: 'note', label: 'یادداشت / دلیل' }]);
  if (!v) return;
  const amount = parseMoney(v.amount);
  if (!amount) return toast('مبلغ درست نیست', 'err');
  const ts = now();
  await db.movements.add({ id: randomId(), shiftId: shift.shiftId, type, amount, note: v.note || '', userName: state.user.name,
    approvedBy: approver.name, timestamp: ts, updatedAt: ts, synced: 0 });
  refreshBadge();
  renderShift();
}

// Safety check before the blind count. Shows counts only (never money totals), so expected cash stays hidden.
async function preCloseCheck(shift) {
  const all = await db.sales.where('shiftId').equals(shift.shiftId).toArray();
  const sales = realSales(all), practiceN = all.length - sales.length;
  const moves = await db.movements.where('shiftId').equals(shift.shiftId).toArray();
  const done = sales.filter((x) => !x.voided).length, voided = sales.length - done;
  const by = (t) => moves.filter((x) => x.type === t).length;
  const pending = await pendingCount();
  const s = await getSettings();
  const warn = [];
  if (state.cart.length) warn.push(`🛒 سبد خرید خالی نیست (${toDariDigits(state.cart.length)} قلم). اول فروش را تکمیل یا لغو کنید.`);
  if (s.webhookUrl && pending) warn.push(`☁️ ${toDariDigits(pending)} ریکارد هنوز به گوگل شیت نرفته. اگر انترنت دارید، اول همگام کنید.`);
  modal(`<h2>بررسی قبل از بستن شفت</h2>
    <table class="check-table"><tbody>
      <tr><td>شفت</td><td><span class="ltr">${esc(shift.shiftId)}</span></td></tr>
      <tr><td>باز شده</td><td>${esc(shift.cashierName)} — ${esc(dariDate(shift.openedAt))}</td></tr>
      <tr><td>تعداد فروش</td><td><b>${toDariDigits(done)}</b>${voided ? ` <span class="muted">(+${toDariDigits(voided)} باطل شده)</span>` : ''}${practiceN ? ` <span class="muted">· 🧪 ${toDariDigits(practiceN)} تمرینی (حساب نمی‌شود)</span>` : ''}</td></tr>
      <tr><td>حرکت پول</td><td>برداشت ${toDariDigits(by('drop'))} · مصرف ${toDariDigits(by('payout'))} · افزودن ${toDariDigits(by('payin'))}</td></tr>
      <tr><td>در انتظار ارسال به شیت</td><td><b>${toDariDigits(pending)}</b> ریکارد</td></tr>
    </tbody></table>
    ${warn.map((w) => `<div class="status-warn"><span>${w}</span></div>`).join('')}
    <p class="muted small">اگر همه درست است، پول دخل را بشمارید. مقدار متوقع بعد از شمارش نشان داده می‌شود.</p>
    <div class="actions">
      <button class="btn danger grow" data-go ${state.cart.length ? 'disabled' : ''}>ادامه: شمارش پول</button>
      ${s.webhookUrl && pending ? '<button class="btn" data-sync>☁️ همگام کن</button>' : ''}
      <button class="btn" data-no>لغو</button></div>`, {
    dismiss: false,
    onMount: (box, close) => {
      box.querySelector('[data-no]').onclick = close;
      box.querySelector('[data-go]').onclick = () => { close(); blindClose(shift); };
      box.querySelector('[data-sync]')?.addEventListener('click', async () => {
        const r = await syncNow({ pull: false });
        refreshBadge();
        toast(r.ok ? 'همگام شد' : r.reason === 'offline' ? 'انترنت وصل نیست — بعداً همگام می‌شود' : 'همگام نشد: ' + (r.error || ''), r.ok ? 'ok' : 'err');
        close(); preCloseCheck(shift);
      });
    }
  });
}

function blindClose(shift) {
  modal(`<h2>شمارش پول ختم شفت</h2>
    <p class="muted">همه پول‌ها و سکه‌های داخل دخل را بشمارید — پول آغاز شفت را هم حساب کنید.</p>
    <div class="denoms">${AFN_DENOMS.map((d) => `<label><span>${toDariDigits(d)} <small class="cur">افغانی</small> ×</span><input data-den="${d}" inputmode="numeric" placeholder="۰"></label>`).join('')}</div>
    <p>مجموع شمارش شده:</p><div class="counted num" id="counted">${m(0)}</div>
    <div class="actions"><button class="btn danger grow" data-submit>قفل و ثبت شمارش</button><button class="btn" data-no>لغو</button></div>`, {
    dismiss: false,
    onMount: (box, close) => {
      const read = () => Object.fromEntries($$('[data-den]', box).map((i) => [i.dataset.den, parseIntSafe(i.value)]));
      box.addEventListener('input', () => { $('#counted', box).innerHTML = m(countDenoms(read())); });
      box.querySelector('[data-no]').onclick = close;
      box.querySelector('[data-submit]').onclick = async () => {
        const denoms = read();
        const counted = countDenoms(denoms);
        if (!(await confirmBox(`مجموع شمارش ${formatMoney(counted)} ثبت شود؟ بعد از ثبت قابل تغییر نیست.`))) return;
        close();
        const result = await finalizeShift(shift, denoms, counted);
        beep('done');
        if (isAdmin()) return showShiftResult(result);
        modal(`<h2>شفت بسته شد</h2><p>شمارش شما (${m(counted)}) ثبت شد. نتیجه را مدیر می‌بیند.</p>
          <div class="actions"><button class="btn primary" data-admin>نمایش نتیجه (رمز مدیر)</button><button class="btn" data-ok>خوب</button></div>`, {
          onMount: (b, c) => {
            b.querySelector('[data-ok]').onclick = () => { c(); go('shift'); };
            b.querySelector('[data-admin]').onclick = async () => { if (await askPin('رمز مدیر', { role: 'admin' })) { c(); showShiftResult(result); } };
          }
        });
        go('shift');
      };
    }
  });
}

async function finalizeShift(shift, denoms, counted) {
  const sales = realSales(await db.sales.where('shiftId').equals(shift.shiftId).toArray());
  const movements = await db.movements.where('shiftId').equals(shift.shiftId).toArray();
  const exp = shiftExpected({ startingFloat: shift.startingFloat, sales, movements });
  const variance = counted - exp.expected;
  const ts = now();
  const rec = {
    ...shift, status: 'closed', closedAt: ts, closedBy: state.user.name, denoms, countedCash: counted, expectedCash: exp.expected, variance,
    varianceStatus: varianceStatus(variance), netCash: exp.netCash, payouts: exp.payouts, drops: exp.drops, payins: exp.payins,
    grossSales: sales.reduce((a, s) => a + s.total, 0), voidTotal: sales.filter((s) => s.voided).reduce((a, s) => a + s.total, 0),
    txCount: sales.filter((s) => !s.voided).length, updatedAt: ts, synced: 0
  };
  await db.shifts.put(rec);
  refreshBadge();
  if (navigator.onLine) syncNow({ pull: false }).then(refreshBadge);
  return rec;
}

function showShiftResult(r) {
  const word = { balanced: 'برابر ✔', short: 'کمبود', over: 'اضافه' }[r.varianceStatus] || '';
  modal(`<h2>نتیجه شفت <span class="ltr">${esc(r.shiftId)}</span></h2>
    <table><tbody>
      <tr><td>پول آغاز شفت</td><td>${m(r.startingFloat)}</td></tr>
      <tr><td>فروش خالص نقدی</td><td>${m(r.netCash)}</td></tr>
      <tr><td>افزودن پول / مصارف / برداشت</td><td>${m(r.payins)} / ${m(r.payouts)} / ${m(r.drops)}</td></tr>
      <tr><td><b>متوقع در دخل</b></td><td><b>${m(r.expectedCash)}</b></td></tr>
      <tr><td><b>شمارش شده</b></td><td><b>${m(r.countedCash)}</b></td></tr>
    </tbody></table>
    <div class="variance ${esc(r.varianceStatus)}" style="margin-top:12px">${r.variance > 0 ? '+' : ''}${m(r.variance)} — ${word}</div>
    ${isAdmin() ? `<div class="status-warn" style="margin-top:12px"><span>💾 پشتیبان روزانه: آخرین پشتیبان ${esc(timeAgo(state.s.lastBackupAt))}</span><button class="btn small" data-backup2>گرفتن پشتیبان</button></div>` : ''}
    <div class="actions"><button class="btn primary" data-print>🖨 چاپ گزارش Z</button>
      ${bluetoothSupported() ? '<button class="btn" data-bt>📶 بلوتوث</button>' : ''}<button class="btn" data-close>بستن</button></div>`, {
    onMount: (box, close) => {
      box.querySelector('[data-close]').onclick = close;
      box.querySelector('[data-backup2]')?.addEventListener('click', async (e) => { await doBackup(); e.target.closest('.status-warn').innerHTML = '<span>💾 ✔ پشتیبان گرفته شد</span>'; });
      box.querySelector('[data-print]').onclick = () => printHtml(zReportDoc(r, state.s), state.s.paperWidth);
      box.querySelector('[data-bt]')?.addEventListener('click', () => btPrint(zReportDoc(r, state.s)));
    }
  });
}

// ====================================================================== receive stock
async function renderReceive() {
  state.batch = state.batch || (await getSetting2('currentBatch'));
  const b = state.batch;
  if (!b) {
    $('#main').innerHTML = `<div class="center-screen"><form class="card setup stack" id="batchForm">
      <h2>📦 دریافت محموله جدید</h2>
      <label class="field">نام عرضه‌کننده (تأمین‌کننده)<input name="supplier" required autofocus></label>
      <label class="field">شماره فاکتور<input name="invoiceNo"></label>
      <button class="btn primary big" type="submit">شروع دریافت</button></form></div>`;
    $('#batchForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      state.batch = { batchId: 'B-' + Date.now().toString(36).toUpperCase(), supplier: f.supplier.trim(), invoiceNo: f.invoiceNo.trim(), startedAt: now() };
      await setSetting('currentBatch', state.batch);
      renderReceive();
    };
    return;
  }
  const lines = await db.receivings.where('batchId').equals(b.batchId).toArray();
  const totalCost = lines.reduce((a, l) => a + Math.round(l.qty * l.cost), 0);
  $('#main').innerHTML = `<div class="stack">
    <div class="card"><div class="row"><h2 style="margin:0">📦 ${esc(b.supplier)}</h2><span class="muted">فاکتور: ${esc(b.invoiceNo || '—')}</span>
      <span class="spacer"></span><button class="btn primary" id="endBatch">ختم محموله</button></div>
      <div class="scanbar" style="margin-top:12px"><input id="recvScan" data-scan placeholder="بارکد جنس را اسکن کنید" autocomplete="off" autofocus>
      <button class="btn" id="camBtn">📷 کمره</button><button class="btn" id="noCode" title="جنس بدون بارکد">بدون بارکد</button></div>
      <div id="camBox" class="cam hidden"></div></div>
    <div class="card hidden" id="itemCard"></div>
    <div class="card"><div class="row"><h3 style="margin:0">اجناس این محموله</h3><span class="spacer"></span>
      <b>مجموع فاکتور: ${m(totalCost)}</b></div>
      ${lines.length ? `<div class="table-wrap"><table><thead><tr><th>جنس</th><th>تعداد</th><th>قیمت خرید</th><th>قیمت فروش</th><th>مجموع</th></tr></thead><tbody>
      ${lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${formatQty(l.qty, l.unit)}</td><td>${m(l.cost)}</td><td>${m(l.price)}</td><td>${m(Math.round(l.qty * l.cost))}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">هنوز جنسی اضافه نشده</p>'}</div></div>`;
  bindScanInput($('#recvScan'), receiveCode);
  $('#camBtn').onclick = (e) => toggleCamera('camBox', receiveCode, e.currentTarget);
  $('#noCode').onclick = async () => receiveCode(internalBarcode(await nextSeq('internalSeq')));
  $('#endBatch').onclick = async () => {
    if (!(await confirmBox(`محموله «${b.supplier}» با ${toDariDigits(lines.length)} قلم و مجموع ${formatMoney(totalCost)} ختم شود؟`))) return;
    state.batch = null;
    await setSetting('currentBatch', null);
    toast('محموله ثبت شد', 'ok');
    if (navigator.onLine) syncNow({ pull: false }).then(refreshBadge);
    renderReceive();
  };
}
async function getSetting2(k) { return (await getSettings())[k]; }

async function receiveCode(code) {
  if (!state.batch) return;
  if (!eanValid(code)) { beep('err'); return toast('بارکد درست خوانده نشد، دوباره اسکن کنید', 'err'); }
  const p = await findProduct(code);
  if (p) code = p.barcode; // same product saved under the other UPC / EAN form
  beep(p ? 'ok' : 'new');
  const card = $('#itemCard');
  card.classList.remove('hidden');
  card.innerHTML = `<form class="stack" id="itemForm">
    <div class="row"><b>بارکد:</b><span class="ltr">${esc(code)}</span>${p ? `<span class="muted">موجودی فعلی: ${formatQty(p.stock || 0, p.unit)}</span>` : '<span class="new-flag">جنس جدید! نام و قیمت را وارد کنید</span>'}</div>
    <label class="field">نام جنس<input name="name" required value="${esc(p?.name || '')}" ${p ? '' : 'autofocus'}></label>
    ${unitSelectHtml(p?.unit)}
    <div class="grid2">
      <label class="field"><span class="cost-lbl">قیمت خرید (فی دانه)</span><input name="cost" inputmode="decimal" required value="${p ? esc(formatNumber(p.cost || 0)) : ''}" ${p ? 'autofocus' : ''}></label>
      <label class="field"><span class="price-lbl">قیمت فروش</span><input name="price" inputmode="decimal" required value="${p ? esc(formatNumber(p.price)) : ''}"></label>
    </div>
    <div class="row">مفاد: <span class="margin-pill" id="margin">—</span></div>
    <label class="field"><span class="qty-lbl">تعداد دریافتی</span><input name="qty" inputmode="decimal" required value="${toDariDigits(1)}"></label>
    <div class="qty-add"></div>
    <button class="btn primary big" type="submit">ذخیره و افزودن به گدام</button></form>`;
  const form = $('#itemForm');
  const updMargin = () => {
    const c = parseMoney(form.cost.value), r = parseMoney(form.price.value);
    const mp = marginPct(c, r);
    $('#margin').textContent = r ? toDariDigits(mp) + '٪' : '—';
    $('#margin').classList.toggle('bad', r > 0 && mp < 0);
  };
  form.addEventListener('input', updMargin);
  form.qty.addEventListener('input', () => { form.qty.dataset.touched = '1'; });
  updMargin();
  const updUnit = () => {
    const kg = form.unit.value === 'kg';
    card.querySelector('.cost-lbl').textContent = kg ? 'قیمت خرید (فی کیلو)' : 'قیمت خرید (فی دانه)';
    card.querySelector('.price-lbl').textContent = kg ? 'قیمت فروش (فی کیلو)' : 'قیمت فروش';
    card.querySelector('.qty-lbl').textContent = kg ? 'وزن دریافتی (کیلو)' : 'تعداد دریافتی';
    card.querySelector('.qty-add').innerHTML = (kg ? [1, 5, 10, 25, 50] : [1, 6, 12, 24, 48]).map((n) =>
      `<button type="button" class="btn" data-add="${n}">+${toDariDigits(n)}${kg ? (n >= 25 ? ' (بوری)' : ' کیلو') : n >= 12 ? ' (کارتن)' : ''}</button>`).join('')
      + '<button type="button" class="btn" data-add="0">صفر</button>';
  };
  form.unit.onchange = updUnit;
  updUnit();
  card.querySelector('.qty-add').onclick = (e) => {
    const n = e.target.closest('[data-add]')?.dataset.add;
    if (n === undefined) return;
    const next = n === '0' ? 0 : addQty(parseQty(form.qty.value), +n - (form.qty.dataset.touched ? 0 : 1));
    form.qty.value = form.unit.value === 'kg' ? qtyInput(next) : toDariDigits(next);
    form.qty.dataset.touched = '1';
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const unit = form.unit.value === 'kg' ? 'kg' : 'pc';
    const qty = unit === 'kg' ? parseQty(form.qty.value) : parseIntSafe(form.qty.value), cost = parseMoney(form.cost.value), price = parseMoney(form.price.value);
    if (qty <= 0) return toast(unit === 'kg' ? 'وزن باید بیشتر از صفر باشد' : 'تعداد باید بیشتر از صفر باشد', 'err');
    if (!price) return toast('قیمت فروش را وارد کنید', 'err');
    const ts = now();
    await db.transaction('rw', db.products, db.receivings, async () => {
      const cur = await db.products.get(code);
      await db.products.put(stampPrice(cur, { barcode: code, name: form.name.value.trim(), price, cost, stock: addQty(cur?.stock, qty), quick: cur?.quick || 0, unit,
        ...(cur?.demo ? { demo: 1 } : {}), updatedAt: ts, synced: cur?.demo ? 1 : 0 }, ts));
      await db.receivings.add({ id: randomId(), batchId: state.batch.batchId, supplier: state.batch.supplier, invoiceNo: state.batch.invoiceNo,
        barcode: code, name: form.name.value.trim(), qty, unit, cost, price, total: Math.round(qty * cost), userName: state.user.name, timestamp: ts, updatedAt: ts, synced: 0,
        priceChanged: cur ? cur.price !== price : false, ...(cur?.demo ? { practice: 1, synced: 1 } : {}) });
    });
    beep('done');
    toast(`${unit === 'kg' ? formatQty(qty, 'kg') : toDariDigits(qty) + ' عدد'} «${form.name.value.trim()}» به گدام اضافه شد`, 'ok');
    refreshBadge();
    await renderReceive();
  };
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ====================================================================== products
async function renderProducts() {
  $('#main').innerHTML = `<div class="card stack">
    <div class="row"><h2 style="margin:0">🏷️ اجناس</h2><span class="spacer"></span>
      <button class="btn primary" id="newProd">+ جنس جدید</button>
      <button class="btn" id="expCsv">صادرات CSV</button><button class="btn" id="impCsv">واردات CSV</button>
      <button class="btn" id="pullSheet">دریافت قیمت‌ها از شیت</button></div>
    <input id="prodSearch" data-scan placeholder="جستجو با نام یا بارکد" autocomplete="off">
    <div class="table-wrap"><table><thead><tr><th>نام</th><th>بارکد</th><th>قیمت فروش</th><th>قیمت خرید</th><th>مفاد</th><th title="فقط فروش و دریافت همین دستگاه. مجموع همه دستگاه‌ها در گوگل شیت است.">موجودی (این دستگاه)</th><th>⭐</th><th></th></tr></thead>
    <tbody id="prodRows"></tbody></table></div></div>`;
  const draw = async (q = '') => {
    const nq = normalizeBarcode(q);
    const all = await db.products.orderBy('name').toArray();
    const list = q ? all.filter((p) => p.name.includes(q) || p.barcode.includes(nq)) : all;
    $('#prodRows').innerHTML = list.map((p) => `<tr class="${(p.stock || 0) <= state.s.lowStock ? 'low' : ''}">
      <td>${p.unit === 'kg' ? '⚖ ' : ''}${esc(p.name)}</td><td><span class="ltr small">${esc(p.barcode)}</span></td><td>${priceLabel(p)}</td><td>${m(p.cost || 0)}</td>
      <td>${toDariDigits(marginPct(p.cost || 0, p.price))}٪</td><td>${formatQty(p.stock || 0, p.unit)}</td><td>${p.quick ? '⭐' : ''}</td>
      <td><button class="btn small" data-edit="${esc(p.barcode)}">ویرایش</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">جنسی نیست</td></tr>';
  };
  $('#prodSearch').oninput = (e) => draw(e.target.value.trim());
  $('#prodRows').onclick = async (e) => { const bc = e.target.closest('[data-edit]')?.dataset.edit; if (bc) editProduct(await db.products.get(bc), () => draw($('#prodSearch').value.trim())); };
  $('#newProd').onclick = () => editProduct({}, () => draw());
  $('#expCsv').onclick = async () => {
    const rows = [['barcode', 'name', 'price', 'cost', 'stock', 'quick', 'unit']];
    for (const p of await db.products.toArray()) rows.push([p.barcode, p.name, p.price / 100, (p.cost || 0) / 100, p.stock || 0, p.quick ? 1 : 0, p.unit === 'kg' ? 'kg' : 'pc']);
    download(`products-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + toCsv(rows), 'text/csv;charset=utf-8');
  };
  $('#impCsv').onclick = async () => {
    const f = await pickFile('.csv,text/csv');
    if (!f) return;
    const rows = parseCsv(await f.text());
    const head = rows.shift()?.map((h) => h.trim().toLowerCase()) || [];
    const ix = (k) => head.indexOf(k);
    if (ix('barcode') < 0 || ix('name') < 0 || ix('price') < 0) return toast('ستون‌های barcode, name, price لازم است', 'err');
    let n = 0; const ts = now();
    await db.transaction('rw', db.products, async () => {
      for (const r of rows) {
        const bc = normalizeBarcode(r[ix('barcode')] || '');
        if (!bc) continue;
        const cur = await db.products.get(bc);
        const unit = ix('unit') >= 0 ? normalizeUnit(r[ix('unit')]) : cur?.unit || 'pc';
        await db.products.put(stampPrice(cur, { barcode: bc, name: (r[ix('name')] || '').trim(), price: parseMoney(r[ix('price')]), unit,
          cost: ix('cost') >= 0 ? parseMoney(r[ix('cost')]) : cur?.cost || 0,
          stock: ix('stock') >= 0 ? (unit === 'kg' ? parseQty(r[ix('stock')]) : parseIntSafe(r[ix('stock')])) : cur?.stock || 0,
          quick: ix('quick') >= 0 ? (parseIntSafe(r[ix('quick')]) ? 1 : 0) : cur?.quick || 0, updatedAt: ts, synced: 0 }, ts));
        n++;
      }
    });
    toast(`${toDariDigits(n)} جنس وارد شد`, 'ok');
    draw();
  };
  $('#pullSheet').onclick = async () => {
    try {
      const { n, conflicts } = await pullProducts();
      toast(`${toDariDigits(n)} جنس از گوگل شیت به‌روز شد`, 'ok');
      if (conflicts.length) await resolveConflicts(conflicts);
      draw(); refreshBadge();
    }
    catch (err) { toast(navigator.onLine ? err.message : 'برای این کار انترنت لازم است', 'err'); }
  };
  draw();
}

// A product was changed on this device (not yet sent) AND differently in the sheet: the manager picks one.
function resolveConflicts(conflicts) {
  const label = { name: 'نام', price: 'قیمت فروش', cost: 'قیمت خرید', unit: 'واحد' };
  const show = (f, o) => (f === 'price' || f === 'cost' ? formatMoney(o[f]) : f === 'unit' ? (o[f] === 'kg' ? 'کیلو' : 'دانه') : o[f]);
  return new Promise((resolve) => {
    modal(`<h2>⚠️ تفاوت بین این دستگاه و گوگل شیت</h2>
      <p class="muted small">این اجناس در این دستگاه تغییر کرده‌اند ولی هنوز به گوگل شیت نرفته‌اند، و در شیت هم تغییر کرده‌اند. برای هر کدام انتخاب کنید کدام درست است.</p>
      <div class="stack" id="cfList">${conflicts.map((c, i) => `<div class="card conflict" data-i="${i}">
        <b>${esc(c.local.name)}</b> <span class="ltr small muted">${esc(c.local.barcode)}</span>
        <table class="small"><tr><th></th><th>این دستگاه</th><th>گوگل شیت</th></tr>
        ${c.fields.map((f) => `<tr><td>${label[f]}</td><td>${esc(String(show(f, c.local)))}</td><td>${esc(String(show(f, c.sheet)))}</td></tr>`).join('')}</table>
        <div class="row"><button class="btn grow" data-keep="local">نگه‌داشتن این دستگاه</button><button class="btn grow" data-keep="sheet">گرفتن از شیت</button></div>
      </div>`).join('')}</div>
      <div class="actions"><button class="btn" data-all="local">همه: این دستگاه</button><button class="btn" data-all="sheet">همه: گوگل شیت</button></div>`, {
      dismiss: false,
      onMount: (box, close) => {
        let left = conflicts.length;
        const done = async (i, keep) => {
          const card = box.querySelector(`.conflict[data-i="${i}"]`);
          if (!card || card.dataset.done) return;
          card.dataset.done = '1';
          // 'local' is re-stamped as a fresh edit so the sheet accepts it on the next sync.
          await (keep === 'sheet' ? takeSheetVersion(conflicts[i]) : keepLocalVersion(conflicts[i]));
          card.innerHTML = `<b>${esc(conflicts[i].local.name)}</b> ✔ ${keep === 'sheet' ? 'از شیت گرفته شد' : 'نسخه این دستگاه ماند'}`;
          if (--left === 0) { close(); toast('تفاوت‌ها حل شد', 'ok'); resolve(); }
        };
        box.querySelector('#cfList').onclick = (e) => { const b = e.target.closest('[data-keep]'); if (b) done(+b.closest('.conflict').dataset.i, b.dataset.keep); };
        box.querySelectorAll('[data-all]').forEach((b) => { b.onclick = async () => { for (let i = 0; i < conflicts.length; i++) await done(i, b.dataset.all); }; });
      }
    });
  });
}

function editProduct(p, after, { isNew = !p.name } = {}) {
  modal(`<h2>${isNew ? 'جنس جدید' : 'ویرایش جنس'}</h2><form class="stack" id="pf">
    <label class="field">بارکد<div class="row"><input name="barcode" class="grow ltr" required value="${esc(p.barcode || '')}" ${isNew ? '' : 'readonly'}>
      ${isNew ? '<button type="button" class="btn small" id="genCode">تولید کد داخلی</button>' : ''}</div></label>
    <label class="field">نام<input name="name" required value="${esc(p.name || '')}"></label>
    ${unitSelectHtml(p.unit)}
    <div class="grid2"><label class="field"><span class="price-lbl">قیمت فروش</span><input name="price" inputmode="decimal" required value="${p.price != null ? esc(formatNumber(p.price)) : ''}"></label>
    <label class="field">قیمت خرید<input name="cost" inputmode="decimal" value="${p.cost != null ? esc(formatNumber(p.cost)) : ''}"></label></div>
    <label class="field"><span class="stock-lbl">موجودی</span><input name="stock" inputmode="decimal" value="${p.unit === 'kg' ? qtyInput(p.stock || 0) : toDariDigits(p.stock || 0)}"></label>
    <label class="check"><input type="checkbox" name="quick" ${p.quick ? 'checked' : ''}> دکمه سریع در صفحه فروش (برای نان، میوه و ...)</label>
    <div class="actions"><button class="btn primary" type="submit">ذخیره</button>
      ${isNew ? '' : '<button class="btn" type="button" data-label>🏷 چاپ لیبل QR</button><button class="btn danger" type="button" data-del>حذف</button>'}
      <button class="btn" type="button" data-no>لغو</button></div></form>`, {
    dismiss: false,
    onMount: (box, close) => {
      const f = box.querySelector('#pf');
      const updUnit = () => {
        const kg = f.unit.value === 'kg';
        box.querySelector('.price-lbl').textContent = kg ? 'قیمت فروش (فی کیلو)' : 'قیمت فروش';
        box.querySelector('.stock-lbl').textContent = kg ? 'موجودی (کیلو)' : 'موجودی';
      };
      f.unit.onchange = updUnit;
      updUnit();
      box.querySelector('[data-no]').onclick = close;
      box.querySelector('#genCode')?.addEventListener('click', async () => { f.barcode.value = internalBarcode(await nextSeq('internalSeq')); });
      if (isNew && p.name && !f.barcode.value) nextSeq('internalSeq').then((n) => { if (!f.barcode.value) f.barcode.value = internalBarcode(n); });
      if (isNew && p.name) setTimeout(() => f.price.focus(), 50);
      box.querySelector('[data-label]')?.addEventListener('click', () => printHtml(labelDoc(p), state.s.paperWidth));
      box.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`«${p.name}» از لیست اجناس حذف شود؟ (فروش‌های قبلی باقی می‌ماند)`, { danger: true, okText: 'حذف' }))) return;
        await db.products.delete(p.barcode);
        close(); after?.();
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const bc = normalizeBarcode(f.barcode.value);
        if (isNew && (await findProduct(bc))) return toast('این بارکد قبلاً ثبت شده است', 'err');
        const unit = f.unit.value === 'kg' ? 'kg' : 'pc';
        const cur = await db.products.get(bc), ts = now();
        await db.products.put(stampPrice(cur, { barcode: bc, name: f.name.value.trim(), price: parseMoney(f.price.value), cost: parseMoney(f.cost.value), unit,
          stock: unit === 'kg' ? parseQty(f.stock.value) : parseIntSafe(f.stock.value), quick: f.quick.checked ? 1 : 0,
          ...(cur?.demo ? { demo: 1 } : {}), updatedAt: ts, synced: cur?.demo ? 1 : 0 }, ts));
        close(); toast('ذخیره شد', 'ok'); refreshBadge(); after?.(bc);
      };
    }
  });
}

// ====================================================================== reports
async function renderReports(dateStr) {
  const day = dateStr || new Date().toLocaleDateString('en-CA');
  const start = new Date(day + 'T00:00:00'), end = new Date(start.getTime() + 86400000);
  const allSales = await db.sales.where('timestamp').between(start.toISOString(), end.toISOString()).reverse().toArray();
  const sales = realSales(allSales), practiceN = allSales.length - sales.length;
  const good = sales.filter((s) => !s.voided);
  const net = good.reduce((a, s) => a + s.total, 0);
  const cost = good.reduce((a, s) => a + s.items.reduce((b, l) => b + Math.round((l.cost || 0) * l.qty), 0), 0);
  const voids = sales.filter((s) => s.voided);
  const top = new Map();
  for (const s of good) for (const l of s.items) { const t = top.get(l.barcode) || { name: l.name, qty: 0, total: 0, unit: l.unit }; t.qty = addQty(t.qty, l.qty); t.total += lineTotal(l); top.set(l.barcode, t); }
  const topList = [...top.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  const shifts = await db.shifts.orderBy('openedAt').reverse().limit(15).toArray();
  const low = (await db.products.toArray()).filter((p) => (p.stock || 0) <= state.s.lowStock).slice(0, 30);
  const s = await getSettings();
  $('#main').innerHTML = `<div class="stack">
    <div class="card row"><h2 style="margin:0">📊 گزارش</h2>
      <input type="date" id="day" value="${day}" style="max-width:200px"><span class="muted">${esc(dariDate(start, { time: false }))}</span>
      ${practiceN ? `<span class="muted small">🧪 ${toDariDigits(practiceN)} فروش تمرینی در این روز حساب نشده</span>` : ''}
      <span class="spacer"></span><button class="btn" id="scanRcpt">📷 اسکن QR رسید</button><button class="btn" id="expSales">صادرات فروش CSV</button></div>
    <div id="camBox" class="cam hidden"></div>
    <div class="grid2">
      <div class="stat"><div class="k">فروش خالص</div><div class="v">${m(net)}</div></div>
      <div class="stat"><div class="k">تعداد رسید</div><div class="v">${toDariDigits(good.length)}</div></div>
      <div class="stat"><div class="k">مفاد ناخالص</div><div class="v">${m(net - cost)}</div><div class="small muted">${toDariDigits(net ? Math.round(((net - cost) / net) * 100) : 0)}٪ از فروش</div></div>
      <div class="stat"><div class="k">باطل شده</div><div class="v">${toDariDigits(voids.length)} · ${m(voids.reduce((a, x) => a + x.total, 0))}</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>پرفروش‌ترین اجناس</h3>${topList.length ? `<table><tbody>${topList.map((t) => `<tr><td>${esc(t.name)}</td><td>${formatQty(t.qty, t.unit)}</td><td>${m(t.total)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">—</p>'}</div>
      <div class="card"><h3>موجودی کم (≤ ${toDariDigits(s.lowStock)})</h3>${low.length ? `<table><tbody>${low.map((p) => `<tr><td>${esc(p.name)}</td><td>${toDariDigits(p.stock || 0)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">همه خوب است</p>'}</div>
    </div>
    <div class="card"><h3>رسیدها</h3><div class="table-wrap"><table><thead><tr><th>رسید</th><th>زمان</th><th>صندوقدار</th><th>مجموع</th><th>دریافتی</th><th>باقی</th><th>همگام</th></tr></thead><tbody id="rcptRows">
      ${sales.map((x) => `<tr class="${x.voided ? 'voided' : ''}" data-r="${esc(x.receiptId)}" style="cursor:pointer"><td><span class="ltr small">${esc(x.receiptId)}</span></td><td>${esc(dariDate(x.timestamp))}</td><td>${esc(x.cashierName)}</td>
        <td>${m(x.total)}</td><td>${m(x.cashReceived)}</td><td>${m(x.changeGiven)}</td><td>${x.synced ? '✔' : '⏳'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">فروشی در این روز نیست</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><h3>شفت‌ها</h3><div class="table-wrap"><table><thead><tr><th>شفت</th><th>صندوقدار</th><th>باز</th><th>بسته</th><th>متوقع</th><th>شمارش</th><th>تفاوت</th></tr></thead><tbody id="shiftRows">
      ${shifts.map((x) => `<tr data-sh="${esc(x.shiftId)}" style="cursor:pointer"><td><span class="ltr small">${esc(x.shiftId)}</span></td><td>${esc(x.cashierName)}</td><td>${esc(dariDate(x.openedAt))}</td>
        <td>${x.closedAt ? esc(dariDate(x.closedAt)) : '<b>باز</b>'}</td><td>${x.closedAt ? m(x.expectedCash) : '—'}</td><td>${x.closedAt ? m(x.countedCash) : '—'}</td>
        <td>${x.closedAt ? `<span class="variance ${esc(x.varianceStatus)}" style="font-size:1rem;padding:2px 8px">${m(x.variance)}</span>` : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">—</td></tr>'}
    </tbody></table></div></div></div>`;
  $('#day').onchange = (e) => renderReports(e.target.value);
  $('#rcptRows').onclick = (e) => { const r = e.target.closest('[data-r]')?.dataset.r; if (r) showReceipt(r); };
  $('#shiftRows').onclick = async (e) => { const id = e.target.closest('[data-sh]')?.dataset.sh; if (!id) return; const sh = await db.shifts.get(id); if (sh.closedAt) showShiftResult(sh); };
  $('#scanRcpt').onclick = (e) => toggleCamera('camBox', reportsCode, e.currentTarget);
  $('#expSales').onclick = () => {
    const rows = [['receiptId', 'timestamp', 'cashier', 'barcode', 'item', 'qty', 'price', 'lineTotal', 'receiptTotal', 'cashReceived', 'change', 'voided']];
    for (const x of sales) for (const l of x.items) rows.push([x.receiptId, x.timestamp, x.cashierName, l.barcode, l.name, l.qty, l.price / 100, lineTotal(l) / 100, x.total / 100, x.cashReceived / 100, x.changeGiven / 100, x.voided ? 1 : 0]);
    download(`sales-${day}.csv`, '﻿' + toCsv(rows), 'text/csv;charset=utf-8');
  };
}

function reportsCode(code) {
  const r = parseReceiptQr(code);
  if (r) { stopCamera(); $('#camBox')?.classList.add('hidden'); showReceipt(r.receiptId); }
  else toast('این QR رسید نیست', 'err');
}

// ====================================================================== settings
async function renderSettings() {
  const s = await getSettings();
  state.s = s;
  const users = await db.users.toArray();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  $('#main').innerHTML = `<div class="stack">
    <form class="card stack" id="sf"><h2>⚙️ تنظیمات فروشگاه</h2>
      <div class="muted small">نسخه رایگان: <b class="ltr">${esc(await appVersion() || '—')}</b> · اسکنر: <b class="ltr">${esc(decoderName || '—')}</b> · ${isStandalone() ? '✔ نصب شده' : '✖ نصب نشده'}</div>
      <div class="install-box"></div>
      <div class="grid2">
        <label class="field">نام فروشگاه<input name="storeName" value="${esc(s.storeName)}"></label>
        <label class="field">آدرس<input name="storeAddress" value="${esc(s.storeAddress)}"></label>
        <label class="field">تلفن<input name="storePhone" value="${esc(s.storePhone)}" class="ltr"></label>
        <label class="field">متن پایین رسید<input name="receiptFooter" value="${esc(s.receiptFooter)}"></label>
        <label class="field">کد دستگاه<input name="deviceId" value="${esc(s.deviceId)}" class="ltr" maxlength="6"></label>
        <label class="field">عرض کاغذ چاپگر<select name="paperWidth"><option value="80" ${s.paperWidth == 80 ? 'selected' : ''}>۸۰ ملی‌متر</option><option value="58" ${s.paperWidth == 58 ? 'selected' : ''}>۵۸ ملی‌متر</option></select></label>
        <label class="field">حد موجودی کم<input name="lowStock" inputmode="numeric" value="${toDariDigits(s.lowStock)}"></label>
      </div>
      <label class="check"><input type="checkbox" name="autoPrint" ${s.autoPrint ? 'checked' : ''}> چاپ خودکار رسید بعد از هر فروش</label>
      <h3>☁️ گوگل شیت (دفتر پشتیبان — فقط این بخش انترنت لازم دارد)</h3>
      <details class="multi-note"><summary>چند دستگاه با یک گوگل شیت؟ (حتماً بخوانید)</summary>
        <ul class="small">
          <li>هر دستگاه فروش و موجودی خودش را نگه می‌دارد. «موجودی» در این دستگاه = جنس دریافت شده منهای فروش <b>همین دستگاه</b>.</li>
          <li>در گوگل شیت، تب <b>Stock_By_Device</b> موجودی هر دستگاه را جدا نشان می‌دهد و ستون موجودی <b>Inventory</b> مجموع همه دستگاه‌هاست.</li>
          <li>کد هر دستگاه باید فرق کند (T1، T2 …).</li>
          <li>شمارش و اصلاح موجودی را فقط در یک دستگاه (دستگاه اصلی) انجام دهید.</li>
          <li>برای شروع، یک دستگاه در هر دوکان پیشنهاد می‌شود.</li>
        </ul></details>
      <label class="field">آدرس Web App (Apps Script)<input name="webhookUrl" value="${esc(s.webhookUrl)}" class="ltr" placeholder="https://script.google.com/macros/s/.../exec"></label>
      <label class="field">کلید امنیتی (همان SYNC_TOKEN در Apps Script)<input name="syncToken" value="${esc(s.syncToken)}" class="ltr" type="password" autocomplete="off"></label>
      <div class="row"><button class="btn primary" type="submit">ذخیره تنظیمات</button><button class="btn" type="button" id="syncBtn">همگام‌سازی اکنون</button>
        <button class="btn" type="button" id="pullUsersBtn">دریافت کاربران از شیت</button></div>
      <p class="small"><b>آخرین همگام‌سازی موفق: ${esc(timeAgo(s.lastSyncAt))}</b>${s.lastSyncAt ? ` <span class="muted">(${esc(dariDate(s.lastSyncAt))})</span>` : ''} · در انتظار ارسال: <b>${toDariDigits(await pendingCount())}</b>${s.lastSyncError ? ` · <span class="err-text">خطا: ${esc(s.lastSyncError)}</span>` : ''}</p>
    </form>
    <div class="card stack"><div class="row"><h2 style="margin:0">👥 کاربران</h2><span class="spacer"></span><button class="btn primary" id="addUser">+ کاربر جدید</button></div>
      <table><thead><tr><th>نام</th><th>نقش</th><th>منبع</th><th>وضعیت</th><th></th></tr></thead><tbody id="userRows">
      ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${u.role === 'admin' ? 'مدیر' : 'صندوقدار'}</td><td>${u.source === 'sheet' ? 'گوگل شیت' : 'دستگاه'}</td>
        <td>${u.active ? 'فعال' : 'غیرفعال'}</td><td>${u.source === 'sheet' ? '<span class="small muted">در شیت تغییر دهید</span>' :
        `<button class="btn small" data-pin="${esc(u.id)}">تغییر رمز</button> <button class="btn small" data-toggle="${esc(u.id)}">${u.active ? 'غیرفعال' : 'فعال'}</button>`}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="card stack"><h2>🖨 چاپگر</h2>
      <p class="muted small">چاپگر USB/سیستمی: دکمه «چاپ» از پنجره چاپ مرورگر استفاده می‌کند. چاپگر بلوتوث: فقط در Chrome (اندروید/کمپیوتر).</p>
      <div class="row"><button class="btn" id="testPrint">چاپ آزمایشی</button>
      ${bluetoothSupported() ? `<button class="btn" id="btConnect">وصل کردن چاپگر بلوتوث ${bluetoothName() ? '(' + esc(bluetoothName()) + ')' : ''}</button><button class="btn" id="btTest">آزمایش بلوتوث</button>` : '<span class="muted small">این مرورگر بلوتوث را پشتیبانی نمی‌کند</span>'}</div></div>
    <div class="card stack"><h2>💾 پشتیبان</h2>
      <p><b>آخرین پشتیبان: ${esc(timeAgo(s.lastBackupAt))}</b>${s.lastBackupAt ? ` <span class="muted small">(${esc(dariDate(s.lastBackupAt))})</span>` : ''}</p>
      <p class="muted small">ذخیره دائمی دستگاه: ${persisted ? '✔ فعال' : '✖ فعال نیست — اپ را نصب کنید (Add to Home Screen)'} · هر روز پس از بستن شفت پشتیبان بگیرید و فایل را در فلش، واتساپ یا ایمیل خود نگه دارید.</p>
      <div class="row"><button class="btn" id="backup">دانلود پشتیبان کامل (JSON)</button><button class="btn" id="restore">بازیابی از پشتیبان</button></div></div>
  </div>`;
  refreshInstallBoxes();
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    for (const k of ['storeName', 'storeAddress', 'storePhone', 'receiptFooter', 'webhookUrl', 'syncToken']) await setSetting(k, String(f.get(k) || '').trim());
    await setSetting('deviceId', String(f.get('deviceId')).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'T1');
    await setSetting('paperWidth', parseInt(f.get('paperWidth'), 10));
    await setSetting('lowStock', parseIntSafe(f.get('lowStock')));
    await setSetting('autoPrint', !!f.get('autoPrint'));
    state.s = await getSettings();
    $('#storeTitle').textContent = state.s.storeName;
    toast('ذخیره شد', 'ok');
    refreshBadge();
  };
  $('#syncBtn').onclick = () => $('#syncBadge').click();
  $('#pullUsersBtn').onclick = async () => {
    if (!navigator.onLine) return toast('برای این کار انترنت لازم است', 'err');
    try { const n = await pullUsers(await getSettings()); toast(`${toDariDigits(n)} کاربر از شیت دریافت شد`, 'ok'); renderSettings(); }
    catch (err) { toast(err.message, 'err'); }
  };
  $('#addUser').onclick = async () => {
    const v = await formBox('کاربر جدید', [{ name: 'name', label: 'نام', required: true },
      { name: 'role', label: 'نقش', value: 'cashier', options: [['cashier', 'صندوقدار'], ['admin', 'مدیر']] },
      { name: 'pin', label: 'رمز (۴ تا ۶ رقم)', inputmode: 'numeric', type: 'password', required: true }]);
    if (!v) return;
    const pin = toLatin(v.pin);
    if (!/^\d{4,6}$/.test(pin)) return toast('رمز باید ۴ تا ۶ رقم باشد', 'err');
    if (await pinInUse(pin)) return toast('این رمز را کاربر دیگری دارد', 'err');
    await createUser({ name: v.name.trim(), role: v.role, pin });
    toast('کاربر اضافه شد', 'ok'); renderSettings();
  };
  $('#userRows').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const u = await db.users.get(b.dataset.pin || b.dataset.toggle);
    if (b.dataset.pin) {
      const v = await formBox(`رمز جدید برای ${u.name}`, [{ name: 'pin', label: 'رمز (۴ تا ۶ رقم)', inputmode: 'numeric', type: 'password', required: true }]);
      if (!v) return;
      const pin = toLatin(v.pin);
      if (!/^\d{4,6}$/.test(pin)) return toast('رمز باید ۴ تا ۶ رقم باشد', 'err');
      if (await pinInUse(pin, u.id)) return toast('این رمز را کاربر دیگری دارد', 'err');
      await setUserPin(u, pin); toast('رمز تغییر کرد', 'ok');
    } else {
      if (u.active && u.role === 'admin') {
        const admins = (await db.users.toArray()).filter((x) => x.active && x.role === 'admin');
        if (admins.length <= 1) return toast('حداقل یک مدیر فعال لازم است', 'err');
      }
      await db.users.update(u.id, { active: !u.active }); renderSettings();
    }
  };
  const sample = { receiptId: `${s.deviceId}-TEST-0001`, timestamp: now(), cashierName: state.user.name, items: [{ name: 'جنس آزمایشی', qty: 2, price: 2500 }], total: 5000, cashReceived: 10000, changeGiven: 5000 };
  $('#testPrint').onclick = () => printHtml(receiptDoc(sample, state.s), state.s.paperWidth);
  $('#btConnect')?.addEventListener('click', async () => { try { toast('وصل شد: ' + (await connectBluetooth()), 'ok'); renderSettings(); } catch (err) { toast(err.message, 'err'); } });
  $('#btTest')?.addEventListener('click', () => btPrint(receiptDoc(sample, state.s)));
  $('#backup').onclick = async () => { await doBackup(); renderSettings(); };
  $('#restore').onclick = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    if (!(await confirmBox('همه اطلاعات فعلی این دستگاه با فایل پشتیبان جایگزین شود؟', { danger: true, okText: 'جایگزین شود' }))) return;
    try { await importBackup(JSON.parse(await f.text())); toast('بازیابی شد', 'ok'); state.s = await getSettings(); renderLock(); }
    catch (err) { toast(err.message, 'err'); }
  };
}

boot();

// ====================================================================== sold by weight (kg)
function priceLabel(p) { return m(p.price) + (p.unit === 'kg' ? ' / کیلو' : ''); }
function qtyInput(q) { return toDariDigits(String(round3(q)).replace('.', '٫')); }
function unitSelectHtml(unit) {
  return `<label class="field">واحد فروش<select name="unit">
    <option value="pc" ${unit !== 'kg' ? 'selected' : ''}>دانه (با تعداد)</option>
    <option value="kg" ${unit === 'kg' ? 'selected' : ''}>کیلو (با وزن — میوه، سبزی، برنج، گوشت)</option></select></label>`;
}

/** Ask the cashier for a weight. They can type kg from the scale, or the money amount the customer wants ("۵۰ افغانی بده"). */
function askWeight(p, current) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => { if (done) return; done = true; close(); resolve(v); };
    modal(`<h2>⚖ ${esc(p.name)}</h2><p class="muted">قیمت: ${priceLabel(p)}</p>
      <form class="stack" id="wf">
        <label class="field">وزن (کیلو) — از ترازو بخوانید<input name="w" inputmode="decimal" autocomplete="off" autofocus value="${current ? qtyInput(current) : ''}" placeholder="مثلاً ۱٫۲۵"></label>
        <div class="qty-add">${[0.25, 0.5, 1, 2, 5].map((n) => `<button type="button" class="btn" data-kg="${n}">${formatQty(n, 'kg')}</button>`).join('')}</div>
        <label class="field">یا مبلغ (افغانی) — مشتری چند پول جنس می‌خواهد<input name="amt" inputmode="decimal" autocomplete="off" placeholder="مثلاً ۵۰"></label>
        <div class="change-box"><div>قیمت این وزن</div><div class="v num" id="wTotal">${m(0)}</div></div>
        <div class="actions"><button class="btn primary grow" type="submit">افزودن به سبد</button><button class="btn" type="button" data-no>لغو</button></div>
      </form>`, {
      dismiss: false,
      onMount: (box, close) => {
        const f = box.querySelector('#wf');
        const show = () => { box.querySelector('#wTotal').innerHTML = m(lineTotal({ price: p.price, qty: parseQty(f.w.value), unit: 'kg' })); };
        f.w.oninput = () => { f.amt.value = ''; show(); };
        f.amt.oninput = () => { const w = weightForAmount(parseMoney(f.amt.value), p.price); f.w.value = w ? qtyInput(w) : ''; show(); };
        box.querySelector('.qty-add').onclick = (e) => { const k = e.target.closest('[data-kg]')?.dataset.kg; if (k) { f.w.value = qtyInput(+k); f.amt.value = ''; show(); f.w.focus(); } };
        box.querySelector('[data-no]').onclick = () => finish(null, close);
        f.onsubmit = (e) => {
          e.preventDefault();
          const w = parseQty(f.w.value);
          if (w <= 0) return toast('وزن را وارد کنید', 'err');
          if (w > 500) return toast('وزن بیش از حد است — دوباره ببینید', 'err');
          finish(w, close);
        };
        show();
      }
    });
  });
}
