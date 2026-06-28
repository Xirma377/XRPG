import { el, clear, fmtDate, relTime } from '../util.js';
import { icon } from '../icons.js';
import { button, empty } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { brandLogoSvg } from '../assets.js';

export async function render() {
  shell.crumbs([{ label: 'Dashboard' }]);
  shell.actions(null);

  const campaigns = store.all('campaigns');
  const characters = store.all('characters');
  const sessions = store.all('sessions').sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''));
  const systems = store.all('rulesets');
  const sys = appState.system;

  const wrap = el('div.view-pad');

  // Hero
  const hero = el('div.hero');
  hero.appendChild(el('h1', `Welcome to XRPG`));
  hero.appendChild(el('p', sys
    ? `Your game-master console for ${sys.name}. Build campaigns, run live sessions with maps and audio, track combat, and let Claude help you evolve the story between games.`
    : `Your all-in-one game-master console. Start by adding a game system.`));
  const ha = el('div.hero-actions');
  ha.appendChild(button('Run a Session', { variant: 'primary', icon: 'play', onClick: () => router.go('session') }));
  ha.appendChild(button('New Campaign', { icon: 'plus', onClick: () => router.go('campaigns', 'new') }));
  ha.appendChild(button('AI Studio', { icon: 'spark', variant: 'cool', onClick: () => router.go('ai') }));
  hero.appendChild(ha);
  wrap.appendChild(hero);

  // First-run onboarding: walk a new GM through the dependency chain.
  if (!campaigns.length) {
    const groups = store.all('groups');
    const steps = [
      { done: systems.length > 0, label: 'Pick a game system', hint: `${systems.length} ready — STRAIN Z, D&D 2024, Pathfinder 2E, Call of Cthulhu, and more`, view: 'systems', cta: 'Browse systems' },
      { done: groups.length > 0, label: 'Add your players & a group', hint: 'A group is your table; campaigns run with a group', view: 'groups', cta: 'Add a group' },
      { done: false, label: 'Start a campaign', hint: 'Fork a storyline (or start blank) for your group', view: 'campaigns', param: 'new', cta: 'New campaign' },
      { done: false, label: 'Run a session', hint: 'The command center: brief, party, combat, dice, audio, notes, AI recap', view: 'session', cta: 'Run session' },
    ];
    const panel = el('div.panel-box', { style: { marginBottom: '22px', borderColor: 'var(--accent)' } });
    const ph = el('div.panel-box-head'); ph.appendChild(el('h3', [icon('spark', 16), ' Getting Started'])); panel.appendChild(ph);
    const pb = el('div.panel-box-body');
    steps.forEach((s, i) => {
      const row = el('div.list-row');
      const num = el('div.avatar', { style: { background: s.done ? 'var(--good)' : 'var(--bg-3)', color: s.done ? 'var(--accent-ink)' : 'var(--text-dim)', fontWeight: '700' } });
      num.appendChild(s.done ? icon('check', 18) : document.createTextNode(String(i + 1)));
      row.appendChild(num);
      const m = el('div.meta'); m.appendChild(el('div.t', s.label)); m.appendChild(el('div.s', s.hint)); row.appendChild(m);
      row.appendChild(button(s.cta, { size: 'sm', variant: i === 0 || s.done ? 'outline' : 'primary', onClick: () => s.param ? router.go(s.view, s.param) : router.go(s.view) }));
      pb.appendChild(row);
    });
    panel.appendChild(pb);
    wrap.appendChild(panel);
  }

  // Stat cards
  const stats = el('div.stat-cards');
  const statCard = (num, lbl, ic, view) => {
    const c = el('div.stat-card');
    const top = el('div.row.between');
    top.appendChild(el('div.num', String(num)));
    top.appendChild(icon(ic, 22));
    c.appendChild(top);
    c.appendChild(el('div.lbl', lbl));
    c.style.cursor = 'pointer';
    c.addEventListener('click', () => router.go(view));
    return c;
  };
  stats.appendChild(statCard(campaigns.length, 'Campaigns', 'flag', 'campaigns'));
  stats.appendChild(statCard(characters.length, 'Characters', 'mask', 'characters'));
  stats.appendChild(statCard(sessions.length, 'Sessions Played', 'history', 'sessions'));
  stats.appendChild(statCard(systems.length, 'Game Systems', 'layers', 'systems'));
  wrap.appendChild(stats);

  // Two-column: recent campaigns | recent sessions
  const grid = el('div.dash-grid');

  // Campaigns panel
  const campPanel = el('div.panel-box');
  const ch = el('div.panel-box-head');
  ch.appendChild(el('h3', 'Your Campaigns'));
  ch.appendChild(button('New', { size: 'sm', icon: 'plus', onClick: () => router.go('campaigns', 'new') }));
  campPanel.appendChild(ch);
  const cb = el('div.panel-box-body');
  if (!campaigns.length) {
    cb.appendChild(empty('No campaigns yet', { icon: 'flag', hint: 'A campaign runs a storyline with a specific group of players.', action: button('Create your first campaign', { variant: 'primary', icon: 'plus', onClick: () => router.go('campaigns', 'new') }) }));
  } else {
    campaigns.slice(0, 6).forEach((c) => {
      const sysName = (store.get('rulesets', c.systemId) || {}).name || '';
      const grp = store.get('groups', c.groupId);
      const sessCount = store.where('sessions', (s) => s.campaignId === c.id).length;
      const row = el('div.list-row');
      const av = el('div.avatar'); av.appendChild(icon('flag', 18));
      row.appendChild(av);
      const meta = el('div.meta');
      meta.appendChild(el('div.t', c.name || 'Untitled campaign'));
      meta.appendChild(el('div.s', `${sysName}${grp ? ' · ' + grp.name : ''} · ${sessCount} session${sessCount === 1 ? '' : 's'}`));
      row.appendChild(meta);
      row.appendChild(icon('chevR', 16));
      row.addEventListener('click', () => router.go('campaigns', c.id));
      cb.appendChild(row);
    });
  }
  campPanel.appendChild(cb);
  grid.appendChild(campPanel);

  // Sessions panel
  const sessPanel = el('div.panel-box');
  const sh = el('div.panel-box-head');
  sh.appendChild(el('h3', 'Recent Sessions'));
  sh.appendChild(button('Log', { size: 'sm', icon: 'history', onClick: () => router.go('sessions') }));
  sessPanel.appendChild(sh);
  const sb = el('div.panel-box-body');
  if (!sessions.length) {
    sb.appendChild(empty('No sessions recorded', { icon: 'history', hint: 'Run a session to capture notes, dice, combat, and an AI recap.' }));
  } else {
    sessions.slice(0, 6).forEach((s) => {
      const camp = store.get('campaigns', s.campaignId);
      const row = el('div.list-row');
      const av = el('div.avatar'); av.appendChild(el('span.display', String(s.number || '•')));
      row.appendChild(av);
      const meta = el('div.meta');
      meta.appendChild(el('div.t', s.title || `Session ${s.number || ''}`));
      meta.appendChild(el('div.s', `${camp ? camp.name + ' · ' : ''}${relTime(s.date || s.createdAt)}`));
      row.appendChild(meta);
      if (s.summary) row.appendChild(icon('spark', 15));
      row.addEventListener('click', () => router.go('sessions', s.id));
      sb.appendChild(row);
    });
  }
  sessPanel.appendChild(sb);
  grid.appendChild(sessPanel);

  wrap.appendChild(grid);

  // Quick tools row
  const tools = el('div.panel-box');
  tools.style.marginTop = '18px';
  const th = el('div.panel-box-head'); th.appendChild(el('h3', 'Quick Tools')); tools.appendChild(th);
  const tb = el('div.panel-box-body');
  const toolGrid = el('div.card-grid');
  const quick = [
    { v: 'dice', i: 'dice', t: 'Dice Roller', d: 'System-aware checks & probability' },
    { v: 'combat', i: 'swords', t: 'Combat Tracker', d: 'Initiative, clocks, conditions' },
    { v: 'vtt', i: 'map', t: 'Tabletop', d: 'Maps, tokens, fog of war' },
    { v: 'mixer', i: 'music', t: 'Audio Mixer', d: 'Ambient beds & cues' },
    { v: 'rules', i: 'book', t: 'Rules Lookup', d: 'Searchable reference & cheat sheet' },
    { v: 'characters', i: 'mask', t: 'Characters', d: 'PCs & NPCs with portraits' },
  ];
  quick.forEach((q) => {
    const c = el('div.card.clickable');
    const r = el('div.row');
    const ic = el('div.channel-icon'); ic.appendChild(icon(q.i, 20));
    r.appendChild(ic);
    const m = el('div.grow');
    m.appendChild(el('div', { style: { fontWeight: 600 } }, q.t));
    m.appendChild(el('div.small.mute', q.d));
    r.appendChild(m);
    c.appendChild(r);
    c.addEventListener('click', () => router.go(q.v));
    toolGrid.appendChild(c);
  });
  tb.appendChild(toolGrid);
  tools.appendChild(tb);
  wrap.appendChild(tools);

  shell.render(wrap);
}
