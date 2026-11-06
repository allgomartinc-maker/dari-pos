// IndexedDB storage via Dexie (vendor/dexie.min.js, Apache-2.0). Everything lives on the device.
// Booleans can't be indexed in IndexedDB, so "synced" is stored as 0 / 1.
import { hashPin, randomId } from './logic.js';

export const db = new window.Dexie('DariPOS');

db.version(1).stores({
  products: '&barcode, name, updatedAt, synced, quick',
  sales: '&receiptId, shiftId, timestamp, synced, voided',
  receivings: '&id, batchId, timestamp, synced',
  shifts: '&shiftId, status, openedAt, synced',
  movements: '&id, shiftId, timestamp, synced',
  users: '&id, name, source',
  settings: '&key'
});

const DEFAULTS = {
  storeName: 'فروشگاه من',
  storeAddress: '',
  storePhone: '',
  receiptFooter: 'تشکر از خرید شما',
  deviceId: 'T1',
  webhookUrl: '',
  syncToken: '',
  paperWidth: 80,
  lowStock: 5,
  autoPrint: false,
  receiptSeq: 0,
  internalSeq: 0,
  setupDone: false,
  lastSyncAt: null,
  lastSyncError: null
};

export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row ? row.value : DEFAULTS[key];
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

export async function getSettings() {
  const out = { ...DEFAULTS };
  for (const r of await db.settings.toArray()) out[r.key] = r.value;
  return out;
}

export async function nextSeq(key) {
  return db.transaction('rw', db.settings, async () => {
    const n = ((await getSetting(key)) || 0) + 1;
    await setSetting(key, n);
    return n;
  });
}

export async function createUser({ name, role, pin, source = 'local' }) {
  const salt = randomId(16);
  const user = { id: randomId(10), name, role, salt, pinHash: await hashPin(pin, salt), active: true, source };
  await db.users.put(user);
  return user;
}

export async function setUserPin(user, pin) {
  const salt = randomId(16);
  await db.users.update(user.id, { salt, pinHash: await hashPin(pin, salt) });
}

export async function findUserByPin(pin) {
  for (const u of await db.users.toArray()) {
    if (!u.active) continue;
    if ((await hashPin(pin, u.salt)) === u.pinHash) return u;
  }
  return null;
}

export async function pinInUse(pin, exceptId) {
  const u = await findUserByPin(pin);
  return !!u && u.id !== exceptId;
}

export async function openShift() {
  return db.shifts.where('status').equals('open').first();
}

export async function pendingCount() {
  const [a, b, c, d, e] = await Promise.all([
    db.sales.where('synced').equals(0).count(),
    db.receivings.where('synced').equals(0).count(),
    db.shifts.where('synced').equals(0).count(),
    db.movements.where('synced').equals(0).count(),
    db.products.where('synced').equals(0).count()
  ]);
  return a + b + c + d + e;
}

export async function exportBackup() {
  const out = { app: 'DariPOS', version: 1, exportedAt: new Date().toISOString(), tables: {} };
  for (const t of db.tables) out.tables[t.name] = await t.toArray();
  return out;
}

export async function importBackup(data) {
  if (!data || data.app !== 'DariPOS' || !data.tables) throw new Error('فایل پشتیبان معتبر نیست');
  // Coerce numeric fields so a hand-edited backup can't smuggle markup into number cells.
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
  for (const p of data.tables.products || []) { p.barcode = String(p.barcode); p.name = String(p.name ?? ''); p.price = num(p.price); p.cost = num(p.cost); p.stock = num(p.stock); }
  for (const s of data.tables.sales || []) {
    for (const k of ['total', 'cashReceived', 'changeGiven']) s[k] = num(s[k]);
    s.items = (s.items || []).map((l) => ({ ...l, name: String(l.name ?? ''), qty: num(l.qty), price: num(l.price), cost: num(l.cost) }));
  }
  for (const s of data.tables.shifts || []) {
    for (const k of ['startingFloat', 'countedCash', 'expectedCash', 'variance', 'netCash', 'payouts', 'drops', 'payins', 'grossSales', 'voidTotal', 'txCount']) if (k in s) s[k] = num(s[k]);
    if (s.varianceStatus && !['balanced', 'short', 'over'].includes(s.varianceStatus)) s.varianceStatus = '';
  }
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) {
      if (!Array.isArray(data.tables[t.name])) continue;
      await t.clear();
      await t.bulkPut(data.tables[t.name]);
    }
  });
}

export async function requestPersistentStorage() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
