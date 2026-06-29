// Applies a game system's theme (accent palette + display font) onto CSS vars.
// The neutral-dark base remains; only accent/cool/fonts/mood re-skin.

const DEFAULT = {
  accent: '#4ea3ff', accent2: '#2b6fd6', cool: '#7fd1d6',
  displayFont: 'Oswald', titleFont: 'Oswald', monoFont: 'Share Tech Mono',
  mood: 'neutral', accentInk: '#04101f',
};

function readableInk(hex) {
  try {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#0b0e13' : '#ffffff';
  } catch { return '#ffffff'; }
}

// WCAG-accurate ink for the PRIMARY-BUTTON fill, which is a DEEPENED accent
// (color-mix accent ~66%, #0a0e13). Choosing ink by the raw accent's luminance
// lands neon (red) and mid-luminance (cyan/blue) accents on a sub-AA combo, so
// compute the real contrast of light vs dark ink against the deepened fill and
// take the winner. Kept separate from --accent-ink (which serves raw-accent
// surfaces like solid badges / mixer transport).
function _lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function _lum(hex) { const c = hex.replace('#', ''); return 0.2126 * _lin(parseInt(c.slice(0, 2), 16)) + 0.7152 * _lin(parseInt(c.slice(2, 4), 16)) + 0.0722 * _lin(parseInt(c.slice(4, 6), 16)); }
function _contrast(a, b) { const la = _lum(a), lb = _lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function _mix(a, b, t) {
  const pa = a.replace('#', ''), pb = b.replace('#', '');
  const m = (i) => Math.round(parseInt(pa.slice(i, i + 2), 16) * t + parseInt(pb.slice(i, i + 2), 16) * (1 - t));
  return '#' + [m(0), m(2), m(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function buttonInk(accent) {
  try {
    const fill = _mix(accent, '#0a0e13', 0.66);
    return _contrast('#ffffff', fill) >= _contrast('#0b0e13', fill) ? '#ffffff' : '#0b0e13';
  } catch { return '#ffffff'; }
}

export function applyTheme(system) {
  const t = { ...DEFAULT, ...(system && system.theme ? system.theme : {}) };
  const root = document.documentElement.style;
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-2', t.accent2 || t.accent);
  root.setProperty('--cool', t.cool || DEFAULT.cool);
  root.setProperty('--accent-ink', t.accentInk || readableInk(t.accent));
  root.setProperty('--btn-ink', buttonInk(t.accent));
  root.setProperty('--font-display', `'${t.displayFont || 'Oswald'}', var(--font-ui)`);
  root.setProperty('--font-title', `'${t.titleFont || t.displayFont || 'Oswald'}', var(--font-ui)`);
  root.setProperty('--font-mono', `'${t.monoFont || 'Share Tech Mono'}', ui-monospace, monospace`);
  document.body.dataset.mood = t.mood || 'neutral';
}

export function resetTheme() { applyTheme(null); }
