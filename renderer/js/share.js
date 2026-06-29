// Export / import / share. Single docs and dependency "bundles" (e.g. a storyline
// packed with its system + NPCs). Imported content always lands as an editable
// COPY: fresh ids, _seed:false, internal references remapped to the new ids.
import { deepClone, uid } from './util.js';
import { toast } from './ui.js';
import store from './store.js';

function stripMeta(doc) {
  const d = deepClone(doc);
  delete d._seed; delete d._sig; delete d.createdAt; delete d.updatedAt;
  return d;
}

function newId(coll, doc) {
  if (coll === 'characters') return uid(doc && doc.kind === 'npc' ? 'npc' : 'pc');
  return uid({ rulesets: 'sys', storylines: 'story', scenes: 'scene', campaigns: 'camp' }[coll] || coll.slice(0, 3));
}

// Remap known reference fields after ids change, using old→new id map.
function remapRefs(coll, doc, map) {
  const m = (id) => (id && map[id]) || id;
  if (coll === 'storylines') {
    doc.systemId = m(doc.systemId);
    if (Array.isArray(doc.npcs)) doc.npcs = doc.npcs.map(m);
    (doc.factions || []).forEach((f) => { if (f.leaderRef) f.leaderRef = m(f.leaderRef); });
  }
  if (coll === 'characters') doc.systemId = m(doc.systemId);
  if (coll === 'scenes') {
    doc.campaignId = doc.campaignId && map[doc.campaignId] ? map[doc.campaignId] : null;
    // A token's character link must resolve to an imported character or be cleared —
    // never left pointing at a foreign/dangling id from the exporter's store.
    (doc.tokens || []).forEach((t) => { if (t.charId) t.charId = map[t.charId] || null; });
  }
}

// ---- Export ----
export async function exportDoc(coll, doc) {
  const name = (doc.name || coll).replace(/\s+/g, '-').toLowerCase();
  const p = await window.xrpg.dialog.saveJson(`${name}.${coll}.json`, { kind: 'xrpg-doc', collection: coll, doc: stripMeta(doc) });
  if (p) toast('Exported', { type: 'success' });
  return p;
}

// A self-contained storyline: the storyline + its system + the system's NPCs.
export async function exportStorylineBundle(storyline) {
  const docs = [];
  const sys = storyline.systemId && store.get('rulesets', storyline.systemId);
  if (sys) docs.push({ collection: 'rulesets', doc: stripMeta(sys) });
  docs.push({ collection: 'storylines', doc: stripMeta(storyline) });
  store.where('characters', (c) => c.systemId === storyline.systemId && c.kind === 'npc').forEach((c) => docs.push({ collection: 'characters', doc: stripMeta(c) }));
  const p = await window.xrpg.dialog.saveJson(`${(storyline.name || 'storyline').replace(/\s+/g, '-').toLowerCase()}.bundle.json`, { kind: 'xrpg-bundle', label: storyline.name, docs });
  if (p) toast(`Shared bundle exported (${docs.length} items)`, { type: 'success' });
  return p;
}

// A system + all its characters.
export async function exportSystemBundle(system) {
  const docs = [{ collection: 'rulesets', doc: stripMeta(system) }];
  store.where('characters', (c) => c.systemId === system.id).forEach((c) => docs.push({ collection: 'characters', doc: stripMeta(c) }));
  const p = await window.xrpg.dialog.saveJson(`${(system.name || 'system').replace(/\s+/g, '-').toLowerCase()}.bundle.json`, { kind: 'xrpg-bundle', label: system.name, docs });
  if (p) toast(`Shared bundle exported (${docs.length} items)`, { type: 'success' });
  return p;
}

// ---- Import ----
// Accepts xrpg-bundle, xrpg-doc, or a bare {collection,docs} seed file. Returns
// the created docs ([{collection,id,name}]) or null.
export async function importShared(data) {
  let docs = null;
  if (!data) return null;
  if (data.kind === 'xrpg-bundle' && Array.isArray(data.docs)) docs = data.docs.map((d) => ({ collection: d.collection, doc: d.doc }));
  else if (data.kind === 'xrpg-doc' && data.doc) docs = [{ collection: data.collection, doc: data.doc }];
  else if (Array.isArray(data.docs) && data.collection) docs = data.docs.map((d) => ({ collection: data.collection, doc: d }));
  if (!docs || !docs.length) { toast('Not a valid XRPG export', { type: 'error' }); return null; }

  const valid = ['rulesets', 'storylines', 'characters', 'scenes'];
  docs = docs.filter((d) => valid.includes(d.collection) && d.doc && d.doc.id);
  if (!docs.length) { toast('Nothing importable in that file', { type: 'warn' }); return null; }

  const map = {};
  docs.forEach((d) => { map[d.doc.id] = newId(d.collection, d.doc); });
  const created = [];
  for (const d of docs) {
    const copy = stripMeta(d.doc);
    copy.id = map[d.doc.id];
    copy._seed = false;
    remapRefs(d.collection, copy, map);
    await store.save(d.collection, copy);
    created.push({ collection: d.collection, id: copy.id, name: copy.name });
  }
  toast(`Imported ${created.length} item${created.length > 1 ? 's' : ''}`, { type: 'success' });
  return created;
}

// Open a file picker and import.
export async function importFromFile() {
  const data = await window.xrpg.dialog.openJson();
  if (!data) return null;
  return importShared(data);
}
