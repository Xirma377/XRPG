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

export function applyTheme(system) {
  const t = { ...DEFAULT, ...(system && system.theme ? system.theme : {}) };
  const root = document.documentElement.style;
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-2', t.accent2 || t.accent);
  root.setProperty('--cool', t.cool || DEFAULT.cool);
  root.setProperty('--accent-ink', t.accentInk || readableInk(t.accent));
  root.setProperty('--font-display', `'${t.displayFont || 'Oswald'}', var(--font-ui)`);
  root.setProperty('--font-title', `'${t.titleFont || t.displayFont || 'Oswald'}', var(--font-ui)`);
  root.setProperty('--font-mono', `'${t.monoFont || 'Share Tech Mono'}', ui-monospace, monospace`);
  document.body.dataset.mood = t.mood || 'neutral';
}

export function resetTheme() { applyTheme(null); }
