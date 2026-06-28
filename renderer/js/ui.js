// Reusable UI primitives: buttons, fields, modals, toasts, menus, tabs.
import { el, clear, appendChildren, escapeHtml } from './util.js';
import { icon } from './icons.js';

// ---------- Buttons ----------
export function button(label, opts = {}) {
  const b = el('button.btn', { type: 'button', title: opts.title || '' });
  if (opts.variant) b.classList.add('btn-' + opts.variant);
  if (opts.size) b.classList.add('btn-' + opts.size);
  if (opts.active) b.classList.add('active');
  if (opts.disabled) b.disabled = true;
  if (opts.icon) b.appendChild(icon(opts.icon, opts.iconSize || 16));
  if (label) b.appendChild(el('span', label));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  if (opts.id) b.id = opts.id;
  return b;
}

export function iconButton(name, opts = {}) {
  const b = el('button.icon-btn', { type: 'button', title: opts.title || '', 'aria-label': opts.title || name });
  if (opts.variant) b.classList.add('btn-' + opts.variant);
  if (opts.active) b.classList.add('active');
  if (opts.disabled) b.disabled = true;
  b.appendChild(icon(name, opts.size || 18));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

// ---------- Form fields ----------
export function field(label, control, opts = {}) {
  const f = el('label.field' + (opts.inline ? '.inline' : ''));
  if (opts.class) f.classList.add(...opts.class.split(' '));
  if (label) f.appendChild(el('span.field-label', label));
  f.appendChild(control);
  if (opts.hint) f.appendChild(el('span.field-hint', opts.hint));
  return f;
}

export function input(opts = {}) {
  const i = el('input.input', {
    type: opts.type || 'text',
    value: opts.value != null ? opts.value : '',
    placeholder: opts.placeholder || '',
  });
  if (opts.min != null) i.min = opts.min;
  if (opts.max != null) i.max = opts.max;
  if (opts.step != null) i.step = opts.step;
  if (opts.list) i.setAttribute('list', opts.list);
  if (opts.readonly) i.readOnly = true;
  if (opts.onInput) i.addEventListener('input', () => opts.onInput(i.value, i));
  if (opts.onChange) i.addEventListener('change', () => opts.onChange(i.value, i));
  if (opts.onEnter) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onEnter(i.value, i); });
  return i;
}

export function textarea(opts = {}) {
  const t = el('textarea.input.textarea', { placeholder: opts.placeholder || '', rows: opts.rows || 4 });
  t.value = opts.value != null ? opts.value : '';
  if (opts.onInput) t.addEventListener('input', () => opts.onInput(t.value, t));
  if (opts.onChange) t.addEventListener('change', () => opts.onChange(t.value, t));
  if (opts.autosize) { const fit = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }; t.addEventListener('input', fit); setTimeout(fit); }
  return t;
}

export function select(options, opts = {}) {
  const s = el('select.input.select');
  for (const o of options) {
    const val = typeof o === 'object' ? o.value : o;
    const lab = typeof o === 'object' ? o.label : o;
    const op = el('option', { value: val }, lab);
    if (val === opts.value) op.selected = true;
    s.appendChild(op);
  }
  if (opts.value != null) s.value = opts.value;
  if (opts.onChange) s.addEventListener('change', () => opts.onChange(s.value, s));
  return s;
}

export function checkbox(label, opts = {}) {
  const wrap = el('label.checkbox');
  const c = el('input', { type: 'checkbox' });
  c.checked = !!opts.checked;
  if (opts.onChange) c.addEventListener('change', () => opts.onChange(c.checked, c));
  wrap.appendChild(c);
  wrap.appendChild(el('span.checkbox-box'));
  if (label) wrap.appendChild(el('span', label));
  wrap._input = c; // NB: <label>.control is a read-only getter — don't assign it
  return wrap;
}

export function range(opts = {}) {
  const wrap = el('div.range');
  const r = el('input', { type: 'range', min: opts.min ?? 0, max: opts.max ?? 100, step: opts.step ?? 1 });
  r.value = opts.value ?? 0;
  const out = opts.showValue ? el('span.range-val', String(opts.format ? opts.format(r.value) : r.value)) : null;
  r.addEventListener('input', () => { if (out) out.textContent = opts.format ? opts.format(r.value) : r.value; if (opts.onInput) opts.onInput(parseFloat(r.value), r); });
  if (opts.onChange) r.addEventListener('change', () => opts.onChange(parseFloat(r.value), r));
  wrap.appendChild(r);
  if (out) wrap.appendChild(out);
  wrap.control = r;
  return wrap;
}

export function segmented(items, opts = {}) {
  const wrap = el('div.segmented');
  let current = opts.value;
  const btns = new Map();
  items.forEach((it) => {
    const val = typeof it === 'object' ? it.value : it;
    const lab = typeof it === 'object' ? it.label : it;
    const b = el('button.seg', { type: 'button' }, lab);
    if (val === current) b.classList.add('active');
    b.addEventListener('click', () => {
      current = val;
      btns.forEach((bb) => bb.classList.remove('active'));
      b.classList.add('active');
      if (opts.onChange) opts.onChange(val);
    });
    btns.set(val, b);
    wrap.appendChild(b);
  });
  wrap.select = (val) => { const b = btns.get(val); if (b) b.click(); };
  return wrap;
}

// ---------- Badges, pills, chips ----------
export function badge(text, opts = {}) {
  const b = el('span.badge', text);
  if (opts.color) b.style.setProperty('--badge', opts.color);
  if (opts.variant) b.classList.add('badge-' + opts.variant);
  return b;
}

export function chip(text, opts = {}) {
  const c = el('span.chip');
  if (opts.icon) c.appendChild(icon(opts.icon, 13));
  c.appendChild(el('span', text));
  if (opts.onRemove) {
    const x = el('button.chip-x', { type: 'button', title: 'Remove' });
    x.appendChild(icon('x', 12));
    x.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemove(); });
    c.appendChild(x);
  }
  if (opts.onClick) { c.classList.add('clickable'); c.addEventListener('click', opts.onClick); }
  if (opts.color) c.style.setProperty('--chip', opts.color);
  return c;
}

// ---------- Empty state / spinner ----------
export function empty(message, opts = {}) {
  const e = el('div.empty');
  if (opts.icon) e.appendChild(icon(opts.icon, 40, { class: 'empty-icon' }));
  e.appendChild(el('p.empty-msg', message));
  if (opts.hint) e.appendChild(el('p.empty-hint', opts.hint));
  if (opts.action) e.appendChild(opts.action);
  return e;
}

export function spinner(label) {
  const s = el('div.spinner-wrap');
  s.appendChild(el('div.spinner'));
  if (label) s.appendChild(el('span.dim', label));
  return s;
}

// ---------- Section header ----------
export function sectionHeader(title, opts = {}) {
  const h = el('div.section-header');
  const left = el('div.section-title');
  if (opts.icon) left.appendChild(icon(opts.icon, 18));
  left.appendChild(el('h2', title));
  if (opts.count != null) left.appendChild(badge(String(opts.count)));
  h.appendChild(left);
  if (opts.actions) { const a = el('div.section-actions'); appendChildren(a, opts.actions); h.appendChild(a); }
  return h;
}

export function card(opts = {}) {
  const c = el('div.card');
  if (opts.class) c.classList.add(...opts.class.split(' '));
  if (opts.onClick) { c.classList.add('clickable'); c.addEventListener('click', opts.onClick); }
  return c;
}

// ---------- Toast ----------
let toastHost = null;
export function toast(msg, opts = {}) {
  if (!toastHost) { toastHost = el('div.toast-host'); document.body.appendChild(toastHost); }
  const t = el('div.toast');
  if (opts.type) t.classList.add('toast-' + opts.type);
  const ic = { success: 'check', error: 'warn', warn: 'warn', info: 'info' }[opts.type] || 'info';
  t.appendChild(icon(ic, 16));
  t.appendChild(el('span.grow', msg));
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const timeout = opts.timeout ?? (opts.type === 'error' ? 5200 : 3000);
  const close = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); };
  if (timeout > 0) setTimeout(close, timeout);
  t.addEventListener('click', close);
  return close;
}

// ---------- Modal ----------
const modalStack = [];
export function modal(opts = {}) {
  const backdrop = el('div.modal-backdrop');
  const m = el('div.modal');
  if (opts.width) m.style.maxWidth = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
  if (opts.class) m.classList.add(...opts.class.split(' '));

  const head = el('div.modal-head');
  head.appendChild(el('h3.modal-title', opts.title || ''));
  const closeBtn = iconButton('x', { title: 'Close', size: 18 });
  head.appendChild(closeBtn);
  m.appendChild(head);

  const bodyWrap = el('div.modal-body');
  if (opts.body) appendChildren(bodyWrap, opts.body);
  m.appendChild(bodyWrap);

  const footer = el('div.modal-foot');
  m.appendChild(footer);

  backdrop.appendChild(m);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('in'));

  modalStack.push(backdrop);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('in');
    setTimeout(() => backdrop.remove(), 200);
    const i = modalStack.indexOf(backdrop); if (i >= 0) modalStack.splice(i, 1);
    if (opts.onClose) opts.onClose(result);
    document.removeEventListener('keydown', onKey);
  };
  // Only the top-most modal responds to Escape (so nested modals don't all close).
  const onKey = (e) => { if (e.key === 'Escape' && !opts.noEscape && modalStack[modalStack.length - 1] === backdrop) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', () => close());
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && !opts.noBackdropClose) close(); });

  const ctrl = {
    el: m, body: bodyWrap, footer, close,
    setTitle: (t) => { head.querySelector('.modal-title').textContent = t; },
    setBody: (...nodes) => { clear(bodyWrap); appendChildren(bodyWrap, nodes); },
    setFooter: (...nodes) => { clear(footer); appendChildren(footer, nodes); },
  };

  if (opts.actions) {
    for (const a of opts.actions) {
      const b = button(a.label, { variant: a.variant, icon: a.icon, onClick: () => { if (a.onClick) a.onClick(close); else close(a.value); } });
      footer.appendChild(b);
    }
  }
  return ctrl;
}

export function confirm(opts = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title: opts.title || 'Confirm',
      width: opts.width || 440,
      body: [el('p.modal-text', opts.message || 'Are you sure?')],
      noBackdropClose: false,
      onClose: () => resolve(false),
    });
    m.setFooter(
      button(opts.cancelLabel || 'Cancel', { variant: 'ghost', onClick: () => m.close() }),
      button(opts.okLabel || 'Confirm', { variant: opts.danger ? 'danger' : 'primary', onClick: () => { resolve(true); m.close(); } }),
    );
  });
}

export function promptText(opts = {}) {
  return new Promise((resolve) => {
    const control = opts.multiline
      ? textarea({ value: opts.value || '', placeholder: opts.placeholder || '', rows: opts.rows || 5 })
      : input({ value: opts.value || '', placeholder: opts.placeholder || '' });
    const m = modal({
      title: opts.title || 'Input',
      width: opts.width || 480,
      body: [opts.label ? el('p.modal-text', opts.label) : null, control].filter(Boolean),
      onClose: () => resolve(null),
    });
    setTimeout(() => { control.focus(); if (control.select) control.select(); }, 30);
    const submit = () => { resolve(control.value); m.close(); };
    if (!opts.multiline) control.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    m.setFooter(
      button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
      button(opts.okLabel || 'OK', { variant: 'primary', onClick: submit }),
    );
  });
}

// ---------- Context menu ----------
let menuEl = null;
export function contextMenu(items, x, y) {
  closeMenu();
  menuEl = el('div.context-menu');
  for (const it of items) {
    if (it === '-' || it.sep) { menuEl.appendChild(el('div.menu-sep')); continue; }
    const mi = el('button.menu-item', { type: 'button' });
    if (it.danger) mi.classList.add('danger');
    if (it.icon) mi.appendChild(icon(it.icon, 15));
    mi.appendChild(el('span.grow', it.label));
    if (it.kbd) mi.appendChild(el('span.menu-kbd', it.kbd));
    mi.addEventListener('click', () => { closeMenu(); it.onClick && it.onClick(); });
    if (it.disabled) mi.disabled = true;
    menuEl.appendChild(mi);
  }
  document.body.appendChild(menuEl);
  const rect = menuEl.getBoundingClientRect();
  const px = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const py = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menuEl.style.left = px + 'px';
  menuEl.style.top = py + 'px';
  requestAnimationFrame(() => menuEl.classList.add('in'));
  setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
}
function onDocClick(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', onDocClick); } }

// ---------- Tabs ----------
export function tabs(items, opts = {}) {
  const wrap = el('div.tabs');
  const bar = el('div.tab-bar');
  const panel = el('div.tab-panel');
  wrap.appendChild(bar); wrap.appendChild(panel);
  const btns = new Map();
  let current = null;

  function select(key) {
    const item = items.find((i) => i.key === key);
    if (!item) return;
    current = key;
    btns.forEach((b, k) => b.classList.toggle('active', k === key));
    clear(panel);
    const content = item.render ? item.render(panel) : item.content;
    if (content) appendChildren(panel, content);
    if (opts.onChange) opts.onChange(key);
  }

  items.forEach((it) => {
    const b = el('button.tab', { type: 'button' });
    if (it.icon) b.appendChild(icon(it.icon, 15));
    b.appendChild(el('span', it.label));
    if (it.badge != null) b.appendChild(badge(String(it.badge)));
    b.addEventListener('click', () => select(it.key));
    btns.set(it.key, b);
    bar.appendChild(b);
  });

  wrap.select = select;
  wrap.panel = panel;
  wrap.bar = bar;
  select(opts.value || (items[0] && items[0].key));
  return wrap;
}

// ---------- Drawer (side panel) ----------
export function drawer(opts = {}) {
  const backdrop = el('div.drawer-backdrop');
  const d = el('div.drawer' + (opts.side === 'left' ? '.left' : ''));
  if (opts.width) d.style.width = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
  const head = el('div.drawer-head');
  head.appendChild(el('h3', opts.title || ''));
  const closeBtn = iconButton('x', { title: 'Close' });
  head.appendChild(closeBtn);
  const body = el('div.drawer-body');
  d.appendChild(head); d.appendChild(body);
  if (opts.body) appendChildren(body, opts.body);
  backdrop.appendChild(d);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('in'));
  const close = () => { backdrop.classList.remove('in'); setTimeout(() => backdrop.remove(), 250); if (opts.onClose) opts.onClose(); };
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  return { el: d, body, close, head };
}

// ---------- Copyable ----------
export async function copyText(text, label) {
  try {
    await window.xrpg.clipboard.write(text);
    toast(label || 'Copied to clipboard', { type: 'success', timeout: 1500 });
  } catch (e) {
    toast('Copy failed: ' + e.message, { type: 'error' });
  }
}

// ---------- Stat block helper ----------
export function statRow(label, value, opts = {}) {
  const r = el('div.stat-row');
  r.appendChild(el('span.stat-label', label));
  const v = el('span.stat-value', String(value));
  if (opts.color) v.style.color = opts.color;
  r.appendChild(v);
  return r;
}
