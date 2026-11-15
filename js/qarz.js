// Qarz (customer credit). A customer's balance is always the sum of their ledger entries:
// sale (+ put on qarz), payment (− paid), void (− a qarz sale undone, or + an overpayment undone), adjust (± manager, with a note).
// Money is pul (1 AFN = 100 pul).
import { randomId, formatMoney, dariDate, toLatinDigits } from './logic.js';

export const LEDGER_TYPES = ['sale', 'payment', 'void', 'adjust'];

export function balanceOf(entries, customerId) {
  let b = 0;
  for (const x of entries) if (x.customerId === customerId) b += x.amount || 0;
  return b;
}

/** customerId → { balance, lastAt } in one pass (for the list screen). */
export function balancesById(entries) {
  const m = new Map();
  for (const x of entries) {
    const r = m.get(x.customerId) || { balance: 0, lastAt: '' };
    r.balance += x.amount || 0;
    if (x.timestamp > r.lastAt) r.lastAt = x.timestamp;
    m.set(x.customerId, r);
  }
  return m;
}

/** Cash covers this purchase first; anything extra pays down the old qarz. */
export function splitQarzPayment({ total, cash, balance = 0 }) {
  const c = Math.max(0, Math.round(cash || 0));
  const cashReceived = Math.min(c, total);
  const credit = total - cashReceived;
  const overpaid = c - cashReceived;
  return { cashReceived, credit, overpaid, newBalance: balance + credit - overpaid, overBalance: overpaid > Math.max(balance, 0) };
}

export function overLimit(customer, newBalance) {
  return (customer?.limit || 0) > 0 && newBalance > customer.limit;
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const digits = (s) => toLatinDigits(String(s ?? '')).replace(/\D/g, '');

/** Name (trimmed, any case) or phone digits (Dari or Latin). Deleted customers show only while they still owe or are owed. Highest debt first. */
export function findCustomers(customers, query, balances = new Map()) {
  const q = norm(query), qd = digits(query);
  const bal = (c) => balances.get(c.id)?.balance || 0;
  return customers
    .filter((c) => !c.deleted || bal(c) !== 0)
    .filter((c) => !q || norm(c.name).includes(q) || (qd.length >= 3 && digits(c.phone).includes(qd)))
    .sort((a, b) => bal(b) - bal(a) || norm(a.name).localeCompare(norm(b.name)));
}

export function ledgerEntry({ customer, type, amount, receiptId, shiftId, by, note }) {
  if (!LEDGER_TYPES.includes(type)) throw new Error('unknown ledger type: ' + type);
  if (type === 'adjust' && !String(note ?? '').trim()) throw new Error('برای اصلاح حساب یادداشت لازم است');
  const ts = new Date().toISOString();
  return {
    id: randomId(), customerId: customer.id, customerName: customer.name, timestamp: ts, type, amount: Math.round(amount),
    ...(receiptId ? { receiptId } : {}), ...(shiftId ? { shiftId } : {}), by: by || '', ...(note ? { note: String(note).trim() } : {}),
    updatedAt: ts, synced: 0
  };
}

/** For reports: qarz given (sales minus voids) and collected (payments) between the range's days. */
export function qarzTotals(entries, range) {
  const a = range.start.toISOString(), b = range.end.toISOString();
  let given = 0, collected = 0;
  for (const x of entries) {
    if (x.timestamp < a || x.timestamp >= b) continue;
    // A negative void undoes qarz given; a positive void undoes a payment (extra cash handed back).
    if (x.type === 'sale' || (x.type === 'void' && x.amount < 0)) given += x.amount;
    else if (x.type === 'payment' || (x.type === 'void' && x.amount > 0)) collected -= x.amount;
  }
  return { given, collected };
}

export const LEDGER_LABEL = { sale: 'خرید قرض', payment: 'دریافت', void: 'باطل', adjust: 'اصلاح' };

/** Short Dari account statement to send by WhatsApp. */
export function statementText({ storeName, customer, entries, balance }) {
  const owed = balance >= 0 ? `مانده قرض: ${formatMoney(balance)}` : `دکان بدهکار است: ${formatMoney(-balance)}`;
  const lines = [`حساب قرض — ${storeName || ''}`.trim(), customer.name, owed, ''];
  const recent = [...entries].sort((x, y) => (x.timestamp < y.timestamp ? 1 : -1)).slice(0, 15);
  for (const x of recent) lines.push(`${dariDate(x.timestamp, { time: false })} · ${LEDGER_LABEL[x.type] || x.type} · ${formatMoney(Math.abs(x.amount))}`);
  return lines.join('\n');
}

/** What voiding a sale does to qarz: ledger amounts to add (as type 'void') and cash handed back from the current drawer.
 *  The qarz part comes off the account; extra cash that paid old qarz is undone and returned to the customer. */
export function voidQarzEffects(sale) {
  if (!sale.customerId) return { ledger: [], drawerOut: 0 };
  const ledger = [];
  if (sale.credit) ledger.push(-sale.credit);
  if (sale.overpaidToQarz) ledger.push(sale.overpaidToQarz);
  return { ledger, drawerOut: sale.overpaidToQarz || 0 };
}

/** Is there already a (not deleted) customer with this name? Case and extra spaces ignored; `exceptId` skips the one being edited. */
export function sameNameExists(customers, name, exceptId) {
  const n = norm(name);
  return !!n && customers.some((c) => !c.deleted && c.id !== exceptId && norm(c.name) === n);
}

/** Manager approval only when this sale puts new qarz on an account that ends above its limit (paying down never needs it). */
export function needsLimitApproval(customer, split) {
  return split.credit > 0 && overLimit(customer, split.newBalance);
}
