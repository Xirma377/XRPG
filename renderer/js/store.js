// Renderer-side data client: caches collections, emits change events,
// and exposes high-level helpers. Talks to main via window.xrpg.store.

import { Emitter } from './util.js';

const X = window.xrpg;

class Store extends Emitter {
  constructor() {
    super();
    this.cache = new Map();   // coll -> Map(id -> doc)
    this.loaded = new Set();
    // Cross-window live sync: another window changed a doc -> refresh our cache.
    if (X.store.onChanged) X.store.onChanged((p) => this._external(p));
  }

  async _external({ coll, id, removed }) {
    if (!this.loaded.has(coll)) return;
    if (removed) {
      const m = this.cache.get(coll); if (m) m.delete(id);
      this.emit('change:' + coll, null, id); this.emit('change', coll, null, id);
    } else {
      const doc = await X.store.get(coll, id);
      if (doc) {
        if (!this.cache.has(coll)) this.cache.set(coll, new Map());
        const existing = this.cache.get(coll).get(id);
        // Merge into the existing object so live references (e.g. native editors) stay valid.
        if (existing && existing !== doc) { Object.keys(existing).forEach((k) => { if (!(k in doc)) delete existing[k]; }); Object.assign(existing, doc); }
        else this.cache.get(coll).set(id, doc);
        const out = this.cache.get(coll).get(id);
        this.emit('change:' + coll, out); this.emit('change', coll, out);
      }
    }
  }

  async load(coll) {
    const docs = await X.store.list(coll);
    const m = new Map();
    for (const d of docs) m.set(d.id, d);
    this.cache.set(coll, m);
    this.loaded.add(coll);
    return this.all(coll);
  }

  async ensure(coll) {
    if (!this.loaded.has(coll)) await this.load(coll);
    return this.all(coll);
  }

  async loadAll() {
    const colls = ['rulesets', 'storylines', 'campaigns', 'sessions', 'characters',
      'players', 'groups', 'scenes', 'mixerpresets', 'soundboards', 'generations', 'notes'];
    await Promise.all(colls.map((c) => this.load(c)));
  }

  all(coll) {
    const m = this.cache.get(coll);
    return m ? Array.from(m.values()) : [];
  }

  get(coll, id) {
    const m = this.cache.get(coll);
    return m ? m.get(id) || null : null;
  }

  // synchronous filtered query against cache
  where(coll, pred) { return this.all(coll).filter(pred); }

  async save(coll, doc) {
    const saved = await X.store.put(coll, doc);
    if (!this.cache.has(coll)) this.cache.set(coll, new Map());
    this.cache.get(coll).set(saved.id, saved);
    this.emit('change:' + coll, saved);
    this.emit('change', coll, saved);
    return saved;
  }

  async remove(coll, id) {
    await X.store.remove(coll, id);
    const m = this.cache.get(coll);
    if (m) m.delete(id);
    this.emit('change:' + coll, null, id);
    this.emit('change', coll, null, id);
    return true;
  }

  // ---- media ----
  async saveMediaBase64(kind, filename, base64) { return X.media.saveBase64(kind, filename, base64); }
  async importMedia(kind, filters) { return X.media.importFile(kind, filters); }
  async deleteMedia(kind, id) { return X.media.delete(kind, id); }
  mediaUrl(kind, id) { return id ? `xrpg://media/${kind}/${id}` : null; }

  // ---- settings & secrets ----
  async getSettings() { return X.settings.get(); }
  async setSettings(obj) { const s = await X.settings.set(obj); this.emit('settings', s); return s; }
  async hasSecret(key) { return X.secret.has(key); }
  async setSecret(key, value) { return X.secret.set(key, value); }

  // ---- export / import ----
  async exportAll() { return X.store.exportAll(); }
  async importAll(dump, opts) { const r = await X.store.importAll(dump, opts); await this.loadAll(); this.emit('change'); return r; }
}

export const store = new Store();
export default store;
