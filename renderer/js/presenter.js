// Presenter: the GM-controlled state that drives the Player Display window.
// Lives in settings.presenter so it syncs cross-window via the settings:changed
// broadcast. The GM mutates it from the session runner; the player window observes.
//
// Model: a BACKGROUND (idle card or the tabletop) + independently toggleable
// OVERLAYS (initiative / clocks / party HUD) + a momentary full-screen PUSH
// (read-aloud or image) shown over everything.
import store from './store.js';
import appState from './state.js';

export function presenterDefaults() {
  return {
    background: 'idle',           // idle | tabletop
    push: 'none',                 // none | readaloud | image
    overlays: { initiative: false, clocks: false, party: false },
    readaloud: '',
    imageMediaId: null,
    publicClockIds: [],           // encounter clock ids the players may see
    party: {},                    // { [charId]: { hp: bool, status: bool } }
    sceneId: null,                // tabletop scene shown to players
    title: '',                    // idle card title
    sub: '',                      // idle card subtitle
  };
}

export function presenterFrom(settings) {
  const p = (settings && settings.presenter) || {};
  const d = presenterDefaults();
  return { ...d, ...p, overlays: { ...d.overlays, ...(p.overlays || {}) }, party: { ...(p.party || {}) } };
}

export function getPresenter() { return presenterFrom(appState.settings); }

// Merge a patch and persist (broadcasts settings:changed to the player window).
export async function setPresenter(patch) {
  const cur = getPresenter();
  const next = { ...cur, ...patch };
  if (patch.overlays) next.overlays = { ...cur.overlays, ...patch.overlays };
  if (patch.party) next.party = { ...cur.party, ...patch.party };
  await appState.updateSettings({ presenter: next });
  return next;
}

// ---- GM action helpers (used by the presenter panel + contextual "show" buttons) ----
export const presenter = {
  get: getPresenter,
  set: setPresenter,
  setBackground: (background) => setPresenter({ background }),
  showTabletop: (sceneId) => setPresenter(sceneId ? { background: 'tabletop', sceneId } : { background: 'tabletop' }),
  idle: () => setPresenter({ background: 'idle' }),
  pushReadAloud: (text) => setPresenter({ push: 'readaloud', readaloud: text || '' }),
  pushImage: (mediaId) => setPresenter({ push: 'image', imageMediaId: mediaId || null }),
  clearPush: () => setPresenter({ push: 'none' }),
  setOverlay: (key, val) => setPresenter({ overlays: { [key]: !!val } }),
  setIdleCard: (title, sub) => setPresenter({ title: title || '', sub: sub || '' }),
  setClockPublic(id, val) {
    const cur = getPresenter();
    const ids = new Set(cur.publicClockIds || []);
    if (val) ids.add(id); else ids.delete(id);
    return setPresenter({ publicClockIds: [...ids] });
  },
  revealPc(charId, reveal) {
    const cur = getPresenter();
    const entry = { ...(cur.party[charId] || { hp: false, status: false }), ...reveal };
    return setPresenter({ party: { [charId]: entry } });
  },
  isPcRevealed(charId) { const p = getPresenter().party[charId]; return !!(p && (p.hp || p.status)); },
};

export function openPlayerDisplay() { return window.xrpg.window.popout('player', 'player'); }

export default presenter;
