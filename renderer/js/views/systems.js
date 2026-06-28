import { el, clear, deepClone, uid, debounce } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, card, badge, chip, modal, confirm, toast, field, input, textarea, select, segmented, tabs } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { applyTheme } from '../theme.js';
import { objListEditor } from '../editors.js';

export async function render(id) {
  if (id) return renderDetail(id);
  return renderList();
}

async function renderList() {
  shell.crumbs([{ label: 'Game Systems' }]);
  shell.actions([
    button('Import', { icon: 'upload', size: 'sm', onClick: importSystem }),
    button('New System', { icon: 'plus', variant: 'primary', size: 'sm', onClick: createSystem }),
  ]);

  const systems = store.all('rulesets');
  const wrap = el('div.view-pad');
  wrap.appendChild(el('p.dim', { style: { marginBottom: '18px' } },
    'XRPG is system-agnostic. Each game system defines its own attributes, dice mechanic, derived stats, conditions, bestiary, and reference. Open one to view or fully edit it; switch the active system any time from the sidebar.'));

  if (!systems.length) {
    wrap.appendChild(empty('No systems yet', { icon: 'layers', action: button('Create one', { variant: 'primary', onClick: createSystem }) }));
    shell.render(wrap); return;
  }

  const grid = el('div.card-grid');
  for (const sys of systems) {
    const c = card({ class: 'entity-card clickable', onClick: () => router.go('systems', sys.id) });
    const head = el('div.ec-head');
    const swatch = el('div.ec-portrait', { style: { background: (sys.theme && sys.theme.accent) || 'var(--accent)', display: 'grid', placeItems: 'center' } });
    swatch.appendChild(icon('layers', 22, { stroke: '#0008' }));
    head.appendChild(swatch);
    const ht = el('div.grow');
    ht.appendChild(el('div.ec-title', sys.name));
    ht.appendChild(el('div.ec-sub', sys.tagline || ''));
    head.appendChild(ht);
    if (sys.id === appState.activeSystemId) head.appendChild(badge('Active', { variant: 'solid' }));
    c.appendChild(head);

    c.appendChild(el('div.ec-body', sys.summary || ''));

    const tagRow = el('div.ec-tags');
    if (sys.dice) tagRow.appendChild(chip(sys.dice.notation + ' · ' + (sys.dice.resolution || ''), { icon: 'dice' }));
    tagRow.appendChild(chip((sys.attributes || []).length + ' attributes', { icon: 'sliders' }));
    if ((sys.reference || []).length) tagRow.appendChild(chip((sys.reference || []).length + ' rules', { icon: 'book' }));
    c.appendChild(tagRow);

    const foot = el('div.ec-foot');
    if (sys.id !== appState.activeSystemId) {
      foot.appendChild(button('Set Active', { size: 'sm', variant: 'primary', onClick: async (e) => { e.stopPropagation(); await appState.setSystem(sys.id); toast(`${sys.name} is now active`, { type: 'success' }); renderList(); } }));
    }
    foot.appendChild(button('Open', { size: 'sm', onClick: () => router.go('systems', sys.id) }));
    const actions = el('div.card-actions');
    actions.appendChild(iconButton('copy', { title: 'Duplicate', size: 16, onClick: async (e) => { e.stopPropagation(); await duplicateSystem(sys); } }));
    actions.appendChild(iconButton('download', { title: 'Export', size: 16, onClick: (e) => { e.stopPropagation(); exportSystem(sys); } }));
    foot.appendChild(actions);
    c.appendChild(foot);
    grid.appendChild(c);
  }
  wrap.appendChild(grid);
  shell.render(wrap);
}

async function renderDetail(id) {
  const sys = store.get('rulesets', id);
  if (!sys) { router.go('systems'); return; }
  shell.crumbs([{ label: 'Game Systems', to: 'systems' }, { label: sys.name }]);
  shell.actions([
    sys.id !== appState.activeSystemId ? button('Set Active', { icon: 'check', size: 'sm', variant: 'primary', onClick: async () => { await appState.setSystem(sys.id); toast(`${sys.name} active`, { type: 'success' }); renderDetail(id); } }) : badge('Active', { variant: 'solid' }),
    button('Duplicate', { icon: 'copy', size: 'sm', onClick: () => duplicateSystem(sys) }),
    button('Export', { icon: 'download', size: 'sm', onClick: () => exportSystem(sys) }),
    button('Delete', { icon: 'trash', size: 'sm', variant: 'danger', onClick: () => deleteSystem(sys) }),
  ]);

  const wrap = el('div.view-pad');
  const headRow = el('div.section-header');
  const t = el('div.section-title');
  const swatch = el('div', { style: { width: '14px', height: '40px', borderRadius: '4px', background: (sys.theme && sys.theme.accent) || 'var(--accent)' } });
  t.appendChild(swatch);
  const ti = el('div');
  ti.appendChild(el('h2', sys.name));
  ti.appendChild(el('div.small.mute', sys.tagline || ''));
  t.appendChild(ti);
  headRow.appendChild(t);
  wrap.appendChild(headRow);

  const tabsEl = tabs([
    { key: 'overview', label: 'Overview', icon: 'info', render: () => buildOverview(sys) },
    { key: 'attrs', label: 'Attributes & Stats', icon: 'sliders', render: () => buildAttrs(sys) },
    { key: 'content', label: 'Content', icon: 'book', render: () => buildContent(sys) },
    { key: 'edit', label: 'Edit System', icon: 'edit', render: () => buildEditor(sys) },
    { key: 'advanced', label: 'Advanced (JSON)', icon: 'gear', render: () => buildAdvanced(sys) },
  ]);
  wrap.appendChild(tabsEl);
  shell.render(wrap);
}

function buildOverview(sys) {
  const col = el('div.col');
  col.appendChild(el('p.prose', sys.summary || 'No summary.'));
  const grid = el('div.meta-grid', { style: { marginTop: '8px' } });
  const mi = (l, v) => { const m = el('div.meta-item'); m.appendChild(el('div.ml', l)); m.appendChild(el('div.mv', v)); return m; };
  grid.appendChild(mi('Dice', (sys.dice && sys.dice.notation) || '—'));
  grid.appendChild(mi('Resolution', (sys.dice && sys.dice.resolution) || '—'));
  grid.appendChild(mi('Attributes', String((sys.attributes || []).length)));
  grid.appendChild(mi('Derived stats', String((sys.deriveds || []).length)));
  grid.appendChild(mi('Reference articles', String((sys.reference || []).length)));
  grid.appendChild(mi('Version', sys.version || '1.0'));
  col.appendChild(grid);
  if (sys.dice && sys.dice.summary) {
    col.appendChild(el('div.notice.mono', { style: { marginTop: '10px' } }, sys.dice.summary));
  }
  return col;
}

function buildAttrs(sys) {
  const col = el('div.col');
  col.appendChild(el('h3', 'Attributes'));
  const at = el('table.data-table');
  const head = el('thead'); const htr = el('tr');
  ['Name', 'Abbr', 'Default', 'Range', 'Governs'].forEach((h) => htr.appendChild(el('th', h)));
  head.appendChild(htr); at.appendChild(head);
  const tb = el('tbody');
  (sys.attributes || []).forEach((a) => {
    const tr = el('tr');
    tr.appendChild(el('td', a.name));
    tr.appendChild(el('td', a.abbr || ''));
    tr.appendChild(el('td', String(a.default ?? '')));
    tr.appendChild(el('td', `${a.min ?? '-'}–${a.max ?? '-'}`));
    tr.appendChild(el('td', a.desc || ''));
    tb.appendChild(tr);
  });
  at.appendChild(tb);
  col.appendChild(at);

  if ((sys.deriveds || []).length) {
    col.appendChild(el('h3', { style: { marginTop: '16px' } }, 'Derived Stats'));
    const dt = el('table.data-table'); const dh = el('thead'); const dhr = el('tr');
    ['Name', 'Formula', 'Notes'].forEach((h) => dhr.appendChild(el('th', h))); dh.appendChild(dhr); dt.appendChild(dh);
    const db = el('tbody');
    (sys.deriveds || []).forEach((d) => {
      const tr = el('tr');
      tr.appendChild(el('td', d.name));
      tr.appendChild(el('td', el('code', d.formula)));
      tr.appendChild(el('td', d.desc || ''));
      db.appendChild(tr);
    });
    dt.appendChild(db); col.appendChild(dt);
  }

  if ((sys.easeLadder || []).length) {
    col.appendChild(el('h3', { style: { marginTop: '16px' } }, 'Difficulty (Ease)'));
    const row = el('div.row.wrap.gap-2');
    sys.easeLadder.forEach((e) => row.appendChild(chip(`${e.name} ${e.mod >= 0 ? '+' : ''}${e.mod}`)));
    col.appendChild(row);
  }
  if ((sys.dcLadder || []).length) {
    col.appendChild(el('h3', { style: { marginTop: '16px' } }, 'Difficulty Classes'));
    const row = el('div.row.wrap.gap-2');
    sys.dcLadder.forEach((e) => row.appendChild(chip(`${e.name} (DC ${e.dc})`)));
    col.appendChild(row);
  }
  if ((sys.tracks || []).length) {
    col.appendChild(el('h3', { style: { marginTop: '16px' } }, 'Tracks'));
    sys.tracks.forEach((tk) => {
      const c = el('div.side-card');
      c.appendChild(el('h4', tk.name));
      (tk.stages || []).forEach((s, i) => c.appendChild(el('p.small', [el('b', `${i}. ${s.name}: `), s.effect])));
      col.appendChild(c);
    });
  }
  return col;
}

function buildContent(sys) {
  const col = el('div.col');
  const section = (title, items, fn) => {
    if (!items || !items.length) return;
    col.appendChild(el('h3', title));
    items.forEach((it) => col.appendChild(fn(it)));
  };
  section('Backgrounds', sys.backgrounds, (b) => { const c = el('div.beat'); c.appendChild(el('div.bt', b.name)); c.appendChild(el('div.bb', [el('b', 'Knack: '), b.knack, el('br'), el('b', 'Gear: '), b.gear])); return c; });
  section('Weapons', sys.weapons, (w) => { const c = el('div.beat'); c.appendChild(el('div.bh', [el('div.bt', w.name), badge(w.damage)])); c.appendChild(el('div.bb', w.notes)); return c; });
  section('Bestiary', sys.bestiary, (b) => { const c = el('div.beat'); c.appendChild(el('div.bt', b.name)); c.appendChild(el('div.bb', `${b.defense ? 'Defense ' + b.defense + ' · ' : ''}${b.body != null ? 'Body ' + b.body + ' · ' : ''}${b.speed || ''} — ${b.notes || ''}`)); return c; });
  section('Tables', sys.tables, (t) => { const c = el('div.beat'); c.appendChild(el('div.bt', t.name)); c.appendChild(el('div.bb', (t.entries || []).map((e, i) => `${i + 1}. ${e}`).join('  ·  '))); return c; });
  if (!col.children.length) col.appendChild(empty('No extra content', { icon: 'book', hint: 'This system has no backgrounds, weapons, bestiary, or tables defined.' }));
  return col;
}

// ---------- Native form editor ----------
function uniqueKey(prefix, arr) { let n = arr.length + 1; const has = (k) => arr.some((x) => x.key === k); while (has(prefix + n)) n++; return prefix + n; }
function buildEditor(sys) {
  // ensure arrays exist
  ['attributes', 'deriveds', 'conditions', 'weapons', 'bestiary', 'reference', 'rollPresets', 'easeLadder', 'dcLadder', 'tracks'].forEach((k) => { if (!Array.isArray(sys[k])) sys[k] = []; });
  const save = debounce(async () => { await store.save('rulesets', sys); if (sys.id === appState.activeSystemId) applyTheme(sys); }, 450);
  const attrOpts = () => (sys.attributes || []).concat(sys.deriveds || []).map((a) => ({ value: a.key, label: a.name || a.key }));

  const sec = (title, node) => { const d = el('div.editor-section'); d.appendChild(el('h4', title)); d.appendChild(node); return d; };
  const editor = (items, fields, opts) => objListEditor(Object.assign({ items, fields, onChange: save }, opts));

  return tabs([
    { key: 'meta', label: 'Meta & Dice', render: () => editMetaDice(sys, save) },
    { key: 'attrs', label: 'Attributes', render: () => sec('Attributes', editor(sys.attributes, [
      { key: 'name', label: 'Name' }, { key: 'key', label: 'Key (lowercase)' }, { key: 'abbr', label: 'Abbr' },
      { key: 'default', label: 'Default', type: 'number' }, { key: 'min', label: 'Min', type: 'number' }, { key: 'max', label: 'Max', type: 'number' },
      { key: 'desc', label: 'Governs', type: 'textarea', full: true },
    ], { addLabel: 'Add attribute', itemTitle: (a) => a.name || a.key, defaults: () => ({ key: uniqueKey('attr', sys.attributes), default: 8, min: 3, max: 16 }) })) },
    { key: 'deriveds', label: 'Derived Stats', render: () => sec('Derived stats (formulas)', editor(sys.deriveds, [
      { key: 'name', label: 'Name' }, { key: 'key', label: 'Key' }, { key: 'abbr', label: 'Abbr' },
      { key: 'formula', label: 'Formula', type: 'formula', full: true },
      { key: 'min', label: 'Min', type: 'number' }, { key: 'max', label: 'Max', type: 'number' },
      { key: 'resource', label: '', type: 'bool', boolLabel: 'Resource (HP-like pool)' },
      { key: 'desc', label: 'Notes', type: 'textarea', full: true },
    ], { addLabel: 'Add derived', itemTitle: (d) => d.name || d.key, defaults: () => ({ key: uniqueKey('der', sys.deriveds), formula: '0' }) })) },
    { key: 'conditions', label: 'Conditions', render: () => sec('Conditions', editor(sys.conditions, [
      { key: 'name', label: 'Name' }, { key: 'effect', label: 'Effect', type: 'textarea', full: true },
    ], { addLabel: 'Add condition', itemTitle: (c) => c.name })) },
    { key: 'bestiary', label: 'Bestiary', render: () => sec('Bestiary', editor(sys.bestiary, [
      { key: 'name', label: 'Name' }, { key: 'meta', label: 'Meta (e.g. CR 1 · Undead)' },
      { key: 'hp', label: 'HP', type: 'number' }, { key: 'ac', label: 'AC / Defense', type: 'number' },
      { key: 'statblock', label: 'Stat block (markdown)', type: 'textarea', full: true, rows: 5 },
      { key: 'tags', label: 'Tags', type: 'tags', full: true },
    ], { addLabel: 'Add creature', itemTitle: (b) => b.name })) },
    { key: 'reference', label: 'Rules', render: () => sec('Reference articles', editor(sys.reference, [
      { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' }, { key: 'tags', label: 'Tags', type: 'tags' },
      { key: 'body', label: 'Body (markdown)', type: 'textarea', full: true, rows: 7 },
    ], { addLabel: 'Add article', itemTitle: (r) => r.title, defaults: () => ({ id: 'ref_' + uid('').slice(0, 6), category: 'Custom' }) })) },
    { key: 'weapons', label: 'Weapons', render: () => sec('Weapons', editor(sys.weapons, [
      { key: 'name', label: 'Name' }, { key: 'damage', label: 'Damage' }, { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ], { addLabel: 'Add weapon', itemTitle: (w) => w.name })) },
    { key: 'presets', label: 'Roll Presets', render: () => sec('Quick-roll presets', editor(sys.rollPresets, [
      { key: 'name', label: 'Name' }, { key: 'attr', label: 'Attribute / stat', type: 'select', options: attrOpts },
      { key: 'ease', label: 'Difficulty (optional)' }, { key: 'note', label: 'Note', type: 'textarea', full: true },
    ], { addLabel: 'Add preset', itemTitle: (p) => p.name })) },
  ]);
}

function editMetaDice(sys, save) {
  const col = el('div.col.gap-4');
  const text = (label, key, ta) => { const c = ta ? textarea({ value: sys[key] || '', rows: 2 }) : input({ value: sys[key] || '' }); c.addEventListener('input', () => { sys[key] = c.value; save(); }); col.appendChild(field(label, c)); };
  text('Name', 'name'); text('Tagline', 'tagline'); text('Version label', 'version'); text('Summary', 'summary', true);

  // theme colors
  sys.theme = sys.theme || {};
  const colorRow = el('div.row.gap-4.wrap');
  [['accent', 'Accent'], ['accent2', 'Accent 2'], ['cool', 'Cool']].forEach(([k, l]) => { const i = input({ type: 'color', value: sys.theme[k] || '#4ea3ff' }); i.addEventListener('input', () => { sys.theme[k] = i.value; save(); applyTheme(sys); }); colorRow.appendChild(field(l, i)); });
  col.appendChild(colorRow);

  // dice
  col.appendChild(el('div.divider', 'Dice'));
  sys.dice = sys.dice || {};
  const notI = input({ value: sys.dice.notation || '' }); notI.addEventListener('input', () => { sys.dice.notation = notI.value; save(); });
  const resSel = select(['roll-under', 'roll-high', 'degrees', 'percentile', 'pbta', 'pool', 'flat'].map((v) => ({ value: v, label: v })), { value: sys.dice.resolution || 'roll-high', onChange: (v) => { sys.dice.resolution = v; save(); } });
  const dsumI = input({ value: sys.dice.summary || '' }); dsumI.addEventListener('input', () => { sys.dice.summary = dsumI.value; save(); });
  col.appendChild(el('div.form-grid', [field('Notation', notI), field('Resolution', resSel), field('Dice summary', dsumI, { class: 'span-2' })]));

  // reward stat
  col.appendChild(el('div.divider', 'Reward / advancement stat'));
  sys.rewardStat = sys.rewardStat || { key: 'xp', name: 'XP' };
  const rkI = input({ value: sys.rewardStat.key || '' }); rkI.addEventListener('input', () => { sys.rewardStat.key = rkI.value; save(); });
  const rnI = input({ value: sys.rewardStat.name || '' }); rnI.addEventListener('input', () => { sys.rewardStat.name = rnI.value; save(); });
  const rdI = input({ value: sys.rewardStat.desc || '' }); rdI.addEventListener('input', () => { sys.rewardStat.desc = rdI.value; save(); });
  col.appendChild(el('div.form-grid', [field('Key', rkI), field('Name', rnI), field('Note', rdI, { class: 'span-2' })]));

  // ladders
  col.appendChild(el('div.divider', 'Difficulty ladder'));
  const ladderSeg = segmented([{ value: 'ease', label: 'Ease (roll-under)' }, { value: 'dc', label: 'DC (roll-high/degrees)' }], { value: (sys.dcLadder && sys.dcLadder.length) ? 'dc' : 'ease', onChange: () => {} });
  col.appendChild(ladderSeg);
  const ladderBox = el('div', { style: { marginTop: '8px' } });
  function drawLadder(which) {
    clear(ladderBox);
    if (which === 'dc') ladderBox.appendChild(objListEditor({ items: sys.dcLadder = sys.dcLadder || [], fields: [{ key: 'name', label: 'Name' }, { key: 'dc', label: 'DC', type: 'number' }], onChange: save, addLabel: 'Add DC', itemTitle: (d) => d.name }));
    else ladderBox.appendChild(objListEditor({ items: sys.easeLadder = sys.easeLadder || [], fields: [{ key: 'name', label: 'Name' }, { key: 'mod', label: 'Modifier', type: 'number' }, { key: 'use', label: 'Use for', type: 'textarea', full: true }], onChange: save, addLabel: 'Add ease', itemTitle: (e) => e.name }));
  }
  ladderSeg.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => drawLadder(b.textContent.startsWith('DC') ? 'dc' : 'ease')));
  drawLadder((sys.dcLadder && sys.dcLadder.length) ? 'dc' : 'ease');
  col.appendChild(ladderBox);

  col.appendChild(el('p.small.mute', { style: { marginTop: '12px' } }, 'Changes save automatically. Use the Advanced (JSON) tab for anything not covered here (tables, backgrounds, clock templates, etc.).'));
  return col;
}

function buildAdvanced(sys) {
  const col = el('div.col');
  col.appendChild(el('p.small.mute', 'Edit the full system definition as JSON. Changes apply to the active theme immediately on save.'));
  const ta = textarea({ value: JSON.stringify(sys, null, 2), rows: 24 });
  ta.style.fontFamily = 'var(--font-mono)'; ta.style.fontSize = '12px';
  col.appendChild(ta);
  const status = el('div.small.mute');
  const row = el('div.row.gap-2');
  row.appendChild(button('Save JSON', { variant: 'primary', icon: 'save', onClick: async () => {
    let parsed;
    try { parsed = JSON.parse(ta.value); } catch (e) { status.textContent = 'Invalid JSON: ' + e.message; status.style.color = 'var(--bad)'; return; }
    parsed.id = sys.id;
    await store.save('rulesets', parsed);
    if (sys.id === appState.activeSystemId) applyTheme(parsed);
    toast('System saved', { type: 'success' });
    renderDetail(sys.id);
  } }));
  row.appendChild(status);
  col.appendChild(row);
  return col;
}

// ---- actions ----
async function createSystem() {
  const nameI = input({ placeholder: 'My Game System' });
  const m = modal({
    title: 'New Game System', width: 460,
    body: [
      field('Name', nameI),
      field('Dice resolution', select([
        { value: 'roll-under', label: 'Roll-under (e.g. 3d6 ≤ stat)' },
        { value: 'roll-high', label: 'Roll-high (e.g. d20 + mod ≥ DC)' },
        { value: 'pbta', label: 'PbtA (2d6 + stat, success bands)' },
        { value: 'pool', label: 'Dice pool (count successes)' },
      ], { value: 'roll-high', onChange: (v) => (resolution = v) })),
    ],
  });
  let resolution = 'roll-high';
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Create', { variant: 'primary', onClick: async () => {
      const notation = resolution === 'roll-high' ? '1d20' : resolution === 'pbta' ? '2d6' : resolution === 'roll-under' ? '3d6' : '6d6';
      const sys = {
        id: 'sys_' + uid('').slice(0, 8), name: nameI.value || 'New System', tagline: '', version: '1.0',
        summary: '', theme: { accent: '#4ea3ff', accent2: '#2b6fd6', cool: '#7fd1d6', mood: 'neutral' },
        dice: { notation, resolution, summary: '' },
        attributes: [
          { key: 'might', name: 'Might', abbr: 'MGT', default: resolution === 'pbta' ? 0 : 10, min: 0, max: 20, desc: '' },
          { key: 'grace', name: 'Grace', abbr: 'GRC', default: resolution === 'pbta' ? 0 : 10, min: 0, max: 20, desc: '' },
          { key: 'mind', name: 'Mind', abbr: 'MND', default: resolution === 'pbta' ? 0 : 10, min: 0, max: 20, desc: '' },
        ],
        deriveds: [], reference: [], rollPresets: [], _seed: false,
      };
      await store.save('rulesets', sys);
      m.close();
      toast('System created', { type: 'success' });
      router.go('systems', sys.id);
    } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

function editSystem(sys) {
  const nameI = input({ value: sys.name });
  const tagI = input({ value: sys.tagline || '' });
  const sumI = textarea({ value: sys.summary || '', rows: 3 });
  const accentI = input({ type: 'color', value: (sys.theme && sys.theme.accent) || '#4ea3ff' });
  const accent2I = input({ type: 'color', value: (sys.theme && sys.theme.accent2) || '#2b6fd6' });
  const coolI = input({ type: 'color', value: (sys.theme && sys.theme.cool) || '#7fd1d6' });
  const diceSumI = input({ value: (sys.dice && sys.dice.summary) || '' });
  const m = modal({
    title: 'Edit System', width: 520,
    body: [
      field('Name', nameI),
      field('Tagline', tagI),
      field('Summary', sumI),
      el('div.row.gap-4', [field('Accent', accentI), field('Accent 2', accent2I), field('Cool', coolI)]),
      field('Dice summary', diceSumI),
    ],
  });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Save', { variant: 'primary', onClick: async () => {
      const next = deepClone(sys);
      next.name = nameI.value; next.tagline = tagI.value; next.summary = sumI.value;
      next.theme = { ...(next.theme || {}), accent: accentI.value, accent2: accent2I.value, cool: coolI.value };
      next.dice = { ...(next.dice || {}), summary: diceSumI.value };
      await store.save('rulesets', next);
      if (sys.id === appState.activeSystemId) { applyTheme(next); }
      m.close(); toast('Saved', { type: 'success' }); renderDetail(sys.id);
    } }),
  );
}

async function deleteSystem(sys) {
  const systems = store.all('rulesets');
  if (systems.length <= 1) { toast('Can\'t delete the only game system.', { type: 'warn' }); return; }
  const chars = store.where('characters', (c) => c.systemId === sys.id).length;
  const camps = store.where('campaigns', (c) => c.systemId === sys.id).length;
  let msg = `Delete "${sys.name}"?`;
  if (chars || camps) msg += ` ${chars} character(s) and ${camps} campaign(s) reference it (their data stays, but this system definition is removed).`;
  if (sys._seed) msg += ' You can restore built-in systems later in Settings → Data.';
  if (!(await confirm({ title: 'Delete system?', message: msg, danger: true, okLabel: 'Delete' }))) return;
  await store.remove('rulesets', sys.id);
  if (appState.activeSystemId === sys.id) { const next = store.all('rulesets')[0]; if (next) await appState.setSystem(next.id); }
  toast('System deleted', { type: 'success' });
  router.go('systems');
}

async function duplicateSystem(sys) {
  const copy = deepClone(sys);
  copy.id = 'sys_' + uid('').slice(0, 8);
  copy.name = sys.name + ' (copy)';
  copy._seed = false;
  delete copy.createdAt; delete copy.updatedAt;
  await store.save('rulesets', copy);
  toast('Duplicated', { type: 'success' });
  router.go('systems', copy.id);
}

async function exportSystem(sys) {
  const path = await window.xrpg.dialog.saveJson(`${sys.name.replace(/\s+/g, '-').toLowerCase()}.system.json`, { kind: 'xrpg-doc', collection: 'rulesets', doc: sys });
  if (path) toast('Exported', { type: 'success' });
}

async function importSystem() {
  const data = await window.xrpg.dialog.openJson();
  if (!data) return;
  let doc = null;
  if (data.kind === 'xrpg-doc' && data.collection === 'rulesets') doc = data.doc;
  else if (data.collection === 'rulesets' && Array.isArray(data.docs)) doc = data.docs[0];
  else if (data.id && data.attributes) doc = data;
  if (!doc) { toast('Not a valid system file', { type: 'error' }); return; }
  doc.id = 'sys_' + uid('').slice(0, 8); doc._seed = false;
  await store.save('rulesets', doc);
  toast('System imported', { type: 'success' });
  renderList();
}
