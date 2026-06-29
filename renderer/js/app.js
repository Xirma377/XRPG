// XRPG renderer entry point: boots data, builds the shell, wires routing.
import { el, clear, $, debounce } from './util.js';
import { icon } from './icons.js';
import { brandLogoSvg } from './assets.js';
import store from './store.js';
import appState from './state.js';
import router from './router.js';
import shell from './shell.js';
import { toast, contextMenu, modal, button } from './ui.js';
import updates from './updates.js';
import { initDiscordBridge } from './discord-bridge.js';
import { openPlayerDisplay } from './presenter.js';

const NAV = [
  { section: 'Play' },
  { view: 'dashboard', label: 'Dashboard', icon: 'home' },
  { view: 'session', label: 'Run Session', icon: 'play' },
  { view: 'vtt', label: 'Tabletop', icon: 'map' },
  { view: 'combat', label: 'Combat Tracker', icon: 'swords' },
  { view: 'mixer', label: 'Audio Mixer', icon: 'music' },
  { view: 'dice', label: 'Dice', icon: 'dice' },
  { section: 'Campaign' },
  { view: 'campaigns', label: 'Campaigns', icon: 'flag', countColl: 'campaigns' },
  { view: 'storylines', label: 'Storylines', icon: 'scroll', countColl: 'storylines' },
  { view: 'characters', label: 'Characters', icon: 'mask', countColl: 'characters' },
  { view: 'groups', label: 'Players & Groups', icon: 'users' },
  { view: 'sessions', label: 'Session Log', icon: 'history', countColl: 'sessions' },
  { section: 'System' },
  { view: 'rules', label: 'Rules', icon: 'book' },
  { view: 'systems', label: 'Game Systems', icon: 'layers', countColl: 'rulesets' },
  { section: 'Studio' },
  { view: 'ai', label: 'AI Studio', icon: 'spark' },
];

// Player mode: a streamlined, player-first navigation. No GM tooling.
const NAV_PLAYER = [
  { section: 'Play' },
  { view: 'dashboard', label: 'Home', icon: 'home' },
  { view: 'characters', label: 'My Characters', icon: 'mask', countColl: 'characters' },
  { view: 'dice', label: 'Dice', icon: 'dice' },
  { section: 'Reference' },
  { view: 'rules', label: 'Rules', icon: 'book' },
];
// Routes a Player is allowed to reach (everything else redirects to Home).
const PLAYER_ROUTES = new Set(['dashboard', 'characters', 'dice', 'rules', 'settings']);

function currentRole() { return (appState.settings && appState.settings.role) || 'gm'; }
function isPlayer() { return currentRole() === 'player'; }
function navList() { return isPlayer() ? NAV_PLAYER : NAV; }

const ROUTES = {
  dashboard: () => import('./views/dashboard.js'),
  session: () => import('./views/session.js'),
  vtt: () => import('./views/vtt.js'),
  combat: () => import('./views/combat.js'),
  mixer: () => import('./views/mixer.js'),
  dice: () => import('./views/dice.js'),
  campaigns: () => import('./views/campaigns.js'),
  storylines: () => import('./views/storylines.js'),
  characters: () => import('./views/characters.js'),
  groups: () => import('./views/groups.js'),
  sessions: () => import('./views/sessions.js'),
  rules: () => import('./views/rules.js'),
  systems: () => import('./views/systems.js'),
  ai: () => import('./views/ai.js'),
  settings: () => import('./views/settings.js'),
};

let navItems = {};

function buildShell() {
  const app = el('div#app');

  // ---- Sidebar ----
  const sidebar = el('aside.sidebar');
  const brand = el('div.brand');
  const logo = el('div.brand-logo'); logo.innerHTML = brandLogoSvg(28);
  brand.appendChild(logo);
  brand.appendChild(el('div.brand-name', [el('span.x', 'X'), document.createTextNode('RPG')]));
  brand.style.cursor = 'pointer';
  brand.title = 'About XRPG';
  brand.addEventListener('click', openAbout);
  sidebar.appendChild(brand);

  const nav = el('nav.nav');
  for (const item of navList()) {
    if (item.section) { nav.appendChild(el('div.nav-section-label', item.section)); continue; }
    const n = el('div.nav-item', { 'data-view': item.view });
    n.appendChild(icon(item.icon, 18));
    n.appendChild(el('span.nav-label', item.label));
    const count = el('span.nav-count');
    n.appendChild(count);
    n.addEventListener('click', () => router.go(item.view));
    nav.appendChild(n);
    navItems[item.view] = { node: n, countEl: count, countColl: item.countColl };
  }
  sidebar.appendChild(nav);

  // system switcher + settings
  const foot = el('div.sidebar-foot');
  foot.appendChild(el('div.nav-section-label', { style: { padding: '2px 6px 4px' } }, 'Active System'));
  const sysSwitch = el('div.sys-switch', { id: 'sysSwitch' });
  sysSwitch.appendChild(el('div.sys-switch-dot'));
  const sysText = el('div.sys-switch-text');
  sysText.appendChild(el('div.sys-name', '—'));
  sysText.appendChild(el('div.sys-sub', 'Game system'));
  sysSwitch.appendChild(sysText);
  sysSwitch.appendChild(icon('chevD', 14, { class: 'sys-switch-text' }));
  sysSwitch.addEventListener('click', openSystemMenu);
  foot.appendChild(sysSwitch);

  const settingsBtn = el('div.nav-item', { 'data-view': 'settings' });
  settingsBtn.appendChild(icon('gear', 18));
  settingsBtn.appendChild(el('span.nav-label', 'Settings'));
  settingsBtn.addEventListener('click', () => router.go('settings'));
  navItems['settings'] = { node: settingsBtn };
  foot.appendChild(settingsBtn);
  sidebar.appendChild(foot);

  app.appendChild(sidebar);

  // ---- Main ----
  const main = el('main.main');
  const topbar = el('div.topbar');
  const navToggle = el('button.icon-btn', { title: 'Toggle navigation' });
  navToggle.appendChild(icon('menu', 18));
  navToggle.addEventListener('click', () => app.classList.toggle('nav-collapsed'));
  topbar.appendChild(navToggle);

  const crumbs = el('div.crumbs');
  topbar.appendChild(crumbs);
  topbar.appendChild(el('div.topbar-spacer'));

  const globalSearch = el('div.global-search');
  globalSearch.appendChild(icon('search', 15));
  const gInput = el('input', { placeholder: 'Search… (Ctrl+K)' });
  gInput.addEventListener('focus', openPalette);
  globalSearch.appendChild(gInput);
  topbar.appendChild(globalSearch);

  // Windows launcher: pop the current view or a reference view into its own window
  // (second monitor), and open the player display.
  const windowsBtn = el('button.icon-btn', { title: 'Open in a separate window' });
  windowsBtn.appendChild(icon('cards', 18));
  windowsBtn.addEventListener('click', () => {
    const c = router.current || { view: 'dashboard', params: [] };
    const cur = c.view + (c.params && c.params.length ? '/' + c.params.join('/') : '');
    const ref = (route) => window.xrpg.window.popout(route, 'ref');
    const r = windowsBtn.getBoundingClientRect();
    contextMenu([
      { label: 'Open Player Display', icon: 'eye', onClick: () => openPlayerDisplay() },
      '-',
      { label: 'Pop out current view', icon: 'cards', onClick: () => ref(cur) },
      { label: 'Tabletop', icon: 'map', onClick: () => ref('vtt') },
      { label: 'Combat Tracker', icon: 'swords', onClick: () => ref('combat') },
      { label: 'Rules & Bestiary', icon: 'book', onClick: () => ref('rules') },
      { label: 'Audio Mixer', icon: 'music', onClick: () => ref('mixer') },
      { label: 'Dice', icon: 'dice', onClick: () => ref('dice') },
    ], r.right - 200, r.bottom + 4);
  });
  if (!isPlayer()) topbar.appendChild(windowsBtn);

  const saveDot = el('div.save-dot', { id: 'saveDot', title: 'Saved' });
  saveDot.appendChild(icon('check', 13));
  saveDot.appendChild(el('span', 'Saved'));
  topbar.appendChild(saveDot);

  const actions = el('div.topbar-actions', { id: 'viewActions' });
  topbar.appendChild(actions);

  main.appendChild(topbar);
  const view = el('div.view', { id: 'view' });
  main.appendChild(view);
  app.appendChild(main);

  document.body.appendChild(app);

  shell.mount({ viewEl: view, crumbEl: crumbs, actionsEl: actions, appEl: app });
  refreshCounts();
  refreshSystemSwitcher();
}

function refreshCounts() {
  const player = isPlayer();
  for (const [view, ref] of Object.entries(navItems)) {
    if (ref.countColl && ref.countEl) {
      // Player mode's "My Characters" badge must match the player home: own
      // (non-seed) PCs only — not the seeded NPCs/demo party.
      const n = (player && ref.countColl === 'characters')
        ? store.all('characters').filter((c) => (c.kind || 'pc') === 'pc' && !c._seed).length
        : store.all(ref.countColl).length;
      ref.countEl.textContent = n ? String(n) : '';
    }
  }
}

function refreshSystemSwitcher() {
  const sw = $('#sysSwitch');
  if (!sw) return;
  const sys = appState.system;
  sw.querySelector('.sys-name').textContent = sys ? sys.name : 'No system';
  sw.querySelector('.sys-sub').textContent = sys ? (sys.tagline || 'Game system') : 'Add a system';
}

function openSystemMenu(e) {
  const systems = store.all('rulesets');
  const items = systems.map((s) => ({
    label: s.name + (s.id === appState.activeSystemId ? '  ✓' : ''),
    onClick: async () => { await appState.setSystem(s.id); refreshSystemSwitcher(); router._resolve(); toast(`Switched to ${s.name}`, { type: 'success', timeout: 1500 }); },
  }));
  items.push('-');
  items.push({ label: 'Manage systems…', icon: 'layers', onClick: () => router.go('systems') });
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(items, r.left, r.top - (items.length * 34) - 10);
}

function setActiveNav(view) {
  for (const [v, ref] of Object.entries(navItems)) ref.node.classList.toggle('active', v === view);
}

let currentMod = null;
async function mountView(view, params) {
  // Player mode never reaches GM-only views (even via a stale hash / deep link).
  if (!window.__popout && isPlayer() && !PLAYER_ROUTES.has(view)) { router.go('dashboard'); return; }
  // Tear down the outgoing view (cancels its timers/listeners/RAF/audio nodes).
  // Awaited so a view that persists on teardown (e.g. the session runner) lands
  // before the next view reads the store.
  if (currentMod && typeof currentMod.teardown === 'function') {
    try { await currentMod.teardown(); } catch (e) { console.error('teardown error', e); }
  }
  currentMod = null;
  setActiveNav(view);
  shell.actions(null);
  const loader = ROUTES[view] || ROUTES.dashboard;
  try {
    const mod = await loader();
    currentMod = mod;
    await mod.render(...params);
  } catch (err) {
    console.error('view error', view, err);
    shell.render(el('div.view-pad', [
      el('div.empty', [
        icon('warn', 40, { class: 'empty-icon' }),
        el('p.empty-msg', 'Failed to load this view'),
        el('p.empty-hint', String(err && err.message || err)),
      ]),
    ]));
  }
}

// ---------- Command palette ----------
let paletteOpen = false;
function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  const results = el('div.palette-results');
  const inp = el('input.input', { placeholder: 'Jump to anything — views, campaigns, characters, rules…', autofocus: true });
  const m = modal({ title: 'Quick search', width: 600, class: 'palette', body: [inp, results], onClose: () => { paletteOpen = false; } });
  const sources = buildPaletteIndex();

  const run = debounce(() => {
    const q = inp.value.trim().toLowerCase();
    clear(results);
    let list = sources;
    if (q) list = sources.filter((s) => s.text.toLowerCase().includes(q)).sort((a, b) => a.text.toLowerCase().indexOf(q) - b.text.toLowerCase().indexOf(q));
    list = list.slice(0, 40);
    for (const r of list) {
      const row = el('button.palette-row', { type: 'button' });
      row.appendChild(icon(r.icon || 'chevR', 15));
      row.appendChild(el('span.grow', r.text));
      row.appendChild(el('span.palette-cat', r.cat));
      row.addEventListener('click', () => { m.close(); r.go(); });
      results.appendChild(row);
    }
    if (!list.length) results.appendChild(el('div.empty', [el('p.empty-hint', 'No matches')]));
  }, 80);
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); const f = results.querySelector('.palette-row'); if (f) f.focus(); }
  });
  results.addEventListener('keydown', (e) => {
    const rows = Array.from(results.querySelectorAll('.palette-row'));
    const i = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (rows[i + 1] || rows[0]).focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (rows[i - 1] || inp).focus(); }
    if (e.key === 'Enter') document.activeElement.click();
  });
  setTimeout(() => inp.focus(), 30);
  run();
}

function buildPaletteIndex() {
  const player = isPlayer();
  const idx = [];
  // Only index nav the current role can actually reach (mountView guards GM
  // routes, but Player mode shouldn't advertise GM tooling in search either).
  for (const item of navList()) {
    if (item.section) continue;
    idx.push({ text: item.label, cat: 'Go to', icon: item.icon, go: () => router.go(item.view) });
  }
  idx.push({ text: 'Settings', cat: 'Go to', icon: 'gear', go: () => router.go('settings') });
  if (player) {
    for (const ch of store.all('characters')) if ((ch.kind || 'pc') === 'pc' && !ch._seed) idx.push({ text: ch.name || 'Unnamed', cat: 'Character', icon: 'mask', go: () => router.go('characters', ch.id) });
    return idx;
  }
  for (const c of store.all('campaigns')) idx.push({ text: c.name || 'Untitled campaign', cat: 'Campaign', icon: 'flag', go: () => router.go('campaigns', c.id) });
  for (const s of store.all('storylines')) idx.push({ text: s.name || 'Untitled storyline', cat: 'Storyline', icon: 'scroll', go: () => router.go('storylines', s.id) });
  for (const ch of store.all('characters')) idx.push({ text: ch.name || 'Unnamed', cat: ch.kind === 'npc' ? 'NPC' : 'PC', icon: 'mask', go: () => router.go('characters', ch.id) });
  for (const sys of store.all('rulesets')) idx.push({ text: sys.name, cat: 'System', icon: 'layers', go: () => router.go('systems', sys.id) });
  return idx;
}

async function openAbout() {
  let info = {};
  try { info = await window.xrpg.app.info(); } catch {}
  const body = el('div.col.gap-2', { style: { alignItems: 'center', textAlign: 'center' } });
  const logo = el('div', { style: { width: '72px', height: '72px' } }); logo.innerHTML = brandLogoSvg(72);
  body.appendChild(logo);
  body.appendChild(el('div', { style: { fontFamily: 'var(--font-display)', fontWeight: '700', fontSize: '28px', letterSpacing: '.05em' } }, [el('span', { style: { color: 'var(--accent)' } }, 'X'), document.createTextNode('RPG')]));
  body.appendChild(el('div.small.mute', 'Game-master console · v' + (info.version || '')));
  body.appendChild(el('div.tiny.mute', { style: { marginTop: '6px' } }, 'Copyright © Xirma. All rights reserved.'));
  const status = el('div.small.mute', { style: { marginTop: '8px', minHeight: '18px' } });
  body.appendChild(status);
  const off = updates.on('status', (e) => {
    if (e.type === 'available') status.textContent = `Update v${e.version} found — downloading…`;
    else if (e.type === 'progress') status.textContent = `Downloading… ${e.percent}%`;
    else if (e.type === 'downloaded') status.textContent = `Update v${e.version} ready — restart to install.`;
    else if (e.type === 'not-available') status.textContent = "You're on the latest version.";
    else if (e.type === 'error') status.textContent = 'Update error.';
  });
  const m = modal({ title: 'About XRPG', width: 420, body: [body], onClose: () => off && off() });
  m.setFooter(
    button('Check for Updates', { icon: 'refresh', onClick: async () => { status.textContent = 'Checking…'; const r = await updates.check(); if (!r.ok) status.textContent = r.reason === 'dev' ? 'Updates run only in the installed app.' : 'Updater unavailable in this build.'; } }),
    button('Settings', { variant: 'ghost', onClick: () => { m.close(); router.go('settings'); } }),
    button('Close', { variant: 'primary', onClick: () => m.close() }),
  );
}

function wireGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); document.getElementById('app').classList.toggle('nav-collapsed'); }
  });
}

// First-run: pick a role so the app can tailor itself. Always resolves (even if
// the welcome is dismissed — defaults to GM) so boot never hangs.
function chooseRoleFirstRun() {
  return new Promise((resolve) => {
    let picked = null;
    const make = (role, ic, title, desc) => {
      const c = el('button', { type: 'button', style: { flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '22px 16px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', cursor: 'pointer', color: 'var(--text)', textAlign: 'center' } });
      c.appendChild(icon(ic, 32));
      c.appendChild(el('div', { style: { fontWeight: '700', fontSize: '16px' } }, title));
      c.appendChild(el('div.small.mute', desc));
      c.addEventListener('mouseenter', () => { c.style.borderColor = 'var(--accent)'; });
      c.addEventListener('mouseleave', () => { c.style.borderColor = 'var(--line)'; });
      c.addEventListener('click', async () => { picked = role; await appState.updateSettings({ role }); m.close(); });
      return c;
    };
    const body = el('div.col.gap-4');
    body.appendChild(el('p.dim', { style: { textAlign: 'center' } }, 'Welcome to XRPG — a local-first toolkit for tabletop RPGs. How will you be using it? You can switch any time in Settings.'));
    body.appendChild(el('div.row.gap-4', [
      make('gm', 'swords', 'Game Master', 'Run campaigns, the tabletop, audio, combat, the player display, and AI tools.'),
      make('player', 'mask', 'Player', 'Build & play your character, roll dice, take notes — and export to share with your GM.'),
    ]));
    const m = modal({ title: 'Welcome to XRPG', width: 600, body, noEscape: true, noBackdropClose: true, onClose: () => { if (picked) resolve(picked); else appState.updateSettings({ role: 'gm' }).then(() => resolve('gm')); } });
  });
}

async function boot() {
  try {
    await store.loadAll();
    await appState.init();
    const { encounter } = await import('./encounter.js');
    await encounter.load();

    // Keep this window live with the others: settings (presenter, encounter,
    // active scene) are broadcast cross-window. Mirror them into appState +
    // the encounter singleton so reference/player windows stay in sync.
    if (window.xrpg.settings.onChanged) {
      window.xrpg.settings.onChanged((s) => {
        appState.settings = s;
        if (s && s.encounter) encounter.applyState(s.encounter);
      });
    }

    // Pop-out mode. 'player' = the composed Player Display (presenter-driven);
    // any other mode = a GM reference window showing one route full-bleed.
    const popout = new URLSearchParams(location.search).get('popout');
    window.__popout = popout || null;
    if (popout) {
      document.body.classList.add('popout');
      document.body.classList.add('popout-' + (popout === 'player' ? 'player' : 'ref'));
      if (popout === 'player') {
        const root = el('div', { id: 'view' });
        document.body.appendChild(root);
        const { renderPlayerDisplay } = await import('./views/player.js');
        renderPlayerDisplay(root);
        return;
      }
      // Reference window: mount the route carried in the hash (#/route), full-bleed.
      const view = el('div.view', { id: 'view', style: { height: '100vh' } });
      document.body.appendChild(view);
      shell.mount({ viewEl: view, crumbEl: el('div'), actionsEl: el('div'), appEl: document.body });
      router.on('navigate', (v, p) => mountView(v, p));
      router.start('dashboard');
      return;
    }

    // First launch: ask whether this is a GM or a Player so we can tailor the app.
    // (Skipped under dev-capture flags so automated screenshots don't block.)
    const devCapture = new URLSearchParams(location.search).get('dev');
    if (appState.settings.role === undefined && !devCapture) { await chooseRoleFirstRun(); }

    buildShell();
    wireGlobalKeys();

    // Single mount path: the router emits 'navigate' on every resolve.
    router.on('navigate', (view, params) => mountView(view, params));

    let saveDotTimer = null;
    store.on('change', () => {
      refreshCounts();
      const d = document.getElementById('saveDot');
      if (d) { d.classList.add('show'); clearTimeout(saveDotTimer); saveDotTimer = setTimeout(() => d.classList.remove('show'), 1400); }
    });
    appState.on('system', () => { refreshSystemSwitcher(); });

    // Global notice when an update finishes downloading.
    updates.on('status', (e) => { if (e && e.type === 'downloaded') toast(`Update v${e.version} downloaded — open Settings to restart & install.`, { type: 'success', timeout: 8000 }); });

    // Discord slash-command bridge (handles /roll, /check, /sheet, /hp from anywhere).
    initDiscordBridge();

    // Dev helpers (harmless; useful for testing & power users).
    window.__xrpg = { store, appState, router };

    router.start('dashboard');
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;color:#f88;font-family:monospace;white-space:pre-wrap">XRPG failed to start:\n${err && err.stack || err}</div>`;
    console.error(err);
  }
}

boot();
