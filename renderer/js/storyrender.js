// Shared renderers for storyline content (acts, sessions, world, timeline).
import { el, clear } from './util.js';
import { icon } from './icons.js';
import { badge, chip } from './ui.js';
import { setMarkdown } from './markdown.js';
import store from './store.js';
import router from './router.js';

export function renderReadAloud(text) {
  return el('div.read-aloud.selectable', text);
}

export function renderSessionBlueprint(s, opts = {}) {
  const wrap = el('div.col.gap-4');
  const head = el('div.row.between');
  const ht = el('div');
  ht.appendChild(el('h3', `Session ${s.number || ''} — ${s.title || ''}`));
  if (s.subtitle) ht.appendChild(el('p.small.mute', s.subtitle));
  head.appendChild(ht);
  if (opts.actions) head.appendChild(opts.actions);
  wrap.appendChild(head);

  if (s.situation) { const sec = section('Situation'); const p = el('div.prose.selectable'); setMarkdown(p, s.situation); sec.appendChild(p); wrap.appendChild(sec); }

  (s.readAlouds || []).forEach((ra) => wrap.appendChild(renderReadAloud(ra)));

  (s.phases || []).forEach((ph) => {
    const sec = section(ph.title);
    if (ph.body) { const p = el('div.prose.selectable'); setMarkdown(p, ph.body); sec.appendChild(p); }
    if (ph.beats && ph.beats.length) {
      const bl = el('div.beat-list');
      ph.beats.forEach((b) => { const beat = el('div.beat'); const bb = el('div.bb.selectable'); setMarkdown(bb, b); beat.appendChild(bb); bl.appendChild(beat); });
      sec.appendChild(bl);
    }
    wrap.appendChild(sec);
  });

  if (s.decision) { const sec = section('The Decision'); const p = el('div.prose.selectable'); setMarkdown(p, s.decision); sec.appendChild(p); wrap.appendChild(sec); }

  if (s.checksClocks && s.checksClocks.length) {
    const sec = section('Checks & Clocks');
    const ul = el('ul.prose');
    s.checksClocks.forEach((c) => ul.appendChild(el('li', c)));
    sec.appendChild(ul); wrap.appendChild(sec);
  }
  if (s.branches && s.branches.length) {
    const sec = section('Branches & Options');
    s.branches.forEach((b) => { const beat = el('div.beat'); beat.appendChild(el('div.bt', b.name)); const bb = el('div.bb.selectable'); setMarkdown(bb, b.body); beat.appendChild(bb); sec.appendChild(beat); });
    wrap.appendChild(sec);
  }
  if (s.npcFates && s.npcFates.length) {
    const sec = section('NPC Fates & Hooks');
    const ul = el('ul.prose'); s.npcFates.forEach((c) => ul.appendChild(el('li', c))); sec.appendChild(ul); wrap.appendChild(sec);
  }
  if (s.rewards) { const sec = section('Rewards'); const p = el('div.prose.selectable'); setMarkdown(p, s.rewards); sec.appendChild(p); wrap.appendChild(sec); }
  return wrap;
}

function section(title) {
  const s = el('div');
  s.appendChild(el('div.rcat', { style: { color: 'var(--accent)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px', marginTop: '4px' } }, title));
  return s;
}

export function renderActs(content, opts = {}) {
  const wrap = el('div.col.gap-4');
  (content.acts || []).forEach((act) => {
    const block = el('div.act-block');
    block.appendChild(el('div.act-title', act.title));
    if (act.days) block.appendChild(el('div.small.mute', act.days));
    block.appendChild(el('p.prose.selectable', act.summary || ''));
    // sessions in this act
    const sessions = (content.sessions || []).filter((s) => s.act === act.id);
    if (sessions.length) {
      const list = el('div.col.gap-2', { style: { marginTop: '8px' } });
      sessions.forEach((s) => {
        const row = el('div.beat.clickable', { style: { cursor: opts.onSession ? 'pointer' : 'default' } });
        const bh = el('div.bh');
        bh.appendChild(badge('S' + s.number, { variant: 'dim' }));
        bh.appendChild(el('div.bt', s.title));
        row.appendChild(bh);
        if (s.subtitle) row.appendChild(el('div.bb', s.subtitle));
        if (opts.onSession) row.addEventListener('click', () => opts.onSession(s));
        list.appendChild(row);
      });
      block.appendChild(list);
    }
    wrap.appendChild(block);
  });
  // refuges / catastrophe / finale extras
  if (content.refuges) {
    const sec = section('The Refuges');
    content.refuges.forEach((r) => { const c = el('div.beat'); c.appendChild(el('div.bt', r.name)); c.appendChild(el('div.bb.selectable', r.desc)); sec.appendChild(c); });
    wrap.appendChild(sec);
  }
  if (content.catastrophe) { const sec = section('The Catastrophe'); sec.appendChild(el('p.prose.selectable', content.catastrophe)); wrap.appendChild(sec); }
  if (content.finale) { const sec = section('The Finale'); sec.appendChild(el('p.prose.selectable', content.finale)); wrap.appendChild(sec); }
  return wrap;
}

export function renderWorld(content) {
  const wrap = el('div.col.gap-5');
  if (content.locations && content.locations.length) {
    const sec = el('div'); sec.appendChild(el('h3', { style: { marginBottom: '10px' } }, 'Locations'));
    content.locations.forEach((l) => { const c = el('div.beat'); const bh = el('div.bh'); bh.appendChild(el('div.bt', l.name)); (l.tags || []).forEach((t) => bh.appendChild(badge(t, { variant: 'dim' }))); c.appendChild(bh); c.appendChild(el('div.bb.selectable', l.desc)); sec.appendChild(c); });
    wrap.appendChild(sec);
  }
  if (content.factions && content.factions.length) {
    const sec = el('div'); sec.appendChild(el('h3', { style: { marginBottom: '10px' } }, 'Factions'));
    content.factions.forEach((f) => {
      const c = el('div.beat'); const bh = el('div.bh'); bh.appendChild(el('div.bt', f.name));
      const leader = f.leaderRef ? store.get('characters', f.leaderRef) : null;
      if (leader) bh.appendChild(chip(leader.name, { icon: 'npc', onClick: () => router.go('characters', leader.id) }));
      c.appendChild(bh); c.appendChild(el('div.bb.selectable', f.desc)); sec.appendChild(c);
    });
    wrap.appendChild(sec);
  }
  if (content.npcs && content.npcs.length) {
    const sec = el('div'); sec.appendChild(el('h3', { style: { marginBottom: '10px' } }, 'Key NPCs'));
    const row = el('div.row.wrap.gap-2');
    content.npcs.forEach((nid) => { const npc = store.get('characters', nid); if (npc) row.appendChild(chip(npc.name, { icon: 'mask', onClick: () => router.go('characters', npc.id) })); });
    sec.appendChild(row); wrap.appendChild(sec);
  }
  return wrap;
}

export function renderTimeline(content) {
  const wrap = el('div');
  (content.timeline || []).forEach((t) => {
    const row = el('div.timeline-row');
    row.appendChild(el('div.timeline-when', t.when));
    row.appendChild(el('div.grow.selectable', t.what));
    wrap.appendChild(row);
  });
  if (!(content.timeline || []).length) wrap.appendChild(el('p.dim', 'No timeline defined.'));
  return wrap;
}
