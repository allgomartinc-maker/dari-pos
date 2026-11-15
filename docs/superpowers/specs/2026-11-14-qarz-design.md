# Qarz (customer credit) — design

Date: 2026-11-14 · App: صندوق دری (dari-pos) · Status: approved by owner 2026-11-14

## Why

Afghan shops sell on qarz (credit) to known customers every day. Today the app can only finish a sale when it is fully paid in cash, so shops keep qarz in a notebook. The owner wants:

- to put a sale (all or part of it) on a person's qarz account;
- to look up a person by name and see the total they owe, with every purchase and payment;
- to record part payments, showing "received" and "still owes";
- new qarz purchases to add to the same running account, which never closes;
- to see all of this when he is not in the shop. That part is a separate later project (an owner page). This build only gives him two Google Sheet tabs.

## Goals

1. Sell on qarz at checkout, either fully or with some cash paid now.
2. Customer accounts with a running balance, built from a ledger of purchases, payments, voids and manager adjustments.
3. Record payments (full or partial) from a customer. The cash counts in the shift that receives it.
4. Show the balance everywhere it matters: when picking the customer, on the receipt, on the customer's page, and in the qarz list.
5. Reports show qarz given and qarz collected for the chosen dates, plus total still owed.
6. Google Sheet gets `Qarz_Customers` and `Qarz_Ledger` tabs so the owner can see qarz remotely.
7. Backups and phone moves carry qarz data.

## Non-goals (this build)

- Sharing balances between several tills. Qarz lives on the one phone that gives it. A second till made with "move → old phone still selling" starts with no customers.
- The owner's remote page (option B). That is the next project.
- Interest, due dates, automatic reminders, SMS.
- Qarz for suppliers (the shop owing others).

## Anti-goals (would be a failure even if it "works")

- The balance on the list, the customer page, the receipt and the Sheet disagreeing.
- Qarz sales making the shift's expected cash too high, or qarz payments not counted, so cashiers look short or over.
- A cashier able to erase or reduce someone's debt without the manager.
- Practice (🧪) items ending up on a real customer's account.

## Constraints

- Offline-first, single device; everything in IndexedDB (Dexie). The schema moves to version 2 and adds tables. Existing data must survive the upgrade.
- Money is stored as integer pul. UI is Dari, RTL, big buttons for low-literacy staff, one tap where possible.
- Must work on every phone (iPhone and Android).
- The Code.gs change only reaches a shop after the owner re-pastes it and deploys a new version. The app must not break against the old script, which ignores unknown fields.
- Customer names and phones are personal data. They stay on the phone and in the owner's own Sheet only. Receipts print the name, never the phone.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **Picked** | **Ledger.** A `customers` table plus a `ledger` table of signed entries (+ owed, − paid). The balance is always the sum of a customer's entries. | Every number is explainable, history comes free, and it merges cleanly later if several tills ever share qarz. Sums are computed on read, which is fine at shop scale (hundreds of customers, thousands of entries). |
| Rejected | A stored balance on the customer, updated on each event | Simpler reads, but it drifts after a void or edit, has no history, and two tills could never merge it. |
| Rejected | Qarz as a "payment method" field on sales only | No place for payments or adjustments, and balances would come from scanning sales. Breaks goals 2–3. |

Owner-side: the owner picked **A now** (Sheet tabs, part of this build) and **B later** (private owner page, its own project). He rejected C (owner logs into the POS app on his own phone).

## Design

### Data

- `customers`: `id`, `name`, `phone` (optional), `limit` (optional, pul; 0 = no limit), `note`, `createdAt`, `updatedAt`, `synced`.
- `ledger`: `id`, `customerId`, `customerName` (copied at the time, for the Sheet and history), `timestamp`, `type`, `amount`, `receiptId?`, `shiftId?`, `by` (user name), `note?`, `updatedAt`, `synced`.
  - `type` is one of `sale` (+), `payment` (−), `void` (− reverses a sale), `adjust` (±, manager only, note required).
- `sales` gain `credit` (pul put on qarz; 0 or missing = cash sale), `customerId` and `customerName`. For a qarz sale, `cashReceived` = cash paid now, `changeGiven` = 0, and `total` = `cashReceived` + `credit`.
- The balance is the sum of `amount` over a customer's ledger. One pure function (in logic.js, tested) computes it and is used by every screen.

### Checkout

- The pay panel gets a **«قرض»** button next to the cash entry.
- It opens a sheet with:
  - a search box (name or phone) and a list of matches, each showing its current balance;
  - **«مشتری نو»** (new customer): name required, phone optional.
- After a customer is picked, the sheet shows:
  - their current balance;
  - a «نقد حالا» (cash now) field, 0 by default, with **no upper limit**;
  - live lines showing how the cash splits and the total owed afterwards.
- **Rule: cash covers this purchase first; anything extra pays down the customer's old qarz.** (Approved by the owner, 2026-11-14.)
  - cash < total: the sale is recorded with `cashReceived` = cash and `credit` = total − cash, plus a `sale` ledger entry of +credit.
  - cash = total: a plain paid sale linked to the customer, with no ledger entry.
  - cash > total: the sale is fully paid (`cashReceived` = total, `credit` = 0, `overpaidToQarz` = cash − total). There is also a `payment` ledger entry of −(cash − total), with the receipt ID, plus a `qarz` shift movement for the same amount. No change is given.
  - If the extra is more than the old balance, ask "more than owed — still record it?" before confirming.
  - Example: owes 2,000, buys 500, gives 1,000 → 500 for the purchase, 500 off the qarz, still owes 1,500.
- Confirming completes the sale. It writes the sale and a `sale` ledger entry in one transaction, adjusts stock as usual, and shows the done screen with the qarz lines instead of change.
- Blocked cases:
  - The cart has practice (🧪) items.
  - No shift is open.
  - Going over the customer's `limit` needs the manager PIN. The sale records who approved it.

### Customer payments

- From the customer's page: **«دریافت پول»** (receive money), with the amount and «همه» (all) as a shortcut.
- This writes a `payment` ledger entry and a shift **movement** of new type `qarz` for the same amount.
- `shiftExpected` counts `qarz` movements as cash in. Shift close and the Z report show a «دریافت قرض» line.
- A shift must be open.
- Paying more than the balance asks "more than owed — still record it?" and the balance goes negative (the shop owes them).
- A small payment slip can be printed or Bluetooth-printed: shop, customer, received, still owes.

### Voids and corrections

- Voiding a qarz sale (manager, existing flow) adds a `void` ledger entry of −credit. Only the cash part counts as returned cash.
- A manager **«اصلاح حساب»** (adjust account) adds ±amount with a required note, for example forgiving a debt or entering an opening balance from the old notebook.
- Nothing is ever deleted from the ledger.
- A customer can be deleted only when their balance is 0 and only with the manager PIN. Their ledger stays for history.

### Qarz screen (new nav tab «قرض», all roles)

- Top: «مجموع قرض مردم» (total owed to the shop).
- A search box, then the list sorted by who owes most: name, phone, balance, last activity.
- The customer page shows:
  - the balance, big;
  - «دریافت پول» (receive money);
  - history, newest first: date, what happened, receipt (tap to open), amount, and the running balance after it;
  - «ارسال حساب» (send account): shares a short Dari text statement through the phone's share menu (WhatsApp etc.);
  - manager-only actions: edit name/phone/limit, «اصلاح حساب», delete.

### Receipts

A sale linked to a customer prints:
- «نقد دریافتی» (cash received)
- «قرض این رسید» (qarz on this receipt, if any)
- «از قرض کم شد» (taken off the qarz, if any)
- «مانده کل قرض — {name}» (total still owed, stored on the sale at the time so reprints match)

### Reports (date range)

- New stats:
  - «قرض داده شده» (qarz given: sum of `sale` entries in range, minus `void`s)
  - «قرض گرفته شده» (qarz collected: `payment`s in range)
  - «مجموع قرض مردم» (total owed now)
- Net sales stay all sales (cash and qarz). A small line splits them into cash and qarz.
- The CSV adds `credit` and `customer` columns to the line rows, and the qarz totals to the summary block.

### Google Sheet (Code.gs)

- New tabs:
  - `Qarz_Customers`: ID, name, phone, limit, still owes, last activity, device.
  - `Qarz_Ledger`: ID, time, customer ID, name, type, amount (Afghani), receipt, shift, by, note, device.
- The push upserts both by ID. "Still owes" is recomputed from the ledger tab after each push.
- The `Sales` tab gets two columns at the end: Credit / قرض and Customer / مشتری. Existing columns don't move.
- `Cash_Movements` gets the `qarz` type rows as usual.

### Backup and move

- New tables are included automatically.
- `cleanBackup` coerces ledger `amount`, customer `limit` and sale `credit` to whole pul.
- `prepareSecondTill` empties `customers` and `ledger`.

## Settled after review (builder's calls, owner to check)

1. **Old script safety.** The new Code.gs answers `features: ['qarz']`. Until a push response includes it, the app sends `customers` and `ledger` but does **not** mark them synced, so nothing is lost before the owner re-pastes the script. Settings shows «اسکریپت گوگل شیت را به‌روز کنید» (update the Google Sheet script) while qarz rows are waiting for it.
2. **Voiding a part-qarz sale** works like today's cash void. The goods come back, the cash part is handed back and drops out of that sale's shift, and the ledger gets `void` = −credit.
3. **Deleting a customer** is a soft delete (`deleted: 1`, hidden on the phone, pushed with Status «Deleted» in `Qarz_Customers`). If a later void or adjust makes their balance non-zero, they show again.
4. **Shift record** gets `qarzIn` (qarz cash collected in that shift). `Shift_Reconciliation` gets a column at the end, so pay-ins, payouts, drops, qarz and expected add up.
5. **Restoring a backup without qarz tables** (made before this version) clears `customers` and `ledger`. A backup is a full snapshot; mixing would leave balances pointing at sales that no longer exist.
6. **Negative balances** are allowed and mean «دکان به مشتری بدهکار است» (the shop owes the customer). This happens after overpaying, or after voiding a sale that was already paid off. They show in a different colour in the list.

## Left to the builder

- Exact layout and wording of sheets beyond the labels above. Keep the existing visual language and big touch targets.
- Where the balance function lives and the Dexie indexes (`customers: &id, name, phone, synced`; `ledger: &id, customerId, timestamp, synced` is the expected shape).
- How the Sheet recomputes "still owes" (a script-side total, like `stockTotals`).
- Tests: balance math, sale + void + payment + adjust sequences, shift expected with qarz movements, cleanBackup/prepareSecondTill for the new tables, report totals, Code.gs push for both tabs.
