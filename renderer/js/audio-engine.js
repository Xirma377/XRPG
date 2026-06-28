// Procedural + file-based audio engine for the mixer and session cues.
// All ambient beds are synthesized with Web Audio — no audio files required.
import { Emitter, uid } from './util.js';

// ---- Procedural instrument library (looping ambient beds) ----
export const INSTRUMENTS = [
  { id: 'wind', name: 'Wind', icon: 'snow', cat: 'weather' },
  { id: 'blizzard', name: 'Blizzard', icon: 'snow', cat: 'weather' },
  { id: 'rain', name: 'Rain', icon: 'snow', cat: 'weather' },
  { id: 'thunderstorm', name: 'Thunderstorm', icon: 'bolt', cat: 'weather' },
  { id: 'fire', name: 'Campfire', icon: 'fire', cat: 'place' },
  { id: 'engine', name: 'Engine Idle', icon: 'road', cat: 'place' },
  { id: 'radio', name: 'Radio Static', icon: 'radio', cat: 'place' },
  { id: 'night', name: 'Night / Crickets', icon: 'music', cat: 'place' },
  { id: 'drone-dark', name: 'Dark Drone', icon: 'music', cat: 'tension' },
  { id: 'drone-warm', name: 'Warm Drone', icon: 'music', cat: 'tension' },
  { id: 'sub', name: 'Sub Rumble', icon: 'bolt', cat: 'tension' },
  { id: 'heartbeat', name: 'Heartbeat', icon: 'heart', cat: 'tension' },
  { id: 'horde', name: 'Distant Horde', icon: 'zombie', cat: 'tension' },
  { id: 'tension', name: 'Tension Riser', icon: 'spark', cat: 'tension' },
];

// ---- One-shot SFX ----
export const ONESHOTS = [
  { id: 'impact', name: 'Impact', icon: 'bolt' },
  { id: 'boom', name: 'Deep Boom', icon: 'bolt' },
  { id: 'gunshot', name: 'Gunshot', icon: 'target' },
  { id: 'thunder', name: 'Thunder', icon: 'bolt' },
  { id: 'glass', name: 'Glass Break', icon: 'x' },
  { id: 'door', name: 'Door Slam', icon: 'stop' },
  { id: 'alert', name: 'Alert Tone', icon: 'warn' },
  { id: 'static-burst', name: 'Static Burst', icon: 'radio' },
  { id: 'dice', name: 'Dice Clack', icon: 'dice' },
  { id: 'scream', name: 'Distant Scream', icon: 'warn' },
  { id: 'heartbeat-spike', name: 'Heart Spike', icon: 'heart' },
  { id: 'chime', name: 'Soft Chime', icon: 'spark' },
];

class AudioEngine extends Emitter {
  constructor() {
    super();
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.channels = new Map(); // id -> channel
    this.started = false;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 6; this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.25;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    this.started = true;
    this.emit('ready');
    return this.ctx;
  }

  setMaster(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  noiseBuffer(sec, color = 'white') {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    if (color === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    } else if (color === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25; }
    } else {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return b;
  }

  // ---- Channel management ----
  addChannel(spec = {}) {
    this.ensure();
    let id = spec.id || uid('ch');
    while (this.channels.has(id)) id = uid('ch'); // never overwrite a live channel
    const gain = this.ctx.createGain();
    gain.gain.value = spec.gain != null ? spec.gain : 0.6;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    gain.connect(analyser);
    analyser.connect(this.master);
    const ch = {
      id, name: spec.name || 'Channel', type: spec.type || 'instrument',
      source: spec.source || null, // instrument id or media id
      url: spec.url || null,       // explicit file URL (library/imported)
      meta: spec.meta || null,     // {license, attribution, category, source}
      gain, analyser, nodes: null, fileEl: null, playing: false, paused: false,
      muted: false, solo: false, loop: spec.loop !== false, volume: gain.gain.value,
    };
    this.channels.set(id, ch);
    this.emit('channels');
    return ch;
  }

  removeChannel(id) {
    const ch = this.channels.get(id);
    if (!ch) return;
    this.stop(id);
    try { ch.gain.disconnect(); ch.analyser.disconnect(); } catch {}
    this.channels.delete(id);
    this.emit('channels');
  }

  setVolume(id, v) {
    const ch = this.channels.get(id); if (!ch) return;
    ch.volume = v;
    if (!ch.muted) ch.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.04);
    this.emit('channel', id);
  }

  setMute(id, m) {
    const ch = this.channels.get(id); if (!ch) return;
    ch.muted = m;
    ch.gain.gain.setTargetAtTime(m ? 0 : ch.volume, this.ctx.currentTime, 0.04);
    this.emit('channel', id);
  }

  async play(id) {
    const ch = this.channels.get(id); if (!ch) return;
    this.ensure();
    if (ch.paused) return this.resume(id);
    if (ch.playing) return;
    if (ch.type === 'instrument') {
      ch.nodes = this.buildInstrument(ch.source, ch.gain);
    } else if (ch.type === 'file') {
      await this.playFile(ch);
    }
    ch.playing = true; ch.paused = false;
    // fade in
    const target = ch.muted ? 0 : ch.volume;
    ch.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    ch.gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    ch.gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, target), this.ctx.currentTime + 0.8);
    this.emit('channel', id);
  }

  stop(id, fade = 0.5) {
    const ch = this.channels.get(id); if (!ch || (!ch.playing && !ch.paused)) return;
    const t = this.ctx.currentTime;
    ch.gain.gain.cancelScheduledValues(t);
    ch.gain.gain.setValueAtTime(Math.max(0.0001, ch.gain.gain.value), t);
    ch.gain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    const nodes = ch.nodes; const fileEl = ch.fileEl;
    setTimeout(() => {
      if (nodes && nodes.stop) try { nodes.stop(); } catch {}
      if (fileEl) { try { fileEl.pause(); fileEl.currentTime = 0; } catch {} }
    }, fade * 1000 + 30);
    ch.nodes = null; ch.playing = false; ch.paused = false;
    this.emit('channel', id);
  }

  pause(id) {
    const ch = this.channels.get(id); if (!ch || !ch.playing || ch.paused) return;
    ch.paused = true; ch.playing = false;
    ch.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
    if (ch.fileEl) { try { ch.fileEl.pause(); } catch {} }
    this.emit('channel', id);
  }

  resume(id) {
    const ch = this.channels.get(id); if (!ch || !ch.paused) return;
    ch.paused = false; ch.playing = true;
    const target = ch.muted ? 0 : ch.volume;
    ch.gain.gain.setTargetAtTime(Math.max(0.0001, target), this.ctx.currentTime, 0.08);
    if (ch.fileEl) { try { ch.fileEl.play(); } catch {} }
    this.emit('channel', id);
  }

  togglePause(id) { const ch = this.channels.get(id); if (!ch) return; if (ch.paused) this.resume(id); else if (ch.playing) this.pause(id); else this.play(id); }
  toggle(id) { const ch = this.channels.get(id); if (!ch) return; if (ch.playing || ch.paused) this.stop(id); else this.play(id); }

  pauseAll() { for (const id of this.channels.keys()) this.pause(id); }

  // One-shot playback of a file URL (e.g. a downloaded SFX), auto-cleaned.
  oneShotFile(url, vol = 1) {
    this.ensure();
    const el = new Audio(url);
    el.crossOrigin = 'anonymous';
    let node;
    try { node = this.ctx.createMediaElementSource(el); } catch { el.play().catch(() => {}); return; }
    const g = this.ctx.createGain(); g.gain.value = vol;
    node.connect(g); g.connect(this.master);
    let done = false;
    const cleanup = () => { if (done) return; done = true; clearTimeout(safety); try { node.disconnect(); g.disconnect(); } catch {} try { el.pause(); el.src = ''; } catch {} };
    el.addEventListener('ended', cleanup);
    el.addEventListener('error', cleanup);
    // Safety net: if 'ended' never fires (stalled stream / looping), force cleanup.
    const safety = setTimeout(cleanup, Math.min(60000, (el.duration && isFinite(el.duration) ? el.duration * 1000 + 1000 : 30000)));
    el.play().catch(() => cleanup());
  }

  async playFile(ch) {
    const url = ch.url || `xrpg://media/audio/${ch.source}`;
    const el = new Audio(url);
    el.loop = ch.loop;
    el.crossOrigin = 'anonymous';
    const node = this.ctx.createMediaElementSource(el);
    node.connect(ch.gain);
    ch.fileEl = el;
    ch.nodes = { stop: () => { try { node.disconnect(); } catch {} } };
    try { await el.play(); } catch (e) { console.warn('file play failed', e); }
  }

  // ---- Instrument synthesis ----
  buildInstrument(kind, dest) {
    const ctx = this.ctx;
    const made = [];
    const reg = (n) => { made.push(n); return n; };
    const stop = () => { made.forEach((n) => { try { if (n.stop) n.stop(); } catch {} try { n.disconnect(); } catch {} }); };

    const loopNoise = (sec, color) => { const s = ctx.createBufferSource(); s.buffer = this.noiseBuffer(sec, color); s.loop = true; reg(s); return s; };
    const filt = (type, freq, q) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q != null) f.Q.value = q; reg(f); return f; };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; reg(g); return g; };
    const osc = (type, freq) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; reg(o); return o; };

    switch (kind) {
      case 'wind': {
        const n = loopNoise(3, 'white'); const bp = filt('bandpass', 400, 0.7); const g = gain(0.5);
        const lfo = osc('sine', 0.08); const lg = gain(0.35); lfo.connect(lg); lg.connect(g.gain);
        n.connect(bp); bp.connect(g); g.connect(dest); n.start(); lfo.start();
        break;
      }
      case 'blizzard': {
        const n = loopNoise(3, 'white'); const bp = filt('bandpass', 700, 0.5); const g = gain(0.7);
        const lfo = osc('sine', 0.15); const lg = gain(0.5); lfo.connect(lg); lg.connect(g.gain);
        const hp = filt('highpass', 300); n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest); n.start(); lfo.start();
        break;
      }
      case 'rain': {
        const n = loopNoise(3, 'white'); const hp = filt('highpass', 1200); const g = gain(0.45);
        const lfo = osc('sine', 3.5); const lg = gain(0.08); lfo.connect(lg); lg.connect(g.gain);
        n.connect(hp); hp.connect(g); g.connect(dest); n.start(); lfo.start();
        break;
      }
      case 'thunderstorm': {
        const n = loopNoise(3, 'white'); const hp = filt('highpass', 1000); const g = gain(0.4);
        n.connect(hp); hp.connect(g); g.connect(dest); n.start();
        const rumble = loopNoise(4, 'brown'); const lp = filt('lowpass', 120); const rg = gain(0.5);
        rumble.connect(lp); lp.connect(rg); rg.connect(dest); rumble.start();
        // occasional thunder
        const schedule = () => { if (!made.length) return; this.oneShot('thunder', 0.5); made._t = setTimeout(schedule, 8000 + Math.random() * 14000); };
        made._t = setTimeout(schedule, 5000 + Math.random() * 8000);
        made.push({ stop: () => clearTimeout(made._t) });
        break;
      }
      case 'fire': {
        const n = loopNoise(3, 'brown'); const lp = filt('lowpass', 700); const g = gain(0.5);
        n.connect(lp); lp.connect(g); g.connect(dest); n.start();
        // crackle
        const crackle = () => { if (!made.length) return; if (this.ctx) { const t = ctx.currentTime; const c = ctx.createBufferSource(); c.buffer = this.noiseBuffer(0.04, 'white'); const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 1800 + Math.random() * 2000; const cg = ctx.createGain(); cg.gain.setValueAtTime(0.12 * Math.random(), t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05); c.connect(cf); cf.connect(cg); cg.connect(dest); c.start(t); c.stop(t + 0.05); } made._t = setTimeout(crackle, 60 + Math.random() * 220); };
        made._t = setTimeout(crackle, 100);
        made.push({ stop: () => clearTimeout(made._t) });
        break;
      }
      case 'engine': {
        const o1 = osc('sawtooth', 55); const o2 = osc('sawtooth', 82); const lp = filt('lowpass', 320); const g = gain(0.18);
        const lfo = osc('sine', 6); const lg = gain(8); lfo.connect(lg); lg.connect(o1.frequency);
        o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest); o1.start(); o2.start(); lfo.start();
        break;
      }
      case 'radio': {
        const n = loopNoise(2, 'white'); const bp = filt('bandpass', 1600, 0.5); const g = gain(0.3);
        const lfo = osc('sine', 0.5); const lg = gain(0.15); lfo.connect(lg); lg.connect(g.gain);
        n.connect(bp); bp.connect(g); g.connect(dest); n.start(); lfo.start();
        break;
      }
      case 'night': {
        const n = loopNoise(3, 'pink'); const lp = filt('lowpass', 500); const g = gain(0.2);
        n.connect(lp); lp.connect(g); g.connect(dest); n.start();
        // cricket chirp
        const chirp = () => { if (!made.length) return; const t = ctx.currentTime; const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 4200 + Math.random() * 600; const cg = ctx.createGain(); cg.gain.setValueAtTime(0, t); for (let k = 0; k < 4; k++) { cg.gain.setValueAtTime(0.02, t + k * 0.04); cg.gain.setValueAtTime(0, t + k * 0.04 + 0.02); } o.connect(cg); cg.connect(dest); o.start(t); o.stop(t + 0.2); made._t = setTimeout(chirp, 400 + Math.random() * 900); };
        made._t = setTimeout(chirp, 500);
        made.push({ stop: () => clearTimeout(made._t) });
        break;
      }
      case 'drone-dark': {
        const o1 = osc('sine', 55); const o2 = osc('sine', 55.3); const o3 = osc('sawtooth', 36.7); const lp = filt('lowpass', 200); const g = gain(0.12);
        o1.connect(g); o2.connect(g); o3.connect(lp); lp.connect(g); g.connect(dest); o1.start(); o2.start(); o3.start();
        break;
      }
      case 'drone-warm': {
        const o1 = osc('sine', 110); const o2 = osc('sine', 164.8); const o3 = osc('triangle', 82.4); const g = gain(0.1);
        o1.connect(g); o2.connect(g); o3.connect(g); g.connect(dest); o1.start(); o2.start(); o3.start();
        break;
      }
      case 'sub': {
        const o = osc('sine', 32); const o2 = osc('sine', 32.4); const g = gain(0.22);
        const lfo = osc('sine', 0.1); const lg = gain(0.06); lfo.connect(lg); lg.connect(g.gain);
        o.connect(g); o2.connect(g); g.connect(dest); o.start(); o2.start(); lfo.start();
        break;
      }
      case 'heartbeat': {
        const g = gain(1); g.connect(dest);
        let gap = 1100;
        const beat = () => { if (!made.length) return; const t = ctx.currentTime; this._thump(t, 0.22, 46, g); this._thump(t + 0.28, 0.15, 46, g); made._t = setTimeout(beat, gap); };
        beat();
        made.push({ stop: () => clearTimeout(made._t) });
        break;
      }
      case 'horde': {
        const n = loopNoise(4, 'brown'); const lp = filt('lowpass', 240); const g = gain(0.28);
        const lfo = osc('sine', 0.13); const lg = gain(0.12); lfo.connect(lg); lg.connect(g.gain);
        n.connect(lp); lp.connect(g); g.connect(dest); n.start(); lfo.start();
        // groans
        const groan = () => { if (!made.length) return; const t = ctx.currentTime; const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70 + Math.random() * 40, t); o.frequency.exponentialRampToValueAtTime(45, t + 1.2); const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.06, t + 0.3); og.gain.exponentialRampToValueAtTime(0.001, t + 1.3); const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 500; o.connect(of); of.connect(og); og.connect(dest); o.start(t); o.stop(t + 1.4); made._t = setTimeout(groan, 1500 + Math.random() * 4000); };
        made._t = setTimeout(groan, 2000);
        made.push({ stop: () => clearTimeout(made._t) });
        break;
      }
      case 'tension': {
        const n = loopNoise(4, 'white'); const bp = filt('bandpass', 800, 1.2); const g = gain(0.12);
        const lfo = osc('sine', 0.05); const lg = gain(600); lfo.connect(lg); lg.connect(bp.frequency);
        n.connect(bp); bp.connect(g); g.connect(dest); n.start(); lfo.start();
        const o = osc('sawtooth', 110); const og = gain(0.04); o.connect(og); og.connect(dest); o.start();
        break;
      }
      default: {
        const n = loopNoise(2, 'pink'); const g = gain(0.2); n.connect(g); g.connect(dest); n.start();
      }
    }
    return { stop };
  }

  _thump(t, vol, freq, dest) {
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq + 20, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.1);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + 0.36);
  }

  // ---- One-shots ----
  oneShot(kind, vol = 0.6) {
    this.ensure();
    const ctx = this.ctx, t = ctx.currentTime, dest = this.master;
    const noise = (sec, color) => { const s = ctx.createBufferSource(); s.buffer = this.noiseBuffer(sec, color); return s; };
    switch (kind) {
      case 'impact': case 'boom': {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(kind === 'boom' ? 90 : 120, t); o.frequency.exponentialRampToValueAtTime(kind === 'boom' ? 27 : 40, t + (kind === 'boom' ? 1.1 : 0.6));
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'boom' ? 1.7 : 1.0));
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.8);
        const n = noise(0.5, 'white'); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; const ng = ctx.createGain(); ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4); n.connect(lp); lp.connect(ng); ng.connect(dest); n.start(t); n.stop(t + 0.45);
        break;
      }
      case 'gunshot': {
        const n = noise(0.3, 'white'); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500; const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); n.connect(hp); hp.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.3);
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2); const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.7, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.25);
        break;
      }
      case 'thunder': {
        const n = noise(2, 'brown'); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(80, t + 1.8); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 2); n.connect(lp); lp.connect(g); g.connect(dest); n.start(t); n.stop(t + 2.1);
        break;
      }
      case 'glass': {
        for (let k = 0; k < 6; k++) { const tk = t + k * 0.03; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 2000 + Math.random() * 4000; const g = ctx.createGain(); g.gain.setValueAtTime(vol * 0.4, tk); g.gain.exponentialRampToValueAtTime(0.001, tk + 0.18); o.connect(g); g.connect(dest); o.start(tk); o.stop(tk + 0.2); }
        break;
      }
      case 'door': {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.15); const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.3);
        const n = noise(0.2, 'brown'); const ng = ctx.createGain(); ng.gain.setValueAtTime(vol * 0.4, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2); n.connect(ng); ng.connect(dest); n.start(t); n.stop(t + 0.22);
        break;
      }
      case 'alert': {
        const tone = (f, st) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vol * 0.3, st + 0.02); g.gain.setValueAtTime(vol * 0.3, st + 0.7); g.gain.linearRampToValueAtTime(0, st + 0.75); o.connect(g); g.connect(dest); o.start(st); o.stop(st + 0.78); };
        tone(853, t); tone(960, t); tone(853, t + 0.85); tone(960, t + 0.85);
        break;
      }
      case 'static-burst': {
        const n = noise(0.5, 'white'); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; const g = ctx.createGain(); g.gain.setValueAtTime(vol * 0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45); n.connect(bp); bp.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.5);
        break;
      }
      case 'dice': {
        for (let k = 0; k < 3; k++) { const tk = t + k * 0.12; const n = noise(0.06, 'white'); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; const g = ctx.createGain(); g.gain.setValueAtTime(vol * 0.5, tk); g.gain.exponentialRampToValueAtTime(0.001, tk + 0.05); n.connect(hp); hp.connect(g); g.connect(dest); n.start(tk); n.stop(tk + 0.06); }
        break;
      }
      case 'scream': {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(600, t); o.frequency.linearRampToValueAtTime(900, t + 0.3); o.frequency.linearRampToValueAtTime(400, t + 0.8); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.18, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3; o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.95);
        break;
      }
      case 'heartbeat-spike': {
        this._thump(t, vol * 0.4, 50); this._thump(t + 0.22, vol * 0.3, 50); this._thump(t + 0.5, vol * 0.4, 52); this._thump(t + 0.68, vol * 0.3, 52);
        break;
      }
      case 'chime': {
        [523, 659, 784].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); const st = t + i * 0.08; g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vol * 0.18, st + 0.02); g.gain.exponentialRampToValueAtTime(0.001, st + 1.2); o.connect(g); g.connect(dest); o.start(st); o.stop(st + 1.3); });
        break;
      }
      default: this._thump(t, vol, 60);
    }
    this.emit('oneshot', kind);
  }

  stopAll() { for (const id of this.channels.keys()) this.stop(id); }
}

export const audio = new AudioEngine();
export default audio;
