// Seed (built-in content) protection + hide helpers.
// Seeded docs carry _seed:true and are READ-ONLY in the UI: the user makes an
// editable copy instead (copyToEdit). Hide-state lives in settings (never on the
// seed docs, which stay immutable): a global `builtinsHidden` flag plus a
// per-doc `hiddenIds` list.
import { el, deepClone, uid } from './util.js';
import { button, chip, toast } from './ui.js';
import store from './store.js';
import appState from './state.js';
import router from './router.js';

export function isSeed(doc) { return !!(doc && doc._seed); }

export function isHidden(doc) {
  if (!doc) return false;
  const s = appState.settings || {};
  if (s.builtinsHidden && doc._seed) return true;
  return Array.isArray(s.hiddenIds) && s.hiddenIds.includes(doc.id);
}

// Filter a list down to the docs the user should currently see.
export function visible(list) { return (list || []).filter((d) => !isHidden(d)); }
export function hiddenCount(list) { return (list || []).filter(isHidden).length; }

export async function setBuiltinsHidden(hidden) {
  await appState.updateSettings({ builtinsHidden: !!hidden });
}
export async function hideDoc(id) {
  const ids = new Set(appState.settings.hiddenIds || []); ids.add(id);
  await appState.updateSettings({ hiddenIds: [...ids] });
}
export async function showDoc(id) {
  const ids = (appState.settings.hiddenIds || []).filter((x) => x !== id);
  await appState.updateSettings({ hiddenIds: ids });
}
export async function showAllBuiltins() {
  await appState.updateSettings({ builtinsHidden: false, hiddenIds: [] });
}

const PREFIX = { rulesets: 'sys', storylines: 'story', characters: 'ch', scenes: 'scene', campaigns: 'camp' };

// Make an independent, editable copy of a seeded doc. The copy is _seed:false,
// gets a fresh id (so the original built-in is untouched and keeps updating),
// and is navigated to if a view route is given.
export async function copyToEdit(coll, doc, { navigateView, rename = true, silent = false } = {}) {
  const copy = deepClone(doc);
  copy.id = uid(PREFIX[coll] || coll.slice(0, 3));
  if (rename && copy.name) copy.name = copy.name.replace(/\s*\(Copy\)\s*$/i, '') + ' (Copy)';
  copy._seed = false;
  delete copy.createdAt; delete copy.updatedAt; delete copy._sig;
  await store.save(coll, copy);
  if (!silent) toast('Editable copy created', { type: 'success' });
  if (navigateView) router.go(navigateView, copy.id);
  return copy;
}

// Small "Built-in" indicator chip for cards/headers.
export function builtinChip() { return chip('Built-in', { icon: 'lock' }); }

// A read-only banner shown in place of an editor for a seeded doc.
export function readOnlyBanner(coll, doc, navigateView) {
  const box = el('div.notice', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } });
  box.appendChild(el('div.grow', [
    el('b', 'Built-in content is read-only. '),
    'Make an editable copy to customize it — your copy is independent and is never overwritten when the built-ins update.',
  ]));
  box.appendChild(button('Copy to Edit', { icon: 'copy', variant: 'primary', onClick: () => copyToEdit(coll, doc, { navigateView }) }));
  return box;
}
