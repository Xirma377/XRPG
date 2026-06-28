import { el, clear, uid, deepClone } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, card, badge, chip, modal, confirm, toast, field, input, textarea, select } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { portraitNode } from '../portrait.js';

const COLORS = ['#5bd0a0', '#6fa8ff', '#c9a0ff', '#ff7a6b', '#e8b04b', '#7fd1d6', '#ff6b9d', '#9d8fff'];

export async function render() {
  shell.crumbs([{ label: 'Players & Groups' }]);
  shell.actions([
    button('New Player', { icon: 'user', size: 'sm', onClick: () => editPlayer() }),
    button('New Group', { icon: 'users', variant: 'primary', size: 'sm', onClick: () => editGroup() }),
  ]);

  const wrap = el('div.view-pad');
  wrap.appendChild(el('p.dim', { style: { marginBottom: '18px' } },
    'A group is a table of players. The same storyline can be run as multiple campaigns with different groups — each keeps its own play history.'));

  // Groups
  wrap.appendChild(buildSection('Groups (Tables)', 'users', store.all('groups'), groupCard, () => editGroup()));
  // Players
  wrap.appendChild(buildSection('Players', 'user', store.all('players'), playerCard, () => editPlayer()));

  shell.render(wrap);
}

function buildSection(title, ic, items, cardFn, addFn) {
  const sec = el('div', { style: { marginBottom: '28px' } });
  const head = el('div.section-header');
  const t = el('div.section-title'); t.appendChild(icon(ic, 18)); t.appendChild(el('h2', title)); t.appendChild(badge(String(items.length)));
  head.appendChild(t);
  head.appendChild(button('Add', { size: 'sm', icon: 'plus', onClick: addFn }));
  sec.appendChild(head);
  if (!items.length) { sec.appendChild(empty('None yet', { icon: ic, action: button('Create', { variant: 'primary', onClick: addFn }) })); return sec; }
  const grid = el('div.card-grid');
  items.forEach((it) => grid.appendChild(cardFn(it)));
  sec.appendChild(grid);
  return sec;
}

function groupCard(g) {
  const members = (g.playerIds || []).map((id) => store.get('players', id)).filter(Boolean);
  const c = card({ class: 'entity-card' });
  const head = el('div.ec-head');
  const avatar = el('div.ec-portrait', { style: { background: g.color || COLORS[0], display: 'grid', placeItems: 'center' } });
  avatar.appendChild(icon('users', 22, { stroke: '#0009' }));
  head.appendChild(avatar);
  const ht = el('div.grow');
  ht.appendChild(el('div.ec-title', g.name));
  ht.appendChild(el('div.ec-sub', `${members.length} player${members.length === 1 ? '' : 's'}`));
  head.appendChild(ht);
  c.appendChild(head);
  if (members.length) {
    const row = el('div.ec-tags');
    members.forEach((p) => row.appendChild(chip(p.name, { color: p.color })));
    c.appendChild(row);
  }
  const campCount = store.where('campaigns', (cc) => cc.groupId === g.id).length;
  c.appendChild(el('div.ec-body.small.mute', `${campCount} campaign${campCount === 1 ? '' : 's'}`));
  const foot = el('div.ec-foot');
  foot.appendChild(button('Edit', { size: 'sm', onClick: () => editGroup(g) }));
  const actions = el('div.card-actions');
  actions.appendChild(iconButton('trash', { title: 'Delete', size: 16, variant: 'danger', onClick: async () => { if (await confirm({ title: 'Delete group?', message: `Delete "${g.name}"? Campaigns keep running but lose this group link.`, danger: true })) { await store.remove('groups', g.id); render(); } } }));
  foot.appendChild(actions);
  c.appendChild(foot);
  return c;
}

function playerCard(p) {
  const pcs = store.where('characters', (c) => c.playerId === p.id);
  const c = card({ class: 'entity-card' });
  const head = el('div.ec-head');
  const avatar = el('div.ec-portrait', { style: { background: p.color || COLORS[1], display: 'grid', placeItems: 'center', color: '#0009', fontFamily: 'var(--font-display)', fontWeight: '700', fontSize: '22px' } }, (p.name || '?')[0].toUpperCase());
  head.appendChild(avatar);
  const ht = el('div.grow');
  ht.appendChild(el('div.ec-title', p.name));
  ht.appendChild(el('div.ec-sub', p.email || `${pcs.length} character${pcs.length === 1 ? '' : 's'}`));
  head.appendChild(ht);
  c.appendChild(head);
  if (pcs.length) {
    // group a player's characters by game system (players can play across systems)
    const bySys = {};
    pcs.forEach((pc) => { (bySys[pc.systemId] = bySys[pc.systemId] || []).push(pc); });
    Object.entries(bySys).forEach(([sid, list]) => {
      const sys = store.get('rulesets', sid);
      const wrap = el('div', { style: { marginTop: '6px' } });
      wrap.appendChild(el('div.tiny.mute', { style: { marginBottom: '4px' } }, sys ? sys.name : 'Unknown system'));
      const row = el('div.ec-tags');
      list.forEach((pc) => row.appendChild(chip(pc.name, { icon: 'mask', onClick: () => router.go('characters', pc.id) })));
      wrap.appendChild(row);
      c.appendChild(wrap);
    });
  }
  const foot = el('div.ec-foot');
  foot.appendChild(button('Edit', { size: 'sm', onClick: () => editPlayer(p) }));
  const actions = el('div.card-actions');
  actions.appendChild(iconButton('trash', { title: 'Delete', size: 16, variant: 'danger', onClick: async () => { if (await confirm({ title: 'Delete player?', message: `Delete "${p.name}"?`, danger: true })) { await store.remove('players', p.id); render(); } } }));
  foot.appendChild(actions);
  c.appendChild(foot);
  return c;
}

function editPlayer(p) {
  const isNew = !p;
  p = p ? deepClone(p) : { name: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], email: '', notes: '' };
  const nameI = input({ value: p.name, placeholder: 'Player name' });
  const emailI = input({ value: p.email || '', placeholder: 'Optional' });
  const colorI = input({ type: 'color', value: p.color });
  const notesI = textarea({ value: p.notes || '', rows: 2, placeholder: 'Notes about this player…' });
  const m = modal({ title: isNew ? 'New Player' : 'Edit Player', width: 440, body: [field('Name', nameI), field('Email / handle', emailI), field('Color', colorI), field('Notes', notesI)] });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Save', { variant: 'primary', onClick: async () => { p.name = nameI.value || 'Player'; p.email = emailI.value; p.color = colorI.value; p.notes = notesI.value; if (isNew) p.id = 'plr_' + uid('').slice(0, 8); await store.save('players', p); m.close(); render(); } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

function editGroup(g) {
  const isNew = !g;
  g = g ? deepClone(g) : { name: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], playerIds: [], notes: '' };
  if (!Array.isArray(g.playerIds)) g.playerIds = [];
  const nameI = input({ value: g.name, placeholder: 'e.g. Thursday Night Crew' });
  const colorI = input({ type: 'color', value: g.color });
  const notesI = textarea({ value: g.notes || '', rows: 2 });

  const memberWrap = el('div.col.gap-2');
  function drawMembers() {
    clear(memberWrap);
    const players = store.all('players');
    if (!players.length) { memberWrap.appendChild(el('p.small.mute', 'No players yet. Create players first, then add them here.')); return; }
    players.forEach((p) => {
      const inGroup = g.playerIds.includes(p.id);
      const row = el('label.checkbox', { style: { padding: '6px 0' } });
      const cb = el('input', { type: 'checkbox' }); cb.checked = inGroup;
      cb.addEventListener('change', () => { if (cb.checked) { if (!g.playerIds.includes(p.id)) g.playerIds.push(p.id); } else { g.playerIds = g.playerIds.filter((x) => x !== p.id); } });
      row.appendChild(cb); row.appendChild(el('span.checkbox-box'));
      const dot = el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: p.color, display: 'inline-block' } });
      row.appendChild(dot);
      row.appendChild(el('span', p.name));
      memberWrap.appendChild(row);
    });
  }
  drawMembers();

  const addPlayerBtn = button('+ New player', { size: 'sm', variant: 'ghost', onClick: () => editPlayerInline(() => drawMembers()) });

  const m = modal({ title: isNew ? 'New Group' : 'Edit Group', width: 480, body: [field('Group name', nameI), field('Color', colorI), el('div.field', [el('span.field-label', 'Members'), memberWrap, addPlayerBtn]), field('Notes', notesI)] });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Save', { variant: 'primary', onClick: async () => { g.name = nameI.value || 'New Group'; g.color = colorI.value; g.notes = notesI.value; if (isNew) g.id = 'grp_' + uid('').slice(0, 8); await store.save('groups', g); m.close(); render(); } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

function editPlayerInline(done) {
  const nameI = input({ placeholder: 'Player name' });
  const m = modal({ title: 'Quick Add Player', width: 380, body: [field('Name', nameI)] });
  m.setFooter(button('Add', { variant: 'primary', onClick: async () => { if (nameI.value.trim()) { await store.save('players', { id: 'plr_' + uid('').slice(0, 8), name: nameI.value.trim(), color: COLORS[Math.floor(Math.random() * COLORS.length)] }); } m.close(); done(); } }));
  setTimeout(() => nameI.focus(), 30);
}
