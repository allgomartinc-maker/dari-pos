// Online-only part: pushes queued records to the Google Apps Script web app and pulls users / prices.
// Everything else works without internet. Records stay synced=0 until the server answers {ok:true}.
import { db, getSettings, setSetting } from './db.js';

const TABLES = ['sales', 'receivings', 'shifts', 'movements', 'products'];
const BATCH = 200;
let running = false;
const listeners = new Set();

export function onSyncChange(fn) { listeners.add(fn); }
function emit(state) { listeners.forEach((fn) => fn(state)); }

async function post(url, body) {
  // text/plain keeps this a "simple" CORS request (no preflight), which Apps Script supports.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('پاسخ نامعتبر از گوگل شیت'); }
  if (!json.ok) throw new Error(json.error || 'خطای سرور');
  return json;
}

export async function syncNow({ pull = true } = {}) {
  if (running) return { skipped: true };
  const s = await getSettings();
  if (!s.webhookUrl) return { skipped: true, reason: 'no-url' };
  if (!navigator.onLine) return { skipped: true, reason: 'offline' };
  running = true;
  emit({ running: true });
  let sent = 0;
  try {
    for (;;) {
      const payload = { action: 'push', token: s.syncToken, deviceId: s.deviceId, storeName: s.storeName };
      let any = false;
      for (const t of TABLES) {
        payload[t] = await db[t].where('synced').equals(0).limit(BATCH).toArray();
        if (payload[t].length) any = true;
      }
      if (!any) break;
      await post(s.webhookUrl, payload);
      // Only mark rows that were not edited while the request was in flight.
      for (const t of TABLES) {
        for (const row of payload[t]) {
          const key = db[t].schema.primKey.keyPath;
          const cur = await db[t].get(row[key]);
          if (cur && cur.updatedAt === row.updatedAt) { await db[t].update(row[key], { synced: 1 }); sent++; }
        }
      }
    }
    if (pull) await pullUsers(s);
    await setSetting('lastSyncAt', new Date().toISOString());
    await setSetting('lastSyncError', null);
    emit({ running: false, ok: true, sent });
    return { ok: true, sent };
  } catch (err) {
    await setSetting('lastSyncError', String(err.message || err));
    emit({ running: false, ok: false, error: err.message });
    return { ok: false, error: err.message };
  } finally {
    running = false;
  }
}

export async function pullUsers(s) {
  const res = await post(s.webhookUrl, { action: 'users', token: s.syncToken, deviceId: s.deviceId });
  if (!Array.isArray(res.users)) return 0;
  await db.transaction('rw', db.users, async () => {
    await db.users.where('source').equals('sheet').delete();
    for (const u of res.users) {
      if (!u.name || !u.pinHash || !['admin', 'cashier'].includes(u.role)) continue;
      await db.users.put({ id: 'sheet:' + u.name, name: u.name, role: u.role, salt: u.salt,
        pinHash: u.pinHash, active: u.active !== false, source: 'sheet' });
    }
  });
  return res.users.length;
}

// Admin action: take names / prices / costs from the sheet's Inventory tab. Local stock is kept.
export async function pullProducts() {
  const s = await getSettings();
  if (!s.webhookUrl) throw new Error('آدرس گوگل شیت تنظیم نشده');
  const res = await post(s.webhookUrl, { action: 'products', token: s.syncToken, deviceId: s.deviceId });
  let n = 0;
  await db.transaction('rw', db.products, async () => {
    for (const p of res.products || []) {
      if (!p.barcode) continue;
      const cur = await db.products.get(String(p.barcode));
      await db.products.put({
        barcode: String(p.barcode), name: String(p.name || cur?.name || ''), price: num(p.price ?? cur?.price),
        cost: num(p.cost ?? cur?.cost), stock: cur ? cur.stock : num(p.stock), quick: cur?.quick || 0,
        updatedAt: cur?.updatedAt || new Date().toISOString(), synced: 1
      });
      n++;
    }
  });
  return n;
}

const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

export function startAutoSync() {
  window.addEventListener('online', () => syncNow());
  setInterval(() => { if (navigator.onLine) syncNow(); }, 60_000);
  if (navigator.onLine) setTimeout(() => syncNow(), 2000);
}
