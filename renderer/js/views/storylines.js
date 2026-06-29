import { el, clear, uid, deepClone, debounce } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, card, badge, chip, modal, confirm, toast, field, input, textarea, select, tabs } from '../ui.js';
import { objListEditor } from '../editors.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { renderActs, renderWorld, renderTimeline, renderSessionBlueprint } from '../storyrender.js';
import { startCampaignFromStoryline } from './campaigns.js';
import { visible, hiddenCount, isSeed, builtinChip, readOnlyBanner, copyToEdit, hideDoc, showAllBuiltins } from '../seed.js';
import { exportDoc, exportStorylineBundle, importFromFile } from '../share.js';

export async function render(id) {
  if (id === 'new') return createStoryline();
  if (id) return renderDetail(id);
  return renderList();
}

async function renderList() {
  shell.crumbs([{ label: 'Storylines' }]);
  shell.actions([
    button('Import', { icon: 'upload', size: 'sm', onClick: importStoryline }),
    button('New Storyline', { icon: 'plus', variant: 'primary', size: 'sm', onClick: createStoryline }),
  ]);
  const wrap = el('div.view-pad');
  wrap.appendChild(el('p.dim', { style: { marginBottom: '18px' } },
    'A storyline is a reusable narrative blueprint — acts, sessions, locations, factions, and a timeline. Start a campaign from one to run it with a group of players.'));

  const allStories = store.all('storylines');
  const stories = visible(allStories);
  const nHidden = hiddenCount(allStories);
  if (nHidden) {
    wrap.appendChild(el('div.row.gap-2', { style: { marginBottom: '12px' } }, [
      el('span.small.mute', `${nHidden} built-in storyline${nHidden > 1 ? 's' : ''} hidden.`),
      button('Show all built-ins', { size: 'sm', variant: 'ghost', onClick: async () => { await showAllBuiltins(); renderList(); } }),
    ]));
  }
  if (!stories.length) { wrap.appendChild(empty('No storylines', { icon: 'scroll', hint: 'Create one, or generate a whole campaign in AI Studio.', action: button('New storyline', { variant: 'primary', onClick: createStoryline }) })); shell.render(wrap); return; }

  const grid = el('div.card-grid');
  for (const s of stories) {
    const sys = store.get('rulesets', s.systemId);
    const camps = store.where('campaigns', (c) => c.storylineId === s.id).length;
    const c = card({ class: 'entity-card clickable' });
    c.addEventListener('click', () => router.go('storylines', s.id));
    const head = el('div.ec-head');
    const av = el('div.ec-portrait', { style: { background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', display: 'grid', placeItems: 'center' } });
    av.appendChild(icon('scroll', 22, { stroke: '#fff' }));
    head.appendChild(av);
    const ht = el('div.grow'); ht.appendChild(el('div.ec-title', s.name)); ht.appendChild(el('div.ec-sub', s.subtitle || '')); head.appendChild(ht);
    if (isSeed(s)) head.appendChild(builtinChip());
    c.appendChild(head);
    c.appendChild(el('div.ec-body', (s.premise || '').slice(0, 140) + ((s.premise || '').length > 140 ? '…' : '')));
    const tags = el('div.ec-tags');
    if (sys) tags.appendChild(chip(sys.name, { icon: 'layers' }));
    tags.appendChild(chip((s.acts || []).length + ' acts', { icon: 'flag' }));
    tags.appendChild(chip((s.sessions || []).length + ' sessions', { icon: 'book' }));
    if (camps) tags.appendChild(chip(camps + ' campaign' + (camps === 1 ? '' : 's'), { icon: 'play' }));
    c.appendChild(tags);
    const foot = el('div.ec-foot');
    foot.appendChild(button('Start Campaign', { size: 'sm', variant: 'primary', icon: 'play', onClick: (e) => { e.stopPropagation(); startCampaignFromStoryline(s.id); } }));
    const actions = el('div.card-actions');
    actions.appendChild(iconButton('copy', { title: isSeed(s) ? 'Copy to Edit' : 'Duplicate', size: 16, onClick: async (e) => { e.stopPropagation(); if (isSeed(s)) { await copyToEdit('storylines', s, { navigateView: 'storylines' }); } else { const copy = deepClone(s); copy.id = 'story_' + uid('').slice(0, 8); copy.name += ' (copy)'; copy._seed = false; delete copy.createdAt; delete copy.updatedAt; await store.save('storylines', copy); router.go('storylines', copy.id); } } }));
    if (isSeed(s)) actions.appendChild(iconButton('eyeOff', { title: 'Hide built-in', size: 16, onClick: async (e) => { e.stopPropagation(); await hideDoc(s.id); toast(`${s.name} hidden`, { type: 'success' }); renderList(); } }));
    foot.appendChild(actions);
    c.appendChild(foot);
    grid.appendChild(c);
  }
  wrap.appendChild(grid);
  shell.render(wrap);
}

async function renderDetail(id) {
  const s = store.get('storylines', id);
  if (!s) { router.go('storylines'); return; }
  const sys = store.get('rulesets', s.systemId);
  shell.crumbs([{ label: 'Storylines', to: 'storylines' }, { label: s.name }]);
  const seed = isSeed(s);
  const acts = [button('Start Campaign', { icon: 'play', variant: 'primary', size: 'sm', onClick: () => startCampaignFromStoryline(s.id) })];
  if (seed) acts.push(button('Copy to Edit', { icon: 'copy', size: 'sm', onClick: () => copyToEdit('storylines', s, { navigateView: 'storylines' }) }));
  else acts.push(button('AI Author', { icon: 'spark', variant: 'cool', size: 'sm', onClick: () => router.go('ai', 'storyline', s.id) }));
  acts.push(button('Export', { icon: 'download', size: 'sm', onClick: () => exportDoc('storylines', s) }));
  acts.push(button('Share bundle', { icon: 'link', size: 'sm', title: 'Export this storyline with its system + NPCs in one file', onClick: () => exportStorylineBundle(s) }));
  if (seed) acts.push(button('Hide', { icon: 'eyeOff', size: 'sm', onClick: async () => { await hideDoc(s.id); toast(`${s.name} hidden`, { type: 'success' }); router.go('storylines'); } }));
  acts.push(button('Delete', { icon: 'trash', size: 'sm', variant: 'danger', onClick: async () => { const camps = store.where('campaigns', (c) => c.storylineId === s.id).length; if (await confirm({ title: 'Delete storyline?', message: `Delete "${s.name}"?${camps ? ` ${camps} campaign(s) forked from it keep their own copy and are unaffected.` : ''}${seed ? ' You can restore built-in content in Settings → Data.' : ''}`, danger: true, okLabel: 'Delete' })) { await store.remove('storylines', s.id); toast('Deleted', { type: 'success' }); router.go('storylines'); } } }));
  shell.actions(acts);

  const wrap = el('div.view-pad');
  const headRow = el('div.section-header');
  const t = el('div.section-title'); t.appendChild(icon('scroll', 20));
  const ti = el('div'); ti.appendChild(el('div.row.gap-2', [el('h2', { style: { margin: 0 } }, s.name), seed ? builtinChip() : null].filter(Boolean))); ti.appendChild(el('div.small.mute', s.subtitle || '')); t.appendChild(ti);
  headRow.appendChild(t);
  if (sys) headRow.appendChild(badge(sys.name, { variant: 'dim' }));
  wrap.appendChild(headRow);

  wrap.appendChild(tabs([
    { key: 'overview', label: 'Overview', icon: 'info', render: () => buildOverview(s) },
    { key: 'structure', label: 'Structure', icon: 'flag', render: () => renderActs(s, { onSession: (sess) => showSession(s, sess) }) },
    { key: 'world', label: 'World', icon: 'compass', render: () => renderWorld(s) },
    { key: 'timeline', label: 'Timeline', icon: 'clock', render: () => renderTimeline(s) },
    { key: 'edit', label: seed ? 'Edit (read-only)' : 'Edit', icon: 'edit', render: () => seed ? readOnlyBanner('storylines', s, 'storylines') : buildStorylineEditor(s, () => renderDetail(id)) },
  ]));
  shell.render(wrap);
}

function buildOverview(s) {
  const col = el('div.col.gap-4');
  if (s.premise) { col.appendChild(el('h3', 'Premise')); col.appendChild(el('p.prose.selectable', s.premise)); }
  if (s.tone) { col.appendChild(el('h3', 'Tone')); col.appendChild(el('p.prose.selectable', s.tone)); }
  if (s.setting) {
    col.appendChild(el('h3', 'Setting'));
    const grid = el('div.meta-grid');
    const mi = (l, v) => { const m = el('div.meta-item'); m.appendChild(el('div.ml', l)); m.appendChild(el('div.mv.selectable', v)); return m; };
    if (s.setting.when) grid.appendChild(mi('When', s.setting.when));
    if (s.setting.where) grid.appendChild(mi('Where', s.setting.where));
    if (s.setting.elevation) grid.appendChild(mi('Elevation', s.setting.elevation));
    if (s.setting.collapse) grid.appendChild(mi('Span', s.setting.collapse));
    col.appendChild(grid);
  }
  if (s.contentWarnings && s.contentWarnings.length) {
    const cw = el('div.side-card', { style: { borderColor: 'color-mix(in srgb, var(--warn) 40%, var(--line))' } });
    cw.appendChild(el('h4', { style: { color: 'var(--warn)' } }, 'Content Warnings'));
    const ul = el('ul.prose'); s.contentWarnings.forEach((c) => ul.appendChild(el('li', c))); cw.appendChild(ul);
    col.appendChild(cw);
  }
  if (s.designNotes) { col.appendChild(el('h3', 'Design Notes')); col.appendChild(el('p.prose.selectable', s.designNotes)); }
  return col;
}

function showSession(storyline, sess) {
  const m = modal({ title: '', width: 760, class: 'session-blueprint' });
  m.setBody(renderSessionBlueprint(sess, { actions: button('Run this session', { variant: 'primary', icon: 'play', size: 'sm', onClick: () => { m.close(); startCampaignFromStoryline(storyline.id, sess.number); } }) }));
}

// ---------- Native storyline editor ----------
function buildStorylineEditor(s, rerender) {
  ['acts', 'sessions', 'locations', 'factions', 'timeline', 'npcs'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
  const save = debounce(async () => { await store.save('storylines', s); }, 450);
  const sec = (title, node) => { const d = el('div.editor-section'); d.appendChild(el('h4', title)); d.appendChild(node); return d; };

  return tabs([
    { key: 'meta', label: 'Premise', render: () => editStoryMeta(s, save) },
    { key: 'acts', label: 'Acts', render: () => sec('Acts', objListEditor({ items: s.acts, onChange: save, addLabel: 'Add act', itemTitle: (a) => a.title, defaults: () => ({ id: 'act' + (s.acts.length + 1) }), fields: [{ key: 'title', label: 'Title' }, { key: 'days', label: 'Days/When' }, { key: 'id', label: 'ID (for session links)' }, { key: 'summary', label: 'Summary', type: 'textarea', full: true }] })) },
    { key: 'sessions', label: 'Sessions', render: () => buildSessionsEditor(s, save, rerender) },
    { key: 'locations', label: 'Locations', render: () => sec('Locations', objListEditor({ items: s.locations, onChange: save, addLabel: 'Add location', itemTitle: (l) => l.name, fields: [
      { key: 'name', label: 'Name' }, { key: 'tags', label: 'Tags', type: 'tags' },
      { key: 'desc', label: 'Summary', type: 'textarea', full: true },
      { key: 'details', label: 'Full details (GM, markdown)', type: 'textarea', full: true, rows: 5 },
      { key: 'readAloud', label: 'Read-aloud (player-facing)', type: 'textarea', full: true, rows: 4 },
      { key: 'gmNotes', label: 'GM setup notes', type: 'textarea', full: true, rows: 3 },
    ] })) },
    { key: 'factions', label: 'Factions', render: () => sec('Factions', objListEditor({ items: s.factions, onChange: save, addLabel: 'Add faction', itemTitle: (f) => f.name, fields: [{ key: 'name', label: 'Name' }, { key: 'leaderRef', label: 'Leader (NPC id)' }, { key: 'desc', label: 'Description', type: 'textarea', full: true }] })) },
    { key: 'timeline', label: 'Timeline', render: () => sec('Timeline', objListEditor({ items: s.timeline, onChange: save, addLabel: 'Add beat', itemTitle: (t) => t.when, fields: [{ key: 'when', label: 'When' }, { key: 'what', label: 'What happens', type: 'textarea', full: true }] })) },
  ]);
}

function editStoryMeta(s, save) {
  const col = el('div.col.gap-4');
  const t = (label, key, ta, rows) => { const c = ta ? textarea({ value: s[key] || '', rows: rows || 3 }) : input({ value: s[key] || '' }); c.addEventListener('input', () => { s[key] = c.value; save(); }); col.appendChild(field(label, c)); };
  t('Title', 'name'); t('Subtitle', 'subtitle'); t('Premise', 'premise', true, 4); t('Tone', 'tone', true, 2);
  s.setting = s.setting || {};
  const setRow = el('div.form-grid');
  [['when', 'When'], ['where', 'Where'], ['elevation', 'Elevation'], ['collapse', 'Span']].forEach(([k, l]) => { const c = input({ value: s.setting[k] || '' }); c.addEventListener('input', () => { s.setting[k] = c.value; save(); }); setRow.appendChild(field(l, c)); });
  col.appendChild(el('div.divider', 'Setting')); col.appendChild(setRow);
  col.appendChild(field('Content warnings (one per line)', (() => { const ta = textarea({ value: (s.contentWarnings || []).join('\n'), rows: 3 }); ta.addEventListener('input', () => { s.contentWarnings = ta.value.split('\n').map((x) => x.trim()).filter(Boolean); save(); }); return ta; })()));
  t('Design notes', 'designNotes', true, 3);
  col.appendChild(el('p.small.mute', 'Changes save automatically. New campaigns started from this storyline get a copy of the current version.'));
  return col;
}

function buildSessionsEditor(s, save, rerender) {
  const wrap = el('div.editor-section');
  wrap.appendChild(el('h4', 'Sessions'));
  const list = el('div.col.gap-2');
  wrap.appendChild(list);
  function draw() {
    clear(list);
    if (!s.sessions.length) list.appendChild(el('p.small.mute', 'No sessions. Add one below.'));
    s.sessions.sort((a, b) => (a.number || 0) - (b.number || 0)).forEach((sess) => {
      const row = el('div.row.between', { style: { padding: '8px 10px', background: 'var(--bg-1)', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-1)' } });
      const m = el('div'); m.appendChild(el('div', { style: { fontWeight: 600 } }, `S${sess.number} — ${sess.title || ''}`)); if (sess.subtitle) m.appendChild(el('div.small.mute', sess.subtitle));
      row.appendChild(m);
      const ctrl = el('div.row.gap-1');
      ctrl.appendChild(button('Edit', { size: 'sm', icon: 'edit', onClick: () => editStorylineSession(s, sess, save, draw) }));
      ctrl.appendChild(iconButton('trash', { size: 14, variant: 'danger', onClick: () => { s.sessions = s.sessions.filter((x) => x !== sess); save(); draw(); } }));
      row.appendChild(ctrl);
      list.appendChild(row);
    });
  }
  draw();
  wrap.appendChild(el('div', { style: { marginTop: '10px' } }, button('Add session', { size: 'sm', icon: 'plus', onClick: () => { const n = (s.sessions.reduce((mx, x) => Math.max(mx, x.number || 0), 0)) + 1; const sess = { id: 's' + n, number: n, title: 'New Session', act: (s.acts[0] || {}).id || 'act1', readAlouds: [], phases: [], checksClocks: [], branches: [], npcFates: [] }; s.sessions.push(sess); save(); draw(); editStorylineSession(s, sess, save, draw); } })));
  return wrap;
}

function editStorylineSession(s, sess, save, rerender) {
  const numI = input({ type: 'number', value: sess.number || 1 });
  const titleI = input({ value: sess.title || '' });
  const subI = input({ value: sess.subtitle || '' });
  const actSel = select((s.acts || []).map((a) => ({ value: a.id, label: a.title })), { value: sess.act });
  const sitT = textarea({ value: sess.situation || '', rows: 4 });
  const raT = textarea({ value: (sess.readAlouds || []).join('\n\n'), rows: 5, placeholder: 'One read-aloud passage per paragraph (blank line between).' });
  const checksT = textarea({ value: (sess.checksClocks || []).join('\n'), rows: 3, placeholder: 'One check/clock per line.' });
  const rewardT = textarea({ value: sess.rewards || '', rows: 2 });
  const m = modal({ title: `Edit Session ${sess.number}`, width: 680, body: [
    el('div.form-grid', [field('Number', numI), field('Act', actSel)]),
    field('Title', titleI), field('Subtitle', subI), field('Situation', sitT),
    field('Read-aloud passages', raT), field('Checks & Clocks (one per line)', checksT), field('Rewards', rewardT),
  ] });
  m.setFooter(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Save', { variant: 'primary', onClick: () => {
    sess.number = parseInt(numI.value, 10) || sess.number; sess.title = titleI.value; sess.subtitle = subI.value; sess.act = actSel.value;
    sess.situation = sitT.value; sess.readAlouds = raT.value.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    sess.checksClocks = checksT.value.split('\n').map((x) => x.trim()).filter(Boolean); sess.rewards = rewardT.value;
    save(); m.close(); rerender();
  } }));
}

function createStoryline() {
  const systems = store.all('rulesets');
  let systemId = appState.activeSystemId || (systems[0] && systems[0].id);
  const nameI = input({ placeholder: 'Storyline title' });
  const sysSel = select(systems.map((x) => ({ value: x.id, label: x.name })), { value: systemId, onChange: (v) => (systemId = v) });
  const premiseI = textarea({ placeholder: 'The hook / premise…', rows: 3 });
  const m = modal({ title: 'New Storyline', width: 480, body: [field('System', sysSel), field('Title', nameI), field('Premise', premiseI)] });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Create', { variant: 'primary', onClick: async () => {
      const story = {
        id: 'story_' + uid('').slice(0, 8), systemId, name: nameI.value || 'New Storyline', subtitle: '',
        premise: premiseI.value || '', tone: '', contentWarnings: [], setting: {}, locations: [], factions: [], npcs: [],
        timeline: [], acts: [{ id: 'act1', title: 'Act I', days: '', summary: '' }], sessions: [], _seed: false,
      };
      await store.save('storylines', story);
      m.close();
      router.go('storylines', story.id);
    } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

function editMeta(s) {
  s = store.get('storylines', s.id);
  const nameI = input({ value: s.name });
  const subI = input({ value: s.subtitle || '' });
  const premiseI = textarea({ value: s.premise || '', rows: 4 });
  const toneI = textarea({ value: s.tone || '', rows: 2 });
  const m = modal({ title: 'Edit Storyline', width: 560, body: [field('Title', nameI), field('Subtitle', subI), field('Premise', premiseI), field('Tone', toneI)] });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Save', { variant: 'primary', onClick: async () => { const next = deepClone(s); next.name = nameI.value; next.subtitle = subI.value; next.premise = premiseI.value; next.tone = toneI.value; await store.save('storylines', next); m.close(); renderDetail(s.id); } }),
  );
}

async function exportStoryline(s) {
  const path = await window.xrpg.dialog.saveJson(`${(s.name || 'storyline').replace(/\s+/g, '-').toLowerCase()}.storyline.json`, { kind: 'xrpg-doc', collection: 'storylines', doc: s });
  if (path) toast('Exported', { type: 'success' });
}

async function importStoryline() {
  // Handles a single storyline, a shareable bundle (storyline + system + NPCs),
  // or a raw seed file — all land as editable copies with remapped references.
  const created = await importFromFile();
  if (created && created.length) {
    const story = created.find((c) => c.collection === 'storylines');
    renderList();
    if (story) router.go('storylines', story.id);
  }
}
