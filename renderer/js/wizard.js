// Guided, system-driven character creation wizard (Charactermancer-style):
// a full-screen, two-pane flow (current step + contextual rules help), a live
// stat preview, validation, and a review step. Steps adapt to the active system's
// definition (attributes, attributeRules, backgrounds, deriveds, characterTemplate).
import { el, clear, clamp, uid } from './util.js';
import { icon } from './icons.js';
import { button, iconButton, input, textarea, select, field, chip, toast, confirm } from './ui.js';
import { setMarkdown } from './markdown.js';
import store from './store.js';
import appState from './state.js';
import { blankCharacter, allDeriveds, validateCreation } from './rules.js';
import { portraitNode } from './portrait.js';

export function openCreationWizard(opts = {}) {
  return new Promise((resolve) => {
    const systems = store.all('rulesets');
    let systemId = opts.systemId || appState.activeSystemId || (systems[0] && systems[0].id);
    let kind = opts.kind || 'pc';
    let system = store.get('rulesets', systemId) || systems[0];
    if (!system) { toast('Add a game system first', { type: 'warn' }); resolve(null); return; }
    let working = blankCharacter(system, kind);
    working.portraitSeed = uid('seed');

    // ---- overlay shell ----
    const overlay = el('div', { style: { position: 'fixed', inset: '0', zIndex: '500', background: 'var(--bg-0, #0b0e13)', display: 'flex', flexDirection: 'column' } });
    const header = el('div', { style: { display: 'flex', alignItems: 'center', gap: '16px', padding: '14px 22px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' } });
    const titleWrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', minWidth: '0' } });
    titleWrap.appendChild(icon('mask', 22));
    titleWrap.appendChild(el('div', [el('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'Create a Character'), el('div.small.mute', system.name + (kind === 'npc' ? ' · NPC' : ''))]));
    header.appendChild(titleWrap);
    const stepBar = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', flex: '1', justifyContent: 'center' } });
    header.appendChild(stepBar);
    const preview = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
    header.appendChild(preview);
    header.appendChild(iconButton('x', { title: 'Cancel', size: 20, onClick: () => cancel() }));
    overlay.appendChild(header);

    const main = el('div', { style: { flex: '1', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', minHeight: '0' } });
    const left = el('div', { style: { overflow: 'auto', padding: '28px 32px' } });
    const right = el('div', { style: { overflow: 'auto', padding: '24px', borderLeft: '1px solid var(--line)', background: 'var(--bg-1)' } });
    main.appendChild(left); main.appendChild(right);
    overlay.appendChild(main);

    const footer = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 22px', borderTop: '1px solid var(--line)', background: 'var(--panel)' } });
    overlay.appendChild(footer);
    document.body.appendChild(overlay);

    // ---- steps (adapt to the system) ----
    function steps() {
      const s = [];
      if (!opts.systemId && systems.length > 1) s.push('system');
      s.push('identity', 'attributes');
      if ((system.backgrounds || []).length) s.push('background');
      s.push('details', 'review');
      return s;
    }
    let stepIdx = 0;
    const stepTitles = { system: 'System', identity: 'Identity', attributes: 'Attributes', background: 'Background', details: 'Details', review: 'Review' };

    function refresh() { working.derived = allDeriveds(system, working); drawPreview(); }

    function drawPreview() {
      clear(preview);
      const port = portraitNode(working, 34, { round: true });
      preview.appendChild(port);
      const der = working.derived || {};
      const chips = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', maxWidth: '320px' } });
      (system.deriveds || []).slice(0, 4).forEach((d) => { const v = der[d.key]; if (v != null) chips.appendChild(chip(`${d.abbr || d.name} ${v}`)); });
      preview.appendChild(chips);
    }

    function drawStepBar() {
      clear(stepBar);
      steps().forEach((key, i) => {
        const b = el('button', { type: 'button', style: stepPill(i === stepIdx, i < stepIdx) });
        b.textContent = (i + 1) + '. ' + stepTitles[key];
        b.addEventListener('click', () => { stepIdx = i; draw(); });
        stepBar.appendChild(b);
      });
    }

    function draw() {
      drawStepBar();
      clear(left); clear(right); clear(footer);
      const key = steps()[stepIdx];
      ({ system: stepSystem, identity: stepIdentity, attributes: stepAttributes, background: stepBackground, details: stepDetails, review: stepReview })[key]();
      // footer
      const back = button('Back', { icon: 'chevL', variant: 'ghost', onClick: () => { stepIdx = clamp(stepIdx - 1, 0, steps().length - 1); draw(); } });
      back.disabled = stepIdx === 0;
      footer.appendChild(el('div', [back]));
      const right2 = el('div.row.gap-2');
      right2.appendChild(button('Cancel', { variant: 'ghost', onClick: () => cancel() }));
      if (key === 'review') right2.appendChild(button('Create Character', { variant: 'primary', icon: 'check', onClick: () => finish() }));
      else right2.appendChild(button('Next', { variant: 'primary', icon: 'chevR', onClick: () => { stepIdx = clamp(stepIdx + 1, 0, steps().length - 1); draw(); } }));
      footer.appendChild(right2);
      refresh();
    }

    function help(title, nodes) {
      right.appendChild(el('div.small', { style: { textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-mute)', marginBottom: '8px' } }, title));
      (Array.isArray(nodes) ? nodes : [nodes]).forEach((n) => n && right.appendChild(n));
    }

    // ---------- STEP: system ----------
    function stepSystem() {
      left.appendChild(el('h2', 'Choose a game system'));
      left.appendChild(el('p.dim', 'Your character is built for one game system. Pick the one your group is playing.'));
      const grid = el('div.card-grid', { style: { marginTop: '16px' } });
      systems.forEach((s) => {
        const c = el('button', { type: 'button', style: sysCard(s.id === systemId) });
        c.appendChild(el('div', { style: { fontWeight: '700', fontSize: '15px' } }, s.name));
        c.appendChild(el('div.small.mute', s.tagline || ''));
        if (s.dice) c.appendChild(el('div.small.mute', { style: { marginTop: '6px', fontFamily: 'var(--font-mono)' } }, (s.dice.notation || '') + ' · ' + (s.dice.resolution || '')));
        c.addEventListener('click', () => { systemId = s.id; system = s; working = remakeFor(s); draw(); });
        grid.appendChild(c);
      });
      left.appendChild(grid);
      help('About', el('p.prose', system.summary || system.tagline || ''));
    }
    function remakeFor(s) { const w = blankCharacter(s, kind); w.name = working.name; w.portraitSeed = working.portraitSeed; return w; }

    // ---------- STEP: identity ----------
    function stepIdentity() {
      left.appendChild(el('h2', 'Who are they?'));
      const col = el('div.col.gap-4', { style: { maxWidth: '520px', marginTop: '12px' } });
      const nameI = input({ value: working.name, placeholder: kind === 'npc' ? 'NPC name' : 'Character name' });
      nameI.addEventListener('input', () => { working.name = nameI.value; });
      col.appendChild(field('Name', nameI));
      const roleI = input({ value: working.role || '', placeholder: 'Concept / role — e.g. “off-duty nurse”, “aggressive trucker”' });
      roleI.addEventListener('input', () => { working.role = roleI.value; });
      col.appendChild(field('Concept', roleI));
      // portrait
      const portRow = el('div.row.gap-4', { style: { alignItems: 'center' } });
      let portNode = portraitNode(working, 72, { round: true });
      portRow.appendChild(portNode);
      portRow.appendChild(button('Regenerate portrait', { size: 'sm', icon: 'refresh', onClick: () => { working.portrait = null; working.portraitSeed = uid('seed'); const np = portraitNode(working, 72, { round: true }); portNode.replaceWith(np); portNode = np; drawPreview(); } }));
      col.appendChild(field('Portrait', portRow));
      left.appendChild(col);
      help('Tip', el('p.prose', 'A strong one-line concept does more than a backstory. Who were they before, and what do they want tonight?'));
    }

    // ---------- STEP: attributes ----------
    function stepAttributes() {
      const r = system.attributeRules || {};
      const attrs = system.attributes || [];
      left.appendChild(el('h2', 'Attributes'));
      const pointBuy = r.pointsToDistribute != null && r.start != null;
      const budgetEl = el('div.small', { style: { margin: '6px 0 16px' } });
      left.appendChild(budgetEl);
      const min = (a) => r.startMin != null ? r.startMin : (a.min != null ? a.min : 0);
      const max = (a) => r.startMax != null ? r.startMax : (a.max != null ? a.max : 99);
      function spent() { return attrs.reduce((sum, a) => sum + (Number(working.attrs[a.key] || 0) - (r.start || 0)), 0); }
      function updateBudget() {
        if (!pointBuy) { budgetEl.textContent = ''; return; }
        const rem = r.pointsToDistribute - spent();
        budgetEl.replaceChildren(el('b', `${rem} `), document.createTextNode(`point${Math.abs(rem) === 1 ? '' : 's'} remaining`), el('span.mute', `  (start ${r.start}, max ${r.startMax})`));
        budgetEl.style.color = rem === 0 ? 'var(--good)' : (rem < 0 ? 'var(--bad)' : 'var(--warn)');
      }
      const list = el('div.col.gap-2', { style: { maxWidth: '560px' } });
      attrs.forEach((a) => {
        const row = el('div.row.between', { style: { padding: '8px 12px', background: 'var(--bg-1)', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-1)' } });
        const lab = el('div'); lab.appendChild(el('div', { style: { fontWeight: '600' } }, a.name)); if (a.desc) lab.appendChild(el('div.tiny.mute', a.desc));
        row.appendChild(lab);
        const ctrl = el('div.row.gap-2', { style: { alignItems: 'center' } });
        const val = el('div.mono', { style: { minWidth: '28px', textAlign: 'center', fontSize: '16px', fontWeight: '700' } }, String(working.attrs[a.key]));
        const dec = iconButton('minus', { size: 14, onClick: () => set(working.attrs[a.key] - 1) });
        const inc = iconButton('plus', { size: 14, onClick: () => set(working.attrs[a.key] + 1) });
        function set(v) {
          v = clamp(v, min(a), max(a));
          if (pointBuy && (v - (r.start || 0)) > 0) { const projected = spent() - (Number(working.attrs[a.key]) - (r.start || 0)) + (v - (r.start || 0)); if (projected > r.pointsToDistribute) return; }
          working.attrs[a.key] = v; val.textContent = String(v); updateBudget(); refresh();
        }
        ctrl.appendChild(dec); ctrl.appendChild(val); ctrl.appendChild(inc);
        row.appendChild(ctrl);
        list.appendChild(row);
      });
      left.appendChild(list);
      updateBudget();
      // help: derived + ease ladder
      const helpNodes = [];
      if (system.dice && system.dice.summary) helpNodes.push(el('p.small.mono', { style: { background: 'var(--bg-2)', padding: '8px', borderRadius: 'var(--r-1)' } }, system.dice.summary));
      const derBox = el('div', { style: { marginTop: '10px' } });
      derBox.appendChild(el('div.small', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Derived stats'));
      (system.deriveds || []).forEach((d) => { derBox.appendChild(el('p.small', [el('b', `${d.name}: `), el('span.mono', String((working.derived || {})[d.key])), d.desc ? el('span.mute', ' — ' + d.desc) : null].filter(Boolean))); });
      helpNodes.push(derBox);
      if ((system.easeLadder || []).length) { const e = el('div', { style: { marginTop: '10px' } }); e.appendChild(el('div.small', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Difficulty')); system.easeLadder.forEach((x) => e.appendChild(el('p.tiny', `${x.name} (${x.mod >= 0 ? '+' : ''}${x.mod}) — ${x.use || ''}`))); helpNodes.push(e); }
      help('Reference', helpNodes);
    }

    // ---------- STEP: background ----------
    function stepBackground() {
      left.appendChild(el('h2', 'Background'));
      left.appendChild(el('p.dim', 'Your background shapes who you were before — and gives you a starting edge.'));
      const grid = el('div.card-grid', { style: { marginTop: '14px' } });
      (system.backgrounds || []).forEach((b) => {
        const sel = working.background === b.name;
        const c = el('button', { type: 'button', style: sysCard(sel) });
        c.appendChild(el('div', { style: { fontWeight: '700' } }, b.name));
        if (b.knack) c.appendChild(el('div.small', [el('b', 'Knack: '), b.knack]));
        if (b.gear) c.appendChild(el('div.small.mute', { style: { marginTop: '4px' } }, 'Gear: ' + b.gear));
        c.addEventListener('click', () => {
          working.background = b.name;
          working.knacks = b.knack ? [b.knack] : [];
          working.gear = b.gear ? (Array.isArray(b.gear) ? b.gear.slice() : [b.gear]) : [];
          draw();
        });
        grid.appendChild(c);
      });
      left.appendChild(grid);
      const sel = (system.backgrounds || []).find((b) => b.name === working.background);
      help('Selected', sel ? el('div', [el('p.prose', el('b', sel.name)), sel.knack ? el('p.small', [el('b', 'Knack: '), sel.knack]) : null, sel.gear ? el('p.small.mute', 'Gear: ' + sel.gear) : null].filter(Boolean)) : el('p.dim', 'Pick a background, or skip it.'));
    }

    // ---------- STEP: details ----------
    function stepDetails() {
      left.appendChild(el('h2', 'Finishing touches'));
      const col = el('div.col.gap-4', { style: { maxWidth: '560px', marginTop: '12px' } });
      const tmpl = (system.characterTemplate && system.characterTemplate.pcFields) || [];
      if (tmpl.includes('tie') || true) { const i = input({ value: working.tie || '', placeholder: 'Someone or something you’re trying to get back to' }); i.addEventListener('input', () => { working.tie = i.value; }); col.appendChild(field('Tie', i)); }
      if (tmpl.includes('fear') || true) { const i = input({ value: working.fear || '', placeholder: 'What the story will make you face' }); i.addEventListener('input', () => { working.fear = i.value; }); col.appendChild(field('Fear', i)); }
      const knacksI = input({ value: (working.knacks || []).join(', '), placeholder: 'comma, separated' }); knacksI.addEventListener('input', () => { working.knacks = knacksI.value.split(',').map((x) => x.trim()).filter(Boolean); }); col.appendChild(field('Knacks', knacksI));
      const gearI = textarea({ value: (working.gear || []).join('\n'), rows: 3, placeholder: 'One item per line' }); gearI.addEventListener('input', () => { working.gear = gearI.value.split('\n').map((x) => x.trim()).filter(Boolean); }); col.appendChild(field('Starting gear', gearI));
      const notesI = textarea({ value: working.notes || '', rows: 3, placeholder: 'Anything else — appearance, history, a secret…' }); notesI.addEventListener('input', () => { working.notes = notesI.value; }); col.appendChild(field('Notes', notesI));
      left.appendChild(col);
      if (system.characterTemplate && system.characterTemplate.note) help('Note', el('p.prose', system.characterTemplate.note));
      else help('Tip', el('p.prose', 'A Tie and a Fear give the GM hooks and make hard choices land. Keep them concrete.'));
    }

    // ---------- STEP: review ----------
    function stepReview() {
      left.appendChild(el('h2', 'Review'));
      const v = validateCreation(system, working);
      if (!v.ok) {
        const warn = el('div.notice', { style: { borderColor: 'var(--warn)', marginBottom: '14px' } });
        warn.appendChild(el('div', { style: { fontWeight: '600', color: 'var(--warn)', marginBottom: '4px' } }, 'Before you finish:'));
        const ul = el('ul.prose'); v.issues.forEach((it) => ul.appendChild(el('li', it))); warn.appendChild(ul);
        warn.appendChild(el('p.small.mute', 'You can still create the character and adjust later.'));
        left.appendChild(warn);
      } else {
        left.appendChild(el('div.notice', { style: { borderColor: 'var(--good)', marginBottom: '14px' } }, [el('span', { style: { color: 'var(--good)', fontWeight: '600' } }, '✓ Looks good — ready to create.')]));
      }
      const card = el('div.card', { style: { maxWidth: '620px' } });
      const head = el('div.row.gap-4', { style: { alignItems: 'center' } });
      head.appendChild(portraitNode(working, 64, { round: true }));
      const hi = el('div'); hi.appendChild(el('h3', { style: { margin: 0 } }, working.name || (kind === 'npc' ? 'New NPC' : 'New Character'))); if (working.role) hi.appendChild(el('div.small.mute', working.role)); head.appendChild(hi);
      card.appendChild(head);
      const attrLine = (system.attributes || []).map((a) => `${a.abbr || a.name} ${working.attrs[a.key]}`).join('  ·  ');
      card.appendChild(el('div.mono.small', { style: { marginTop: '10px' } }, attrLine));
      const derLine = (system.deriveds || []).map((d) => `${d.abbr || d.name} ${(working.derived || {})[d.key]}`).join('  ·  ');
      card.appendChild(el('div.mono.small', { style: { marginTop: '4px', color: 'var(--cool)' } }, derLine));
      if (working.background) card.appendChild(el('p.small', { style: { marginTop: '8px' } }, [el('b', 'Background: '), working.background]));
      if ((working.knacks || []).length) card.appendChild(el('p.small', [el('b', 'Knacks: '), working.knacks.join(', ')]));
      if (working.tie) card.appendChild(el('p.small', [el('b', 'Tie: '), working.tie]));
      if (working.fear) card.appendChild(el('p.small', [el('b', 'Fear: '), working.fear]));
      left.appendChild(card);
      help('Almost there', el('p.prose', 'Create the character to start playing. You can refine everything on the sheet afterward.'));
    }

    async function finish() {
      working.derived = allDeriveds(system, working);
      working.systemId = system.id;
      working.kind = kind;
      working.id = (kind === 'npc' ? 'npc_' : 'pc_') + uid('').slice(0, 8);
      if (!working.name) working.name = kind === 'npc' ? 'New NPC' : 'New Character';
      working._seed = false;
      const saved = await store.save('characters', working);
      toast('Character created', { type: 'success' });
      close(saved);
    }
    async function cancel() {
      const dirty = working.name || (working.role) || Object.keys(working.attrs || {}).some((k) => working.attrs[k] !== ((system.attributes.find((a) => a.key === k) || {}).default));
      if (dirty && !(await confirm({ title: 'Discard this character?', message: 'You haven’t finished creating this character. Discard it?', danger: true, okLabel: 'Discard' }))) return;
      close(null);
    }
    function close(result) { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(result || null); if (opts.onDone) opts.onDone(result || null); }
    // Ignore Escape while a modal (e.g. the discard-confirm) is open — let that
    // top layer handle it, instead of stacking a second confirm.
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) { e.stopPropagation(); cancel(); } };
    document.addEventListener('keydown', onKey);

    draw();
  });
}

function stepPill(active, done) {
  return { padding: '5px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: active ? '700' : '500', cursor: 'pointer', border: '1px solid ' + (active ? 'color-mix(in srgb, var(--accent) 50%, #000)' : 'var(--line)'), background: active ? 'color-mix(in srgb, var(--accent) 70%, #0a0e13)' : (done ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent'), color: active ? 'var(--btn-ink, #fff)' : 'var(--text)' };
}
function sysCard(sel) {
  return { textAlign: 'left', padding: '14px 16px', borderRadius: 'var(--r-2)', cursor: 'pointer', color: 'var(--text)', background: sel ? 'color-mix(in srgb, var(--accent) 14%, var(--bg-2))' : 'var(--bg-2)', border: '1px solid ' + (sel ? 'var(--accent)' : 'var(--line)') };
}
