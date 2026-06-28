// Shared combat/encounter state (singleton), persisted to settings so it
// survives navigation and restarts. Used by the Combat view and Session Runner.
import { Emitter, uid, deepClone, debounce } from './util.js';
import store from './store.js';
import { resolveCheck } from './dice.js';
import { allDeriveds } from './rules.js';

class Encounter extends Emitter {
  constructor() {
    super();
    this.state = { round: 1, mode: 'phase', phase: null, turnIndex: -1, combatants: [], clocks: [] };
    this._save = debounce(() => store.setSettings({ encounter: this.state }), 400);
  }

  async load() {
    const s = await store.getSettings();
    if (s && s.encounter) this.state = s.encounter;
    this.emit('change');
  }

  persist() { this._save(); this.emit('change'); }

  setMode(mode) { this.state.mode = mode; this.persist(); }

  addCombatant(c) {
    const cb = {
      id: 'cb_' + uid('').slice(0, 6),
      name: c.name || 'Combatant', kind: c.kind || 'npc', charId: c.charId || null,
      color: c.color || null, ini: c.ini != null ? c.ini : null,
      hp: c.hp || { cur: 10, max: 10 }, resources: c.resources || {},
      conditions: c.conditions || [], tracks: c.tracks || {},
      defense: c.defense || '', notes: c.notes || '', down: false, ...c,
    };
    this.state.combatants.push(cb);
    this.persist();
    return cb;
  }

  addFromCharacter(character, system) {
    const der = allDeriveds(system, character);
    const resources = {};
    let hp = { cur: 10, max: 10 };
    let hpSet = false;
    (system.deriveds || []).forEach((d) => {
      if (d.resource) {
        const max = der[d.key];
        const cur = (character.resources && character.resources[d.key] != null) ? character.resources[d.key] : max;
        if (!hpSet) { hp = { cur, max, key: d.key }; hpSet = true; } // first resource = the HP bar
        resources[d.key] = { cur, max, name: d.abbr || d.name };
      }
    });
    return this.addCombatant({
      name: character.name, kind: character.kind === 'pc' ? 'pc' : (character.threat ? 'threat' : 'npc'),
      charId: character.id, hp, resources, color: character.color || null,
      conditions: (character.conditions || []).slice(), tracks: deepClone(character.tracks || {}),
    });
  }

  update(id, patch) {
    const c = this.state.combatants.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch);
    if (c.hp && c.hp.cur <= 0) c.down = true; else if (c.hp) c.down = false;
    this.persist();
  }

  remove(id) { this.state.combatants = this.state.combatants.filter((c) => c.id !== id); this.persist(); }

  damage(id, amount) {
    const c = this.state.combatants.find((x) => x.id === id);
    if (!c || !c.hp) return;
    c.hp.cur = Math.max(0, Math.min(c.hp.max, c.hp.cur - amount));
    c.down = c.hp.cur <= 0;
    this.persist();
  }

  sortByInit() {
    const order = { fast: 0, slow: 1 };
    this.state.combatants.sort((a, b) => {
      if (this.state.mode === 'numeric') return (b.ini || 0) - (a.ini || 0);
      return (order[a.ini] ?? 2) - (order[b.ini] ?? 2);
    });
    this.persist();
  }

  rollInitiativeAll(system) {
    for (const c of this.state.combatants) {
      if (this.state.mode === 'numeric') {
        const initMod = this._initMod(c, system);
        const r = resolveCheck({ dice: { notation: '1d20', resolution: 'flat' } }, {});
        c.ini = (r.total || 0) + initMod;
      } else {
        // Seize the Moment: Agility (or first attr) check, success = fast
        const char = c.charId ? store.get('characters', c.charId) : null;
        const attrKey = (system.attributes && (system.attributes.find((a) => /agi/i.test(a.key)) || system.attributes[0]) || {}).key;
        let target = 10;
        if (char && attrKey) { const der = allDeriveds(system, char); target = char.attrs[attrKey] != null ? char.attrs[attrKey] : (der[attrKey] || 8); }
        const r = resolveCheck(system, { target });
        c.ini = (r.success) ? 'fast' : 'slow';
      }
    }
    this.sortByInit();
  }

  _initMod(c, system) {
    const char = c.charId ? store.get('characters', c.charId) : null;
    if (!char) return 0;
    const der = allDeriveds(system, char);
    if (der.init != null) return der.init;
    const dexLike = (system.attributes || []).find((a) => /dex|agi/i.test(a.key));
    return dexLike ? (char.attrs[dexLike.key] || 0) : 0;
  }

  nextTurn() {
    const n = this.state.combatants.length;
    if (!n) return;
    let i = this.state.turnIndex;
    i++;
    if (i >= n) { i = 0; this.state.round++; }
    this.state.turnIndex = i;
    this.state.combatants.forEach((c, idx) => (c.active = idx === i));
    this.persist();
  }

  prevTurn() {
    const n = this.state.combatants.length;
    if (!n) return;
    let i = this.state.turnIndex;
    i--;
    if (i < 0) { i = n - 1; this.state.round = Math.max(1, this.state.round - 1); }
    this.state.turnIndex = i;
    this.state.combatants.forEach((c, idx) => (c.active = idx === i));
    this.persist();
  }

  resetTurns() { this.state.turnIndex = -1; this.state.round = 1; this.state.combatants.forEach((c) => (c.active = false)); this.persist(); }

  reset() { this.state = { round: 1, mode: this.state.mode, phase: null, turnIndex: -1, combatants: [], clocks: [] }; this.persist(); }

  // ---- clocks ----
  addClock(name, size, color) { this.state.clocks.push({ id: 'clk_' + uid('').slice(0, 6), name: name || 'Clock', size: size || 6, filled: 0, color: color || null }); this.persist(); }
  tickClock(id, delta) { const c = this.state.clocks.find((x) => x.id === id); if (!c) return; c.filled = Math.max(0, Math.min(c.size, c.filled + delta)); this.persist(); }
  removeClock(id) { this.state.clocks = this.state.clocks.filter((c) => c.id !== id); this.persist(); }
}

export const encounter = new Encounter();
export default encounter;
