// Canvas virtual tabletop engine: map, grid, tokens (drag/snap), fog of war,
// measurement, drawing, ping, pan/zoom. Emits 'change' for persistence.
import { Emitter, uid, debounce, clamp } from './util.js';
import { tokenSvg, mapSvg, svgToDataUrl, TOKEN_COLORS } from './assets.js';

export class VTT extends Emitter {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { x: 0, y: 0, scale: 1 };
    this.tool = 'select';
    this.scene = null;
    this.selected = null;
    this.mapImg = null;
    this.tokenImgs = new Map();
    this.pings = [];
    this.measure = null;
    this.drawing = null;
    this.playerView = false;
    this.brush = 2;
    this.penColor = '#ff5a4d';
    this._running = true;
    this._save = debounce(() => this.emit('change', this.scene), 500);

    this._bind();
    this._loop();
  }

  destroy() { this._running = false; this._unbind(); }

  // ---------- Scene ----------
  setScene(scene) {
    this.scene = scene;
    this.selected = null;
    this.mapImg = null;
    this.tokenImgs.clear();
    if (scene.mapMediaId) this._loadImage(`xrpg://media/maps/${scene.mapMediaId}`, (img) => { this.mapImg = img; });
    else if (scene.mapDataUrl) this._loadImage(scene.mapDataUrl, (img) => { this.mapImg = img; });
    else if (scene.mapKind) this._loadImage(svgToDataUrl(mapSvg(scene.mapKind, { w: scene.w || 1200, h: scene.h || 800 })), (img) => { this.mapImg = img; });
    (scene.tokens || []).forEach((t) => this._ensureTokenImg(t));
    this.fit();
    this.emit('scene', scene);
  }

  _ensureTokenImg(t) {
    if (t.image) { this._loadImage(t.image, (img) => this.tokenImgs.set(t.id, img)); }
    else {
      const svg = tokenSvg({ label: t.label || (t.name || '?').slice(0, 2), color: t.color || TOKEN_COLORS[t.kind] || '#6f93b0' });
      this._loadImage(svgToDataUrl(svg), (img) => this.tokenImgs.set(t.id, img));
    }
  }

  _loadImage(src, cb) { const img = new Image(); img.onload = () => { cb(img); }; img.onerror = () => {}; img.src = src; }

  fit() {
    if (!this.scene) return;
    const cw = this.canvas.clientWidth, chh = this.canvas.clientHeight;
    const w = this.scene.w || 1200, h = this.scene.h || 800;
    const scale = Math.min(cw / w, chh / h) * 0.95;
    this.view.scale = scale;
    this.view.x = (cw - w * scale) / 2;
    this.view.y = (chh - h * scale) / 2;
  }

  setTool(t) { this.tool = t; this.measure = null; this.emit('tool', t); }
  setPlayerView(v) { this.playerView = v; }

  // ---------- Tokens ----------
  addToken(spec) {
    const t = {
      id: 'tok_' + uid('').slice(0, 6),
      name: spec.name || 'Token', kind: spec.kind || 'neutral',
      x: spec.x != null ? spec.x : (this.scene.w || 1200) / 2,
      y: spec.y != null ? spec.y : (this.scene.h || 800) / 2,
      size: spec.size || 1, color: spec.color || TOKEN_COLORS[spec.kind] || '#6f93b0',
      label: spec.label || (spec.name || '?').slice(0, 2),
      charId: spec.charId || null, image: spec.image || null,
      hp: spec.hp || null, conditions: spec.conditions || [],
    };
    this.scene.tokens = this.scene.tokens || [];
    this.scene.tokens.push(t);
    this._ensureTokenImg(t);
    this._save();
    return t;
  }

  updateToken(id, patch) { const t = (this.scene.tokens || []).find((x) => x.id === id); if (!t) return; Object.assign(t, patch); if (patch.color || patch.label || patch.image) { t.image = patch.image || t.image; this._ensureTokenImg(t); } this._save(); }
  removeToken(id) { this.scene.tokens = (this.scene.tokens || []).filter((t) => t.id !== id); if (this.selected === id) this.selected = null; this._save(); }
  getToken(id) { return (this.scene.tokens || []).find((t) => t.id === id); }

  // ---------- Fog ----------
  toggleFog() { if (!this.scene.fog) this.scene.fog = { enabled: false, revealed: [] }; this.scene.fog.enabled = !this.scene.fog.enabled; this._save(); this.emit('fog'); }
  revealAll() { this.scene.fog = this.scene.fog || { enabled: true, revealed: [] }; this.scene.fog.revealed = ['ALL']; this._save(); }
  hideAll() { this.scene.fog = this.scene.fog || { enabled: true, revealed: [] }; this.scene.fog.revealed = []; this._save(); }
  _cellKey(col, row) { return col + ',' + row; }
  _paintFog(wx, wy, reveal) {
    const g = this.scene.grid || { size: 50 };
    const size = g.size || 50;
    const col = Math.floor(wx / size), row = Math.floor(wy / size);
    if (!this.scene.fog) this.scene.fog = { enabled: true, revealed: [] };
    if (this.scene.fog.revealed[0] === 'ALL') this.scene.fog.revealed = this._allCellsExcept();
    const set = new Set(this.scene.fog.revealed);
    const b = this.brush;
    for (let dc = -b; dc <= b; dc++) for (let dr = -b; dr <= b; dr++) {
      if (dc * dc + dr * dr > b * b + 1) continue;
      const k = this._cellKey(col + dc, row + dr);
      if (reveal) set.add(k); else set.delete(k);
    }
    this.scene.fog.revealed = Array.from(set);
    this._save();
  }
  _allCellsExcept() {
    const g = this.scene.grid || { size: 50 }; const size = g.size || 50;
    const cols = Math.ceil((this.scene.w || 1200) / size), rows = Math.ceil((this.scene.h || 800) / size);
    const arr = []; for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) arr.push(this._cellKey(c, r));
    return arr;
  }

  // ---------- Coordinate transforms ----------
  screenToWorld(sx, sy) { return { x: (sx - this.view.x) / this.view.scale, y: (sy - this.view.y) / this.view.scale }; }

  _tokenRadius(t) { const g = this.scene.grid || { size: 50 }; return ((g.size || 50) * (t.size || 1)) / 2; }

  hitToken(wx, wy) {
    const toks = this.scene.tokens || [];
    for (let i = toks.length - 1; i >= 0; i--) { const t = toks[i]; const r = this._tokenRadius(t); const dx = wx - t.x, dy = wy - t.y; if (dx * dx + dy * dy <= r * r) return t; }
    return null;
  }

  snap(v) { const g = this.scene.grid || { size: 50 }; const size = g.size || 50; if (g.snap === false) return v; return Math.round(v / size) * size; }

  ping(wx, wy) { this.pings.push({ x: wx, y: wy, t: performance.now() }); }

  // ---------- Event binding ----------
  _bind() {
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onWheel = (e) => this._wheel(e);
    this.canvas.addEventListener('mousedown', this._onDown);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
  }
  _unbind() {
    this.canvas.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
  }

  _evtPos(e) { const r = this.canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }

  _pointerDown(e) {
    const { sx, sy } = this._evtPos(e);
    const w = this.screenToWorld(sx, sy);
    this._drag = { sx, sy, wx: w.x, wy: w.y, moved: false };

    if (e.button === 1 || e.button === 2) { this._drag.mode = 'pan'; return; }

    if (this.tool === 'pan') { this._drag.mode = 'pan'; this.canvas.classList.add('panning'); return; }
    if (this.tool === 'select') {
      const t = this.hitToken(w.x, w.y);
      if (t) { this.selected = t.id; this._drag.mode = 'token'; this._drag.token = t; this._drag.ox = w.x - t.x; this._drag.oy = w.y - t.y; this.emit('select', t); }
      else { this.selected = null; this._drag.mode = 'pan'; this.emit('select', null); }
      return;
    }
    if (this.tool === 'measure') { this.measure = { x1: w.x, y1: w.y, x2: w.x, y2: w.y }; this._drag.mode = 'measure'; return; }
    if (this.tool === 'fog-reveal' || this.tool === 'fog-hide') { this._drag.mode = 'fog'; this._paintFog(w.x, w.y, this.tool === 'fog-reveal'); return; }
    if (this.tool === 'draw') { this.drawing = { color: this.penColor, width: 3 / this.view.scale, points: [{ x: w.x, y: w.y }] }; this._drag.mode = 'draw'; return; }
    if (this.tool === 'ping') { this.ping(w.x, w.y); this.emit('ping', w); this._drag.mode = 'none'; return; }
    this._drag.mode = 'pan';
  }

  _pointerMove(e) {
    if (!this._drag) {
      // hover cursor
      return;
    }
    const { sx, sy } = this._evtPos(e);
    const w = this.screenToWorld(sx, sy);
    const dx = sx - this._drag.sx, dy = sy - this._drag.sy;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._drag.moved = true;

    switch (this._drag.mode) {
      case 'pan': this.view.x += sx - (this._drag.lastSx ?? this._drag.sx); this.view.y += sy - (this._drag.lastSy ?? this._drag.sy); this._drag.lastSx = sx; this._drag.lastSy = sy; break;
      case 'token': { const t = this._drag.token; t.x = w.x - this._drag.ox; t.y = w.y - this._drag.oy; break; }
      case 'measure': this.measure.x2 = w.x; this.measure.y2 = w.y; break;
      case 'fog': this._paintFog(w.x, w.y, this.tool === 'fog-reveal'); break;
      case 'draw': if (this.drawing) this.drawing.points.push({ x: w.x, y: w.y }); break;
    }
  }

  _pointerUp(e) {
    if (!this._drag) return;
    const mode = this._drag.mode;
    if (mode === 'token' && this._drag.token) {
      const t = this._drag.token;
      if (this.scene.grid && this.scene.grid.snap !== false) {
        const size = this.scene.grid.size || 50;
        t.x = Math.floor(t.x / size) * size + size / 2;
        t.y = Math.floor(t.y / size) * size + size / 2;
      }
      this._save();
      this.emit('select', t);
    }
    if (mode === 'draw' && this.drawing) { this.scene.drawings = this.scene.drawings || []; if (this.drawing.points.length > 1) this.scene.drawings.push(this.drawing); this.drawing = null; this._save(); }
    if (mode === 'fog') this._save();
    this.canvas.classList.remove('panning');
    this._drag = null;
  }

  _wheel(e) {
    e.preventDefault();
    const { sx, sy } = this._evtPos(e);
    const before = this.screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.view.scale = clamp(this.view.scale * factor, 0.15, 6);
    const after = this.screenToWorld(sx, sy);
    this.view.x += (after.x - before.x) * this.view.scale;
    this.view.y += (after.y - before.y) * this.view.scale;
  }

  zoomBy(f) { const cw = this.canvas.clientWidth / 2, chh = this.canvas.clientHeight / 2; const before = this.screenToWorld(cw, chh); this.view.scale = clamp(this.view.scale * f, 0.15, 6); const after = this.screenToWorld(cw, chh); this.view.x += (after.x - before.x) * this.view.scale; this.view.y += (after.y - before.y) * this.view.scale; }

  clearDrawings() { this.scene.drawings = []; this._save(); }

  // ---------- Render ----------
  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = this.canvas.clientWidth, chh = this.canvas.clientHeight;
    if (this.canvas.width !== Math.floor(cw * dpr) || this.canvas.height !== Math.floor(chh * dpr)) {
      this.canvas.width = Math.floor(cw * dpr); this.canvas.height = Math.floor(chh * dpr);
    }
    this._dpr = dpr;
  }

  _loop() {
    if (!this._running) return;
    this._render();
    requestAnimationFrame(() => this._loop());
  }

  _render() {
    if (!this.scene) return;
    this._resize();
    const ctx = this.ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.save();
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);

    const W = this.scene.w || 1200, H = this.scene.h || 800;

    // map
    if (this.mapImg) ctx.drawImage(this.mapImg, 0, 0, W, H);
    else { ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, W, H); }

    // grid
    const g = this.scene.grid;
    if (g && g.visible !== false) this._drawGrid(ctx, W, H, g);

    // drawings
    (this.scene.drawings || []).forEach((d) => this._drawStroke(ctx, d));
    if (this.drawing) this._drawStroke(ctx, this.drawing);

    // tokens
    (this.scene.tokens || []).forEach((t) => this._drawToken(ctx, t));

    // measure
    if (this.measure) this._drawMeasure(ctx);

    // fog
    if (this.scene.fog && this.scene.fog.enabled) this._drawFog(ctx, W, H);

    // pings
    this._drawPings(ctx);

    ctx.restore();
  }

  _drawGrid(ctx, W, H, g) {
    const size = g.size || 50;
    ctx.strokeStyle = g.color || 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1 / this.view.scale;
    ctx.beginPath();
    if (g.type === 'hex') {
      // simple pointy-top hex grid
      const r = size / 2; const hw = Math.sqrt(3) * r; const hh = 1.5 * r;
      for (let row = 0; row * hh < H + r; row++) {
        for (let col = 0; col * hw < W + hw; col++) {
          const cx = col * hw + ((row % 2) ? hw / 2 : 0); const cy = row * hh + r;
          this._hexPath(ctx, cx, cy, r);
        }
      }
    } else {
      for (let x = 0; x <= W; x += size) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 0; y <= H; y += size) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    }
    ctx.stroke();
  }
  _hexPath(ctx, cx, cy, r) { for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 90); const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); }

  _drawStroke(ctx, d) {
    if (!d.points || d.points.length < 2) return;
    ctx.strokeStyle = d.color; ctx.lineWidth = d.width || 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(d.points[0].x, d.points[0].y);
    for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
    ctx.stroke();
  }

  _drawToken(ctx, t) {
    const r = this._tokenRadius(t);
    const img = this.tokenImgs.get(t.id);
    ctx.save();
    // shadow
    ctx.beginPath(); ctx.arc(t.x, t.y + r * 0.08, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    if (img) { ctx.save(); ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(img, t.x - r, t.y - r, r * 2, r * 2); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fillStyle = t.color; ctx.fill(); }
    // ring
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.lineWidth = (this.selected === t.id ? 4 : 2) / this.view.scale;
    ctx.strokeStyle = this.selected === t.id ? '#ffd24a' : (t.color || '#0008');
    ctx.stroke();
    // hp ring
    if (t.hp && t.hp.max) { const pct = clamp(t.hp.cur / t.hp.max, 0, 1); ctx.beginPath(); ctx.arc(t.x, t.y, r + 3 / this.view.scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct); ctx.lineWidth = 3 / this.view.scale; ctx.strokeStyle = pct > 0.5 ? '#54c98a' : pct > 0.25 ? '#e7b955' : '#ff5a4d'; ctx.stroke(); }
    // label
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(12 / this.view.scale + 4)}px Oswald, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; const tw = ctx.measureText(t.name).width; ctx.fillRect(t.x - tw / 2 - 4, t.y + r + 2, tw + 8, 16 / this.view.scale + 4);
    ctx.fillStyle = '#fff'; ctx.fillText(t.name, t.x, t.y + r + 4);
    // condition dots
    if (t.conditions && t.conditions.length) { ctx.fillStyle = '#ff5a4d'; ctx.beginPath(); ctx.arc(t.x + r * 0.7, t.y - r * 0.7, r * 0.18, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  _drawMeasure(ctx) {
    const m = this.measure; const g = this.scene.grid || { size: 50 };
    ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2 / this.view.scale; ctx.setLineDash([8 / this.view.scale, 6 / this.view.scale]);
    ctx.beginPath(); ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2); ctx.stroke(); ctx.setLineDash([]);
    const dist = Math.hypot(m.x2 - m.x1, m.y2 - m.y1) / (g.size || 50);
    const label = `${dist.toFixed(1)} sq`;
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.font = `${Math.round(13 / this.view.scale + 3)}px Share Tech Mono, monospace`;
    const mx = (m.x1 + m.x2) / 2, my = (m.y1 + m.y2) / 2; const tw = ctx.measureText(label).width;
    ctx.fillRect(mx - tw / 2 - 6, my - 12 / this.view.scale, tw + 12, 20 / this.view.scale);
    ctx.fillStyle = '#ffd24a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, mx, my);
  }

  _drawFog(ctx, W, H) {
    const fog = this.scene.fog; const g = this.scene.grid || { size: 50 }; const size = g.size || 50;
    const revealed = new Set(fog.revealed);
    const all = fog.revealed[0] === 'ALL';
    const cols = Math.ceil(W / size), rows = Math.ceil(H / size);
    ctx.fillStyle = this.playerView ? 'rgba(2,4,8,1)' : 'rgba(2,4,8,0.62)';
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const lit = all || revealed.has(c + ',' + r);
      if (!lit) ctx.fillRect(c * size, r * size, size, size);
    }
  }

  _drawPings(ctx) {
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 1500);
    this.pings.forEach((p) => {
      const age = (now - p.t) / 1500;
      const r = (8 + age * 44) / this.view.scale;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,90,77,${1 - age})`; ctx.lineWidth = 3 / this.view.scale; ctx.stroke();
    });
  }
}
