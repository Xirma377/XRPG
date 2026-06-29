// Wire a soundboard element (a .cue-pad or a button) to toggle a one-shot SFX:
// click plays it (and the element turns green via the `.playing` class), click again
// stops it, and it auto-resets when the sound ends. Pushes its listeners to unsubArr
// so the host view tears them down on re-entry.
import audio from './audio-engine.js';

export function wireSfxToggle(node, key, play, unsubArr) {
  node.addEventListener('click', () => {
    const existing = audio.activeShotFor(key);
    if (existing) audio.stopShot(existing);
    else play();
  });
  const update = () => node.classList.toggle('playing', !!audio.activeShotFor(key));
  const off1 = audio.on('shotstart', update);
  const off2 = audio.on('shotend', update);
  update();
  if (unsubArr) { unsubArr.push(off1, off2); }
}

export default { wireSfxToggle };
