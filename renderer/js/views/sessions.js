import { el, clear, fmtDate, fmtDateTime, fmtClock, deepClone } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, badge, chip, modal, confirm, toast, tabs, copyText } from '../ui.js';
import { setMarkdown } from '../markdown.js';
import store from '../store.js';
import shell from '../shell.js';
import router from '../router.js';

export async function render(id) {
  if (id) return renderDetail(id);
  return renderList();
}

async function renderList() {
  shell.crumbs([{ label: 'Session Log' }]);
  shell.actions([button('Run a Session', { icon: 'play', variant: 'primary', size: 'sm', onClick: () => router.go('session') })]);
  const wrap = el('div.view-pad');
  const sessions = store.all('sessions').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!sessions.length) { wrap.appendChild(empty('No sessions yet', { icon: 'history', hint: 'Run a session to capture notes, dice, audio, and an AI recap.', action: button('Run a session', { variant: 'primary', icon: 'play', onClick: () => router.go('session') }) })); shell.render(wrap); return; }

  // group by campaign
  const byCamp = {};
  sessions.forEach((s) => { (byCamp[s.campaignId] = byCamp[s.campaignId] || []).push(s); });
  Object.entries(byCamp).forEach(([cid, list]) => {
    const camp = store.get('campaigns', cid);
    wrap.appendChild(el('h3', { style: { margin: '8px 0 10px' } }, camp ? camp.name : 'Unassigned'));
    list.forEach((s) => {
      const row = el('div.session-row');
      row.appendChild(el('div.sn', String(s.number)));
      const meta = el('div.grow');
      meta.appendChild(el('div', { style: { fontWeight: 600 } }, s.title || `Session ${s.number}`));
      meta.appendChild(el('div.small.mute', `${fmtDateTime(s.date)} · played under v${s.storylineVersion || 1}${s.durationSec ? ' · ' + fmtClock(s.durationSec) : ''}`));
      row.appendChild(meta);
      if (s.audioMediaId) row.appendChild(icon('mic', 16));
      if (s.summary) row.appendChild(badge('recap', { variant: 'dim' }));
      row.appendChild(icon('chevR', 16));
      row.addEventListener('click', () => router.go('sessions', s.id));
      wrap.appendChild(row);
    });
  });
  shell.render(wrap);
}

async function renderDetail(id) {
  const s = store.get('sessions', id);
  if (!s) { router.go('sessions'); return; }
  const camp = store.get('campaigns', s.campaignId);
  shell.crumbs([{ label: 'Session Log', to: 'sessions' }, { label: `${camp ? camp.name + ' · ' : ''}S${s.number}` }]);
  shell.actions([
    button('Resume', { icon: 'play', variant: 'primary', size: 'sm', onClick: () => router.go('session', s.id) }),
    button('Export', { icon: 'download', size: 'sm', onClick: () => exportSession(s) }),
    button('Delete', { icon: 'trash', size: 'sm', variant: 'danger', onClick: async () => { if (await confirm({ title: 'Delete session?', message: `Delete "${s.title}"? This removes its notes and recap (audio file stays in media).`, danger: true })) { await store.remove('sessions', s.id); router.go('sessions'); } } }),
  ]);

  const wrap = el('div.view-pad');
  const head = el('div.section-header');
  const t = el('div.section-title'); t.appendChild(el('div.sn', { style: { width: '44px', height: '44px' } }, String(s.number)));
  const ti = el('div'); ti.appendChild(el('h2', s.title || `Session ${s.number}`)); ti.appendChild(el('div.small.mute', `${camp ? camp.name + ' · ' : ''}${fmtDateTime(s.date)} · v${s.storylineVersion || 1}`)); t.appendChild(ti);
  head.appendChild(t);
  wrap.appendChild(head);

  wrap.appendChild(tabs([
    { key: 'recap', label: 'Recap', icon: 'spark', render: () => buildRecap(s) },
    { key: 'log', label: 'Log & Notes', icon: 'edit', render: () => buildLog(s) },
    { key: 'transcript', label: 'Transcript', icon: 'mic', render: () => buildTranscript(s) },
  ]));
  shell.render(wrap);
}

function buildRecap(s) {
  const col = el('div.col.gap-4');
  if (s.audioMediaId) { const a = el('audio', { controls: true, src: `xrpg://media/audio/${s.audioMediaId}`, style: { width: '100%' } }); col.appendChild(a); }
  // Per-speaker Discord recordings (accumulated across every record segment).
  if (s.discordRecordings && s.discordRecordings.length) {
    const rsec = el('div.col.gap-1');
    rsec.appendChild(el('h3', { style: { marginBottom: '2px' } }, `Discord recordings · ${s.discordRecordings.length} track${s.discordRecordings.length === 1 ? '' : 's'}`));
    s.discordRecordings.forEach((tr) => {
      const r = el('div.row.between', { style: { alignItems: 'center', gap: '8px' } });
      r.appendChild(el('span.small', { style: { flex: 'none' } }, `${tr.label || tr.username || 'Track'}${tr.role === 'gm' ? ' (GM)' : ''}`));
      r.appendChild(el('audio', { controls: true, src: tr.url || `xrpg://media/audio/${tr.mediaId}`, style: { height: '30px', flex: '1', minWidth: '0' } }));
      rsec.appendChild(r);
    });
    const mixes = (s.discordMixdowns && s.discordMixdowns.length) ? s.discordMixdowns : (s.discordMixdownUrl ? [{ url: s.discordMixdownUrl }] : []);
    if (mixes.length) {
      rsec.appendChild(el('div.small.mute', { style: { marginTop: '6px' } }, `Mixdown${mixes.length > 1 ? 's' : ''} (time-aligned)`));
      mixes.forEach((mx) => rsec.appendChild(el('audio', { controls: true, src: mx.url || `xrpg://media/audio/${mx.mediaId}`, style: { width: '100%' } })));
    }
    col.appendChild(rsec);
  }
  if (s.summary) { const prose = el('div.prose.selectable'); setMarkdown(prose, s.summary); col.appendChild(prose); }
  else col.appendChild(empty('No recap', { icon: 'spark', hint: 'Resume the session and generate an AI recap.' }));
  if (s.reflection) { col.appendChild(el('h3', 'Reflection')); col.appendChild(el('p.prose.selectable', s.reflection)); }
  if (s.npcIntroduced && s.npcIntroduced.length) {
    col.appendChild(el('h3', 'NPCs introduced'));
    const row = el('div.row.wrap.gap-2');
    s.npcIntroduced.forEach((nid) => { const n = store.get('characters', nid); if (n) row.appendChild(chip(n.name, { icon: 'npc', onClick: () => router.go('characters', nid) })); });
    col.appendChild(row);
  }
  return col;
}

function buildLog(s) {
  const col = el('div.col.gap-4');
  if (s.log && s.log.length) {
    const box = el('div.beat-list');
    s.log.forEach((e) => { const b = el('div.beat'); const bh = el('div.bh'); bh.appendChild(badge(e.type || 'note', { variant: 'dim' })); bh.appendChild(el('span.small.mute', new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))); b.appendChild(bh); b.appendChild(el('div.bb.selectable', e.text)); box.appendChild(b); });
    col.appendChild(box);
  }
  if (s.notes) { col.appendChild(el('h3', 'Notes')); col.appendChild(el('p.prose.selectable', s.notes)); }
  if (!(s.log || []).length && !s.notes) col.appendChild(empty('No notes', { icon: 'edit' }));
  return col;
}

function buildTranscript(s) {
  const col = el('div.col.gap-2');
  if (s.transcript) { col.appendChild(button('Copy transcript', { size: 'sm', icon: 'copy', onClick: () => copyText(s.transcript) })); col.appendChild(el('div.bridge-box.selectable', s.transcript)); }
  else col.appendChild(empty('No transcript', { icon: 'mic', hint: 'Record or paste a transcript while running the session.' }));
  return col;
}

async function exportSession(s) {
  const path = await window.xrpg.dialog.saveJson(`session-${s.number}.json`, { kind: 'xrpg-doc', collection: 'sessions', doc: s });
  if (path) toast('Exported', { type: 'success' });
}
