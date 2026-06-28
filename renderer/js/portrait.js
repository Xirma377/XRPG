// Shared portrait rendering: uploaded image (media) or generated SVG avatar.
import { el } from './util.js';
import { portraitSvg } from './assets.js';
import store from './store.js';

export function portraitNode(character, size = 52, opts = {}) {
  const d = el('div.portrait-node', { style: { width: size + 'px', height: size + 'px', borderRadius: (opts.round ? '50%' : 'var(--r-2)'), overflow: 'hidden', flex: 'none', background: 'var(--bg-3)' } });
  if (character && character.portrait) {
    const img = el('img', { src: store.mediaUrl('portraits', character.portrait), style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } });
    d.appendChild(img);
  } else {
    d.innerHTML = portraitSvg((character && (character.portraitSeed || character.id)) || 'x', {
      kind: character && character.kind,
      threat: character && character.threat,
    });
  }
  return d;
}
