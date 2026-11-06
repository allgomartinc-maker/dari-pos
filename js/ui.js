// Small DOM helpers: escaping, toasts, modals, PIN prompt.
import { findUserByPin } from './db.js';
import { toDariDigits, toLatinDigits } from './logic.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 4500 : 2600);
}

export function modal(html, { onMount, dismiss = true } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  $('#modalRoot').appendChild(back);
  const close = () => back.remove();
  if (dismiss) {
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  const box = back.firstElementChild;
  onMount?.(box, close);
  const first = box.querySelector('[autofocus], input, button');
  first?.focus();
  return { el: box, close };
}

export function confirmBox(message, { okText = 'بلی', danger = false } = {}) {
  return new Promise((resolve) => {
    modal(`<h2>تأیید</h2><p>${esc(message)}</p>
      <div class="actions"><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button>
      <button class="btn" data-no>لغو</button></div>`, {
      dismiss: false,
      onMount: (m, close) => {
        m.querySelector('[data-ok]').onclick = () => { close(); resolve(true); };
        m.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
      }
    });
  });
}

// fields: [{ name, label, value, type, inputmode, options }]
export function formBox(title, fields, { okText = 'ذخیره' } = {}) {
  return new Promise((resolve) => {
    const inputs = fields.map((f) => {
      if (f.options) {
        return `<label class="field">${esc(f.label)}<select name="${f.name}">${f.options.map(([v, t]) =>
          `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
      }
      return `<label class="field">${esc(f.label)}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"
        ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.required ? 'required' : ''} autocomplete="off"></label>`;
    }).join('');
    modal(`<h2>${esc(title)}</h2><form class="stack">${inputs}
      <div class="actions"><button class="btn primary" type="submit">${esc(okText)}</button><button class="btn" type="button" data-no>لغو</button></div></form>`, {
      dismiss: false,
      onMount: (m, close) => {
        const form = m.querySelector('form');
        form.onsubmit = (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(form)); close(); resolve(v); };
        m.querySelector('[data-no]').onclick = () => { close(); resolve(null); };
      }
    });
  });
}

export function keypadHtml() {
  return `<div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${toDariDigits(n)}</button>`).join('')}
    <button type="button" data-k="C">پاک</button><button type="button" data-k="0">۰</button><button type="button" data-k="B">⌫</button></div>`;
}

// Binds a PIN pad inside `root`. Calls onSubmit(pin) when 4–6 digits entered and Enter/✓ pressed or 6 digits reached.
export function bindPinPad(root, onSubmit, { autoLen = 4 } = {}) {
  let pin = '';
  const dots = root.querySelector('.pin-dots');
  const draw = () => { dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join(''); };
  const press = async (k) => {
    if (k === 'C') pin = '';
    else if (k === 'B') pin = pin.slice(0, -1);
    else if (/^\d$/.test(k) && pin.length < 6) pin += k;
    draw();
    if (k === 'E' || (autoLen && pin.length === autoLen)) {
      const p = pin; pin = ''; draw();
      if (p.length >= 4) await onSubmit(p);
    }
  };
  root.addEventListener('click', (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) press(k); });
  const onKey = (e) => {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey);
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (root.closest('.modal-back') === null && document.querySelector('.modal-back')) return; // a modal is on top
    const k = toLatinDigits(e.key);
    if (/^\d$/.test(k)) press(k);
    else if (e.key === 'Backspace') press('B');
    else if (e.key === 'Enter') press('E');
  };
  document.addEventListener('keydown', onKey);
  draw();
}

// Ask for a PIN in a modal; resolves with the matching user (or null if cancelled).
export function askPin(title, { role } = {}) {
  return new Promise((resolve) => {
    modal(`<h2>${esc(title)}</h2><div class="pin-dots"></div>${keypadHtml()}
      <div class="actions"><button class="btn primary grow" data-k="E">تأیید</button><button class="btn" data-no>لغو</button></div>`, {
      dismiss: false,
      onMount: (m, close) => {
        m.querySelector('[data-no]').onclick = () => { close(); resolve(null); };
        bindPinPad(m, async (pin) => {
          const u = await findUserByPin(pin);
          if (!u || (role && u.role !== role)) { toast(role === 'admin' ? 'رمز مدیر نادرست است' : 'رمز نادرست است', 'err'); return; }
          close(); resolve(u);
        }, { autoLen: 0 });
      }
    });
  });
}

export function download(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}
