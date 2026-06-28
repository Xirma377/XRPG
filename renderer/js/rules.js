// Rules engine: interprets a data-driven game system (ruleset) definition.
import { evalFormula } from './expr.js';
import { resolveCheck } from './dice.js';

// Compute the evaluation context (attribute values) for a character under a system.
export function attrContext(system, character) {
  const ctx = {};
  const attrs = (character && character.attrs) || {};
  for (const a of system.attributes || []) {
    ctx[a.key] = Number(attrs[a.key] != null ? attrs[a.key] : (a.default || 0));
  }
  // also expose current derived values so deriveds can reference each other
  for (const d of system.deriveds || []) {
    ctx[d.key] = computeDerived(system, character, d.key, ctx);
  }
  return ctx;
}

export function computeDerived(system, character, key, baseCtx) {
  const d = (system.deriveds || []).find((x) => x.key === key);
  if (!d) return 0;
  const ctx = baseCtx || (() => {
    const c = {};
    for (const a of system.attributes || []) c[a.key] = Number((character.attrs || {})[a.key] ?? a.default ?? 0);
    return c;
  })();
  let v = evalFormula(d.formula, ctx);
  v = Math.round(v);
  if (d.max != null) v = Math.min(v, d.max);
  if (d.min != null) v = Math.max(v, d.min);
  return v;
}

export function allDeriveds(system, character) {
  const ctx = {};
  for (const a of system.attributes || []) ctx[a.key] = Number((character.attrs || {})[a.key] ?? a.default ?? 0);
  const out = {};
  for (const d of system.deriveds || []) {
    out[d.key] = computeDerived(system, character, d.key, ctx);
    ctx[d.key] = out[d.key];
  }
  return out;
}

// Build a blank character object for a system.
export function blankCharacter(system, kind = 'pc') {
  const attrs = {};
  for (const a of system.attributes || []) attrs[a.key] = a.default ?? 0;
  const c = {
    name: '',
    kind,                       // 'pc' | 'npc'
    systemId: system.id,
    attrs,
    derived: {},
    notes: '',
    background: '',
    knacks: [],
    gear: [],
    tracks: {},                 // key -> stage index
    conditions: [],
    tie: '', fear: '',
    grit: 0,
    portrait: null,             // media id
    portraitSeed: Math.random().toString(36).slice(2),
    tags: [],
    role: kind === 'npc' ? '' : '',
    statBlock: '',              // freeform for quick NPCs
    relationships: [],
    inventory: [], inventoryLog: [],
    rewards: {}, rewardLog: [],
    customFields: [],
  };
  c.derived = allDeriveds(system, c);
  return c;
}

// Format an NPC quick stat line per the system's format string, e.g.
// "Brawn / Agility / Wits / Charm | VIT | Composure".
export function statLine(system, character) {
  const attrVals = (system.attributes || []).map((a) => (character.attrs || {})[a.key] ?? a.default ?? 0);
  const der = allDeriveds(system, character);
  const derVals = (system.deriveds || []).map((d) => `${d.abbr || d.name} ${der[d.key]}`);
  return `${attrVals.join(' / ')}${derVals.length ? ' | ' + derVals.join(' | ') : ''}`;
}

// Validate point-buy for character creation.
export function validateCreation(system, character) {
  const r = system.attributeRules || {};
  const issues = [];
  if (r.pointsToDistribute != null && r.start != null) {
    let spent = 0;
    for (const a of system.attributes || []) {
      const v = Number((character.attrs || {})[a.key] ?? a.default ?? 0);
      spent += (v - r.start);
      if (r.startMax != null && v > r.startMax) issues.push(`${a.name} exceeds starting max (${r.startMax}).`);
      if (r.startMin != null && v < r.startMin) issues.push(`${a.name} below starting min (${r.startMin}).`);
    }
    const budget = r.pointsToDistribute;
    if (spent !== budget) issues.push(`Spent ${spent} of ${budget} points.`);
  }
  return { ok: issues.length === 0, issues };
}

export function check(system, opts) { return resolveCheck(system, opts); }

// Build a flat searchable index of a system's reference content + tables.
export function buildReferenceIndex(system) {
  const items = [];
  for (const r of system.reference || []) {
    items.push({
      id: r.id, title: r.title, category: r.category || 'Reference',
      tags: r.tags || [], body: r.body || '', type: 'article',
    });
  }
  for (const t of system.tables || []) {
    const body = (t.entries || []).map((e, i) => `${i + 1}. ${e}`).join('\n');
    items.push({ id: 'table-' + (t.id || t.name), title: t.name, category: 'Tables', tags: ['table'], body, type: 'table', table: t });
  }
  for (const w of system.weapons || []) {
    items.push({ id: 'weapon-' + (w.name), title: w.name, category: 'Weapons', tags: ['weapon', 'damage'], body: `${w.damage || ''} — ${w.notes || ''}`, type: 'weapon' });
  }
  for (const b of system.bestiary || []) {
    items.push({ id: 'beast-' + b.name, title: b.name, category: 'Bestiary', tags: ['enemy', 'monster'], body: `${b.defense ? 'Defense ' + b.defense + ' · ' : ''}${b.body != null ? 'Body ' + b.body + ' · ' : ''}${b.speed ? 'Speed ' + b.speed : ''}\n${b.notes || ''}`, type: 'bestiary', beast: b });
  }
  return items;
}

export function searchReference(index, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return index;
  const terms = q.split(/\s+/);
  const scored = [];
  for (const item of index) {
    const hay = (item.title + ' ' + item.category + ' ' + (item.tags || []).join(' ') + ' ' + item.body).toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (item.title.toLowerCase().includes(t)) score += 5;
      if ((item.tags || []).some((tag) => tag.toLowerCase().includes(t))) score += 3;
      if (hay.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
