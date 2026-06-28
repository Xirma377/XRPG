import { el, clear, uid, deepClone } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, badge, modal, confirm, toast, field, input, select, segmented, promptText, contextMenu } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import { VTT } from '../vtt-engine.js';
import { mapSvg, svgToBase64, TOKEN_COLORS } from '../assets.js';
import { portraitNode } from '../portrait.js';
import encounter from '../encounter.js';

let engine = null;
let unsub = [];

export async function render() {
  shell.crumbs([{ label: 'Tabletop' }]);
  shell.actions(null);
  teardown();

  const settings = await store.getSettings();
  let scenes = store.all('scenes');
  let activeId = settings.activeSceneId && store.get('scenes', settings.activeSceneId) ? settings.activeSceneId : (scenes[0] && scenes[0].id);

  if (!scenes.length) {
    const wrap = el('div.view-pad');
    wrap.appendChild(empty('No scenes yet', { icon: 'map', hint: 'Create a battlemap to place tokens, draw, and run combat on a grid.', action: button('Create a scene', { variant: 'primary', icon: 'plus', onClick: () => newScene() }) }));
    shell.render(wrap);
    return;
  }

  const scene = store.get('scenes', activeId);

  const root = el('div.vtt-root');
  // toolbar
  const toolbar = el('div.vtt-toolbar');
  root.appendChild(toolbar);
  const stage = el('div.vtt-stage');
  const canvas = el('canvas.vtt-canvas');
  stage.appendChild(canvas);
  const statusEl = el('div.vtt-status');
  stage.appendChild(statusEl);

  // sidebar
  const sidebar = el('div.vtt-sidebar');
  const sbHead = el('div.vtt-sb-head');
  sbHead.appendChild(el('span', 'Tokens'));
  sbHead.appendChild(iconButton('plus', { size: 15, title: 'Add token', onClick: () => addTokenMenu() }));
  sidebar.appendChild(sbHead);
  const sbBody = el('div.vtt-sb-body');
  sidebar.appendChild(sbBody);
  stage.appendChild(sidebar);

  // zoom
  const zoom = el('div.vtt-zoom');
  zoom.appendChild(iconButton('minus', { size: 15, onClick: () => engine.zoomBy(1 / 1.2) }));
  const zlabel = el('div.zlabel', '100%');
  zoom.appendChild(zlabel);
  zoom.appendChild(iconButton('plus', { size: 15, onClick: () => engine.zoomBy(1.2) }));
  zoom.appendChild(iconButton('target', { size: 15, title: 'Fit', onClick: () => engine.fit() }));
  stage.appendChild(zoom);

  root.appendChild(stage);
  shell.render(root);

  // build engine after canvas is in DOM
  requestAnimationFrame(() => {
    engine = new VTT(canvas);
    engine.setScene(deepClone(scene));
    buildToolbar(toolbar, scene, () => render());
    unsub.push(engine.on('change', async (sc) => { await store.save('scenes', sc); }));
    unsub.push(engine.on('select', (t) => { drawTokenList(sbBody); updateStatus(); }));
    unsub.push(engine.on('tool', () => { updateToolbarActive(toolbar); canvas.className = 'vtt-canvas tool-' + engine.tool; }));
    drawTokenList(sbBody);
    updateStatus();
    // zoom label loop
    const zl = setInterval(() => { if (!engine) { clearInterval(zl); return; } zlabel.textContent = Math.round(engine.view.scale * 100) + '%'; }, 200);
    unsub.push(() => clearInterval(zl));

    // Player-display (pop-out) mode: read-only player view with live sync.
    if (window.__popout) {
      engine.setPlayerView(true);
      engine.setTool('pan');
      toolbar.style.display = 'none';
      sidebar.classList.add('hidden');
      statusEl.style.display = 'none';
      unsub.push(store.on('change:scenes', (doc) => {
        if (doc && engine && engine.scene && doc.id === engine.scene.id) engine.setScene(deepClone(doc));
      }));
      // follow GM scene switches
      unsub.push(store.on('settings', () => {}));
    }
  });

  function updateStatus() {
    const sc = engine.scene;
    statusEl.textContent = `${sc.name} · ${(sc.tokens || []).length} tokens · ${sc.grid ? sc.grid.size + 'px grid' : 'no grid'}${sc.fog && sc.fog.enabled ? ' · fog on' : ''}`;
  }

  function drawTokenList(box) {
    clear(box);
    const toks = (engine.scene.tokens || []);
    if (!toks.length) { box.appendChild(el('p.small.mute', { style: { padding: '8px' } }, 'No tokens. Add from roster or quick-add.')); }
    toks.forEach((t) => {
      const row = el('div.vtt-token-row' + (engine.selected === t.id ? ' sel' : ''));
      const tk = el('div.tk', { style: { background: t.color || TOKEN_COLORS[t.kind] } });
      const char = t.charId ? store.get('characters', t.charId) : null;
      if (char) tk.appendChild(portraitNode(char, 28, { round: true }));
      else tk.innerHTML = `<div style="width:100%;height:100%;display:grid;place-items:center;color:#0009;font-weight:700;font-size:11px">${(t.name || '?').slice(0, 2)}</div>`;
      row.appendChild(tk);
      row.appendChild(el('div.tn', t.name));
      row.addEventListener('click', () => { engine.selected = t.id; engine.view.x = engine.canvas.clientWidth / 2 - t.x * engine.view.scale; engine.view.y = engine.canvas.clientHeight / 2 - t.y * engine.view.scale; drawTokenList(box); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); tokenContext(e, t); });
      box.appendChild(row);
    });
  }

  function addTokenMenu() {
    const m = modal({ title: 'Add Token', width: 480 });
    const body = el('div.col.gap-4');
    // quick token
    const nameI = input({ placeholder: 'Token name' });
    let kind = 'npc';
    const kindSeg = segmented(Object.keys(TOKEN_COLORS).map((k) => ({ value: k, label: k })), { value: kind, onChange: (v) => (kind = v) });
    body.appendChild(field('Quick token name', nameI));
    body.appendChild(field('Color', kindSeg));
    body.appendChild(button('Add quick token', { variant: 'primary', icon: 'plus', onClick: () => { engine.addToken({ name: nameI.value || 'Token', kind, color: TOKEN_COLORS[kind] }); drawTokenList(sbBody); m.close(); } }));
    // from roster
    const sys = appState.system;
    const chars = store.where('characters', (c) => !sys || c.systemId === sys.id);
    if (chars.length) {
      body.appendChild(el('div.divider', 'From roster'));
      const list = el('div.col.gap-1', { style: { maxHeight: '260px', overflowY: 'auto' } });
      chars.forEach((c) => {
        const row = el('div.vtt-token-row');
        row.appendChild(portraitNode(c, 26, { round: true }));
        row.appendChild(el('div.tn', c.name));
        row.appendChild(badge(c.kind === 'pc' ? 'PC' : 'NPC', { variant: 'dim' }));
        row.addEventListener('click', () => { engine.addToken({ name: c.name, kind: c.kind === 'pc' ? 'pc' : (c.threat ? 'threat' : 'npc'), color: c.color || TOKEN_COLORS[c.kind === 'pc' ? 'pc' : 'npc'], charId: c.id, label: c.name.slice(0, 2) }); drawTokenList(sbBody); toast(`Added ${c.name}`, { type: 'success', timeout: 800 }); });
        list.appendChild(row);
      });
      body.appendChild(list);
    }
    // from active encounter
    if (encounter.state.combatants.length) {
      body.appendChild(button('Add all combatants from tracker', { icon: 'swords', onClick: () => { encounter.state.combatants.forEach((cb) => { const char = cb.charId ? store.get('characters', cb.charId) : null; engine.addToken({ name: cb.name, kind: cb.kind, color: TOKEN_COLORS[cb.kind], charId: cb.charId, hp: cb.hp }); }); drawTokenList(sbBody); m.close(); toast('Combatants added', { type: 'success' }); } }));
    }
    m.setBody(body);
  }

  function tokenContext(e, t) {
    contextMenu([
      { label: 'Rename…', icon: 'edit', onClick: async () => { const v = await promptText({ title: 'Token name', value: t.name }); if (v != null) { engine.updateToken(t.id, { name: v, label: v.slice(0, 2) }); drawTokenList(sbBody); } } },
      { label: 'Size: Small', onClick: () => { engine.updateToken(t.id, { size: 0.7 }); } },
      { label: 'Size: Medium', onClick: () => { engine.updateToken(t.id, { size: 1 }); } },
      { label: 'Size: Large', onClick: () => { engine.updateToken(t.id, { size: 2 }); } },
      { label: 'Size: Huge', onClick: () => { engine.updateToken(t.id, { size: 3 }); } },
      '-',
      ...(t.charId ? [{ label: 'Open character', icon: 'mask', onClick: () => shell.go('characters', t.charId) }] : []),
      { label: 'Remove', icon: 'trash', danger: true, onClick: () => { engine.removeToken(t.id); drawTokenList(sbBody); } },
    ], e.clientX, e.clientY);
  }

  // expose token context on canvas right-click
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const w = engine.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    const t = engine.hitToken(w.x, w.y);
    if (t) tokenContext(e, t);
  });
}

function buildToolbar(toolbar, scene, rerender) {
  clear(toolbar);
  const tools = [
    { id: 'select', icon: 'grip', title: 'Select / move' },
    { id: 'pan', icon: 'menu', title: 'Pan' },
    { id: 'measure', icon: 'ruler', title: 'Measure' },
    { id: 'draw', icon: 'edit', title: 'Draw' },
    { id: 'ping', icon: 'pin', title: 'Ping' },
  ];
  tools.forEach((t) => {
    const b = el('button.vtt-tool' + (engine.tool === t.id ? ' active' : ''), { title: t.title, 'data-tool': t.id });
    b.appendChild(icon(t.icon, 18));
    b.addEventListener('click', () => engine.setTool(t.id));
    toolbar.appendChild(b);
  });
  toolbar.appendChild(el('div.sep'));
  // fog tools
  ['fog-reveal', 'fog-hide'].forEach((id) => {
    const b = el('button.vtt-tool' + (engine.tool === id ? ' active' : ''), { title: id === 'fog-reveal' ? 'Reveal fog' : 'Hide fog', 'data-tool': id });
    b.appendChild(icon(id === 'fog-reveal' ? 'eye' : 'eyeOff', 18));
    b.addEventListener('click', () => engine.setTool(id));
    toolbar.appendChild(b);
  });
  toolbar.appendChild(el('div.sep'));
  // toggles
  toolbar.appendChild(toolbarToggle('Grid', 'grid', scene.grid && scene.grid.visible !== false, () => { engine.scene.grid.visible = !(engine.scene.grid.visible !== false); engine._save(); }));
  toolbar.appendChild(toolbarToggle('Fog', 'eyeOff', scene.fog && scene.fog.enabled, () => { engine.toggleFog(); }));
  toolbar.appendChild(toolbarToggle('Player View', 'eye', false, (b) => { engine.playerView = !engine.playerView; b.classList.toggle('active', engine.playerView); }));
  toolbar.appendChild(el('div.sep'));
  toolbar.appendChild(button('Add Token', { size: 'sm', icon: 'plus', variant: 'primary', onClick: () => { const ev = document.querySelector('.vtt-sb-head .icon-btn'); if (ev) ev.click(); } }));
  // overflow menu
  toolbar.appendChild(el('div', { style: { flex: '1' } }));
  toolbar.appendChild(button('Player Display', { size: 'sm', icon: 'eye', title: 'Open this scene in a separate window for players', onClick: () => window.xrpg.window.popout('vtt', 'player') }));
  toolbar.appendChild(button('Reveal All', { size: 'sm', onClick: () => engine.revealAll() }));
  toolbar.appendChild(button('Hide All', { size: 'sm', onClick: () => engine.hideAll() }));
  toolbar.appendChild(button('Clear Drawings', { size: 'sm', variant: 'ghost', onClick: () => engine.clearDrawings() }));
  toolbar.appendChild(iconButton('layers', { title: 'Scenes', onClick: (e) => scenesMenu(e, rerender) }));
  toolbar.appendChild(iconButton('gear', { title: 'Scene settings', onClick: () => sceneSettings(rerender) }));
}

function toolbarToggle(label, ic, active, onClick) {
  const b = el('button.vtt-tool' + (active ? ' active' : ''), { title: label });
  b.appendChild(icon(ic, 18));
  b.addEventListener('click', () => { onClick(b); b.classList.toggle('active'); });
  return b;
}

function updateToolbarActive(toolbar) {
  toolbar.querySelectorAll('.vtt-tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === engine.tool));
}

function scenesMenu(e, rerender) {
  const scenes = store.all('scenes');
  const items = scenes.map((s) => ({ label: (s.id === engine.scene.id ? '✓ ' : '') + s.name, icon: 'map', onClick: async () => { await store.setSettings({ activeSceneId: s.id }); rerender(); } }));
  items.push('-');
  items.push({ label: 'New scene…', icon: 'plus', onClick: () => newScene(rerender) });
  items.push({ label: 'Rename scene…', icon: 'edit', onClick: async () => { const v = await promptText({ title: 'Scene name', value: engine.scene.name }); if (v) { engine.scene.name = v; await store.save('scenes', engine.scene); rerender(); } } });
  items.push({ label: 'Delete scene', icon: 'trash', danger: true, onClick: async () => { if (await confirm({ title: 'Delete scene?', message: `Delete "${engine.scene.name}"?`, danger: true })) { await store.remove('scenes', engine.scene.id); const remaining = store.all('scenes'); await store.setSettings({ activeSceneId: remaining[0] ? remaining[0].id : null }); rerender(); } } });
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(items, r.left - 150, r.bottom + 4);
}

function sceneSettings(rerender) {
  const sc = engine.scene;
  const gridType = sc.grid ? sc.grid.type : 'square';
  const sizeI = input({ type: 'number', value: sc.grid ? sc.grid.size : 50 });
  let gt = gridType;
  const typeSeg = segmented([{ value: 'square', label: 'Square' }, { value: 'hex', label: 'Hex' }], { value: gridType, onChange: (v) => (gt = v) });
  let snap = sc.grid ? sc.grid.snap !== false : true;
  const snapSeg = segmented([{ value: 'on', label: 'Snap on' }, { value: 'off', label: 'Snap off' }], { value: snap ? 'on' : 'off', onChange: (v) => (snap = v === 'on') });
  const m = modal({ title: 'Scene Settings', width: 460, body: [
    field('Grid size (px)', sizeI),
    field('Grid type', typeSeg),
    field('Token snapping', snapSeg),
    button('Change map…', { icon: 'map', onClick: () => { m.close(); changeMap(rerender); } }),
  ] });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Save', { variant: 'primary', onClick: async () => { engine.scene.grid = { ...(engine.scene.grid || {}), type: gt, size: parseInt(sizeI.value, 10) || 50, snap, visible: engine.scene.grid ? engine.scene.grid.visible : true }; await store.save('scenes', engine.scene); m.close(); } }),
  );
}

async function changeMap(rerender) {
  const m = modal({ title: 'Change Map', width: 520 });
  const body = el('div.col.gap-4');
  body.appendChild(el('div.divider', 'Generated maps'));
  const grid = el('div.preset-grid');
  [['grid', 'Blank Grid'], ['snow', 'Snowfield'], ['highway', 'I-17 Highway'], ['compound', 'Compound'], ['interior', 'Interior']].forEach(([kind, name]) => {
    const b = el('button.preset-btn'); b.appendChild(el('div.pn', name)); b.appendChild(el('div.pd', 'generated'));
    b.addEventListener('click', async () => { const svg = mapSvg(kind); const saved = await store.saveMediaBase64('maps', kind + '.svg', svgToBase64(svg)); engine.scene.mapMediaId = saved.id; engine.scene.mapDataUrl = null; engine.scene.w = 1200; engine.scene.h = 800; await store.save('scenes', engine.scene); m.close(); rerender(); });
    grid.appendChild(b);
  });
  body.appendChild(grid);
  body.appendChild(button('Import image…', { icon: 'upload', onClick: async () => { const saved = await store.importMedia('maps', [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]); if (saved) { engine.scene.mapMediaId = saved.id; engine.scene.mapDataUrl = null; await store.save('scenes', engine.scene); m.close(); rerender(); } } }));
  m.setBody(body);
}

async function newScene(rerender) {
  const nameI = input({ placeholder: 'Scene name', value: 'New Scene' });
  let mapKind = 'grid';
  const mapSeg = segmented([['grid', 'Grid'], ['snow', 'Snow'], ['highway', 'Highway'], ['compound', 'Compound'], ['interior', 'Interior']].map(([v, l]) => ({ value: v, label: l })), { value: 'grid', onChange: (v) => (mapKind = v) });
  const m = modal({ title: 'New Scene', width: 460, body: [field('Name', nameI), field('Map', mapSeg)] });
  m.setFooter(
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button('Create', { variant: 'primary', onClick: async () => {
      const svg = mapSvg(mapKind);
      const saved = await store.saveMediaBase64('maps', mapKind + '.svg', svgToBase64(svg));
      const scene = {
        id: 'scene_' + uid('').slice(0, 8), name: nameI.value || 'New Scene',
        campaignId: appState.activeCampaignId || null, mapMediaId: saved.id, w: 1200, h: 800,
        grid: { type: 'square', size: 50, visible: true, snap: true, color: 'rgba(255,255,255,0.09)' },
        tokens: [], fog: { enabled: false, revealed: [] }, drawings: [],
      };
      await store.save('scenes', scene);
      await store.setSettings({ activeSceneId: scene.id });
      m.close();
      if (rerender) rerender(); else render();
    } }),
  );
  setTimeout(() => nameI.focus(), 30);
}

export function teardown() { if (engine) { engine.destroy(); engine = null; } unsub.forEach((u) => u && u()); unsub = []; }
