import { el, clear, uid, deepClone, debounce, fileToBase64, fmtDateTime, relTime } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, card, badge, chip, modal, confirm, toast, field, input, textarea, select, segmented, tabs, statRow, promptText, contextMenu } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { blankCharacter, allDeriveds, statLine, validateCreation } from '../rules.js';
import { portraitNode } from '../portrait.js';
import { addItem, updateItem, useItem, loseItem, removeItem, adjustReward, rewardStatOf, ensureProgress } from '../progress.js';
import { visible, isSeed, builtinChip, copyToEdit, hideDoc } from '../seed.js';
import { importFromFile } from '../share.js';

export async function render(id, sub) {
  if (id === 'new') return openCreate();
  if (id) return renderDetail(id, sub);
  return renderList();
}

let listState = { filter: 'all', q: '' };

async function renderList() {
  shell.crumbs([{ label: 'Characters' }]);
  shell.actions([
    button('Import', { icon: 'upload', size: 'sm', onClick: async () => { const created = await importFromFile(); if (created && created.length) { const ch = created.find((c) => c.collection === 'characters'); if (ch) router.go('characters', ch.id); } } }),
    button('New NPC', { icon: 'npc', size: 'sm', onClick: () => openCreate('npc') }),
    button('New PC', { icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openCreate('pc') }),
  ]);

  const wrap = el('div.view-pad');

  const toolbar = el('div.toolbar');
  const seg = segmented([
    { value: 'all', label: 'All' }, { value: 'pc', label: 'Player Characters' }, { value: 'npc', label: 'NPCs' },
  ], { value: listState.filter, onChange: (v) => { listState.filter = v; draw(); } });
  toolbar.appendChild(seg);
  const searchBox = el('div.search-box');
  searchBox.appendChild(icon('search', 15));
  const sInput = el('input', { placeholder: 'Search characters…', value: listState.q });
  searchBox.appendChild(sInput);
  toolbar.appendChild(searchBox);
  wrap.appendChild(toolbar);

  const grid = el('div.card-grid');
  wrap.appendChild(grid);

  function draw() {
    clear(grid);
    let chars = visible(store.all('characters'));
    if (listState.filter !== 'all') chars = chars.filter((c) => (c.kind || 'pc') === listState.filter);
    if (listState.q) { const q = listState.q.toLowerCase(); chars = chars.filter((c) => (c.name + ' ' + (c.role || '') + ' ' + (c.tags || []).join(' ')).toLowerCase().includes(q)); }
    chars.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (!chars.length) {
      grid.appendChild(empty('No characters', { icon: 'mask', hint: 'Create a player character or an NPC.', action: button('New character', { variant: 'primary', onClick: () => openCreate('pc') }) }));
      return;
    }
    for (const c of chars) grid.appendChild(charCard(c));
  }

  sInput.addEventListener('input', debounce(() => { listState.q = sInput.value.trim(); draw(); }, 120));
  draw();
  shell.render(wrap);
}

function charCard(c) {
  const sys = store.get('rulesets', c.systemId) || appState.system;
  const card_ = card({ class: 'entity-card clickable' });
  card_.addEventListener('click', () => router.go('characters', c.id));
  const head = el('div.ec-head');
  head.appendChild(portraitNode(c, 52));
  const ht = el('div.grow');
  ht.appendChild(el('div.ec-title', c.name || 'Unnamed'));
  ht.appendChild(el('div.ec-sub', c.role || (c.kind === 'npc' ? 'NPC' : 'Player Character')));
  head.appendChild(ht);
  head.appendChild(badge(c.kind === 'npc' ? 'NPC' : 'PC', { color: c.kind === 'npc' ? 'var(--npc)' : 'var(--pc)' }));
  if (isSeed(c)) head.appendChild(builtinChip());
  card_.appendChild(head);

  if (sys) {
    const line = c.statBlock || (sys.attributes ? statLine(sys, c) : '');
    if (line) card_.appendChild(el('div.ec-body.mono', { style: { fontSize: '12px' } }, line));
  }
  if (c.tags && c.tags.length) {
    const tagRow = el('div.ec-tags');
    c.tags.slice(0, 4).forEach((t) => tagRow.appendChild(chip(t)));
    card_.appendChild(tagRow);
  }
  return card_;
}

// ---------- Create ----------
function openCreate(kindPreset) {
  const systems = store.all('rulesets');
  if (!systems.length) { toast('Add a game system first', { type: 'warn' }); router.go('systems'); return; }
  let kind = kindPreset || 'pc';
  let systemId = appState.activeSystemId || (systems[0] && systems[0].id);
  const nameI = input({ placeholder: kind === 'npc' ? 'NPC name' : 'Character name' });
  const kindSeg = segmented([{ value: 'pc', label: 'Player Character' }, { value: 'npc', label: 'NPC' }], { value: kind, onChange: (v) => (kind = v) });
  const sysSel = select(systems.map((s) => ({ value: s.id, label: s.name })), { value: systemId, onChange: (v) => (systemId = v) });
  const m = modal({
    title: 'New Character', width: 460,
    body: [field('Type', kindSeg), field('Game system', sysSel), field('Name', nameI)],
  });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Create', { variant: 'primary', onClick: async () => {
      const sys = store.get('rulesets', systemId);
      const c = blankCharacter(sys, kind);
      c.id = (kind === 'npc' ? 'npc_' : 'pc_') + uid('').slice(0, 8);
      c.name = nameI.value || (kind === 'npc' ? 'New NPC' : 'New Character');
      c.portraitSeed = uid('seed');
      await store.save('characters', c);
      m.close();
      router.go('characters', c.id);
    } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

// ---------- Detail / sheet ----------
async function renderDetail(id) {
  const c = store.get('characters', id);
  if (!c) { router.go('characters'); return; }
  const sys = store.get('rulesets', c.systemId) || appState.system;
  shell.crumbs([{ label: 'Characters', to: 'characters' }, { label: c.name || 'Unnamed' }]);

  const seed = isSeed(c);
  let working = deepClone(c);
  // Built-in (seeded) characters are read-only: edits are no-ops until the user
  // makes an editable copy. (The main-process store guard also blocks any write.)
  const save = seed ? () => {} : debounce(async () => { await store.save('characters', working); }, 350);
  const saveNow = seed ? async () => {} : async () => { await store.save('characters', working); };

  const acts = [badge(sys ? sys.name : '—', { variant: 'dim' })];
  if (seed) acts.push(builtinChip(), button('Copy to Edit', { icon: 'copy', size: 'sm', variant: 'primary', onClick: () => copyToEdit('characters', c, { navigateView: 'characters' }) }));
  acts.push(button('Copy to System', { icon: 'layers', size: 'sm', onClick: () => copyToSystem(working) }));
  acts.push(button('Export', { icon: 'download', size: 'sm', onClick: async () => { const p = await window.xrpg.dialog.saveJson(`${(working.name || 'character').replace(/\s+/g, '-').toLowerCase()}.character.json`, { kind: 'xrpg-doc', collection: 'characters', doc: working }); if (p) toast('Exported', { type: 'success' }); } }));
  if (!seed) acts.push(button('Duplicate', { icon: 'copy', size: 'sm', onClick: async () => { const copy = deepClone(working); copy.id = (copy.kind === 'npc' ? 'npc_' : 'pc_') + uid('').slice(0, 8); copy.name += ' (copy)'; delete copy.createdAt; delete copy.updatedAt; await store.save('characters', copy); toast('Duplicated', { type: 'success' }); router.go('characters', copy.id); } }));
  if (seed) acts.push(button('Hide', { icon: 'eyeOff', size: 'sm', onClick: async () => { await hideDoc(c.id); toast(`${c.name} hidden`, { type: 'success' }); router.go('characters'); } }));
  acts.push(button('Delete', { icon: 'trash', size: 'sm', variant: 'danger', onClick: async () => { if (await confirm({ title: 'Delete character?', message: `Delete "${working.name}"? This cannot be undone.${seed ? ' You can restore built-in content in Settings → Data.' : ''}`, danger: true, okLabel: 'Delete' })) { await store.remove('characters', id); router.go('characters'); } } }));
  shell.actions(acts);

  const wrap = el('div.view-pad');
  if (seed) {
    const banner = el('div.notice', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' } });
    banner.appendChild(el('div.grow', [el('b', 'Built-in character (read-only). '), 'Changes here will not be saved. Make an editable copy to play or customize this character.']));
    banner.appendChild(button('Copy to Edit', { icon: 'copy', variant: 'primary', onClick: () => copyToEdit('characters', c, { navigateView: 'characters' }) }));
    wrap.appendChild(banner);
  }
  const detail = el('div.detail');

  // ---- main column ----
  const main = el('div.col');

  // header card
  const headCard = el('div.card');
  const headRow = el('div.row.gap-4');
  let portrait = wirePortrait(portraitNode(working, 96));
  headRow.appendChild(portrait);

  function wirePortrait(node) {
    node.style.cursor = 'pointer';
    node.title = 'Change portrait';
    node.addEventListener('click', () => portraitMenu(working, () => { saveNow(); refreshPortrait(); }));
    return node;
  }
  function refreshPortrait() { const np = wirePortrait(portraitNode(working, 96)); portrait.replaceWith(np); portrait = np; }

  const headInfo = el('div.grow.col.gap-2');
  const nameI = input({ value: working.name, placeholder: 'Name' });
  nameI.style.fontSize = '20px'; nameI.style.fontWeight = '700';
  nameI.addEventListener('input', () => { working.name = nameI.value; save(); shell.crumbs([{ label: 'Characters', to: 'characters' }, { label: working.name || 'Unnamed' }]); });
  headInfo.appendChild(nameI);
  const roleI = input({ value: working.role || '', placeholder: working.kind === 'npc' ? 'Role / concept' : 'Background / concept' });
  roleI.addEventListener('input', () => { working.role = roleI.value; save(); });
  headInfo.appendChild(roleI);
  const kindRow = el('div.row.gap-2');
  kindRow.appendChild(segmented([{ value: 'pc', label: 'PC' }, { value: 'npc', label: 'NPC' }], { value: working.kind, onChange: (v) => { working.kind = v; saveNow(); } }));
  if (working.kind === 'npc') {
    const threatChk = el('label.checkbox');
    const cb = el('input', { type: 'checkbox' }); cb.checked = !!working.threat;
    cb.addEventListener('change', () => { working.threat = cb.checked; saveNow(); refreshPortrait(); });
    threatChk.appendChild(cb); threatChk.appendChild(el('span.checkbox-box')); threatChk.appendChild(el('span', 'Hostile / threat'));
    kindRow.appendChild(threatChk);
  }
  headInfo.appendChild(kindRow);
  headRow.appendChild(headInfo);
  headCard.appendChild(headRow);
  main.appendChild(headCard);

  // attributes
  if (sys && sys.attributes) {
    const attrCard = el('div.card');
    attrCard.appendChild(el('h3', { style: { marginBottom: '12px' } }, 'Attributes'));
    const attrGrid = el('div.attr-grid');
    const derivedRowWrap = el('div.derived-row', { style: { marginTop: '14px' } });

    function recomputeDerived() {
      clear(derivedRowWrap);
      const der = allDeriveds(sys, working);
      for (const d of sys.deriveds || []) {
        const pill = el('div.derived-pill');
        if (d.resource) {
          // current / max
          if (!working.resources) working.resources = {};
          if (working.resources[d.key] == null) working.resources[d.key] = der[d.key];
          const cur = el('input.input', { type: 'number', value: working.resources[d.key], style: { width: '52px', textAlign: 'center', padding: '4px' } });
          cur.addEventListener('input', () => { working.resources[d.key] = parseInt(cur.value, 10) || 0; save(); });
          pill.appendChild(cur);
          pill.appendChild(el('span.dl', '/ ' + der[d.key] + ' ' + (d.abbr || d.name)));
        } else {
          pill.appendChild(el('span.dv', String(der[d.key])));
          pill.appendChild(el('span.dl', d.abbr || d.name));
        }
        derivedRowWrap.appendChild(pill);
      }
    }

    for (const a of sys.attributes) {
      const box = el('div.attr-box');
      box.appendChild(el('div.abbr', a.abbr || a.name));
      const val = el('div.val', String(working.attrs[a.key] ?? a.default ?? 0));
      box.appendChild(val);
      box.appendChild(el('div.name', a.name));
      const stepper = el('div.stepper');
      const dec = el('button'); dec.appendChild(icon('minus', 13));
      const inc = el('button'); inc.appendChild(icon('plus', 13));
      const setv = (nv) => { nv = Math.max(a.min ?? -5, Math.min(a.max ?? 30, nv)); working.attrs[a.key] = nv; val.textContent = String(nv); recomputeDerived(); save(); };
      dec.addEventListener('click', () => setv((working.attrs[a.key] ?? a.default ?? 0) - 1));
      inc.addEventListener('click', () => setv((working.attrs[a.key] ?? a.default ?? 0) + 1));
      stepper.appendChild(dec); stepper.appendChild(inc);
      box.appendChild(stepper);
      attrGrid.appendChild(box);
    }
    attrCard.appendChild(attrGrid);
    attrCard.appendChild(derivedRowWrap);
    recomputeDerived();

    // point-buy validation (PC only)
    if (working.kind === 'pc' && sys.attributeRules && sys.attributeRules.pointsToDistribute != null) {
      const v = validateCreation(sys, working);
      const status = el('div.small', { style: { marginTop: '10px', color: v.ok ? 'var(--good)' : 'var(--warn)' } });
      const refresh = () => { const vv = validateCreation(sys, working); status.textContent = vv.ok ? '✓ Valid character creation budget' : vv.issues.join('  '); status.style.color = vv.ok ? 'var(--good)' : 'var(--warn)'; };
      // re-validate on attribute change
      attrGrid.addEventListener('click', () => setTimeout(refresh, 0));
      refresh();
      attrCard.appendChild(status);
    }
    main.appendChild(attrCard);
  }

  // NPC quick stat block (freeform)
  if (working.kind === 'npc') {
    const sbCard = el('div.card');
    sbCard.appendChild(el('h3', { style: { marginBottom: '8px' } }, 'Quick Stat Block'));
    sbCard.appendChild(el('p.small.mute', { style: { marginBottom: '8px' } }, sys && sys.npcStatFormat ? 'Format: ' + sys.npcStatFormat : ''));
    const sbI = input({ value: working.statBlock || (sys ? statLine(sys, working) : ''), placeholder: sys && sys.npcStatFormat });
    sbI.classList.add('mono');
    sbI.addEventListener('input', () => { working.statBlock = sbI.value; save(); });
    sbCard.appendChild(sbI);
    const wantsI = input({ value: working.wants || '', placeholder: 'What they want…' });
    wantsI.addEventListener('input', () => { working.wants = wantsI.value; save(); });
    sbCard.appendChild(field('Wants', wantsI, { class: 'span-2' }));
    main.appendChild(sbCard);
  }

  // notes & details
  const notesCard = el('div.card');
  notesCard.appendChild(el('h3', { style: { marginBottom: '10px' } }, 'Notes & Background'));
  const notesT = textarea({ value: working.notes || '', rows: 6, placeholder: 'Background, personality, history, secrets…', autosize: true });
  notesT.addEventListener('input', () => { working.notes = notesT.value; save(); });
  notesCard.appendChild(notesT);
  main.appendChild(notesCard);

  // inventory
  main.appendChild(buildInventoryCard(working, sys, () => renderDetail(id), saveNow));
  // custom fields
  main.appendChild(buildCustomFields(working, save));

  detail.appendChild(main);

  // ---- side column ----
  const side = el('div.detail-side');

  // rewards
  side.appendChild(buildRewardsCard(working, sys, () => renderDetail(id)));

  // PC fields
  if (working.kind === 'pc' && sys) {
    const buildCard = el('div.side-card');
    buildCard.appendChild(el('h4', 'Build'));
    if (sys.backgrounds && sys.backgrounds.length) {
      const bgSel = select([{ value: '', label: '— Background —' }, ...sys.backgrounds.map((b) => ({ value: b.name, label: b.name }))], { value: working.background || '', onChange: (v) => { working.background = v; const bg = sys.backgrounds.find((b) => b.name === v); if (bg) { working.knacks = working.knacks || []; if (bg.knack && !working.knacks.includes(bg.knack)) working.knacks.push(bg.knack); } saveNow(); renderDetail(id); } });
      buildCard.appendChild(field('Background', bgSel));
    }
    buildCard.appendChild(tagEditor('Knacks', working.knacks || [], (arr) => { working.knacks = arr; save(); }));
    buildCard.appendChild(tagEditor('Gear', working.gear || [], (arr) => { working.gear = arr; save(); }));
    const tieI = input({ value: working.tie || '', placeholder: 'Someone/thing they protect' });
    tieI.addEventListener('input', () => { working.tie = tieI.value; save(); });
    buildCard.appendChild(field('Trying to protect', tieI));
    const fearI = input({ value: working.fear || '', placeholder: 'What breaks their nerve' });
    fearI.addEventListener('input', () => { working.fear = fearI.value; save(); });
    buildCard.appendChild(field('Breaks my nerve', fearI));
    const gritI = input({ type: 'number', value: working.grit || 0 });
    gritI.addEventListener('input', () => { working.grit = parseInt(gritI.value, 10) || 0; save(); });
    buildCard.appendChild(field('Grit', gritI));
    side.appendChild(buildCard);
  }

  // tags
  const tagCard = el('div.side-card');
  tagCard.appendChild(el('h4', 'Tags'));
  tagCard.appendChild(tagEditor(null, working.tags || [], (arr) => { working.tags = arr; save(); }));
  side.appendChild(tagCard);

  // conditions / tracks
  if (sys && (sys.conditions || sys.tracks)) {
    const condCard = el('div.side-card');
    condCard.appendChild(el('h4', 'Conditions & Tracks'));
    if (sys.tracks) {
      for (const tk of sys.tracks) {
        condCard.appendChild(el('div.tl-name.small.mute', { style: { marginBottom: '4px' } }, tk.name));
        const ladder = el('div.track-ladder');
        const cur = (working.tracks && working.tracks[tk.key]) || 0;
        (tk.stages || []).forEach((s, i) => {
          const step = el('div.track-step' + (i <= cur && i > 0 ? '.on' : '') + (i === cur ? '.cur' : ''), { title: s.effect });
          step.style.setProperty('--track-color', tk.color || 'var(--cool)');
          step.appendChild(el('span', s.name));
          step.addEventListener('click', () => { if (!working.tracks) working.tracks = {}; working.tracks[tk.key] = (working.tracks[tk.key] === i ? 0 : i); saveNow(); renderDetail(id); });
          ladder.appendChild(step);
        });
        condCard.appendChild(ladder);
      }
    }
    if (sys.conditions) {
      const condWrap = el('div.row.wrap.gap-2', { style: { marginTop: '10px' } });
      sys.conditions.forEach((cond) => {
        const active = (working.conditions || []).includes(cond.name);
        const ch = chip(cond.name, { color: active ? 'var(--bad)' : undefined, onClick: () => { working.conditions = working.conditions || []; const idx = working.conditions.indexOf(cond.name); if (idx >= 0) working.conditions.splice(idx, 1); else working.conditions.push(cond.name); saveNow(); renderDetail(id); } });
        if (active) ch.style.borderColor = 'var(--bad)';
        ch.title = cond.effect;
        condWrap.appendChild(ch);
      });
      condCard.appendChild(condWrap);
    }
    side.appendChild(condCard);
  }

  detail.appendChild(side);
  wrap.appendChild(detail);
  shell.render(wrap);
}

// ---------- helpers ----------
function tagEditor(label, items, onChange) {
  const wrapEl = el('div.field');
  if (label) wrapEl.appendChild(el('span.field-label', label));
  const box = el('div.tag-input');
  const arr = items.slice();
  function redraw() {
    clear(box);
    arr.forEach((t, i) => box.appendChild(chip(t, { onRemove: () => { arr.splice(i, 1); onChange(arr.slice()); redraw(); } })));
    const inp = el('input', { placeholder: 'add…' });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { arr.push(inp.value.trim()); onChange(arr.slice()); redraw(); setTimeout(() => box.querySelector('input').focus(), 0); } });
    box.appendChild(inp);
  }
  redraw();
  wrapEl.appendChild(box);
  return wrapEl;
}

function portraitMenu(c, done) {
  const m = modal({
    title: 'Portrait', width: 420,
    body: [
      el('div.portrait-pick', [
        (() => { const p = portraitNode(c, 80); p.classList.add('pp-img'); return p; })(),
        el('div.col.gap-2', [
          el('p.small.mute', 'A unique avatar is generated from this character. Regenerate for a new look, or upload your own image.'),
        ]),
      ]),
    ],
  });
  m.setFooter(
    button('Upload image…', { icon: 'upload', onClick: async () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const b64 = await fileToBase64(f);
        const saved = await store.saveMediaBase64('portraits', f.name, b64);
        c.portrait = saved.id;
        m.close(); done();
      };
      inp.click();
    } }),
    button('Regenerate', { icon: 'refresh', onClick: () => { c.portrait = null; c.portraitSeed = uid('seed'); m.close(); done(); } }),
    button('Done', { variant: 'primary', onClick: () => { m.close(); done(); } }),
  );
}

// ---------- Inventory ----------
function buildInventoryCard(working, sys, rerender, saveNow) {
  ensureProgress(working);
  const cardEl = el('div.card');
  const head = el('div.row.between'); head.appendChild(el('h3', 'Inventory'));
  head.appendChild(button('Add Item', { size: 'sm', icon: 'plus', onClick: () => addItemModal(working, sys, rerender) }));
  cardEl.appendChild(head);
  let any = false;
  [['gear', 'Gear'], ['consumable', 'Consumables'], ['treasure', 'Treasure']].forEach(([t, label]) => {
    const items = working.inventory.filter((i) => i.type === t);
    if (!items.length) return; any = true;
    cardEl.appendChild(el('div.divider', label));
    items.forEach((it) => cardEl.appendChild(invRow(working, it, rerender, saveNow)));
  });
  if (!any) cardEl.appendChild(el('p.small.mute', { style: { marginTop: '8px' } }, 'No items yet. Track gear, consumables, and treasure — and log when they\'re used or lost during play.'));
  if (working.inventoryLog.length) {
    const det = el('details', { style: { marginTop: '12px' } });
    det.appendChild(el('summary', { style: { cursor: 'pointer', color: 'var(--text-mute)', fontSize: '12px' } }, `Usage log (${working.inventoryLog.length})`));
    const log = el('div.col.gap-1', { style: { marginTop: '8px', maxHeight: '200px', overflowY: 'auto' } });
    working.inventoryLog.slice().reverse().forEach((e) => {
      const row = el('div.small');
      row.appendChild(el('span.mute', relTime(e.at) + ' · '));
      row.appendChild(el('b', e.action + ' '));
      row.appendChild(document.createTextNode(`${e.qty || ''} ${e.item}${e.note ? ' — ' + e.note : ''}`));
      log.appendChild(row);
    });
    det.appendChild(log); cardEl.appendChild(det);
  }
  return cardEl;
}

function invRow(working, it, rerender, saveNow) {
  const row = el('div.row.gap-2', { style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)' } });
  const qtyWrap = el('div.row.gap-1');
  const qtySpan = el('span.mono', { style: { minWidth: '22px', textAlign: 'center' } }, String(it.qty));
  qtyWrap.appendChild(iconButton('minus', { size: 13, onClick: async () => {
    if (it.type === 'consumable') { useItem(working, it.id, 1, '', appState.activeSessionId); await store.save('characters', working); rerender(); return; } // logs + auto-removes at 0
    it.qty = Math.max(0, (it.qty || 0) - 1); qtySpan.textContent = String(it.qty); saveNow();
  } }));
  qtyWrap.appendChild(qtySpan);
  qtyWrap.appendChild(iconButton('plus', { size: 13, onClick: () => { it.qty = (it.qty || 0) + 1; qtySpan.textContent = String(it.qty); saveNow(); } }));
  row.appendChild(qtyWrap);
  const meta = el('div.grow', { style: { minWidth: 0 } });
  const nameRow = el('div.row.gap-2');
  nameRow.appendChild(el('span', { style: { fontWeight: 600 } }, it.name));
  if (it.type === 'gear') {
    const eq = chip(it.equipped ? 'Equipped' : 'Stowed', { onClick: () => { it.equipped = !it.equipped; saveNow(); rerender(); } });
    if (it.equipped) eq.style.borderColor = 'var(--good)';
    nameRow.appendChild(eq);
  }
  meta.appendChild(nameRow);
  if (it.notes) meta.appendChild(el('div.tiny.mute', it.notes));
  row.appendChild(meta);
  const ctrl = el('div.row.gap-1');
  if (it.type === 'consumable' || it.qty > 0) ctrl.appendChild(button('Use', { size: 'sm', variant: 'ghost', onClick: () => useItemModal(working, it, rerender) }));
  ctrl.appendChild(iconButton('grip', { size: 15, onClick: (e) => invMenu(e, working, it, rerender) }));
  row.appendChild(ctrl);
  return row;
}

function addItemModal(working, sys, rerender) {
  const nameI = input({ placeholder: 'Item name' });
  const qtyI = input({ type: 'number', value: 1 });
  let type = 'gear';
  const typeSeg = segmented([{ value: 'gear', label: 'Gear' }, { value: 'consumable', label: 'Consumable' }, { value: 'treasure', label: 'Treasure' }], { value: 'gear', onChange: (v) => (type = v) });
  const notesI = input({ placeholder: 'Notes (optional)' });
  const m = modal({ title: 'Add Item', width: 440, body: [field('Name', nameI), field('Type', typeSeg), field('Quantity', qtyI), field('Notes', notesI)] });
  m.setFooter(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Add', { variant: 'primary', onClick: async () => { addItem(working, { name: nameI.value || 'Item', qty: parseInt(qtyI.value, 10) || 1, type, notes: notesI.value }); await store.save('characters', working); m.close(); rerender(); } }));
  setTimeout(() => nameI.focus(), 30);
}

function useItemModal(working, it, rerender) {
  const qtyI = input({ type: 'number', value: 1, min: 1 });
  const noteI = input({ placeholder: 'When/why (optional)' });
  const m = modal({ title: 'Use ' + it.name, width: 400, body: [field('Quantity used', qtyI), field('Note', noteI)] });
  m.setFooter(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Use', { variant: 'primary', onClick: async () => { useItem(working, it.id, parseInt(qtyI.value, 10) || 1, noteI.value, appState.activeSessionId); await store.save('characters', working); m.close(); rerender(); toast('Logged', { type: 'success', timeout: 900 }); } }));
  setTimeout(() => qtyI.focus(), 30);
}

function invMenu(e, working, it, rerender) {
  contextMenu([
    { label: 'Edit…', icon: 'edit', onClick: () => editItemModal(working, it, rerender) },
    { label: 'Mark lost…', icon: 'x', onClick: async () => { const note = await promptText({ title: 'Mark lost', label: it.name, placeholder: 'When/how it was lost' }); if (note !== null) { loseItem(working, it.id, note, appState.activeSessionId); await store.save('characters', working); rerender(); } } },
    '-',
    { label: 'Remove', icon: 'trash', danger: true, onClick: async () => { removeItem(working, it.id); await store.save('characters', working); rerender(); } },
  ], e.clientX, e.clientY);
}

function editItemModal(working, it, rerender) {
  const nameI = input({ value: it.name });
  const notesI = input({ value: it.notes || '' });
  let type = it.type;
  const typeSeg = segmented([{ value: 'gear', label: 'Gear' }, { value: 'consumable', label: 'Consumable' }, { value: 'treasure', label: 'Treasure' }], { value: it.type, onChange: (v) => (type = v) });
  const m = modal({ title: 'Edit Item', width: 440, body: [field('Name', nameI), field('Type', typeSeg), field('Notes', notesI)] });
  m.setFooter(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Save', { variant: 'primary', onClick: async () => { updateItem(working, it.id, { name: nameI.value, notes: notesI.value, type }); await store.save('characters', working); m.close(); rerender(); } }));
}

// ---------- Rewards ----------
function buildRewardsCard(working, sys, rerender) {
  ensureProgress(working);
  const rs = rewardStatOf(sys);
  const cardEl = el('div.side-card');
  cardEl.appendChild(el('h4', rs.name + ' & Rewards'));
  const cur = working.rewards[rs.key] || 0;
  const row = el('div.row.between', { style: { alignItems: 'center' } });
  row.appendChild(iconButton('minus', { title: 'Spend', onClick: () => adjustRewardModal(working, rs, -1, rerender) }));
  row.appendChild(el('div.col', { style: { alignItems: 'center', gap: '0' } }, [el('div', { style: { fontSize: '30px', fontWeight: 700, fontFamily: 'var(--font-display)', lineHeight: '1' } }, String(cur)), el('div.tiny.mute', rs.name)]));
  row.appendChild(iconButton('plus', { title: 'Award', onClick: () => adjustRewardModal(working, rs, 1, rerender) }));
  cardEl.appendChild(row);
  if (rs.desc) cardEl.appendChild(el('p.tiny.mute', { style: { marginTop: '8px', textAlign: 'center' } }, rs.desc));
  // other currencies the character has accumulated
  const others = Object.keys(working.rewards).filter((k) => k !== rs.key && working.rewards[k]);
  if (others.length) {
    const r2 = el('div.row.wrap.gap-2', { style: { marginTop: '8px', justifyContent: 'center' } });
    others.forEach((k) => r2.appendChild(badge(`${working.rewards[k]} ${k}`, { variant: 'dim' })));
    cardEl.appendChild(r2);
  }
  if (working.rewardLog.length) {
    const det = el('details', { style: { marginTop: '10px' } });
    det.appendChild(el('summary', { style: { cursor: 'pointer', color: 'var(--text-mute)', fontSize: '11px' } }, `History (${working.rewardLog.length})`));
    const log = el('div.col.gap-1', { style: { marginTop: '6px', maxHeight: '160px', overflowY: 'auto' } });
    working.rewardLog.slice().reverse().forEach((e) => { const r = el('div.tiny'); r.appendChild(el('span', { style: { color: e.delta >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 600 } }, (e.delta >= 0 ? '+' : '') + e.delta + ' ' + e.currency)); r.appendChild(el('span.mute', ' · ' + (e.reason || relTime(e.at)))); log.appendChild(r); });
    det.appendChild(log); cardEl.appendChild(det);
  }
  return cardEl;
}

function adjustRewardModal(working, rs, sign, rerender) {
  const amtI = input({ type: 'number', value: 1, min: 1 });
  const reasonI = input({ placeholder: sign > 0 ? 'e.g. survived the night' : 'e.g. raised an attribute' });
  const m = modal({ title: (sign > 0 ? 'Award ' : 'Spend ') + rs.name, width: 400, body: [field('Amount', amtI), field('Reason', reasonI)] });
  m.setFooter(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button(sign > 0 ? 'Award' : 'Spend', { variant: 'primary', onClick: async () => { adjustReward(working, rs.key, sign * (parseInt(amtI.value, 10) || 1), reasonI.value, appState.activeSessionId); await store.save('characters', working); m.close(); rerender(); } }));
  setTimeout(() => amtI.focus(), 30);
}

// ---------- Custom fields ----------
function buildCustomFields(working, save) {
  ensureProgress(working);
  const cardEl = el('div.card');
  const head = el('div.row.between'); head.appendChild(el('h3', 'Custom Fields'));
  head.appendChild(button('Add Field', { size: 'sm', icon: 'plus', onClick: () => { working.customFields.push({ label: 'New Field', value: '' }); save(); renderFields(); } }));
  cardEl.appendChild(head);
  const box = el('div.col.gap-2', { style: { marginTop: '8px' } });
  cardEl.appendChild(box);
  function renderFields() {
    clear(box);
    if (!working.customFields.length) { box.appendChild(el('p.small.mute', 'Add sheet fields specific to this character (Spell Slots, Faction Rep, Bonds, Cyberware…).')); return; }
    working.customFields.forEach((f, i) => {
      const row = el('div.row.gap-2');
      const li = input({ value: f.label, placeholder: 'Label' }); li.style.maxWidth = '42%';
      li.addEventListener('input', () => { f.label = li.value; save(); });
      const vi = input({ value: f.value, placeholder: 'Value' });
      vi.addEventListener('input', () => { f.value = vi.value; save(); });
      row.appendChild(li); row.appendChild(vi);
      row.appendChild(iconButton('trash', { size: 14, onClick: () => { working.customFields.splice(i, 1); save(); renderFields(); } }));
      box.appendChild(row);
    });
  }
  renderFields();
  return cardEl;
}

// ---------- Copy to another system ----------
function copyToSystem(working) {
  const systems = store.all('rulesets').filter((s) => s.id !== working.systemId);
  if (!systems.length) { toast('No other systems to copy to', { type: 'warn' }); return; }
  const fromSys = store.get('rulesets', working.systemId);
  const srcAttrs = (fromSys && fromSys.attributes) || [];
  let targetId = systems[0].id;
  let mapping = {};
  const sysSel = select(systems.map((s) => ({ value: s.id, label: s.name })), { value: targetId, onChange: (v) => { targetId = v; buildMapping(); } });
  const mapBox = el('div.col.gap-2');
  const m = modal({ title: `Copy "${working.name}" to another system`, width: 560, body: [
    el('p.small.mute', 'Creates a NEW character in the target system. Map this character\'s attributes onto the target\'s; unmapped target attributes use their defaults. Name, notes, tags, portrait, inventory and custom fields carry over.'),
    field('Target system', sysSel), mapBox,
  ] });
  function buildMapping() {
    clear(mapBox); mapping = {};
    const target = store.get('rulesets', targetId);
    mapBox.appendChild(el('div.divider', 'Attribute mapping'));
    (target.attributes || []).forEach((ta) => {
      const match = srcAttrs.find((sa) => sa.key === ta.key) || srcAttrs.find((sa) => (sa.name || '').toLowerCase() === (ta.name || '').toLowerCase());
      mapping[ta.key] = match ? match.key : '';
      const opts = [{ value: '', label: `— default (${ta.default}) —` }, ...srcAttrs.map((sa) => ({ value: sa.key, label: `${sa.name} (${working.attrs[sa.key] != null ? working.attrs[sa.key] : sa.default})` }))];
      const sel = select(opts, { value: mapping[ta.key], onChange: (v) => (mapping[ta.key] = v) });
      mapBox.appendChild(field(`${ta.name} (${ta.abbr})`, sel));
    });
  }
  buildMapping();
  m.setFooter(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Create copy', { variant: 'primary', icon: 'copy', onClick: async () => {
    const target = store.get('rulesets', targetId);
    const nc = blankCharacter(target, working.kind);
    nc.id = (working.kind === 'npc' ? 'npc_' : 'pc_') + uid('').slice(0, 8);
    nc.name = `${working.name} (${target.name})`; nc.role = working.role || ''; nc.notes = working.notes || '';
    nc.tags = (working.tags || []).slice(); nc.playerId = working.playerId || null; nc.threat = !!working.threat;
    nc.portrait = working.portrait || null; nc.portraitSeed = working.portraitSeed || uid('seed');
    nc.customFields = deepClone(working.customFields || []); nc.inventory = deepClone(working.inventory || []);
    nc.rewards = deepClone(working.rewards || {});
    (target.attributes || []).forEach((ta) => { const sk = mapping[ta.key]; if (sk && working.attrs[sk] != null) nc.attrs[ta.key] = working.attrs[sk]; });
    nc.derived = allDeriveds(target, nc);
    await store.save('characters', nc);
    m.close(); toast(`Copied to ${target.name}`, { type: 'success' }); router.go('characters', nc.id);
  } }));
}
