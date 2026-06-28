// Reusable form-based editors for arrays of objects (attributes, deriveds,
// conditions, bestiary, reference, sessions, locations, etc.).
import { el, clear, uid, debounce } from './util.js';
import { icon } from './icons.js';
import { button, iconButton, input, textarea, select, field } from './ui.js';
import { compile } from './expr.js';

// opts: { items, fields, onChange, addLabel, itemTitle(item,i), defaults }
// fields: [{ key, label, type:'text'|'number'|'textarea'|'select'|'tags'|'formula', options, placeholder, width, rows }]
export function objListEditor(opts) {
  const items = opts.items;
  const onChange = debounce(opts.onChange || (() => {}), 350);
  const root = el('div.list-editor');
  const list = el('div.col.gap-3');
  root.appendChild(list);
  const addBtn = button(opts.addLabel || 'Add', { size: 'sm', icon: 'plus', onClick: () => { items.push(makeDefault()); onChange(); draw(); } });
  root.appendChild(el('div', { style: { marginTop: '10px' } }, addBtn));

  function makeDefault() {
    const d = {};
    (opts.fields || []).forEach((f) => { d[f.key] = f.default != null ? f.default : (f.type === 'number' ? 0 : f.type === 'tags' ? [] : ''); });
    if (opts.defaults) Object.assign(d, opts.defaults());
    return d;
  }

  function fieldControl(item, f) {
    if (f.type === 'textarea') { const t = textarea({ value: item[f.key] || '', placeholder: f.placeholder, rows: f.rows || 3 }); t.addEventListener('input', () => { item[f.key] = t.value; onChange(); }); return t; }
    if (f.type === 'number') { const i = input({ type: 'number', value: item[f.key] != null ? item[f.key] : 0 }); i.addEventListener('input', () => { item[f.key] = i.value === '' ? null : parseFloat(i.value); onChange(); }); return i; }
    if (f.type === 'select') { const o = typeof f.options === 'function' ? f.options() : f.options; const s = select(o, { value: item[f.key], onChange: (v) => { item[f.key] = v; onChange(); } }); return s; }
    if (f.type === 'bool') { const wrap = el('label.checkbox'); const c = el('input', { type: 'checkbox' }); c.checked = !!item[f.key]; c.addEventListener('change', () => { item[f.key] = c.checked; onChange(); }); wrap.appendChild(c); wrap.appendChild(el('span.checkbox-box')); wrap.appendChild(el('span', f.boolLabel || 'Yes')); return wrap; }
    if (f.type === 'tags') { return tagsControl(item, f, onChange); }
    if (f.type === 'formula') {
      const wrap = el('div.col.gap-1');
      const i = input({ value: item[f.key] || '', placeholder: f.placeholder || 'e.g. 6 + brawn' }); i.classList.add('mono');
      const status = el('div.tiny');
      const check = () => { try { compile(String(i.value || '0')); status.textContent = '✓ valid'; status.style.color = 'var(--good)'; } catch (e) { status.textContent = '✗ ' + e.message; status.style.color = 'var(--bad)'; } };
      i.addEventListener('input', () => { item[f.key] = i.value; check(); onChange(); }); check();
      wrap.appendChild(i); wrap.appendChild(status); return wrap;
    }
    const i = input({ value: item[f.key] != null ? item[f.key] : '', placeholder: f.placeholder });
    i.addEventListener('input', () => { item[f.key] = i.value; onChange(); });
    return i;
  }

  function draw() {
    clear(list);
    if (!items.length) { list.appendChild(el('p.small.mute', 'None yet — click ' + (opts.addLabel || 'Add') + '.')); return; }
    items.forEach((item, i) => {
      const rowCard = el('div.editor-item');
      const top = el('div.row.between', { style: { marginBottom: '8px' } });
      top.appendChild(el('div.small', { style: { fontWeight: 600, color: 'var(--text-mute)' } }, (opts.itemTitle ? opts.itemTitle(item, i) : `#${i + 1}`)));
      const ctrl = el('div.row.gap-1');
      ctrl.appendChild(iconButton('chevD', { size: 14, title: 'Move down', onClick: () => { if (i < items.length - 1) { [items[i], items[i + 1]] = [items[i + 1], items[i]]; onChange(); draw(); } } }));
      ctrl.appendChild(iconButton('chevR', { size: 14, title: 'Move up', onClick: () => { if (i > 0) { [items[i], items[i - 1]] = [items[i - 1], items[i]]; onChange(); draw(); } } }));
      ctrl.appendChild(iconButton('trash', { size: 14, variant: 'danger', title: 'Remove', onClick: () => { items.splice(i, 1); onChange(); draw(); } }));
      top.appendChild(ctrl);
      rowCard.appendChild(top);
      const grid = el('div.editor-grid');
      (opts.fields || []).forEach((f) => {
        const fl = el('label.field' + (f.full ? '.span-2' : ''));
        if (f.width) fl.style.gridColumn = f.width === 'full' ? '1 / -1' : '';
        if (f.full) fl.style.gridColumn = '1 / -1';
        fl.appendChild(el('span.field-label', f.label));
        fl.appendChild(fieldControl(item, f));
        grid.appendChild(fl);
      });
      rowCard.appendChild(grid);
      list.appendChild(rowCard);
    });
  }
  draw();
  root.redraw = draw;
  return root;
}

function tagsControl(item, f, onChange) {
  const box = el('div.tag-input');
  const arr = Array.isArray(item[f.key]) ? item[f.key] : (item[f.key] = []);
  function redraw() {
    clear(box);
    arr.forEach((t, i) => { const chip = el('span.chip', [el('span', t), (() => { const x = el('button.chip-x', { type: 'button' }); x.appendChild(icon('x', 11)); x.addEventListener('click', () => { arr.splice(i, 1); onChange(); redraw(); }); return x; })()]); box.appendChild(chip); });
    const inp = el('input', { placeholder: 'add…' });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { arr.push(inp.value.trim()); onChange(); redraw(); setTimeout(() => box.querySelector('input').focus(), 0); } });
    box.appendChild(inp);
  }
  redraw();
  return box;
}
