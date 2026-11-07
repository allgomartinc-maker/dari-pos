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
    'Change / باقی', 'Items / تعداد', 'Items Summary / اجناس', 'Status / وضعیت', 'Device / دستگاه', 'Synced At / زمان همگام', 'Cost / قیمت خرید', 'Profit / مفاد', 'Voided By / باطل توسط'],
  Sale_Items: ['Receipt ID / شماره رسید', 'Time / زمان', 'Barcode / بارکد', 'Item / جنس', 'Qty / تعداد', 'Price / قیمت', 'Line Total / مجموع', 'Unit Cost / قیمت خرید', 'Price Override / تغییر قیمت', 'Key'],
  Inventory: ['Barcode / بارکد', 'Name / نام', 'Price / قیمت فروش', 'Cost / قیمت خرید', 'Stock (all tills) / موجودی کل', 'Margin % / مفاد', 'Quick / سریع', 'Updated / به‌روز شده', 'Device / دستگاه', 'Unit / واحد (pc / kg)'],
  Purchases: ['ID', 'Time / زمان', 'Batch / محموله', 'Supplier / عرضه‌کننده', 'Invoice / فاکتور', 'Barcode / بارکد', 'Item / جنس', 'Qty / تعداد', 'Unit Cost / قیمت خرید', 'Retail / قیمت فروش', 'Line Cost / مجموع', 'Received By / دریافت کننده', 'Price Changed / تغییر قیمت'],
  Shift_Reconciliation: ['Shift ID / شفت', 'Cashier / صندوقدار', 'Opened / باز شد', 'Closed / بسته شد', 'Start Float / پول آغاز', 'Net Cash Sales / فروش خالص', 'Pay-ins / افزوده',
    'Payouts / مصارف', 'Drops / برداشت', 'Expected / متوقع', 'Counted / شمارش', 'Variance / تفاوت', 'Status / وضعیت', 'Transactions / معاملات', 'Closed By / بسته کننده', 'Denominations / نوت‌ها'],
  Cash_Movements: ['ID', 'Time / زمان', 'Shift / شفت', 'Type / نوع', 'Amount / مبلغ', 'Note / یادداشت', 'User / کاربر', 'Approved By / تأیید'],
  Users: ['Name / نام', 'Role (admin / cashier)', 'PIN / رمز', 'Active / فعال (TRUE/FALSE)'],
  // Each till reports only its own stock here; Inventory's stock column is the sum, so tills never overwrite each other.
  Stock_By_Device: ['Key', 'Barcode / بارکد', 'Device / دستگاه', 'Stock / موجودی این دستگاه', 'Updated / به‌روز شده']
};

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold').setBackground('#d9ead3');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  });
  // Keep barcodes / PINs as text so leading zeros survive (012000000133, 0123)
  [['Inventory', 'A:A'], ['Purchases', 'F:F'], ['Sale_Items', 'C:C'], ['Sale_Items', 'J:J'], ['Users', 'C:C'], ['Stock_By_Device', 'A:B']].forEach(function (x) {
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
    if (body.action === 'users') return json({ ok: true, users: users(ss) });
    if (body.action === 'products') return json({ ok: true, products: products(ss, body.deviceId || '') });
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
      afn(cost), s.voided ? 0 : afn(s.total - cost), s.voidedBy || ''];
  }));
  upsert(ss.getSheetByName('Sale_Items'), 10, items);
  var prods = b.products || [];
  upsert(tab(ss, 'Stock_By_Device'), 1, prods.map(function (p) {
    return [String(p.barcode) + '|' + dev, String(p.barcode), dev, Number(p.stock) || 0, now];
  }));
  var totals = prods.length ? stockTotals(ss) : {};
  upsert(ss.getSheetByName('Inventory'), 1, prods.map(function (p) {
    var margin = p.price ? Math.round(((p.price - (p.cost || 0)) / p.price) * 100) : 0;
    return [String(p.barcode), p.name, afn(p.price), afn(p.cost), totals[String(p.barcode)] || 0, margin, p.quick ? 1 : 0, dt(p.updatedAt), dev, p.unit === 'kg' ? 'kg' : 'pc'];
  }));
  upsert(ss.getSheetByName('Purchases'), 1, (b.receivings || []).map(function (r) {
    return [r.id, dt(r.timestamp), r.batchId, r.supplier, r.invoiceNo, String(r.barcode), r.name, r.unit === 'kg' ? r.qty + ' kg' : r.qty, afn(r.cost), afn(r.price), afn(r.qty * r.cost), r.userName, r.priceChanged ? 'Yes' : ''];
  }));
  upsert(ss.getSheetByName('Shift_Reconciliation'), 1, (b.shifts || []).map(function (s) {
    var closed = s.status === 'closed';
    var status = !closed ? 'Open' : (s.variance === 0 ? 'Balanced' : (s.variance < 0 ? 'Short' : 'Over'));
    return [s.shiftId, s.cashierName, dt(s.openedAt), dt(s.closedAt), afn(s.startingFloat), closed ? afn(s.netCash) : '', closed ? afn(s.payins) : '',
      closed ? afn(s.payouts) : '', closed ? afn(s.drops) : '', closed ? afn(s.expectedCash) : '', closed ? afn(s.countedCash) : '',
      closed ? afn(s.variance) : '', status, closed ? s.txCount : '', s.closedBy || '', s.denoms ? JSON.stringify(s.denoms) : ''];
  }));
  upsert(ss.getSheetByName('Cash_Movements'), 1, (b.movements || []).map(function (m) {
    return [m.id, dt(m.timestamp), m.shiftId, m.type, afn(m.amount), m.note, m.userName, m.approvedBy];
  }));
  return { ok: true, received: sales.length };
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
