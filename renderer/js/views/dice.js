import { el, clear, fmtClock } from '../util.js';
import { icon } from '../icons.js';
import { button, empty, select, input, segmented, badge, toast } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import { resolveCheck, rollNotation, rollUnderProbability, logRoll, getHistory, clearHistory, diceLog } from '../dice.js';
import { allDeriveds } from '../rules.js';

let unsubs = [];

export function teardown() { unsubs.forEach((u) => u && u()); unsubs = []; }

export async function render() {
  const sys = appState.system;
  shell.crumbs([{ label: 'Dice' }]);
  shell.actions(null);
  unsubs.forEach((u) => u && u()); unsubs = [];

  if (!sys) { shell.render(el('div.view-pad', [empty('No system selected', { icon: 'dice' })])); return; }

  const wrap = el('div.view-pad');
  wrap.appendChild(headerLine(sys));

  const stage = el('div.dice-stage');

  // ---- Board ----
  const board = el('div.dice-board');
  const faces = el('div.dice-faces');
  const outcome = el('div.roll-outcome', '—');
  const detail = el('div.roll-detail', sys.dice ? sys.dice.summary : '');
  const probLine = el('div.small.mute', { style: { marginTop: '6px' } });

  // controls
  const controls = el('div.col.gap-4', { style: { marginTop: '18px', textAlign: 'left' } });

  // character selector
  const chars = store.where('characters', (c) => c.systemId === sys.id);
  let selectedChar = null;
  const charSel = select([{ value: '', label: 'Manual (no character)' }, ...chars.map((c) => ({ value: c.id, label: `${c.name} (${c.kind === 'npc' ? 'NPC' : 'PC'})` }))], { value: '', onChange: (v) => { selectedChar = v ? store.get('characters', v) : null; syncFromChar(); } });

  const res = (sys.dice && sys.dice.resolution) || 'flat';

  let attrKey = (sys.attributes && sys.attributes[0] && sys.attributes[0].key) || null;
  let easeName = null, easeMod = 0, dc = 10, manualTarget = null;

  const attrSel = sys.attributes ? select(sys.attributes.map((a) => ({ value: a.key, label: a.name })), { value: attrKey, onChange: (v) => { attrKey = v; updatePreview(); } }) : null;

  // ease / DC ladder
  let ladderSeg = null;
  if (res === 'roll-under' && sys.easeLadder) {
    easeName = (sys.easeLadder.find((e) => e.mod === 0) || sys.easeLadder[0]).name;
    easeMod = (sys.easeLadder.find((e) => e.name === easeName) || {}).mod || 0;
    ladderSeg = segmented(sys.easeLadder.map((e) => ({ value: e.name, label: `${e.name} ${e.mod >= 0 ? '+' : ''}${e.mod}` })), { value: easeName, onChange: (v) => { easeName = v; easeMod = sys.easeLadder.find((e) => e.name === v).mod; updatePreview(); } });
  }
  let dcSeg = null;
  if ((res === 'roll-high' || res === 'degrees') && sys.dcLadder) {
    dc = (sys.dcLadder.find((d) => d.name === 'Medium') || sys.dcLadder[Math.floor(sys.dcLadder.length / 2)] || sys.dcLadder[0]).dc;
    dcSeg = segmented(sys.dcLadder.map((d) => ({ value: String(d.dc), label: `${d.name} (${d.dc})` })), { value: String(dc), onChange: (v) => { dc = parseInt(v, 10); updatePreview(); } });
  }

  function currentTarget() {
    if (res === 'roll-under') {
      let attrVal = manualTarget != null ? manualTarget : attrValue();
      return attrVal + easeMod;
    }
    return dc;
  }
  function attrValue() {
    if (!attrKey) return 10;
    if (selectedChar) { const der = allDeriveds(sys, selectedChar); return selectedChar.attrs[attrKey] != null ? selectedChar.attrs[attrKey] : (der[attrKey] != null ? der[attrKey] : 0); }
    const a = sys.attributes.find((x) => x.key === attrKey); return a ? (a.default || 0) : 0;
  }
  function modValue() {
    // for roll-high / pbta: attribute value is the modifier
    if (!attrKey) return 0;
    if (selectedChar) { const der = allDeriveds(sys, selectedChar); return selectedChar.attrs[attrKey] != null ? selectedChar.attrs[attrKey] : (der[attrKey] != null ? der[attrKey] : 0); }
    const a = sys.attributes.find((x) => x.key === attrKey); return a ? (a.default || 0) : 0;
  }

  function syncFromChar() { updatePreview(); }

  function updatePreview() {
    if (res === 'roll-under') {
      const t = currentTarget();
      const pr = rollUnderProbability(sys.dice.notation || '3d6', t);
      probLine.textContent = `Target ${t}${pr != null ? ' · ' + Math.round(pr * 100) + '% to succeed' : ''}`;
    } else if (res === 'percentile') {
      const t = manualTarget != null ? manualTarget : attrValue();
      probLine.textContent = `Roll ≤ ${t}% · Hard ≤ ${Math.floor(t / 2)} · Extreme ≤ ${Math.floor(t / 5)}`;
    } else if (res === 'roll-high') {
      probLine.textContent = `${sys.dice.notation} ${modValue() >= 0 ? '+' : ''}${modValue()} vs DC ${dc}`;
    } else if (res === 'degrees') {
      probLine.textContent = `${sys.dice.notation} ${modValue() >= 0 ? '+' : ''}${modValue()} vs DC ${dc} · crit at ${dc + 10}+`;
    } else if (res === 'pbta') {
      probLine.textContent = `2d6 ${modValue() >= 0 ? '+' : ''}${modValue()} · 10+ strong, 7–9 cost, 6− miss`;
    }
  }

  const attrLabel = res === 'roll-under' ? 'Attribute' : res === 'percentile' ? 'Skill / Characteristic' : res === 'degrees' ? 'Modifier' : 'Stat';
  if (attrSel) controls.appendChild(labeledRow('Character', charSel));
  if (attrSel) controls.appendChild(labeledRow(attrLabel, attrSel));
  if (ladderSeg) controls.appendChild(labeledRow('Difficulty', ladderSeg));
  if (dcSeg) controls.appendChild(labeledRow('Difficulty', dcSeg));

  const rollBtn = button('Roll ' + (sys.dice ? sys.dice.notation : ''), { variant: 'primary', icon: 'dice', onClick: doRoll });
  rollBtn.classList.add('btn-lg');

  function setFaces(diceArr, opts = {}) {
    clear(faces);
    diceArr.forEach((d) => {
      const die = el('div.die3d', String(d));
      if (opts.critS) die.classList.add('crit-s');
      if (opts.critF) die.classList.add('crit-f');
      faces.appendChild(die);
    });
  }

  function doRoll(presetOpts) {
    const opts = presetOpts || {};
    let target, mod;
    if (res === 'roll-under') {
      const aKey = opts.attr || attrKey;
      let aVal;
      if (selectedChar && aKey) { const der = allDeriveds(sys, selectedChar); aVal = selectedChar.attrs[aKey] != null ? selectedChar.attrs[aKey] : (der[aKey] || 0); }
      else { const a = sys.attributes.find((x) => x.key === aKey); aVal = a ? (a.default || 0) : (manualTarget || 10); }
      const em = opts.ease ? ((sys.easeLadder.find((e) => e.name === opts.ease) || {}).mod || 0) : easeMod;
      target = (manualTarget != null && !opts.attr ? manualTarget : aVal) + em;
    } else if (res === 'percentile') {
      const aVal = opts.attr ? charMod(opts.attr) : attrValue();
      target = (manualTarget != null && !opts.attr) ? manualTarget : aVal;
    } else {
      mod = opts.attr ? charMod(opts.attr) : modValue();
    }
    const result = resolveCheck(sys, { target, mod, dc });
    animateAndShow(result, opts);
  }

  function charMod(aKey) {
    if (selectedChar) { const der = allDeriveds(sys, selectedChar); return selectedChar.attrs[aKey] != null ? selectedChar.attrs[aKey] : (der[aKey] || 0); }
    const a = sys.attributes.find((x) => x.key === aKey); return a ? (a.default || 0) : 0;
  }

  let rolling = false;
  function animateAndShow(result, opts) {
    if (rolling) return;
    rolling = true;
    const finalDice = result.dice || [];
    const n = finalDice.length || 1;
    let ticks = 0;
    const sides = (sys.dice && parseInt((sys.dice.notation || '1d6').split('d')[1], 10)) || 6;
    const iv = setInterval(() => {
      const fake = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
      setFaces(fake);
      faces.querySelectorAll('.die3d').forEach((d) => d.classList.add('rolling'));
      if (++ticks > 6) { clearInterval(iv); settle(result, opts); rolling = false; }
    }, 55);
  }

  function settle(result, opts) {
    setFaces(result.dice, { critS: result.critSuccess, critF: result.critFail });
    let label = '', cls = '';
    if (result.kind === 'roll-under' || result.kind === 'roll-high') {
      label = result.success ? 'SUCCESS' : 'FAILURE';
      cls = result.success ? 'success' : 'fail';
      if (result.critSuccess) label = 'CRIT SUCCESS';
      if (result.critFail) label = 'CRIT FAIL';
    } else if (result.kind === 'pbta') {
      label = result.band === 'strong' ? '10+ STRONG HIT' : result.band === 'weak' ? '7–9 HIT (cost)' : 'MISS';
      cls = result.band === 'miss' ? 'fail' : 'success';
    } else if (result.kind === 'percentile') {
      const L = { critical: 'CRITICAL', extreme: 'EXTREME', hard: 'HARD SUCCESS', regular: 'SUCCESS', fail: 'FAILURE', fumble: 'FUMBLE' };
      label = L[result.level] || (result.success ? 'SUCCESS' : 'FAILURE');
      cls = result.success ? 'success' : 'fail';
    } else if (result.kind === 'degrees') {
      const L = { 'critical-success': 'CRIT SUCCESS', success: 'SUCCESS', failure: 'FAILURE', 'critical-failure': 'CRIT FAILURE' };
      label = L[result.degree];
      cls = result.success ? 'success' : 'fail';
    } else if (result.kind === 'pool') {
      label = `${result.successes} SUCCESS${result.successes === 1 ? '' : 'ES'}`;
      cls = result.success ? 'success' : 'fail';
    } else {
      label = String(result.total != null ? result.total : (result.summary || '—'));
    }
    outcome.textContent = label; outcome.className = 'roll-outcome ' + cls;
    let dtxt = result.summary || '';
    if (result.kind === 'roll-under') { dtxt = `Rolled ${result.total} vs target ${result.target} (margin ${result.margin >= 0 ? '+' : ''}${result.margin})`; if (result.cleanHit) dtxt += ` · CLEAN HIT (${result.cleanHitEffect})`; }
    if (result.kind === 'roll-high') dtxt = `${result.dice[0]}${result.mod >= 0 ? '+' : ''}${result.mod} = ${result.total} vs DC ${result.target}`;
    if (result.kind === 'degrees') dtxt = `${result.natural}${result.mod >= 0 ? '+' : ''}${result.mod} = ${result.total} vs DC ${result.target}`;
    if (result.kind === 'percentile') dtxt = `Rolled ${result.total} vs ${result.target}%`;
    detail.textContent = dtxt;
    logRoll({ system: sys.id, label: (opts && opts.name) || rollLabel(result), result, char: selectedChar ? selectedChar.name : null });
  }

  function rollLabel(result) {
    if (result.kind === 'roll-under') return (attrSel ? (sys.attributes.find((a) => a.key === attrKey) || {}).name : '') + (easeName ? ' (' + easeName + ')' : '');
    return (attrKey ? (sys.attributes.find((a) => a.key === attrKey) || {}).name : 'Roll');
  }

  controls.appendChild(el('div.row.gap-2.wrap', [rollBtn,
    (res === 'roll-under' || res === 'percentile') ? manualTargetField() : null,
  ].filter(Boolean)));

  function manualTargetField() {
    const w = el('label.field.inline');
    w.appendChild(el('span.field-label', res === 'percentile' ? 'or skill %' : 'or manual target'));
    const i = input({ type: 'number', placeholder: 'auto', style: { width: '80px' } });
    i.style.width = '80px';
    i.addEventListener('input', () => { manualTarget = i.value === '' ? null : parseInt(i.value, 10); updatePreview(); });
    w.appendChild(i);
    return w;
  }

  board.appendChild(faces);
  board.appendChild(outcome);
  board.appendChild(detail);
  board.appendChild(probLine);
  board.appendChild(controls);

  // presets
  if (sys.rollPresets && sys.rollPresets.length) {
    const pres = el('div', { style: { marginTop: '20px', textAlign: 'left' } });
    pres.appendChild(el('div.field-label', { style: { marginBottom: '8px' } }, 'Quick rolls'));
    const grid = el('div.preset-grid');
    sys.rollPresets.forEach((p) => {
      const b = el('button.preset-btn');
      b.appendChild(el('div.pn', p.name));
      const a = sys.attributes && sys.attributes.find((x) => x.key === p.attr);
      b.appendChild(el('div.pd', `${a ? a.abbr || a.name : ''}${p.ease ? ' · ' + p.ease : ''}`));
      if (p.note) b.title = p.note;
      b.addEventListener('click', () => doRoll({ attr: p.attr, ease: p.ease, name: p.name }));
      grid.appendChild(b);
    });
    pres.appendChild(grid);
    board.appendChild(pres);
  }

  // manual notation
  const manual = el('div', { style: { marginTop: '18px', textAlign: 'left' } });
  manual.appendChild(el('div.field-label', { style: { marginBottom: '6px' } }, 'Free dice (notation)'));
  const mrow = el('div.row.gap-2');
  const notI = input({ placeholder: 'e.g. 2d6+2, 1d20, 4d6kh3', value: '' });
  mrow.appendChild(notI);
  mrow.appendChild(button('Roll', { onClick: () => {
    const r = rollNotation(notI.value.trim());
    if (!r) { toast('Invalid notation', { type: 'error' }); return; }
    setFaces(r.dice);
    outcome.textContent = String(r.total); outcome.className = 'roll-outcome';
    detail.textContent = `${notI.value} → [${r.dice.join(', ')}]${r.mod ? (r.mod > 0 ? ' +' + r.mod : ' ' + r.mod) : ''} = ${r.total}`;
    logRoll({ system: sys.id, label: notI.value, result: { kind: 'flat', dice: r.dice, total: r.total, summary: String(r.total) } });
  } }));
  manual.appendChild(mrow);
  board.appendChild(manual);

  stage.appendChild(board);

  // ---- Log ----
  const logCol = el('div');
  const logHead = el('div.section-header');
  const lt = el('div.section-title'); lt.appendChild(icon('history', 18)); lt.appendChild(el('h2', 'Roll Log'));
  logHead.appendChild(lt);
  logHead.appendChild(button('Clear', { size: 'sm', variant: 'ghost', onClick: () => { clearHistory(); drawLog(); } }));
  logCol.appendChild(logHead);
  const logBox = el('div.dice-log');
  logCol.appendChild(logBox);
  stage.appendChild(logCol);

  function drawLog() {
    clear(logBox);
    const hist = getHistory().filter((h) => h.system === sys.id);
    if (!hist.length) { logBox.appendChild(empty('No rolls yet', { icon: 'dice' })); return; }
    hist.forEach((h) => {
      const row = el('div.dice-log-row');
      const r = h.result;
      let resTxt = r.summary, success = null;
      if (r.kind === 'roll-under' || r.kind === 'roll-high' || r.kind === 'percentile' || r.kind === 'degrees') success = r.success;
      if (r.kind === 'pbta') success = r.band !== 'miss';
      const resEl = el('span.res' + (success === true ? '.s' : success === false ? '.f' : ''), String(r.total != null ? r.total : (r.successes != null ? r.successes : '')));
      row.appendChild(resEl);
      const meta = el('div.grow');
      meta.appendChild(el('div', { style: { fontWeight: 600, fontSize: '12.5px' } }, h.label || 'Roll' + (h.char ? ' · ' + h.char : '')));
      meta.appendChild(el('div.small.mute', `[${(r.dice || []).join(', ')}] ${r.summary || ''}`));
      row.appendChild(meta);
      logBox.appendChild(row);
    });
  }

  unsubs.push(diceLog.on('roll', drawLog));
  unsubs.push(diceLog.on('clear', drawLog));
  updatePreview();
  drawLog();

  wrap.appendChild(stage);
  shell.render(wrap);
}

function headerLine(sys) {
  const h = el('div.section-header');
  const t = el('div.section-title'); t.appendChild(icon('dice', 20)); t.appendChild(el('h2', 'Dice — ' + sys.name)); h.appendChild(t);
  if (sys.dice) h.appendChild(badge(sys.dice.notation + ' · ' + sys.dice.resolution, { variant: 'dim' }));
  return h;
}

function labeledRow(label, control) {
  const w = el('div.field');
  w.appendChild(el('span.field-label', label));
  w.appendChild(control);
  return w;
}
