import { el, clear, uid, deepClone, fmtDate, fmtDateTime, relTime } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, card, badge, chip, modal, confirm, toast, field, input, textarea, select, tabs } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { renderActs, renderWorld, renderTimeline, renderSessionBlueprint } from '../storyrender.js';

export async function render(id) {
  if (id === 'new') return openCreate();
  if (id) return renderDetail(id);
  return renderList();
}

// ---------- Versioning helpers ----------
export async function commitStoryline(campaign, newStoryline, label, opts = {}) {
  const playedUnderCurrent = store.where('sessions', (s) => s.campaignId === campaign.id && s.storylineVersion === campaign.currentVersion).length > 0;
  const c = deepClone(campaign);
  c.storylineVersions = c.storylineVersions || [];
  if (playedUnderCurrent || opts.forceNewVersion) {
    c.currentVersion = (c.currentVersion || 1) + 1;
    c.storyline = newStoryline;
    c.storylineVersions.push({ v: c.currentVersion, label: label || ('Revision ' + c.currentVersion), at: new Date().toISOString(), content: deepClone(newStoryline) });
  } else {
    c.storyline = newStoryline;
    const cur = c.storylineVersions.find((v) => v.v === c.currentVersion);
    if (cur) { cur.content = deepClone(newStoryline); cur.at = new Date().toISOString(); if (label) cur.label = label; }
    else c.storylineVersions.push({ v: c.currentVersion || 1, label: label || 'Initial', at: new Date().toISOString(), content: deepClone(newStoryline) });
  }
  await store.save('campaigns', c);
  return store.get('campaigns', c.id);
}

// ---------- Start campaign from a storyline (forking) ----------
export function startCampaignFromStoryline(storylineId, runSessionNumber) {
  const story = store.get('storylines', storylineId);
  if (!story) { toast('Storyline not found', { type: 'error' }); return; }
  const groups = store.all('groups');
  let groupId = groups[0] && groups[0].id;
  const nameI = input({ value: story.name + ' — ' + (groups[0] ? groups[0].name : 'New Group'), placeholder: 'Campaign name' });
  const groupSel = select([{ value: '', label: '— No group yet —' }, ...groups.map((g) => ({ value: g.id, label: g.name }))], { value: groupId || '', onChange: (v) => (groupId = v) });
  const m = modal({
    title: 'Start a Campaign', width: 480,
    body: [
      el('p.small.mute', `This forks "${story.name}" into a new campaign with its own editable storyline and play history. The original template stays untouched.`),
      field('Campaign name', nameI),
      field('Player group', groupSel),
    ],
  });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Create campaign', { variant: 'primary', icon: 'flag', onClick: async () => {
      const content = forkStorylineContent(story);
      const camp = {
        id: 'camp_' + uid('').slice(0, 8),
        name: nameI.value || story.name,
        systemId: story.systemId, storylineId: story.id, groupId: groupId || null,
        storyline: content, currentVersion: 1,
        storylineVersions: [{ v: 1, label: 'Initial fork', at: new Date().toISOString(), content: deepClone(content) }],
        status: 'active', notes: '', worldState: { clocks: [], flags: {} },
      };
      await store.save('campaigns', camp);
      await appState.setCampaign(camp.id);
      m.close();
      toast('Campaign created', { type: 'success' });
      if (runSessionNumber) startSession(camp, runSessionNumber);
      else router.go('campaigns', camp.id);
    } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

function forkStorylineContent(story) {
  const c = deepClone(story);
  delete c.id; delete c._seed; delete c.createdAt; delete c.updatedAt; delete c.collection;
  return c;
}

// ---------- List ----------
async function renderList() {
  shell.crumbs([{ label: 'Campaigns' }]);
  shell.actions([button('New Campaign', { icon: 'plus', variant: 'primary', size: 'sm', onClick: openCreate })]);
  const wrap = el('div.view-pad');
  const camps = store.all('campaigns');
  if (!camps.length) {
    wrap.appendChild(empty('No campaigns yet', {
      icon: 'flag', hint: 'A campaign runs a storyline with a specific group of players. Start one from a storyline, or create from scratch.',
      action: el('div.row.gap-2', [
        button('New campaign', { variant: 'primary', icon: 'plus', onClick: openCreate }),
        button('Browse storylines', { onClick: () => router.go('storylines') }),
      ]),
    }));
    shell.render(wrap); return;
  }
  const grid = el('div.card-grid');
  for (const c of camps.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))) {
    const sys = store.get('rulesets', c.systemId);
    const grp = store.get('groups', c.groupId);
    const sessCount = store.where('sessions', (s) => s.campaignId === c.id).length;
    const cardEl = card({ class: 'entity-card clickable' });
    cardEl.addEventListener('click', () => router.go('campaigns', c.id));
    const head = el('div.ec-head');
    const av = el('div.ec-portrait', { style: { background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', display: 'grid', placeItems: 'center' } });
    av.appendChild(icon('flag', 22, { stroke: '#fff' }));
    head.appendChild(av);
    const ht = el('div.grow'); ht.appendChild(el('div.ec-title', c.name)); ht.appendChild(el('div.ec-sub', (sys ? sys.name : '') + (grp ? ' · ' + grp.name : ''))); head.appendChild(ht);
    head.appendChild(badge(c.status || 'active', { variant: 'dim' }));
    cardEl.appendChild(head);
    const tags = el('div.ec-tags');
    tags.appendChild(chip(sessCount + ' session' + (sessCount === 1 ? '' : 's'), { icon: 'history' }));
    tags.appendChild(chip('v' + (c.currentVersion || 1), { icon: 'layers' }));
    cardEl.appendChild(tags);
    const foot = el('div.ec-foot');
    foot.appendChild(button('Open', { size: 'sm', onClick: (e) => { e.stopPropagation(); router.go('campaigns', c.id); } }));
    foot.appendChild(button('Run', { size: 'sm', variant: 'primary', icon: 'play', onClick: (e) => { e.stopPropagation(); startSession(c); } }));
    cardEl.appendChild(foot);
    grid.appendChild(cardEl);
  }
  wrap.appendChild(grid);
  shell.render(wrap);
}

// ---------- Detail ----------
async function renderDetail(id) {
  const c = store.get('campaigns', id);
  if (!c) { router.go('campaigns'); return; }
  const sys = store.get('rulesets', c.systemId);
  const grp = store.get('groups', c.groupId);
  shell.crumbs([{ label: 'Campaigns', to: 'campaigns' }, { label: c.name }]);
  shell.actions([
    button('Run Session', { icon: 'play', variant: 'primary', size: 'sm', onClick: () => startSession(c) }),
    button('AI Evolve', { icon: 'spark', variant: 'cool', size: 'sm', onClick: () => router.go('ai', 'campaign', c.id) }),
    button('Set Active', { icon: 'check', size: 'sm', onClick: async () => { await appState.setCampaign(c.id); toast('Active campaign set', { type: 'success' }); } }),
  ]);

  const wrap = el('div.view-pad');
  const headRow = el('div.section-header');
  const t = el('div.section-title'); t.appendChild(icon('flag', 20));
  const ti = el('div'); ti.appendChild(el('h2', c.name)); ti.appendChild(el('div.small.mute', (sys ? sys.name : '') + (grp ? ' · ' + grp.name : ' · no group'))); t.appendChild(ti);
  headRow.appendChild(t);
  headRow.appendChild(badge('Version ' + (c.currentVersion || 1), { variant: 'dim' }));
  wrap.appendChild(headRow);

  const sessions = store.where('sessions', (s) => s.campaignId === c.id).sort((a, b) => (a.number || 0) - (b.number || 0));

  wrap.appendChild(tabs([
    { key: 'overview', label: 'Overview', icon: 'info', render: () => buildOverview(c, sys, grp, sessions) },
    { key: 'storyline', label: 'Storyline', icon: 'scroll', render: () => buildStoryline(c) },
    { key: 'sessions', label: 'Sessions', icon: 'history', badge: sessions.length || null, render: () => buildSessions(c, sessions) },
    { key: 'versions', label: 'Versions', icon: 'layers', badge: (c.storylineVersions || []).length || null, render: () => buildVersions(c) },
    { key: 'notes', label: 'Notes', icon: 'edit', render: () => buildNotes(c) },
  ]));
  shell.render(wrap);
}

function buildOverview(c, sys, grp, sessions) {
  const col = el('div.col.gap-4');
  // status + meta
  const grid = el('div.meta-grid');
  const mi = (l, v) => { const m = el('div.meta-item'); m.appendChild(el('div.ml', l)); m.appendChild(el('div.mv', v)); return m; };
  grid.appendChild(mi('System', sys ? sys.name : '—'));
  grid.appendChild(mi('Group', grp ? grp.name : '—'));
  grid.appendChild(mi('Sessions played', String(sessions.length)));
  grid.appendChild(mi('Storyline version', 'v' + (c.currentVersion || 1)));
  grid.appendChild(mi('Status', c.status || 'active'));
  grid.appendChild(mi('Started', fmtDate(c.createdAt)));
  col.appendChild(grid);

  // status control
  const statusRow = el('div.row.gap-2');
  statusRow.appendChild(el('span.field-label', 'Status'));
  ['planning', 'active', 'completed'].forEach((st) => {
    statusRow.appendChild(button(st, { size: 'sm', variant: c.status === st ? 'primary' : 'outline', onClick: async () => { const n = deepClone(c); n.status = st; await store.save('campaigns', n); renderDetail(c.id); } }));
  });
  col.appendChild(statusRow);

  // group/storyline link
  const linkRow = el('div.row.gap-2.wrap');
  linkRow.appendChild(button('Change group', { size: 'sm', icon: 'users', onClick: () => changeGroup(c) }));
  const story = store.get('storylines', c.storylineId);
  if (story) linkRow.appendChild(button('View source storyline', { size: 'sm', icon: 'scroll', onClick: () => router.go('storylines', story.id) }));
  col.appendChild(linkRow);

  // premise
  if (c.storyline && c.storyline.premise) { col.appendChild(el('h3', 'Premise')); col.appendChild(el('p.prose.selectable', c.storyline.premise)); }

  // next session suggestion
  const played = new Set(sessions.map((s) => s.blueprintNumber).filter(Boolean));
  const blueprints = (c.storyline && c.storyline.sessions) || [];
  const next = blueprints.find((b) => !played.has(b.number));
  if (next) {
    const card_ = el('div.side-card', { style: { borderColor: 'var(--accent)' } });
    card_.appendChild(el('h4', { style: { color: 'var(--accent)' } }, 'Up Next'));
    card_.appendChild(el('div.big', { style: { fontWeight: 600 } }, `Session ${next.number} — ${next.title}`));
    if (next.subtitle) card_.appendChild(el('p.small.mute', next.subtitle));
    card_.appendChild(el('div', { style: { marginTop: '10px' } }, button('Run this session', { variant: 'primary', icon: 'play', onClick: () => startSession(c, next.number) })));
    col.appendChild(card_);
  }
  return col;
}

function buildStoryline(c) {
  const col = el('div.col.gap-4');
  col.appendChild(el('p.small.mute', 'This is this campaign\'s own working copy of the storyline (forked from the template). Editing it here preserves the history of sessions already played — once a session is played under a version, the next edit creates a new version automatically.'));
  col.appendChild(tabs([
    { key: 'structure', label: 'Structure', icon: 'flag', render: () => renderActs(c.storyline, { onSession: (sess) => showCampaignSession(c, sess) }) },
    { key: 'world', label: 'World', icon: 'compass', render: () => renderWorld(c.storyline) },
    { key: 'timeline', label: 'Timeline', icon: 'clock', render: () => renderTimeline(c.storyline) },
  ]));
  return col;
}

function showCampaignSession(c, sess) {
  const m = modal({ title: '', width: 760 });
  m.setBody(renderSessionBlueprint(sess, {
    actions: el('div.row.gap-2', [
      button('Edit', { size: 'sm', icon: 'edit', onClick: () => { m.close(); editSessionBlueprint(c, sess); } }),
      button('Run this', { size: 'sm', variant: 'primary', icon: 'play', onClick: () => { m.close(); startSession(c, sess.number); } }),
    ]),
  }));
}

function editSessionBlueprint(c, sess) {
  const titleI = input({ value: sess.title || '' });
  const subI = input({ value: sess.subtitle || '' });
  const sitI = textarea({ value: sess.situation || '', rows: 4 });
  const raI = textarea({ value: (sess.readAlouds || []).join('\n\n'), rows: 4, placeholder: 'One read-aloud per paragraph (blank line between).' });
  const rewardI = textarea({ value: sess.rewards || '', rows: 2 });
  const m = modal({ title: `Edit Session ${sess.number}`, width: 640, body: [field('Title', titleI), field('Subtitle', subI), field('Situation', sitI), field('Read-aloud passages', raI), field('Rewards', rewardI)] });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Save (may create new version)', { variant: 'primary', onClick: async () => {
      const content = deepClone(c.storyline);
      const target = content.sessions.find((s) => s.number === sess.number);
      if (target) { target.title = titleI.value; target.subtitle = subI.value; target.situation = sitI.value; target.readAlouds = raI.value.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean); target.rewards = rewardI.value; }
      await commitStoryline(c, content, 'Edited Session ' + sess.number);
      m.close(); toast('Saved', { type: 'success' }); renderDetail(c.id);
    } }),
  );
}

function buildSessions(c, sessions) {
  const col = el('div.col.gap-2');
  const top = el('div.row.between');
  top.appendChild(el('p.small.mute', sessions.length ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} played` : 'No sessions yet.'));
  top.appendChild(button('Run new session', { size: 'sm', variant: 'primary', icon: 'play', onClick: () => startSession(c) }));
  col.appendChild(top);
  if (!sessions.length) { col.appendChild(empty('No sessions played', { icon: 'history', hint: 'Run a session to capture notes, dice, combat, audio, and an AI recap.' })); return col; }
  sessions.forEach((s) => {
    const row = el('div.session-row');
    row.appendChild(el('div.sn', String(s.number || '•')));
    const meta = el('div.grow');
    meta.appendChild(el('div', { style: { fontWeight: 600 } }, s.title || `Session ${s.number}`));
    meta.appendChild(el('div.small.mute', `${fmtDate(s.date || s.createdAt)} · played under v${s.storylineVersion || 1}${s.summary ? ' · has AI recap' : ''}`));
    row.appendChild(meta);
    if (s.audioMediaId) row.appendChild(icon('mic', 16));
    if (s.summary) row.appendChild(icon('spark', 16));
    row.appendChild(icon('chevR', 16));
    row.addEventListener('click', () => router.go('sessions', s.id));
    col.appendChild(row);
  });
  return col;
}

function buildVersions(c) {
  const col = el('div.col.gap-2');
  col.appendChild(el('p.small.mute', 'Each version is an immutable snapshot of the storyline. Sessions stay pinned to the version they were played under, so you never lose the context of a past game.'));
  const versions = (c.storylineVersions || []).slice().sort((a, b) => b.v - a.v);
  versions.forEach((v) => {
    const sessCount = store.where('sessions', (s) => s.campaignId === c.id && s.storylineVersion === v.v).length;
    const row = el('div.version-row' + (v.v === c.currentVersion ? '.current' : ''));
    row.appendChild(el('span.version-badge', 'v' + v.v));
    const meta = el('div.grow');
    meta.appendChild(el('div', { style: { fontWeight: 600 } }, v.label || ('Version ' + v.v)));
    meta.appendChild(el('div.small.mute', `${fmtDateTime(v.at)} · ${sessCount} session${sessCount === 1 ? '' : 's'} played here`));
    row.appendChild(meta);
    if (v.v === c.currentVersion) row.appendChild(badge('Current', { variant: 'solid' }));
    row.appendChild(iconButton('eye', { title: 'View this version', size: 16, onClick: () => viewVersion(c, v) }));
    if (v.v !== c.currentVersion) row.appendChild(iconButton('history', { title: 'Restore as new version', size: 16, onClick: () => restoreVersion(c, v) }));
    col.appendChild(row);
  });
  return col;
}

function viewVersion(c, v) {
  const m = modal({ title: `Storyline — v${v.v} (${v.label || ''})`, width: 820 });
  m.setBody(renderActs(v.content, { onSession: (sess) => { const mm = modal({ title: '', width: 720 }); mm.setBody(renderSessionBlueprint(sess)); } }));
}

async function restoreVersion(c, v) {
  if (!(await confirm({ title: 'Restore version?', message: `Make v${v.v} the basis of a new current version? Past sessions keep their own version.`, okLabel: 'Restore' }))) return;
  await commitStoryline(c, deepClone(v.content), `Restored from v${v.v}`, { forceNewVersion: true });
  toast('Restored as new version', { type: 'success' });
  renderDetail(c.id);
}

function buildNotes(c) {
  const col = el('div.col.gap-4');
  const notesT = textarea({ value: c.notes || '', rows: 14, placeholder: 'Campaign-wide GM notes, secrets, world state, divergences from the storyline…', autosize: true });
  let timer;
  notesT.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => { const n = deepClone(c); n.notes = notesT.value; await store.save('campaigns', n); }, 400); });
  col.appendChild(notesT);
  return col;
}

function changeGroup(c) {
  const groups = store.all('groups');
  let groupId = c.groupId || '';
  const sel = select([{ value: '', label: '— No group —' }, ...groups.map((g) => ({ value: g.id, label: g.name }))], { value: groupId, onChange: (v) => (groupId = v) });
  const m = modal({ title: 'Change Group', width: 400, body: [field('Player group', sel)] });
  m.setFooter(button('Save', { variant: 'primary', onClick: async () => { const n = deepClone(c); n.groupId = groupId || null; await store.save('campaigns', n); m.close(); renderDetail(c.id); } }));
}

// ---------- Create from scratch ----------
function openCreate() {
  const stories = store.all('storylines');
  const systems = store.all('rulesets');
  const groups = store.all('groups');
  let mode = stories.length ? 'fromStory' : 'blank';
  let storyId = stories[0] && stories[0].id;
  let systemId = appState.activeSystemId || (systems[0] && systems[0].id);
  let groupId = groups[0] && groups[0].id;
  const nameI = input({ placeholder: 'Campaign name' });

  const body = el('div.col.gap-4');
  if (stories.length) {
    const storySel = select(stories.map((s) => ({ value: s.id, label: s.name })), { value: storyId, onChange: (v) => (storyId = v) });
    body.appendChild(field('Start from storyline', storySel, { hint: 'Forks the storyline into this campaign.' }));
  }
  const sysSel = select(systems.map((s) => ({ value: s.id, label: s.name })), { value: systemId, onChange: (v) => (systemId = v) });
  const groupSel = select([{ value: '', label: '— No group —' }, ...groups.map((g) => ({ value: g.id, label: g.name }))], { value: groupId || '', onChange: (v) => (groupId = v) });
  body.appendChild(field('Campaign name', nameI));
  body.appendChild(field('System', sysSel));
  body.appendChild(field('Group', groupSel));

  const m = modal({ title: 'New Campaign', width: 480, body: [body] });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Create', { variant: 'primary', onClick: async () => {
      let content;
      if (stories.length && storyId) { const story = store.get('storylines', storyId); content = forkStorylineContent(story); systemId = story.systemId; }
      else content = { name: nameI.value || 'New Campaign', premise: '', acts: [{ id: 'act1', title: 'Act I', summary: '' }], sessions: [], locations: [], factions: [], npcs: [], timeline: [] };
      const camp = {
        id: 'camp_' + uid('').slice(0, 8), name: nameI.value || (content.name || 'New Campaign'),
        systemId, storylineId: (stories.length && storyId) || null, groupId: groupId || null,
        storyline: content, currentVersion: 1,
        storylineVersions: [{ v: 1, label: 'Initial', at: new Date().toISOString(), content: deepClone(content) }],
        status: 'active', notes: '', worldState: { clocks: [], flags: {} },
      };
      await store.save('campaigns', camp);
      await appState.setCampaign(camp.id);
      m.close();
      router.go('campaigns', camp.id);
    } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

// Prompt the GM to tie a new (otherwise blank) session to a storyline brief.
// Resolves to a blueprint number, null (improvise), or false (cancel).
export function chooseBrief(campaign) {
  return new Promise((resolve) => {
    const sessions = ((campaign.storyline && campaign.storyline.sessions) || []).slice().sort((a, b) => (a.number || 0) - (b.number || 0));
    if (!sessions.length) { resolve(null); return; }
    const played = new Set(store.where('sessions', (s) => s.campaignId === campaign.id).map((s) => s.blueprintNumber).filter((n) => n != null));
    const list = el('div.col.gap-2', { style: { maxHeight: '46vh', overflow: 'auto' } });
    sessions.forEach((sess) => {
      const row = el('div.row.between', { style: { padding: '10px 12px', background: 'var(--bg-1)', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-1)' } });
      const meta = el('div.grow');
      const title = el('div', { style: { fontWeight: 600 } }, `S${sess.number} — ${sess.title || 'Untitled'}`);
      if (played.has(sess.number)) title.appendChild(badge('Played', { variant: 'dim' }));
      meta.appendChild(title);
      if (sess.subtitle) meta.appendChild(el('div.small.mute', sess.subtitle));
      row.appendChild(meta);
      row.appendChild(button('Use this brief', { size: 'sm', variant: 'primary', onClick: () => { m.close(); resolve(sess.number); } }));
      list.appendChild(row);
    });
    const m = modal({ title: 'Tie this session to a brief?', width: 640, body: [
      el('p.small.mute', 'Pick a storyline session to load its brief — read-aloud, beats, the key decision, NPC fates. You can also run unscripted and link a brief later from the Brief tab.'),
      list,
    ] });
    m.setFooter(
      button('Run unscripted', { variant: 'ghost', onClick: () => { m.close(); resolve(null); } }),
      button('Cancel', { variant: 'ghost', onClick: () => { m.close(); resolve(false); } }),
    );
  });
}

// ---------- Start a session (creates session doc, opens runner) ----------
export async function startSession(campaign, blueprintNumber) {
  // When no brief was pre-selected, prompt the GM to tie one in (or run unscripted).
  if (blueprintNumber == null) {
    const chosen = await chooseBrief(campaign);
    if (chosen === false) return; // cancelled
    blueprintNumber = chosen;
  }
  const existing = store.where('sessions', (s) => s.campaignId === campaign.id);
  const number = existing.length + 1;
  const blueprint = blueprintNumber != null && campaign.storyline ? (campaign.storyline.sessions || []).find((s) => s.number === blueprintNumber) : null;
  const group = store.get('groups', campaign.groupId);
  const session = {
    id: 'sess_' + uid('').slice(0, 8),
    campaignId: campaign.id, systemId: campaign.systemId,
    number, title: blueprint ? blueprint.title : `Session ${number}`,
    blueprintNumber: blueprint ? blueprint.number : null,
    storylineVersion: campaign.currentVersion || 1,
    date: new Date().toISOString(), groupId: campaign.groupId,
    presentPlayerIds: group ? (group.playerIds || []).slice() : [],
    log: [], notes: '', diceLog: [], combatState: null, clocks: [], sceneId: null,
    transcript: '', summary: '', recommendations: '', reflection: '', audioMediaId: null,
    npcIntroduced: [], durationSec: 0,
  };
  await store.save('sessions', session);
  await appState.setCampaign(campaign.id);
  appState.setSession(session.id);
  router.go('session', session.id);
}
