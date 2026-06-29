// Player Display — the composed, GM-driven player-facing window (2nd monitor or
// Discord screen-share). Renders a background (idle card or the tabletop) with
// independently toggleable overlays (initiative / clocks / party HUD) and a
// momentary full-screen push (read-aloud / image). It is read-only: all control
// comes from the GM via presenter state (settings.presenter), synced live.
import { el, clear, deepClone } from '../util.js';
import store from '../store.js';
import appState from '../state.js';
import { VTT } from '../vtt-engine.js';
import { presenterFrom } from '../presenter.js';
import { clockDialSvg, svgToDataUrl } from '../assets.js';
import { portraitNode } from '../portrait.js';
import { setMarkdown } from '../markdown.js';

export function renderPlayerDisplay(root) {
  root.style.cssText = 'position:fixed;inset:0;background:var(--void,#06080b);color:var(--frost,#e4eef5);overflow:hidden;font-family:var(--font-ui,sans-serif)';
  const bg = el('div', { style: { position: 'absolute', inset: '0' } });
  const overlay = el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
  const full = el('div', { style: { position: 'absolute', inset: '0', display: 'none', zIndex: '20' } });
  root.appendChild(bg); root.appendChild(overlay); root.appendChild(full);

  let engine = null, canvas = null, curScene = null, curStamp = null;

  const enc = () => (appState.settings && appState.settings.encounter) || { combatants: [], clocks: [], turnIndex: -1 };
  const P = () => presenterFrom(appState.settings);

  function ensureCanvas() {
    if (canvas) return;
    canvas = el('canvas', { style: { width: '100%', height: '100%', display: 'block' } });
    clear(bg); bg.appendChild(canvas);
    engine = new VTT(canvas);
    engine.setPlayerView(true);
    engine.setTool('pan');
  }
  function teardownCanvas() {
    if (engine) { try { engine.destroy(); } catch (e) {} engine = null; }
    canvas = null; curScene = null; curStamp = null; clear(bg);
  }

  function renderBackground(p) {
    if (p.background === 'tabletop') {
      const sceneId = p.sceneId || (appState.settings && appState.settings.activeSceneId);
      const scene = sceneId ? store.get('scenes', sceneId) : null;
      if (!scene) { teardownCanvas(); bg.appendChild(idleCard(p, 'No scene selected')); return; }
      ensureCanvas();
      // Re-apply on a new scene OR when its content changes (live token/fog moves).
      // fit() yields a stable framing for a fixed-size scene, so this doesn't jump.
      if (scene.id !== curScene || scene.updatedAt !== curStamp) { engine.setScene(deepClone(scene)); curScene = scene.id; curStamp = scene.updatedAt; }
    } else {
      teardownCanvas();
      bg.appendChild(idleCard(p));
    }
  }

  function idleCard(p, note) {
    const sys = appState.system;
    const camp = appState.activeCampaignId ? store.get('campaigns', appState.activeCampaignId) : null;
    const title = p.title || (camp && camp.name) || (sys && sys.name) || 'XRPG';
    const sub = p.sub || (sys && sys.tagline) || '';
    const wrap = el('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--accent,#4ea3ff) 14%, var(--void,#06080b)), var(--void,#06080b))' } });
    const box = el('div', { style: { textAlign: 'center', padding: '40px' } });
    box.appendChild(el('div', { style: { fontFamily: 'var(--font-display, sans-serif)', fontSize: 'clamp(36px, 8vw, 88px)', fontWeight: '800', letterSpacing: '.01em', color: 'var(--frost,#e4eef5)', textShadow: '0 4px 30px #000a' } }, title));
    if (sub) box.appendChild(el('div', { style: { marginTop: '12px', fontSize: 'clamp(14px, 2.4vw, 24px)', color: 'var(--ice,#92bad6)', letterSpacing: '.04em' } }, sub));
    if (note) box.appendChild(el('div', { style: { marginTop: '24px', fontSize: '14px', color: 'var(--steel,#5a6c7e)' } }, note));
    wrap.appendChild(box);
    return wrap;
  }

  function renderOverlays(p) {
    clear(overlay);
    const e = enc();
    // Initiative (top center)
    if (p.overlays.initiative && (e.combatants || []).length) {
      const bar = el('div', { style: panel({ top: '16px', left: '50%', transform: 'translateX(-50%)', maxWidth: '92vw', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }) });
      bar.appendChild(el('div', { style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ice,#92bad6)', marginRight: '4px' } }, 'Round ' + (e.round || 1)));
      (e.combatants || []).forEach((c, i) => {
        const active = i === e.turnIndex;
        const pill = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '999px', background: active ? 'color-mix(in srgb, var(--accent,#4ea3ff) 70%, #0a0e13)' : 'rgba(255,255,255,0.06)', color: active ? 'var(--btn-ink,#fff)' : 'var(--frost,#e4eef5)', fontWeight: active ? '700' : '500', border: '1px solid ' + (active ? 'color-mix(in srgb, var(--accent,#4ea3ff) 50%, #000)' : 'rgba(255,255,255,0.08)') } });
        pill.appendChild(el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: c.color || kindColor(c.kind) } }));
        pill.appendChild(el('span', c.name));
        bar.appendChild(pill);
      });
      overlay.appendChild(bar);
    }
    // Clocks (top right)
    const clocks = (e.clocks || []).filter((c) => (p.publicClockIds || []).includes(c.id));
    if (p.overlays.clocks && clocks.length) {
      const stack = el('div', { style: panel({ top: '16px', right: '16px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-end' }) });
      clocks.forEach((c) => {
        const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
        row.appendChild(el('div', { style: { textAlign: 'right' } }, [
          el('div', { style: { fontWeight: '600' } }, c.name),
          el('div', { style: { fontSize: '12px', color: 'var(--ice,#92bad6)' } }, `${c.filled} / ${c.size}`),
        ]));
        const dial = el('img', { src: svgToDataUrl(clockDialSvg(c.filled, c.size, c.color || 'var(--ember,#ff2a1f)', 54)) });
        dial.style.width = '54px'; dial.style.height = '54px';
        row.appendChild(dial);
        stack.appendChild(row);
      });
      overlay.appendChild(stack);
    }
    // Party HUD (bottom center)
    if (p.overlays.party) {
      const revealed = Object.keys(p.party || {}).filter((id) => p.party[id] && (p.party[id].hp || p.party[id].status));
      if (revealed.length) {
        const hud = el('div', { style: panel({ bottom: '16px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '96vw' }) });
        revealed.forEach((id) => {
          const ch = store.get('characters', id);
          if (!ch) return;
          const reveal = p.party[id];
          const cb = (e.combatants || []).find((x) => x.charId === id);
          const card = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: '160px' } });
          card.appendChild(portraitNode(ch, 44, { round: true }));
          const info = el('div', { style: { minWidth: '110px' } });
          info.appendChild(el('div', { style: { fontWeight: '700' } }, ch.name));
          if (reveal.hp) {
            const hp = cb && cb.hp ? cb.hp : null;
            if (hp && hp.max) {
              const pct = Math.max(0, Math.min(1, hp.cur / hp.max));
              const bar = el('div', { style: { height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: '4px' } });
              bar.appendChild(el('div', { style: { height: '100%', width: (pct * 100) + '%', background: pct > 0.5 ? 'var(--good,#54c98a)' : pct > 0.25 ? 'var(--warn,#e7b955)' : 'var(--bad,#ff5a4d)' } }));
              info.appendChild(bar);
              info.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--ice,#92bad6)', marginTop: '2px' } }, `${hp.cur} / ${hp.max}`));
            } else { info.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--steel,#5a6c7e)', marginTop: '2px' } }, 'HP —')); }
          }
          if (reveal.status) {
            const conds = (cb && cb.conditions) || ch.conditions || [];
            if (conds.length) { const cr = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' } }); conds.forEach((cn) => cr.appendChild(el('span', { style: { fontSize: '10px', padding: '2px 6px', borderRadius: '999px', background: 'rgba(255,90,77,0.18)', color: '#ffb0a6' } }, cn))); info.appendChild(cr); }
          }
          card.appendChild(info);
          hud.appendChild(card);
        });
        overlay.appendChild(hud);
      }
    }
  }

  function renderFullscreen(p) {
    clear(full);
    if (p.push === 'readaloud' && p.readaloud) {
      full.style.display = '';
      full.style.background = 'rgba(4,6,10,0.96)';
      const wrap = el('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', padding: 'min(8vw, 120px)' } });
      const text = el('div', { style: { maxWidth: '1100px', fontSize: 'clamp(20px, 3.2vw, 40px)', lineHeight: '1.5', color: 'var(--frost,#e4eef5)', fontStyle: 'italic', textAlign: 'center' } });
      setMarkdown(text, p.readaloud);
      wrap.appendChild(text);
      full.appendChild(wrap);
    } else if (p.push === 'image' && p.imageMediaId) {
      full.style.display = '';
      full.style.background = '#000';
      const url = store.mediaUrl('handouts', p.imageMediaId) || store.mediaUrl('misc', p.imageMediaId);
      const img = el('img', { src: url, style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain' } });
      full.appendChild(img);
    } else {
      full.style.display = 'none';
    }
  }

  function renderAll() {
    const p = P();
    renderBackground(p);
    renderOverlays(p);
    renderFullscreen(p);
  }

  // Live: GM presenter edits arrive via settings:changed; scene/character edits via store:changed.
  if (window.xrpg.settings.onChanged) window.xrpg.settings.onChanged((s) => { appState.settings = s; renderAll(); });
  store.on('change', () => renderAll());

  renderAll();
}

function panel(extra) {
  return Object.assign({ position: 'absolute', pointerEvents: 'auto', background: 'rgba(10,14,20,0.72)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '12px 16px', boxShadow: '0 10px 40px #0008' }, extra);
}
function kindColor(kind) { return ({ pc: '#5bd0a0', npc: '#c9a0ff', threat: '#ff7a6b', ally: '#7fd1d6', boss: '#ff5a4d' })[kind] || '#6f93b0'; }
