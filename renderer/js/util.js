// Small DOM + general helpers. CSP-safe (no eval / inline handlers).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// el('div.card#id', {attrs}, [children|string])
export function el(spec, attrs = {}, children) {
  let tag = 'div', id = null;
  const classes = [];
  spec.replace(/([.#]?[^.#]+)/g, (m) => {
    if (m[0] === '.') classes.push(m.slice(1));
    else if (m[0] === '#') id = m.slice(1);
    else tag = m;
  });
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !(attrs instanceof Node)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className += ' ' + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'disabled' || k === 'checked' || k === 'selected') { if (v) node.setAttribute(k, ''); node[k] = !!v; }
      else node.setAttribute(k, v);
    }
  } else if (attrs != null) {
    children = attrs;
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  if (children == null) return node;
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    if (c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function frag(...nodes) {
  const f = document.createDocumentFragment();
  appendChildren(f, nodes);
  return f;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Unique id. A per-call counter + randomness come FIRST so callers that take a
// short prefix via .slice(0, N) still get collision-free ids (the timestamp,
// which changes slowly, is last).
let _uidCounter = Math.floor(Math.random() * 1296);
export function uid(prefix = 'id') {
  _uidCounter = (_uidCounter + 1) % 1296; // 36^2
  return `${prefix}_${_uidCounter.toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36)}`;
}

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function throttle(fn, ms = 60) {
  let last = 0, queued = null;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else { clearTimeout(queued); queued = setTimeout(() => { last = Date.now(); fn(...args); }, ms - (now - last)); }
  };
}

export function deepClone(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(obj); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(obj));
}

export function fmtDate(iso, opts) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, opts || { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const s = Math.round(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const day = Math.round(h / 24); if (day < 30) return `${day}d ago`;
  return fmtDate(iso);
}

export function fmtClock(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function pluralize(n, word, plural) {
  return `${n} ${n === 1 ? word : (plural || word + 's')}`;
}

export function titleCase(s) {
  return String(s || '').replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Seeded RNG (mulberry32) so generated art is deterministic per id.
export function seededRng(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (let i = 0; i < String(seedStr).length; i++) {
    h = Math.imul(h ^ String(seedStr).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(arr, rng = Math.random) { return arr[Math.floor(rng() * arr.length)]; }

export function downloadDataUrl(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = r.result;
      const comma = res.indexOf(',');
      resolve(res.slice(comma + 1));
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const res = r.result; resolve(res.slice(res.indexOf(',') + 1)); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Highlight occurrences of `q` in text, returning a safe DocumentFragment.
export function highlight(text, q) {
  const f = document.createDocumentFragment();
  if (!q) { f.appendChild(document.createTextNode(text)); return f; }
  const lc = text.toLowerCase(), lq = q.toLowerCase();
  let i = 0, idx;
  while ((idx = lc.indexOf(lq, i)) !== -1) {
    if (idx > i) f.appendChild(document.createTextNode(text.slice(i, idx)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + q.length);
    f.appendChild(mark);
    i = idx + q.length;
  }
  if (i < text.length) f.appendChild(document.createTextNode(text.slice(i)));
  return f;
}

// A tiny event emitter.
export class Emitter {
  constructor() { this._h = new Map(); }
  on(evt, fn) {
    if (!this._h.has(evt)) this._h.set(evt, new Set());
    this._h.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { const s = this._h.get(evt); if (s) s.delete(fn); }
  emit(evt, ...args) { const s = this._h.get(evt); if (s) for (const fn of [...s]) { try { fn(...args); } catch (e) { console.error(e); } } }
}
