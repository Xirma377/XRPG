import { el, clear, uid, deepClone, fileToBase64, debounce, fmtBytes } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, badge, chip, modal, confirm, toast, field, input, range, select, promptText, segmented, spinner } from '../ui.js';
import store from '../store.js';
import shell from '../shell.js';
import audio, { INSTRUMENTS, ONESHOTS } from '../audio-engine.js';

let rafId = null;
let unsub = [];
const stripMap = new Map();     // channelId -> { el, refresh }
let manifest = { tracks: [], credits: [] };
let cachedSet = new Set();

const LIC_SHORT = (l) => {
  const s = (l || '').toLowerCase();
  if (s.includes('cc0')) return 'CC0';
  if (s.includes('public domain')) return 'PD';
  if (s.includes('by-sa')) return 'CC-BY-SA';
  if (s.includes('by')) return 'CC-BY';
  return l || '';
};

export function teardown() { cancelVu(); for (const ch of audio.channels.values()) ch._vuBar = null; unsub.forEach((u) => u && u()); unsub = []; stripMap.clear(); }

export async function render() {
  shell.crumbs([{ label: 'Audio Mixer' }]);
  shell.actions([
    button('Pause All', { icon: 'pause', size: 'sm', title: 'Pause every sound currently playing in the Live Mix (keep them so you can resume)', onClick: () => audio.pauseAll() }),
    button('Stop All', { icon: 'stop', size: 'sm', variant: 'ghost', title: 'Stop every sound in the Live Mix', onClick: () => audio.stopAll() }),
    button('Save Scene', { icon: 'save', size: 'sm', onClick: savePreset }),
    button('Credits', { icon: 'info', size: 'sm', variant: 'ghost', onClick: showCredits }),
  ]);
  teardown();

  // load library manifest + cache status
  try { manifest = await window.xrpg.audio.manifest(); } catch { manifest = { tracks: [], credits: [] }; }
  try { cachedSet = new Set(await window.xrpg.audio.cached()); } catch { cachedSet = new Set(); }

  const wrap = el('div.view-pad');

  // master bar
  const masterBar = el('div.master-bar');
  masterBar.appendChild(icon('sliders', 18));
  masterBar.appendChild(el('span.mlabel', 'Master'));
  const masterRange = range({ min: 0, max: 1, step: 0.01, value: audio.master ? audio.master.gain.value : 0.9, showValue: true, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { audio.ensure(); audio.setMaster(v); } });
  masterRange.style.flex = '1';
  masterBar.appendChild(masterRange);
  // The audio engine starts automatically on first interaction (browsers require
  // a user gesture), so there's no manual "start" needed — just show its state.
  const engStatus = el('span.small.mute', audio.started ? '' : 'Audio starts when you add a sound');
  if (audio.started) { engStatus.textContent = ''; masterBar.appendChild(badge('Engine on', { color: 'var(--good)' })); }
  else masterBar.appendChild(engStatus);
  wrap.appendChild(masterBar);

  const layout = el('div.mixer-layout');
  const left = el('div');
  const right = el('div.detail-side');
  layout.appendChild(left); layout.appendChild(right);
  wrap.appendChild(layout);

  // ---- Live mix ----
  const chHead = el('div.section-header');
  const ct = el('div.section-title'); ct.appendChild(icon('music', 18)); ct.appendChild(el('h2', 'Live Mix')); chHead.appendChild(ct);
  chHead.appendChild(el('div.row.gap-2', [
    button('Pause All', { size: 'sm', icon: 'pause', title: 'Pause every sound in the mix', onClick: () => audio.pauseAll() }),
    button('Stop All', { size: 'sm', variant: 'ghost', icon: 'stop', title: 'Stop every sound in the mix', onClick: () => audio.stopAll() }),
  ]));
  left.appendChild(chHead);
  const channelsBox = el('div');
  left.appendChild(channelsBox);
  const emptyHint = empty('No sounds in the mix', { icon: 'music', hint: 'Add ambient beds, music, or SFX from the library on the right, or import your own.' });

  function syncChannels() {
    const chans = Array.from(audio.channels.values());
    // remove strips for gone channels
    for (const [id, s] of stripMap) { if (!audio.channels.has(id)) { s.el.remove(); stripMap.delete(id); } }
    // add strips for new channels
    for (const ch of chans) {
      if (!stripMap.has(ch.id)) { const s = channelStrip(ch); stripMap.set(ch.id, s); channelsBox.appendChild(s.el); }
    }
    if (!chans.length) { if (!emptyHint.parentNode) channelsBox.appendChild(emptyHint); }
    else if (emptyHint.parentNode) emptyHint.remove();
    refreshChannels();
  }
  function refreshChannels() { for (const s of stripMap.values()) s.refresh(); }
  function refreshOne(id) { const s = stripMap.get(id); if (s) s.refresh(); }

  // ---- Soundboard (real SFX + synth) ----
  const sbHead = el('div.section-header', { style: { marginTop: '24px' } });
  const st = el('div.section-title'); st.appendChild(icon('bolt', 18)); st.appendChild(el('h2', 'Soundboard')); sbHead.appendChild(st);
  left.appendChild(sbHead);
  const board = el('div.cue-board');
  const sfxTracks = manifest.tracks.filter((t) => t.category === 'sfx');
  sfxTracks.forEach((t) => board.appendChild(sfxPad(t)));
  // imported one-shots
  listImportedAudio().forEach((f) => board.appendChild(filePad(f)));
  left.appendChild(board);
  // synth FX
  left.appendChild(el('div.divider', { style: { marginTop: '14px' } }, 'Synth FX (instant, offline)'));
  const synthBoard = el('div.cue-board');
  ONESHOTS.forEach((o) => {
    const pad = el('div.cue-pad');
    pad.appendChild(icon(o.icon, 20, { class: 'ci' }));
    pad.appendChild(el('div.cn', o.name));
    pad.addEventListener('click', () => { audio.oneShot(o.id); flash(pad); });
    synthBoard.appendChild(pad);
  });
  left.appendChild(synthBoard);

  // ---- Right: library + presets ----
  right.appendChild(buildLibrary());
  right.appendChild(buildPresets());

  syncChannels();
  unsub.push(audio.on('channels', syncChannels));
  unsub.push(audio.on('channel', (id) => { if (id) refreshOne(id); else refreshChannels(); }));
  unsub.push(store.on('change:mixerpresets', () => { const p = buildPresets(); /* replace */ }));

  startVuLoop();
  shell.render(wrap);
}

// ---------- Channel strip (persistent, updates in place) ----------
function channelStrip(ch) {
  const strip = el('div.channel-strip');
  const head = el('div.channel-head');
  const inst = INSTRUMENTS.find((i) => i.id === ch.source);
  const ic = el('div.channel-icon'); ic.appendChild(icon(inst ? inst.icon : (ch.type === 'file' ? 'music' : 'music'), 18));
  head.appendChild(ic);
  const meta = el('div.grow');
  meta.appendChild(el('div.channel-name', ch.name));
  const sub = el('div.channel-type', chSub(ch));
  meta.appendChild(sub);
  head.appendChild(meta);

  const playBtn = el('button.transport-btn', { title: 'Play/Pause' });
  playBtn.appendChild(icon('play', 18));
  playBtn.addEventListener('click', () => audio.togglePause(ch.id));
  head.appendChild(playBtn);
  const stopBtn = iconButton('stop', { title: 'Stop', onClick: () => audio.stop(ch.id) });
  head.appendChild(stopBtn);
  strip.appendChild(head);

  const vu = el('div.vu'); const vuBar = el('span'); vu.appendChild(vuBar); strip.appendChild(vu);
  ch._vuBar = vuBar;

  const fader = el('div.fader');
  const muteBtn = iconButton('volume', { size: 16, title: 'Mute', onClick: () => audio.setMute(ch.id, !ch.muted) });
  fader.appendChild(muteBtn);
  const r = range({ min: 0, max: 1, step: 0.01, value: ch.volume, onInput: (v) => audio.setVolume(ch.id, v) });
  r.style.flex = '1';
  const rInput = r.querySelector('input');
  fader.appendChild(r);
  const loopBtn = iconButton('replay', { size: 15, title: 'Loop', active: ch.loop, onClick: () => { ch.loop = !ch.loop; if (ch.fileEl) ch.fileEl.loop = ch.loop; refresh(); } });
  fader.appendChild(loopBtn);
  fader.appendChild(iconButton('trash', { size: 15, title: 'Remove', onClick: () => audio.removeChannel(ch.id) }));
  strip.appendChild(fader);

  function refresh() {
    strip.classList.toggle('playing', ch.playing);
    strip.classList.toggle('paused', ch.paused);
    clear(playBtn); playBtn.appendChild(icon(ch.playing ? 'pause' : 'play', 18));
    playBtn.classList.toggle('playing', ch.playing);
    clear(muteBtn); muteBtn.appendChild(icon(ch.muted ? 'volumeX' : 'volume', 16));
    muteBtn.classList.toggle('active', ch.muted);
    loopBtn.classList.toggle('active', ch.loop);
    sub.textContent = chSub(ch);
    if (document.activeElement !== rInput && Math.abs(parseFloat(rInput.value) - ch.volume) > 0.001) rInput.value = ch.volume;
  }
  refresh();
  return { el: strip, refresh };
}
function chSub(ch) {
  if (ch.type === 'file') { const lic = ch.meta && ch.meta.license ? ' · ' + LIC_SHORT(ch.meta.license) : ''; return (ch.paused ? 'Paused' : ch.playing ? 'Playing' : 'Stopped') + lic; }
  return 'Procedural · ' + (ch.paused ? 'Paused' : ch.playing ? 'Playing' : 'Stopped');
}

// ---------- Library ----------
function buildLibrary() {
  const card = el('div.side-card');
  card.appendChild(el('h4', 'Royalty-Free Library'));
  const searchBox = el('div.search-box', { style: { marginBottom: '8px' } });
  searchBox.appendChild(icon('search', 14));
  const sInput = el('input', { placeholder: 'Search tracks…' });
  searchBox.appendChild(sInput);
  card.appendChild(searchBox);

  let cat = 'ambient';
  const seg = segmented([{ value: 'ambient', label: 'Ambient' }, { value: 'music', label: 'Music' }, { value: 'sfx', label: 'SFX' }, { value: 'synth', label: 'Synth' }], { value: cat, onChange: (v) => { cat = v; draw(); } });
  card.appendChild(seg);
  const listBox = el('div.col.gap-1', { style: { maxHeight: '46vh', overflowY: 'auto', marginTop: '8px' } });
  card.appendChild(listBox);
  card.appendChild(button('Import audio file…', { size: 'sm', icon: 'upload', onClick: importAudio, style: { marginTop: '8px' } }));

  function draw() {
    clear(listBox);
    const q = sInput.value.trim().toLowerCase();
    if (cat === 'synth') {
      INSTRUMENTS.forEach((inst) => {
        if (q && !inst.name.toLowerCase().includes(q)) return;
        const row = libRow(inst.name, 'Procedural · ' + inst.cat, null, () => { const ch = audio.addChannel({ name: inst.name, type: 'instrument', source: inst.id, gain: 0.55 }); audio.play(ch.id); toast(`${inst.name} added`, { type: 'success', timeout: 900 }); });
        listBox.appendChild(row);
      });
      return;
    }
    const tracks = manifest.tracks.filter((t) => t.category === cat && (!q || t.name.toLowerCase().includes(q)));
    if (!tracks.length) { listBox.appendChild(el('p.small.mute', { style: { padding: '8px' } }, 'No tracks.')); return; }
    tracks.forEach((t) => listBox.appendChild(trackRow(t)));
  }
  sInput.addEventListener('input', debounce(draw, 120));
  draw();
  return card;
}

function libRow(name, sub, badgeEl, onAdd) {
  const row = el('div.vtt-token-row');
  const ic = el('div', { style: { width: '26px', height: '26px', borderRadius: '6px', background: 'var(--bg-3)', display: 'grid', placeItems: 'center', color: 'var(--accent)', flex: 'none' } });
  ic.appendChild(icon('music', 14));
  row.appendChild(ic);
  const m = el('div.grow', { style: { minWidth: 0 } });
  m.appendChild(el('div.tn', name));
  m.appendChild(el('div.tiny.mute', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, sub));
  row.appendChild(m);
  if (badgeEl) row.appendChild(badgeEl);
  const add = iconButton('plus', { size: 14, title: 'Add to mix', onClick: onAdd });
  row.appendChild(add);
  return row;
}

function trackRow(t) {
  const isCached = cachedSet.has(t.id);
  const lic = badge(LIC_SHORT(t.license), { variant: 'dim' });
  const row = libRow(t.name, (isCached ? '✓ cached · ' : '') + (t.attribution || '') , lic, async () => {
    await addTrackToMix(t, row);
  });
  return row;
}

async function addTrackToMix(t, row) {
  const add = row.querySelector('.icon-btn:last-child');
  const old = add ? add.innerHTML : '';
  if (add) { add.innerHTML = ''; add.appendChild(spinner()); }
  try {
    const res = await window.xrpg.audio.fetch(t);
    cachedSet.add(t.id);
    audio.ensure();
    const ch = audio.addChannel({ name: t.name, type: 'file', url: res.url, loop: t.loop !== false, gain: 0.6, meta: { license: t.license, attribution: t.attribution, libId: t.id, category: t.category } });
    audio.play(ch.id);
    toast(`${t.name} added`, { type: 'success', timeout: 1000 });
  } catch (e) {
    toast('Could not load "' + t.name + '": ' + e.message, { type: 'error' });
  } finally { if (add) add.innerHTML = old; }
}

function sfxPad(t) {
  const pad = el('div.cue-pad');
  pad.appendChild(icon('bolt', 20, { class: 'ci' }));
  pad.appendChild(el('div.cn', t.name));
  pad.appendChild(el('div.ck', LIC_SHORT(t.license)));
  pad.addEventListener('click', async () => {
    flash(pad);
    try { const res = await window.xrpg.audio.fetch(t); cachedSet.add(t.id); audio.oneShotFile(res.url); }
    catch (e) { toast('SFX failed: ' + e.message, { type: 'error' }); }
  });
  return pad;
}
function filePad(f) {
  const pad = el('div.cue-pad');
  pad.appendChild(icon('music', 20, { class: 'ci' }));
  pad.appendChild(el('div.cn', f.name));
  pad.addEventListener('click', () => { audio.oneShotFile(`xrpg://media/audio/${f.id}`); flash(pad); });
  return pad;
}
function flash(pad) { pad.classList.add('active'); setTimeout(() => pad.classList.remove('active'), 400); }

// ---------- Presets ----------
function buildPresets() {
  const card = el('div.side-card');
  card.appendChild(el('h4', 'Scene Presets'));
  const box = el('div'); card.appendChild(box);
  function draw() {
    clear(box);
    const presets = store.all('mixerpresets');
    if (!presets.length) { box.appendChild(el('p.small.mute', 'Save the current mix as a one-tap scene.')); return; }
    presets.forEach((p) => {
      const pill = el('div.preset-pill');
      pill.appendChild(icon('music', 15));
      pill.appendChild(el('span.pn', p.name));
      pill.appendChild(iconButton('play', { size: 14, title: 'Play scene', onClick: (e) => { e.stopPropagation(); loadPreset(p); } }));
      pill.appendChild(iconButton('trash', { size: 14, title: 'Delete', onClick: async (e) => { e.stopPropagation(); await store.remove('mixerpresets', p.id); draw(); } }));
      pill.addEventListener('click', () => loadPreset(p));
      box.appendChild(pill);
    });
  }
  draw();
  unsub.push(store.on('change:mixerpresets', draw));
  return card;
}

async function savePreset() {
  const chans = Array.from(audio.channels.values());
  if (!chans.length) { toast('Nothing in the mix to save', { type: 'warn' }); return; }
  const name = await promptText({ title: 'Save Scene Preset', label: 'Name this scene mix', placeholder: 'e.g. The Snow Trap' });
  if (!name) return;
  const preset = {
    id: 'mix_' + uid('').slice(0, 8), name,
    channels: chans.map((c) => ({ name: c.name, type: c.type, source: c.source, url: c.url, meta: c.meta, volume: c.volume, loop: c.loop, playing: c.playing || c.paused })),
  };
  await store.save('mixerpresets', preset);
  toast('Scene saved', { type: 'success' });
}

async function loadPreset(p) {
  audio.ensure();
  // removeChannel stops + disconnects each channel; do it now rather than racing a timer.
  Array.from(audio.channels.keys()).forEach((id) => audio.removeChannel(id));
  const failed = [];
  for (const c of (p.channels || [])) {
    let url = c.url;
    if (c.type === 'file' && c.meta && c.meta.libId) {
      const t = manifest.tracks.find((x) => x.id === c.meta.libId);
      if (t) { try { url = (await window.xrpg.audio.fetch(t)).url; } catch { failed.push(c.name); continue; } }
    }
    const ch = audio.addChannel({ name: c.name, type: c.type, source: c.source, url, meta: c.meta, gain: c.volume, loop: c.loop });
    if (c.playing !== false) audio.play(ch.id);
  }
  if (failed.length) toast(`${failed.length} track(s) couldn't load: ${failed.join(', ')}`, { type: 'warn' });
  else toast(`Scene: ${p.name}`, { type: 'success', timeout: 1200 });
}

// ---------- Credits ----------
function showCredits() {
  const used = manifest.tracks.filter((t) => /by/i.test(t.license || ''));
  const m = modal({ title: 'Audio Credits', width: 560 });
  const body = el('div.col.gap-4');
  body.appendChild(el('p.small.mute', 'XRPG streams curated royalty-free audio. Public-domain/CC0 needs no credit; CC-BY/CC-BY-SA tracks are credited below.'));
  (manifest.credits || []).forEach((c) => {
    const row = el('div.beat');
    row.appendChild(el('div.bt', c.who));
    row.appendChild(el('div.bb', c.license + (c.url ? ' · ' + c.url : '')));
    body.appendChild(row);
  });
  body.appendChild(el('div.divider', 'Attributed tracks'));
  const listB = el('div.col.gap-1', { style: { maxHeight: '40vh', overflowY: 'auto' } });
  used.forEach((t) => { const row = el('div.row.between'); row.appendChild(el('span.small', t.name)); row.appendChild(el('span.tiny.mute', `${t.attribution} · ${LIC_SHORT(t.license)}`)); listB.appendChild(row); });
  body.appendChild(listB);
  m.setBody(body);
}

// ---------- VU + imports ----------
function startVuLoop() {
  cancelVu();
  const data = new Uint8Array(128);
  const tick = () => {
    for (const ch of audio.channels.values()) {
      if (!ch._vuBar) continue;
      if (ch.playing && ch.analyser) { ch.analyser.getByteFrequencyData(data); let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i]; ch._vuBar.style.width = Math.min(100, (sum / data.length / 255) * 160) + '%'; }
      else ch._vuBar.style.width = '0%';
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}
function cancelVu() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }

let audioLibCache = [];
(async () => { try { const s = await store.getSettings(); audioLibCache = s.audioLibrary || []; } catch {} })();
function listImportedAudio() { return audioLibCache || []; }

async function importAudio() {
  const saved = await store.importMedia('audio', [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'webm', 'flac'] }]);
  if (!saved) return;
  const name = await promptText({ title: 'Name this sound', value: saved.originalName || 'Imported audio' });
  const s = await store.getSettings();
  const lib = s.audioLibrary || [];
  lib.push({ id: saved.id, name: name || saved.originalName || 'Audio' });
  await store.setSettings({ audioLibrary: lib });
  audioLibCache = lib;
  toast('Audio imported', { type: 'success' });
  render();
}
