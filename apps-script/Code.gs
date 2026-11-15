/**
 * Dari POS — Google Sheets back office (free: Google Apps Script).
 *
 * Setup (once):
 *   1. Create a new Google Sheet. Extensions > Apps Script. Paste this whole file. Save.
 *   2. Run the function `setup` (top toolbar). Approve permissions. It creates all tabs and
 *      writes your SYNC_TOKEN to the "Setup" tab — type that token into the app's Settings.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone.
 *      Copy the /exec URL into the app's Settings ("آدرس Web App").
 *
 * Money arrives from the app in pul (1 AFN = 100 pul) and is written to the sheet in Afghani.
 * Every write is an upsert keyed by ID, so re-sending the same record never creates duplicates.
 */

var TABS = {
  Sales: ['Receipt ID / شماره رسید', 'Time / زمان', 'Shift / شفت', 'Cashier / صندوقدار', 'Total / مجموع', 'Cash Tendered / نقد دریافتی',
    'Change / باقی', 'Items / تعداد', 'Items Summary / اجناس', 'Status / وضعیت', 'Device / دستگاه', 'Synced At / زمان همگام', 'Cost / قیمت خرید', 'Profit / مفاد', 'Voided By / باطل توسط', 'Credit / قرض', 'Customer / مشتری'],
  Sale_Items: ['Receipt ID / شماره رسید', 'Time / زمان', 'Barcode / بارکد', 'Item / جنس', 'Qty / تعداد', 'Price / قیمت', 'Line Total / مجموع', 'Unit Cost / قیمت خرید', 'Price Override / تغییر قیمت', 'Key'],
  Inventory: ['Barcode / بارکد', 'Name / نام', 'Price / قیمت فروش', 'Cost / قیمت خرید', 'Stock (all tills) / موجودی کل', 'Margin % / مفاد', 'Quick / سریع', 'Price Updated / زمان تغییر قیمت', 'Device / دستگاه', 'Unit / واحد (pc / kg)'],
  Purchases: ['ID', 'Time / زمان', 'Batch / محموله', 'Supplier / عرضه‌کننده', 'Invoice / فاکتور', 'Barcode / بارکد', 'Item / جنس', 'Qty / تعداد', 'Unit Cost / قیمت خرید', 'Retail / قیمت فروش', 'Line Cost / مجموع', 'Received By / دریافت کننده', 'Price Changed / تغییر قیمت'],
  Shift_Reconciliation: ['Shift ID / شفت', 'Cashier / صندوقدار', 'Opened / باز شد', 'Closed / بسته شد', 'Start Float / پول آغاز', 'Net Cash Sales / فروش خالص', 'Pay-ins / افزوده',
    'Payouts / مصارف', 'Drops / برداشت', 'Expected / متوقع', 'Counted / شمارش', 'Variance / تفاوت', 'Status / وضعیت', 'Transactions / معاملات', 'Closed By / بسته کننده', 'Denominations / نوت‌ها', 'Qarz in / دریافت قرض'],
  Cash_Movements: ['ID', 'Time / زمان', 'Shift / شفت', 'Type / نوع', 'Amount / مبلغ', 'Note / یادداشت', 'User / کاربر', 'Approved By / تأیید'],
  Users: ['Name / نام', 'Role (admin / cashier)', 'PIN / رمز', 'Active / فعال (TRUE/FALSE)'],
  // Each till reports only its own stock here; Inventory's stock column is the sum, so tills never overwrite each other.
  Stock_By_Device: ['Key', 'Barcode / بارکد', 'Device / دستگاه', 'Stock / موجودی این دستگاه', 'Updated / به‌روز شده'],
  // Qarz (customer credit). "Still owes" is recomputed from Qarz_Ledger after every push.
  Qarz_Customers: ['ID', 'Name / نام', 'Phone / تلفن', 'Limit / حد', 'Still owes / مانده', 'Last activity / آخرین', 'Status / وضعیت', 'Device / دستگاه'],
  Qarz_Ledger: ['ID', 'Time / زمان', 'Customer ID', 'Name / نام', 'Type / نوع', 'Amount / مبلغ', 'Receipt / رسید', 'Shift / شفت', 'By / توسط', 'Note / یادداشت', 'Device / دستگاه']
};
// Tells the app what this script can store; the app keeps qarz rows queued until it sees 'qarz'.
var FEATURES = ['qarz'];

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold').setBackground('#d9ead3');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  });
  // Keep barcodes / PINs as text so leading zeros survive (012000000133, 0123)
  [['Inventory', 'A:A'], ['Purchases', 'F:F'], ['Sale_Items', 'C:C'], ['Sale_Items', 'J:J'], ['Users', 'C:C'], ['Stock_By_Device', 'A:B'], ['Qarz_Customers', 'C:C']].forEach(function (x) {
    ss.getSheetByName(x[0]).getRange(x[1]).setNumberFormat('@');
  });
  // Variance colours: red short, yellow over, green balanced
  var rec = ss.getSheetByName('Shift_Reconciliation');
  var rng = rec.getRange('L2:L');
  rec.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setBackground('#f4c7c3').setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground('#fce8b2').setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(0).setBackground('#b7e1cd').setRanges([rng]).build()
  ]);
  var daily = ss.getSheetByName('Daily_Summary') || ss.insertSheet('Daily_Summary');
  daily.setRightToLeft(true);
  daily.getRange('A1').setFormula("=QUERY(Sales!A:N,\"select toDate(B), count(A), sum(E), sum(N) where J = 'Completed' group by toDate(B) order by toDate(B) desc label toDate(B) 'Date / تاریخ', count(A) 'Receipts / رسید', sum(E) 'Net Sales / فروش', sum(N) 'Gross Profit / مفاد'\",1)");
  var users = ss.getSheetByName('Users');
  if (users.getLastRow() < 2) users.appendRow(['نمونه صندوقدار', 'cashier', '1212', false]);
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('SYNC_TOKEN');
  if (!token) { token = Utilities.getUuid().replace(/-/g, ''); props.setProperty('SYNC_TOKEN', token); }
  var info = ss.getSheetByName('Setup') || ss.insertSheet('Setup');
  info.getRange('A1:B2').setValues([['SYNC_TOKEN (copy into app settings)', token], ['Keep this tab private', '']]);
  var s1 = ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
}

/**
 * Simple trigger: when the owner types a new name / price / cost / unit in Inventory, stamp column H
 * so an older price edit from an offline till cannot overwrite it later.
 */
function onEdit(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== 'Inventory') return;
    var c1 = e.range.getColumn(), c2 = e.range.getLastColumn();
    var touchesPrice = (c1 <= 4 && c2 >= 2) || (c1 <= 10 && c2 >= 10);
    var r1 = Math.max(2, e.range.getRow()), r2 = e.range.getLastRow();
    if (!touchesPrice || r2 < r1) return;
    var stamp = [];
    for (var i = r1; i <= r2; i++) stamp.push([new Date()]);
    sh.getRange(r1, 8, r2 - r1 + 1, 1).setValues(stamp);
  } catch (err) { /* never block the owner's edit */ }
}

function doGet() {
  return json({ ok: true, app: 'DariPOS', message: 'Dari POS back office is running. Use POST.' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad json' }); }
  var token = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  if (!token || body.token !== token) return json({ ok: false, error: 'کلید امنیتی نادرست است' });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (body.action === 'push') return json(push(ss, body));
    if (body.action === 'users') return json({ ok: true, users: users(ss), features: FEATURES });
    if (body.action === 'products') return json({ ok: true, products: products(ss, body.deviceId || ''), features: FEATURES });
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function afn(pul) { return Math.round(Number(pul || 0)) / 100; }
function dt(iso) { return iso ? new Date(iso) : ''; }

/** Text starting with = + - @ would run as a formula in Sheets; store it as plain text instead. */
function safeCell(v) {
  return (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) ? "'" + v : v;
}

/** Upsert rows into a sheet keyed by column `keyCol` (1-based). */
function upsert(sheet, keyCol, rows) {
  if (!rows.length) return;
  rows = rows.map(function (r) { return r.map(safeCell); });
  var last = sheet.getLastRow();
  var keys = last > 1 ? sheet.getRange(2, keyCol, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var index = {};
  keys.forEach(function (k, i) { index[k] = i + 2; });
  var append = [];
  rows.forEach(function (r) {
    var k = String(r[keyCol - 1]);
    if (index[k]) sheet.getRange(index[k], 1, 1, r.length).setValues([r]);
    else { append.push(r); index[k] = -1; }
  });
  if (append.length) sheet.getRange(sheet.getLastRow() + 1, 1, append.length, append[0].length).setValues(append);
}

/** Returns the tab, creating it with its header row if this sheet was set up by an older version. */
function tab(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold').setBackground('#d9ead3');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  return sh;
}

/** barcode -> total stock over all devices. */
function stockTotals(ss) {
  var sh = tab(ss, 'Stock_By_Device'), totals = {};
  if (sh.getLastRow() < 2) return totals;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (r[0] === '') return;
    var bc = String(r[1]);
    totals[bc] = Math.round(((totals[bc] || 0) + (Number(r[3]) || 0)) * 1000) / 1000;
  });
  return totals;
}

function push(ss, b) {
  var now = new Date();
  var dev = b.deviceId || '';
  var sales = b.sales || [], items = [];
  upsert(ss.getSheetByName('Sales'), 1, sales.map(function (s) {
    var cost = 0, qty = 0;
    s.items.forEach(function (l, i) {
      var kg = l.unit === 'kg';
      cost += Math.round((l.cost || 0) * l.qty); qty += kg ? 1 : l.qty;
      // Each weighing is its own line, so weighed lines get their position in the key.
      items.push([s.receiptId, dt(s.timestamp), l.barcode, l.name, kg ? l.qty + ' kg' : l.qty, afn(l.price), kg ? Math.round(l.price * l.qty / 100) : afn(l.price * l.qty), afn(l.cost), l.override ? ('Yes: ' + (l.approvedBy || '')) : '',
        s.receiptId + '|' + l.barcode + '|' + l.price + (kg ? '|' + i : '')]);
    });
    return [s.receiptId, dt(s.timestamp), s.shiftId, s.cashierName, afn(s.total), afn(s.cashReceived), afn(s.changeGiven), qty,
      s.items.map(function (l) { return l.name + ' ×' + l.qty + (l.unit === 'kg' ? ' kg' : ''); }).join('، '), s.voided ? 'Voided' : 'Completed', dev, now,
      afn(cost), s.voided ? 0 : afn(s.total - cost), s.voidedBy || '', afn(s.credit || 0), s.customerName || ''];
  }));
  upsert(ss.getSheetByName('Sale_Items'), 10, items);
  var prods = b.products || [];
  upsert(tab(ss, 'Stock_By_Device'), 1, prods.map(function (p) {
    return [String(p.barcode) + '|' + dev, String(p.barcode), dev, Number(p.stock) || 0, now];
  }));
  var totals = prods.length ? stockTotals(ss) : {};
  var inv = ss.getSheetByName('Inventory'), existing = {};
  if (prods.length && inv.getLastRow() > 1) {
    inv.getRange(2, 1, inv.getLastRow() - 1, 10).getValues().forEach(function (r) { if (r[0] !== '') existing[String(r[0])] = r; });
  }
  upsert(inv, 1, prods.map(function (p) {
    var bc = String(p.barcode), old = existing[bc], total = totals[bc] || 0;
    // Stock and price sync separately: the stock total is always updated, but name / price / cost / unit
    // are only taken from a till whose edit (priceAt) is newer than the sheet's (column H).
    var pAt = p.priceAt ? new Date(p.priceAt) : null;
    var oldAt = old && old[7] ? new Date(old[7]) : null;
    var takePrice = !old || (pAt && !isNaN(pAt) && (!oldAt || isNaN(oldAt) || pAt > oldAt));
    if (!takePrice) return [bc, old[1], old[2], old[3], total, old[5], old[6], old[7], dev, old[9]];
    var margin = p.price ? Math.round(((p.price - (p.cost || 0)) / p.price) * 100) : 0;
    return [bc, p.name, afn(p.price), afn(p.cost), total, margin, p.quick ? 1 : 0, pAt || dt(p.updatedAt), dev, p.unit === 'kg' ? 'kg' : 'pc'];
  }));
  upsert(ss.getSheetByName('Purchases'), 1, (b.receivings || []).map(function (r) {
    return [r.id, dt(r.timestamp), r.batchId, r.supplier, r.invoiceNo, String(r.barcode), r.name, r.unit === 'kg' ? r.qty + ' kg' : r.qty, afn(r.cost), afn(r.price), afn(r.qty * r.cost), r.userName, r.priceChanged ? 'Yes' : ''];
  }));
  upsert(ss.getSheetByName('Shift_Reconciliation'), 1, (b.shifts || []).map(function (s) {
    var closed = s.status === 'closed';
    var status = !closed ? 'Open' : (s.variance === 0 ? 'Balanced' : (s.variance < 0 ? 'Short' : 'Over'));
    return [s.shiftId, s.cashierName, dt(s.openedAt), dt(s.closedAt), afn(s.startingFloat), closed ? afn(s.netCash) : '', closed ? afn(s.payins) : '',
      closed ? afn(s.payouts) : '', closed ? afn(s.drops) : '', closed ? afn(s.expectedCash) : '', closed ? afn(s.countedCash) : '',
      closed ? afn(s.variance) : '', status, closed ? s.txCount : '', s.closedBy || '', s.denoms ? JSON.stringify(s.denoms) : '', closed ? afn(s.qarzIn || 0) : ''];
  }));
  upsert(ss.getSheetByName('Cash_Movements'), 1, (b.movements || []).map(function (m) {
    return [m.id, dt(m.timestamp), m.shiftId, m.type, afn(m.amount), m.note, m.userName, m.approvedBy];
  }));
  var custs = b.customers || [], led = b.ledger || [];
  if (custs.length || led.length) {
    upsert(tab(ss, 'Qarz_Ledger'), 1, led.map(function (x) {
      return [x.id, dt(x.timestamp), x.customerId, x.customerName || '', x.type, afn(x.amount), x.receiptId || '', x.shiftId || '', x.by || '', x.note || '', dev];
    }));
    upsert(tab(ss, 'Qarz_Customers'), 1, custs.map(function (c) {
      return [c.id, c.name || '', c.phone ? String(c.phone) : '', afn(c.limit || 0), 0, dt(c.updatedAt), c.deleted ? 'Deleted' : 'Active', dev];
    }));
    qarzBalances(ss);
  }
  return { ok: true, received: sales.length, features: FEATURES };
}

/** Recompute "Still owes" (column E) for every customer from the whole ledger tab. */
function qarzBalances(ss) {
  var led = tab(ss, 'Qarz_Ledger'), cus = tab(ss, 'Qarz_Customers'), owed = {};
  if (led.getLastRow() > 1) {
    led.getRange(2, 1, led.getLastRow() - 1, 6).getValues().forEach(function (r) {
      if (r[0] === '') return;
      owed[String(r[2])] = Math.round(((owed[String(r[2])] || 0) + (Number(r[5]) || 0)) * 100) / 100;
    });
  }
  var n = cus.getLastRow() - 1;
  if (n < 1) return;
  var ids = cus.getRange(2, 1, n, 1).getValues();
  cus.getRange(2, 5, n, 1).setValues(ids.map(function (r) { return [owed[String(r[0])] || 0]; }));
}

function sha256hex(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/** Reads the Users tab. PINs never leave the sheet in plain text — only salted SHA-256 hashes. */
function users(ss) {
  var sh = ss.getSheetByName('Users');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().filter(function (r) {
    return r[0] && /^\d{4,6}$/.test(String(r[2]).trim());
  }).map(function (r) {
    var role = String(r[1]).trim().toLowerCase();
    role = (role === 'admin' || role === 'مدیر') ? 'admin' : 'cashier';
    var salt = Utilities.getUuid();
    var active = !(r[3] === false || String(r[3]).toUpperCase() === 'FALSE' || String(r[3]) === 'غیرفعال');
    return { name: String(r[0]).trim(), role: role, salt: salt, pinHash: sha256hex(salt + ':' + String(r[2]).trim()), active: active };
  });
}

/**
 * Lets the owner edit names/prices in the Inventory tab and pull them to the till.
 * Stock: a starting count typed into the sheet (no till owns it yet) is handed to the first till that
 * pulls it and recorded under that till; every other till gets 0, so the store total is never counted twice.
 */
function products(ss, dev) {
  var sh = ss.getSheetByName('Inventory');
  if (!sh || sh.getLastRow() < 2) return [];
  var owned = stockTotals(ss), claims = [], now = new Date();
  var list = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) {
    var unit = /^\s*(kg|کیلو)/i.test(String(r[9] || '')) ? 'kg' : 'pc';
    var bc = String(r[0]), stock = 0;
    if (!(bc in owned) && dev) { stock = Number(r[4]) || 0; claims.push([bc + '|' + dev, bc, dev, stock, now]); owned[bc] = stock; }
    return { barcode: bc, name: String(r[1]), price: Math.round(Number(r[2]) * 100), cost: Math.round(Number(r[3]) * 100), stock: stock, unit: unit };
  });
  upsert(tab(ss, 'Stock_By_Device'), 1, claims);
  return list;
}


// ---------- easy setup: menu + pairing QR ----------
/** Simple trigger: adds the «صندوق دری» menu when the Sheet opens. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('صندوق دری')
    .addItem('راه‌اندازی', 'setup')
    .addItem('QR اتصال', 'showPairing')
    .addToUi();
}

/** Same format the app reads (parsePairing in js/logic.js). */
function pairingPayload(url, token) { return 'DPOS|S|' + url + '|' + token; }

/** Shows the QR the phone scans in Settings › «اتصال با QR». Only Sheet editors can open this menu. */
function showPairing() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('SYNC_TOKEN');
  if (!token) { setup(); token = props.getProperty('SYNC_TOKEN'); }
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    ui.alert('اول Deploy کنید',
      'Extensions › Apps Script › Deploy › New deployment › ⚙ Web app\nExecute as: Me · Who has access: Anyone › Deploy\nبعد دوباره «QR اتصال» را بزنید.', ui.ButtonSet ? ui.ButtonSet.OK : undefined);
    return;
  }
  var html = HtmlService.createHtmlOutput(pairingHtml(pairingPayload(url, token), url, token)).setWidth(420).setHeight(560);
  ui.showModalDialog(html, 'اتصال گوشی');
}

function htmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** Dialog page: the QR is drawn in the browser (qrcode-generator, MIT), so the key is never sent to any QR service. */
function pairingHtml(payload, url, token) {
  var js = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return '<!doctype html><html dir="rtl"><head><meta charset="utf-8">' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>' +
    '<style>body{font-family:Tahoma,sans-serif;text-align:center;margin:8px}#q svg{width:300px;height:300px}code{direction:ltr;display:block;word-break:break-all;font-size:11px;background:#f2f4f9;padding:6px;border-radius:6px;margin:4px 0}</style></head><body>' +
    '<p><b>در گوشی: تنظیمات › «اتصال با QR» › این را اسکن کنید</b></p><div id="q"></div>' +
    '<p style="color:#a00">این QR کلید فروشگاه است — به کسی نشان ندهید.</p>' +
    '<details><summary>وارد کردن دستی</summary><code>' + htmlEsc(url) + '</code><code>' + htmlEsc(token) + '</code></details>' +
    '<script>var q=qrcode(0,"M");q.addData(' + js + ');q.make();document.getElementById("q").innerHTML=q.createSvgTag({cellSize:6,margin:2});</script>' +
    '</body></html>';
}
