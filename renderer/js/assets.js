// Procedurally generated SVG art (no external assets needed):
// avatars/portraits, VTT tokens, battlemaps, and the app logo.
import { seededRng } from './util.js';

const SURVIVOR_PALETTES = [
  ['#3a4a5e', '#6f93b0', '#e4eef5'], ['#4a3f3a', '#b08a6f', '#f0e2d4'],
  ['#3a4a3f', '#7fae8a', '#e0f0e4'], ['#4a3a4e', '#a07fb0', '#efe2f5'],
  ['#5e4a3a', '#c0986f', '#f5ead4'], ['#2f3a4a', '#5f7fb0', '#dfe9f5'],
  ['#4e3a3a', '#b07f7f', '#f5e2e2'], ['#3a4e4a', '#7fb0a8', '#e2f5f0'],
];
const THREAT_PALETTES = [
  ['#2a1a1a', '#7a3a30', '#d8a89a'], ['#1f2a1a', '#4a6a3a', '#a8c89a'],
  ['#2a2218', '#6a5a3a', '#c8b89a'], ['#221a2a', '#4a3a6a', '#b09ac8'],
];

function hashToInt(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }

// Abstract bust avatar — deterministic from seed.
export function portraitSvg(seed, opts = {}) {
  const rng = seededRng('por' + seed);
  const kind = opts.kind || 'pc';
  const palettes = kind === 'npc' && opts.threat ? THREAT_PALETTES : (kind === 'npc' ? SURVIVOR_PALETTES : SURVIVOR_PALETTES);
  const pal = palettes[Math.floor(rng() * palettes.length)];
  const [dark, mid, light] = pal;
  const bg1 = `hsl(${Math.floor(rng() * 360)}, 22%, ${12 + Math.floor(rng() * 8)}%)`;
  const bg2 = `hsl(${Math.floor(rng() * 360)}, 18%, ${6 + Math.floor(rng() * 6)}%)`;
  const skinShift = Math.floor(rng() * 30) - 10;
  const skin = `hsl(${28 + skinShift}, ${25 + Math.floor(rng() * 20)}%, ${45 + Math.floor(rng() * 25)}%)`;
  const hairHue = Math.floor(rng() * 50);
  const hair = `hsl(${hairHue}, ${10 + Math.floor(rng() * 30)}%, ${10 + Math.floor(rng() * 30)}%)`;
  const eyeY = 86 + Math.floor(rng() * 6);
  const hairStyle = Math.floor(rng() * 4);
  const jaw = 0.85 + rng() * 0.3;

  let hairPath = '';
  if (hairStyle === 0) hairPath = `<path d="M58 78 q42 -46 84 0 q4 18 -4 30 q-38 -28 -76 0 q-8 -14 -4 -30Z" fill="${hair}"/>`;
  else if (hairStyle === 1) hairPath = `<path d="M56 84 q44 -52 88 0 l-6 -2 q-38 -30 -76 0Z" fill="${hair}"/><rect x="56" y="70" width="88" height="14" rx="6" fill="${hair}"/>`;
  else if (hairStyle === 2) hairPath = `<path d="M60 80 q40 -40 80 0 q2 8 0 14 q-40 -22 -80 0 q-2 -6 0 -14Z" fill="${hair}"/>`;
  else hairPath = '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="80%">
      <stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${mid}"/><stop offset="100%" stop-color="${dark}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#bg)"/>
  <path d="M40 200 q0 -54 60 -64 q60 10 60 64Z" fill="url(#body)"/>
  <path d="M86 132 h28 v22 q-14 8 -28 0Z" fill="${skin}" opacity="0.92"/>
  <ellipse cx="100" cy="104" rx="${30 * jaw}" ry="34" fill="${skin}"/>
  <path d="M${100 - 30 * jaw} 104 q0 30 ${30 * jaw} 38 q${30 * jaw} -8 ${30 * jaw} -38Z" fill="${skin}"/>
  ${hairPath}
  <ellipse cx="88" cy="${eyeY}" rx="4" ry="${kind === 'npc' && opts.threat ? 2 : 4}" fill="${kind === 'npc' && opts.threat ? '#d8463a' : '#1a1f26'}"/>
  <ellipse cx="112" cy="${eyeY}" rx="4" ry="${kind === 'npc' && opts.threat ? 2 : 4}" fill="${kind === 'npc' && opts.threat ? '#d8463a' : '#1a1f26'}"/>
  <path d="M92 ${eyeY + 18} q8 5 16 0" stroke="${dark}" stroke-width="2" fill="none" opacity="0.5"/>
  <rect width="200" height="200" fill="none"/>
</svg>`;
}

// VTT token: ring + label/glyph. opts: {label, color, kind, glyph, image}
export function tokenSvg(opts = {}) {
  const color = opts.color || '#6f93b0';
  const label = (opts.label || '?').slice(0, 2).toUpperCase();
  const inkDark = '#0b0e13';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><radialGradient id="g" cx="50%" cy="38%" r="65%">
    <stop offset="0%" stop-color="${shade(color, 28)}"/><stop offset="100%" stop-color="${shade(color, -18)}"/>
  </radialGradient></defs>
  <circle cx="50" cy="50" r="46" fill="url(#g)" stroke="${shade(color, 40)}" stroke-width="3"/>
  <circle cx="50" cy="50" r="46" fill="none" stroke="${inkDark}" stroke-width="1" opacity="0.5"/>
  <text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="Oswald, sans-serif" font-weight="700" font-size="${label.length > 1 ? 34 : 44}" fill="${readableInk(color)}">${escapeXml(label)}</text>
</svg>`;
}

// Battlemaps — stylized top-down grid scenes.
export function mapSvg(kind = 'grid', opts = {}) {
  const w = opts.w || 1200, h = opts.h || 800;
  const cell = opts.cell || 50;
  const grid = gridLines(w, h, cell, 'rgba(255,255,255,0.05)');
  const maps = {
    grid: () => `<rect width="${w}" height="${h}" fill="#10151c"/>${grid}`,
    snow: () => `
      <rect width="${w}" height="${h}" fill="#1a2330"/>
      <rect width="${w}" height="${h}" fill="url(#snowtex)"/>
      ${grid}`,
    highway: () => `
      <rect width="${w}" height="${h}" fill="#e8eef3"/>
      <rect x="${w / 2 - 220}" y="0" width="440" height="${h}" fill="#2b2f36"/>
      <rect x="${w / 2 - 6}" y="0" width="12" height="${h}" fill="#d8c14a" opacity="0.6"/>
      <g stroke="#f0e9d0" stroke-width="5" stroke-dasharray="40 36" opacity="0.7">
        <line x1="${w / 2 - 110}" y1="0" x2="${w / 2 - 110}" y2="${h}"/>
        <line x1="${w / 2 + 110}" y1="0" x2="${w / 2 + 110}" y2="${h}"/>
      </g>
      ${vehicles(w, h)}
      ${grid}`,
    compound: () => `
      <rect width="${w}" height="${h}" fill="#2a2a22"/>
      <rect x="60" y="60" width="${w - 120}" height="${h - 120}" fill="none" stroke="#6a5a3a" stroke-width="10" stroke-dasharray="2 18" stroke-linecap="round"/>
      <rect x="${w * 0.18}" y="${h * 0.3}" width="${w * 0.22}" height="${h * 0.28}" fill="#4a3f33" stroke="#2a241c" stroke-width="3"/>
      <rect x="${w * 0.55}" y="${h * 0.25}" width="${w * 0.14}" height="${h * 0.14}" fill="#3a4a3a" stroke="#2a241c" stroke-width="3"/>
      <circle cx="${w * 0.7}" cy="${h * 0.65}" r="${h * 0.08}" fill="#2f3a44" stroke="#1a2026" stroke-width="3"/>
      ${grid}`,
    interior: () => `
      <rect width="${w}" height="${h}" fill="#14171d"/>
      <rect x="80" y="80" width="${w - 160}" height="${h - 160}" fill="#1e242e" stroke="#39455a" stroke-width="6"/>
      <line x1="${w * 0.5}" y1="80" x2="${w * 0.5}" y2="${h * 0.5}" stroke="#39455a" stroke-width="5"/>
      <line x1="${w * 0.5}" y1="${h * 0.62}" x2="${w * 0.5}" y2="${h - 80}" stroke="#39455a" stroke-width="5"/>
      <line x1="80" y1="${h * 0.5}" x2="${w * 0.3}" y2="${h * 0.5}" stroke="#39455a" stroke-width="5"/>
      ${grid}`,
  };
  const body = (maps[kind] || maps.grid)();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <pattern id="snowtex" width="120" height="120" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="30" r="2" fill="#fff" opacity="0.08"/><circle cx="80" cy="70" r="1.5" fill="#fff" opacity="0.06"/>
      <circle cx="50" cy="100" r="2.5" fill="#fff" opacity="0.07"/>
    </pattern>
  </defs>
  ${body}
</svg>`;
}

function vehicles(w, h) {
  let out = '';
  const cols = [w / 2 - 165, w / 2 - 55, w / 2 + 55, w / 2 + 165];
  const rng = seededRng('veh');
  for (let i = 0; i < 16; i++) {
    const x = cols[i % 4] - 18;
    const y = 40 + Math.floor(i / 4) * 190 + rng() * 40;
    const c = ['#3a4250', '#503a3a', '#3a503f', '#4a4a3a'][Math.floor(rng() * 4)];
    out += `<g transform="translate(${x} ${y})"><rect width="36" height="70" rx="8" fill="${c}" stroke="#15181d" stroke-width="2"/><rect x="5" y="12" width="26" height="20" rx="3" fill="#0e1116" opacity="0.7"/><rect x="5" y="40" width="26" height="18" rx="3" fill="#0e1116" opacity="0.5"/></g>`;
  }
  return out;
}

function gridLines(w, h, cell, color) {
  let lines = `<g stroke="${color}" stroke-width="1">`;
  for (let x = cell; x < w; x += cell) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`;
  for (let y = cell; y < h; y += cell) lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`;
  return lines + '</g>';
}

// XRPG brand logo (the d20-ish hex mark).
export function brandLogoSvg(size = 28) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-2)"/>
  </linearGradient></defs>
  <path d="M24 3l18 10v22L24 45 6 35V13z" fill="none" stroke="url(#lg)" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M24 3v42M6 13l18 10 18-10M24 23L6 35M24 23l18 12" stroke="url(#lg)" stroke-width="1.5" opacity="0.6" fill="none"/>
  <circle cx="24" cy="23" r="4.5" fill="var(--accent)"/>
</svg>`;
}

// App window icon (1024 base) — exported by build script.
export function appIconSvg(size = 256) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#141a24"/><stop offset="100%" stop-color="#0a0d12"/></linearGradient>
    <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff5a4d"/><stop offset="100%" stop-color="#d8392c"/></linearGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#bg)"/>
  <path d="M128 36l78 44v96l-78 44-78-44V80z" fill="none" stroke="url(#mk)" stroke-width="9" stroke-linejoin="round"/>
  <path d="M128 36v184M50 80l78 44 78-44M128 124L50 176M128 124l78 52" stroke="url(#mk)" stroke-width="5" opacity="0.55" fill="none"/>
  <circle cx="128" cy="124" r="16" fill="#ff5a4d"/>
</svg>`;
}

// Clock dial (Blades-style segmented progress clock).
export function clockDialSvg(filled, size, color, px = 46) {
  const cx = 24, cy = 24, r = 20;
  const segs = [];
  const step = (Math.PI * 2) / size;
  const start = -Math.PI / 2;
  for (let i = 0; i < size; i++) {
    const a0 = start + i * step;
    const a1 = start + (i + 1) * step;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = step > Math.PI ? 1 : 0;
    const fillSeg = i < filled;
    segs.push(`<path d="M${cx} ${cy} L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${fillSeg ? color : 'transparent'}" stroke="${color}" stroke-width="1.2" opacity="${fillSeg ? 0.92 : 0.35}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${px}" height="${px}"><circle cx="24" cy="24" r="20" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5"/>${segs.join('')}</svg>`;
}

// ---- helpers ----
export function svgToDataUrl(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
export function svgToBase64(svg) { return btoa(unescape(encodeURIComponent(svg))); }

function escapeXml(s) { return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }

export function shade(hex, amt) {
  try {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const num = parseInt(c, 16);
    let r = (num >> 16) + amt, g = ((num >> 8) & 0xff) + amt, b = (num & 0xff) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  } catch { return hex; }
}

export function readableInk(hex) {
  try {
    let c = hex.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const num = parseInt(c, 16);
    const r = num >> 16, g = (num >> 8) & 0xff, b = num & 0xff;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.58 ? '#0b0e13' : '#ffffff';
  } catch { return '#fff'; }
}

export const TOKEN_COLORS = {
  pc: '#5bd0a0', npc: '#c9a0ff', threat: '#ff7a6b', neutral: '#6f93b0',
  ally: '#7fd1d6', object: '#c0986f', boss: '#ff5a4d',
};
