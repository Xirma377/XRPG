import { el, clear, deepClone } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, badge, chip, modal, confirm, toast, segmented, select, input, contextMenu, promptText } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import encounter from '../encounter.js';
import { clockDialSvg, TOKEN_COLORS } from '../assets.js';
import { allDeriveds } from '../rules.js';
import { portraitNode } from '../portrait.js';

let unsub = null;

export function teardown() { if (unsub) { unsub(); unsub = null; } }

export async function render() {
  const sys = appState.system;
  shell.crumbs([{ label: 'Combat Tracker' }]);
  if (unsub) { unsub(); unsub = null; }

  // default mode by system
  if (!encounter.state.combatants.length) {
    encounter.state.mode = (sys && sys.dice && sys.dice.resolution === 'roll-high') ? 'numeric' : 'phase';
  }

  shell.actions([
    button('Add Combatant', { icon: 'plus', size: 'sm', variant: 'primary', onClick: () => addCombatantModal(sys) }),
    button('Roll Initiative', { icon: 'dice', size: 'sm', onClick: () => { encounter.rollInitiativeAll(sys); toast('Initiative rolled', { type: 'success', timeout: 1200 }); } }),
    button('Reset', { icon: 'refresh', size: 'sm', variant: 'ghost', onClick: async () => { if (await confirm({ title: 'Reset encounter?', message: 'Remove all combatants and clocks?', danger: true })) encounter.reset(); } }),
  ]);

  const wrap = el('div.view-pad');
  const layout = el('div.combat-layout');
  const main = el('div');
  const side = el('div.detail-side');
  layout.appendChild(main); layout.appendChild(side);
  wrap.appendChild(layout);

  function draw() {
    // ---- main: round bar + combatants ----
    clear(main);
    const bar = el('div.row.between', { style: { marginBottom: '14px' } });
    const left = el('div.row.gap-4');
    left.appendChild(el('div.huge.display', 'Round ' + encounter.state.round));
    left.appendChild(segmented([{ value: 'phase', label: 'Phases' }, { value: 'numeric', label: 'Numeric' }], { value: encounter.state.mode, onChange: (v) => encounter.setMode(v) }));
    bar.appendChild(left);
    const turnCtrl = el('div.row.gap-2');
    turnCtrl.appendChild(iconButton('chevL', { title: 'Previous turn', onClick: () => encounter.prevTurn() }));
    turnCtrl.appendChild(button('Next Turn', { icon: 'chevR', onClick: () => encounter.nextTurn() }));
    turnCtrl.appendChild(iconButton('refresh', { title: 'Reset turns', onClick: () => encounter.resetTurns() }));
    bar.appendChild(turnCtrl);
    main.appendChild(bar);

    const cbs = encounter.state.combatants;
    if (!cbs.length) {
      main.appendChild(empty('No combatants', { icon: 'swords', hint: 'Add player characters, NPCs, or quick threats to begin.', action: button('Add combatant', { variant: 'primary', icon: 'plus', onClick: () => addCombatantModal(sys) }) }));
      return;
    }

    cbs.forEach((c) => main.appendChild(combatantRow(c, sys)));
  }

  function drawSide() {
    clear(side);
    // clocks
    const clockCard = el('div.side-card');
    const ch = el('div.row.between');
    ch.appendChild(el('h4', { style: { margin: 0 } }, 'Clocks'));
    ch.appendChild(iconButton('plus', { title: 'Add clock', size: 16, onClick: () => addClockModal(sys) }));
    clockCard.appendChild(ch);
    if (!encounter.state.clocks.length) clockCard.appendChild(el('p.small.mute', { style: { marginTop: '8px' } }, 'No clocks. Add hordes, hazards, or countdowns.'));
    encounter.state.clocks.forEach((clk) => clockCard.appendChild(clockRow(clk)));
    side.appendChild(clockCard);

    // quick add from roster
    const rosterCard = el('div.side-card');
    rosterCard.appendChild(el('h4', 'Quick Add from Roster'));
    const chars = store.where('characters', (c) => c.systemId === (sys && sys.id)).slice(0, 30);
    if (!chars.length) rosterCard.appendChild(el('p.small.mute', 'No characters for this system.'));
    const list = el('div.col.gap-1', { style: { maxHeight: '320px', overflowY: 'auto' } });
    chars.forEach((c) => {
      const row = el('div.vtt-token-row');
      const tk = portraitNode(c, 26, { round: true }); row.appendChild(tk);
      row.appendChild(el('div.tn', c.name));
      row.appendChild(badge(c.kind === 'pc' ? 'PC' : 'NPC', { variant: 'dim' }));
      row.addEventListener('click', () => { encounter.addFromCharacter(c, sys); toast(`Added ${c.name}`, { type: 'success', timeout: 1000 }); });
      list.appendChild(row);
    });
    rosterCard.appendChild(list);
    side.appendChild(rosterCard);
  }

  unsub = encounter.on('change', () => { draw(); drawSide(); });
  draw(); drawSide();
  shell.render(wrap);
}

function combatantRow(c, sys) {
  const row = el('div.combatant' + (c.active ? ' active' : '') + (c.down ? ' down' : ''));
  // initiative
  const ini = el('div.ini');
  if (encounter.state.mode === 'phase') {
    ini.innerHTML = '';
    const tag = el('span.phase-tag' + (c.ini === 'fast' ? '.phase-fast' : '.phase-slow'), c.ini === 'fast' ? 'FAST' : c.ini === 'slow' ? 'SLOW' : '—');
    ini.replaceWith(tag);
    row.appendChild(tag);
    tag.style.cursor = 'pointer';
    tag.title = 'Toggle Fast/Slow';
    tag.addEventListener('click', () => encounter.update(c.id, { ini: c.ini === 'fast' ? 'slow' : 'fast' }));
  } else {
    ini.textContent = c.ini != null ? c.ini : '—';
    ini.style.cursor = 'pointer'; ini.title = 'Set initiative';
    ini.addEventListener('click', async () => { const v = await promptText({ title: 'Initiative', label: c.name, value: String(c.ini || 0) }); if (v != null) { encounter.update(c.id, { ini: parseInt(v, 10) || 0 }); encounter.sortByInit(); } });
    row.appendChild(ini);
  }

  // token / portrait
  const char = c.charId ? store.get('characters', c.charId) : null;
  const tk = el('div.ctoken');
  if (char) tk.appendChild(portraitNode(char, 36, { round: true }));
  else { tk.style.background = TOKEN_COLORS[c.kind] || TOKEN_COLORS.neutral; tk.style.display = 'grid'; tk.style.placeItems = 'center'; tk.innerHTML = `<span style="font-weight:700;font-family:var(--font-display);color:#0009">${(c.name || '?')[0]}</span>`; }
  row.appendChild(tk);

  // meta
  const meta = el('div.cmeta');
  const nameRow = el('div.row.gap-2');
  nameRow.appendChild(el('div.cname', c.name));
  nameRow.appendChild(badge(c.kind === 'pc' ? 'PC' : c.kind === 'threat' ? 'Threat' : 'NPC', { color: TOKEN_COLORS[c.kind], variant: undefined }));
  if (c.down) nameRow.appendChild(badge('DOWN', { color: 'var(--bad)' }));
  meta.appendChild(nameRow);
  if (c.conditions && c.conditions.length) {
    const cond = el('div.csub', c.conditions.join(' · '));
    meta.appendChild(cond);
  }
  // hp bar
  if (c.hp) {
    const pct = c.hp.max ? (c.hp.cur / c.hp.max) * 100 : 0;
    const bar = el('div.hpbar' + (pct < 25 ? ' crit' : pct < 50 ? ' low' : ''));
    bar.appendChild(el('span', { style: { width: pct + '%' } }));
    meta.appendChild(bar);
  }
  row.appendChild(meta);

  // hp controls
  if (c.hp) {
    const hpCtrl = el('div.row.gap-1');
    const hpKey = c.hp.key ? (sys.deriveds.find((d) => d.key === c.hp.key) || {}).abbr : 'HP';
    hpCtrl.appendChild(iconButton('minus', { title: 'Damage', size: 15, onClick: () => encounter.damage(c.id, 1) }));
    const hpVal = el('div.mono', { style: { minWidth: '54px', textAlign: 'center' }, title: 'Click to set' }, `${c.hp.cur}/${c.hp.max}`);
    hpVal.style.cursor = 'pointer';
    hpVal.addEventListener('click', async () => { const v = await promptText({ title: `${hpKey || 'HP'} current`, label: c.name, value: String(c.hp.cur) }); if (v != null) { c.hp.cur = Math.max(0, Math.min(c.hp.max, parseInt(v, 10) || 0)); encounter.update(c.id, { hp: c.hp }); } });
    hpCtrl.appendChild(hpVal);
    hpCtrl.appendChild(iconButton('plus', { title: 'Heal', size: 15, onClick: () => encounter.damage(c.id, -1) }));
    row.appendChild(hpCtrl);
  }

  // menu
  row.appendChild(iconButton('grip', { title: 'More', size: 16, onClick: (e) => combatantMenu(e, c, sys) }));
  return row;
}

function combatantMenu(e, c, sys) {
  const items = [];
  // damage amounts
  items.push({ label: 'Apply damage…', icon: 'minus', onClick: async () => { const v = await promptText({ title: 'Damage amount', value: '1' }); if (v) encounter.damage(c.id, parseInt(v, 10) || 0); } });
  items.push({ label: 'Heal…', icon: 'plus', onClick: async () => { const v = await promptText({ title: 'Heal amount', value: '1' }); if (v) encounter.damage(c.id, -(parseInt(v, 10) || 0)); } });
  items.push('-');
  // conditions
  if (sys && sys.conditions) {
    sys.conditions.forEach((cond) => {
      const active = (c.conditions || []).includes(cond.name);
      items.push({ label: (active ? '✓ ' : '') + cond.name, onClick: () => { const conds = (c.conditions || []).slice(); const i = conds.indexOf(cond.name); if (i >= 0) conds.splice(i, 1); else conds.push(cond.name); encounter.update(c.id, { conditions: conds }); } });
    });
    items.push('-');
  }
  items.push({ label: c.down ? 'Mark up' : 'Mark down', icon: 'heart', onClick: () => encounter.update(c.id, { down: !c.down, hp: c.hp ? { ...c.hp, cur: c.down ? Math.max(1, c.hp.cur) : 0 } : c.hp }) });
  if (c.charId) items.push({ label: 'Open character sheet', icon: 'mask', onClick: () => shell.go('characters', c.charId) });
  items.push('-');
  items.push({ label: 'Remove', icon: 'trash', danger: true, onClick: () => encounter.remove(c.id) });
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(items, r.left - 160, r.bottom + 4);
}

function clockRow(clk) {
  const row = el('div.clock');
  const dial = el('div.clock-dial');
  dial.innerHTML = clockDialSvg(clk.filled, clk.size, clk.color || 'var(--accent)');
  row.appendChild(dial);
  const info = el('div.clock-info');
  info.appendChild(el('div.clock-name', clk.name));
  info.appendChild(el('div.clock-sub', `${clk.filled} / ${clk.size}`));
  row.appendChild(info);
  const ctrl = el('div.clock-controls');
  ctrl.appendChild(iconButton('minus', { size: 14, onClick: () => encounter.tickClock(clk.id, -1) }));
  ctrl.appendChild(iconButton('plus', { size: 14, onClick: () => encounter.tickClock(clk.id, 1) }));
  ctrl.appendChild(iconButton('x', { size: 14, title: 'Remove', onClick: () => encounter.removeClock(clk.id) }));
  row.appendChild(ctrl);
  return row;
}

function addCombatantModal(sys) {
  const nameI = input({ placeholder: 'Name' });
  let kind = 'npc';
  const kindSeg = segmented([{ value: 'pc', label: 'PC' }, { value: 'npc', label: 'NPC' }, { value: 'threat', label: 'Threat' }], { value: kind, onChange: (v) => (kind = v) });
  const hpI = input({ type: 'number', value: 10, placeholder: 'HP' });
  // from bestiary
  let bestiarySel = null;
  if (sys && sys.bestiary && sys.bestiary.length) {
    bestiarySel = select([{ value: '', label: '— From bestiary —' }, ...sys.bestiary.map((b, i) => ({ value: String(i), label: b.name }))], { value: '', onChange: (v) => { if (v !== '') { const b = sys.bestiary[parseInt(v, 10)]; nameI.value = b.name; if (b.body) hpI.value = b.body; } } });
  }
  const m = modal({ title: 'Add Combatant', width: 440, body: [
    bestiarySel ? el('label.field', [el('span.field-label', 'Bestiary'), bestiarySel]) : null,
    el('label.field', [el('span.field-label', 'Name'), nameI]),
    el('label.field', [el('span.field-label', 'Type'), kindSeg]),
    el('label.field', [el('span.field-label', 'HP / Body'), hpI]),
  ].filter(Boolean) });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Add', { variant: 'primary', onClick: () => { const hp = parseInt(hpI.value, 10) || 10; encounter.addCombatant({ name: nameI.value || 'Combatant', kind, hp: { cur: hp, max: hp } }); m.close(); } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

function addClockModal(sys) {
  const nameI = input({ placeholder: 'Clock name' });
  const sizeI = input({ type: 'number', value: 6 });
  let templateSel = null;
  if (sys && sys.clockTemplates && sys.clockTemplates.length) {
    templateSel = select([{ value: '', label: '— Template —' }, ...sys.clockTemplates.map((t, i) => ({ value: String(i), label: `${t.name} (${t.size})` }))], { value: '', onChange: (v) => { if (v !== '') { const t = sys.clockTemplates[parseInt(v, 10)]; nameI.value = t.name; sizeI.value = t.size; } } });
  }
  const m = modal({ title: 'Add Clock', width: 400, body: [
    templateSel ? el('label.field', [el('span.field-label', 'Template'), templateSel]) : null,
    el('label.field', [el('span.field-label', 'Name'), nameI]),
    el('label.field', [el('span.field-label', 'Segments'), sizeI]),
  ].filter(Boolean) });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Add', { variant: 'primary', onClick: () => { encounter.addClock(nameI.value || 'Clock', parseInt(sizeI.value, 10) || 6, null); m.close(); } }),
  );
  setTimeout(() => nameI.focus(), 30);
}
