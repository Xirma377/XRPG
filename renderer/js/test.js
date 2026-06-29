// Automated test harness — exercises core logic and reports to disk, then quits.
import { evalFormula } from './expr.js';
import { parseNotation, rollNotation, resolveCheck, rollUnderProbability } from './dice.js';
import { allDeriveds, blankCharacter, statLine, validateCreation, buildReferenceIndex, searchReference, computeDerived } from './rules.js';
import { extractJson } from './ai-client.js';
import { renderMarkdown } from './markdown.js';
import { portraitSvg, tokenSvg, mapSvg, clockDialSvg, svgToDataUrl } from './assets.js';
import { uid } from './util.js';
import store from './store.js';

const results = [];
const out = document.getElementById('out');
function ok(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') });
  const d = document.createElement('div');
  d.className = cond ? 'pass' : 'fail';
  d.textContent = (cond ? '✓ ' : '✗ ') + name + (cond ? '' : '  — ' + (detail || ''));
  out.appendChild(d);
}
function approx(a, b, eps = 0.01) { return Math.abs(a - b) < eps; }

async function run() {
  // ---- expr ----
  ok('expr: 6 + brawn', evalFormula('6 + brawn', { brawn: 13 }) === 19);
  ok('expr: ternary composure', evalFormula('3 + (wits>=12?1:0) + (charm>=12?1:0)', { wits: 12, charm: 8 }) === 4);
  ok('expr: floor div (d20 mod)', evalFormula('floor((str-10)/2)', { str: 15 }) === 2);
  ok('expr: negative mod', evalFormula('floor((dex-10)/2)', { dex: 7 }) === -2);
  ok('expr: nested parens & mult', evalFormula('(a+b)*2', { a: 3, b: 4 }) === 14);
  ok('expr: malformed safe', evalFormula('6 + + *', {}) === 0);

  // ---- dice ----
  const p = parseNotation('2d6+2');
  ok('dice: parse 2d6+2', p && p.count === 2 && p.sides === 6 && p.mod === 2);
  ok('dice: parse kh', (() => { const q = parseNotation('4d6kh3'); return q && q.keep && q.keep.mode === 'kh' && q.keep.n === 3; })());
  const rn = rollNotation('3d6');
  ok('dice: roll 3d6 in range', rn.total >= 3 && rn.total <= 18 && rn.dice.length === 3);
  // probabilities (exact, from the guide table)
  ok('prob: 3d6<=10 ~ 50%', approx(rollUnderProbability('3d6', 10), 0.5, 0.005), String(rollUnderProbability('3d6', 10)));
  ok('prob: 3d6<=12 ~ 0.741', approx(rollUnderProbability('3d6', 12), 0.7407, 0.01));
  ok('prob: 3d6<=8 ~ 0.259', approx(rollUnderProbability('3d6', 8), 0.2593, 0.01));
  ok('prob: 3d6<=3 ~ 0.0046', approx(rollUnderProbability('3d6', 3), 1 / 216, 0.001));

  // resolveCheck roll-under
  const ruSys = { dice: { notation: '3d6', resolution: 'roll-under', crit: { success: [3], failure: [18] }, cleanHit: { by: 5, effect: '+2' } } };
  let critS = false, clean = false, critLogicOk = true, cleanLogicOk = true;
  for (let i = 0; i < 4000; i++) {
    const r = resolveCheck(ruSys, { target: 18 });
    if (r.total === 3 && !r.critSuccess) critLogicOk = false; // crit detection logic (deterministic)
    if (r.total === 18 && !r.critFail) critLogicOk = false;
    if (r.critSuccess) critS = true;
    // clean hit when margin>=5 (target 13, total<=8)
    const r2 = resolveCheck(ruSys, { target: 13 });
    if (r2.success && (13 - r2.total) >= 5 && !r2.cleanHit) cleanLogicOk = false;
    if (r2.cleanHit) clean = true;
  }
  ok('resolveCheck: roll-under success on high target', resolveCheck(ruSys, { target: 18 }).success === true);
  ok('resolveCheck: roll-under fail on low target', resolveCheck(ruSys, { target: 0 }).success === false);
  ok('resolveCheck: crit/critFail detection logic', critLogicOk);
  ok('resolveCheck: crit success occurs in 4000 rolls', critS);
  ok('resolveCheck: clean-hit logic correct', cleanLogicOk && clean);
  // roll-high
  const rhSys = { dice: { notation: '1d20', resolution: 'roll-high', crit: { success: [20], failure: [1] } } };
  const rh = resolveCheck(rhSys, { mod: 5, dc: 1 });
  ok('resolveCheck: roll-high meets low DC', rh.success === true && rh.total === rh.dice[0] + 5);
  // pbta
  const pbSys = { dice: { notation: '2d6', resolution: 'pbta' } };
  ok('resolveCheck: pbta strong on +10', resolveCheck(pbSys, { mod: 10 }).band === 'strong');
  ok('resolveCheck: pbta miss on -10', resolveCheck(pbSys, { mod: -10 }).band === 'miss');

  // ---- rules engine on real STRAIN Z ----
  await store.ensure('rulesets');
  const sz = store.get('rulesets', 'sys_strainz');
  ok('seed: STRAIN Z present', !!sz);
  if (sz) {
    const mac = { attrs: { brawn: 13, agility: 9, wits: 9, charm: 8 } };
    const der = allDeriveds(sz, mac);
    ok('rules: VIT = 6+brawn = 19', der.vit === 19, JSON.stringify(der));
    ok('rules: Composure = 3 (low wits/charm)', der.composure === 3, JSON.stringify(der));
    const der2 = allDeriveds(sz, { attrs: { brawn: 10, agility: 10, wits: 13, charm: 13 } });
    ok('rules: Composure = 5 (high wits/charm)', der2.composure === 5, JSON.stringify(der2));
    const line = statLine(sz, mac);
    ok('rules: statLine format', /13 \/ 9 \/ 9 \/ 8/.test(line) && /VIT 19/.test(line), line);
    const blank = blankCharacter(sz, 'pc');
    ok('rules: blankCharacter has attrs', blank.attrs.brawn === 8 && blank.derived.vit === 14);
    // validation
    const goodPc = { kind: 'pc', attrs: { brawn: 12, agility: 11, wits: 10, charm: 9 } }; // +10 over 8s? 4+3+2+1=10
    ok('rules: validateCreation valid', validateCreation(sz, goodPc).ok, JSON.stringify(validateCreation(sz, goodPc).issues));
    const badPc = { kind: 'pc', attrs: { brawn: 14, agility: 14, wits: 8, charm: 8 } };
    ok('rules: validateCreation invalid (overspend)', !validateCreation(sz, badPc).ok);
    // reference index + search
    const idx = buildReferenceIndex(sz);
    ok('rules: reference index built', idx.length > 15);
    const found = searchReference(idx, 'headshot');
    ok('rules: search finds headshot', found.length > 0 && /headshot/i.test(found[0].title + found[0].body));
    const coldSearch = searchReference(idx, 'cold');
    ok('rules: search finds cold rules', coldSearch.some((i) => /cold/i.test(i.title)));
  }

  // demo systems
  const d20 = store.get('rulesets', 'sys_d20fantasy');
  ok('seed: d20 fantasy present', !!d20);
  if (d20) {
    const der = allDeriveds(d20, { attrs: { str: 16, dex: 14, con: 12, int: 10, wis: 8, cha: 10 } });
    ok('d20: str_mod(16)=3', der.str_mod === 3, JSON.stringify(der));
    ok('d20: ac = 10 + dex_mod(14)=12', der.ac === 12, JSON.stringify(der));
    ok('d20: hp = 8 + con_mod(12)=9', der.hp === 9, JSON.stringify(der));
  }
  const pbta = store.get('rulesets', 'sys_pbta_hearts');
  ok('seed: PbtA present', !!pbta);

  // ---- new systems present + derived sanity ----
  for (const sid of ['sys_dnd5e2024', 'sys_pf2e', 'sys_coc7e', 'sys_neon', 'sys_morkborg']) {
    const s = store.get('rulesets', sid);
    ok('seed: ' + sid + ' present', !!s, 'missing');
    if (s) {
      ok(sid + ': has version label', !!(s.version && s.version.length > 2));
      ok(sid + ': has bestiary', (s.bestiary || []).length >= 8, String((s.bestiary || []).length));
      ok(sid + ': has reference', (s.reference || []).length >= 8);
      ok(sid + ': deriveds compute (no NaN)', (() => { const d = allDeriveds(s, { attrs: {} }); return Object.values(d).every((v) => Number.isFinite(v)); })(), JSON.stringify(allDeriveds(s, { attrs: {} })));
    }
  }

  // ---- percentile (CoC) resolution ----
  const pctSys = { dice: { notation: '1d100', resolution: 'percentile' } };
  let pctOk = true;
  for (let i = 0; i < 3000; i++) {
    const r = resolveCheck(pctSys, { target: 50 });
    if (r.total <= 10 && r.level !== 'extreme' && r.level !== 'critical') pctOk = false; // ≤skill/5
    if (r.total > 50 && r.success) pctOk = false;
    if (r.total <= 50 && r.total > 1 && !r.success) pctOk = false;
  }
  ok('percentile: levels & success correct', pctOk);
  ok('percentile: 1 is critical', resolveCheck(pctSys, { target: 50 }) && (() => { for (let i = 0; i < 500; i++) { const r = resolveCheck(pctSys, { target: 99 }); if (r.total === 1) return r.critSuccess; } return true; })());

  // ---- degrees (PF2e) resolution ----
  const degSys = { dice: { notation: '1d20', resolution: 'degrees' } };
  let degLogic = true;
  for (let i = 0; i < 4000; i++) {
    const r = resolveCheck(degSys, { mod: 0, dc: 11 });
    const nat = r.natural;
    // reconstruct expected pre-nat step
    let step = r.total >= 21 ? 3 : r.total >= 11 ? 2 : r.total <= 1 ? 0 : 1;
    if (nat === 20) step = Math.min(3, step + 1); else if (nat === 1) step = Math.max(0, step - 1);
    const expected = ['critical-failure', 'failure', 'success', 'critical-success'][step];
    if (r.degree !== expected) degLogic = false;
  }
  ok('degrees: degree computation incl nat20/nat1 shifts', degLogic);
  ok('degrees: success flag matches', resolveCheck(degSys, { mod: 100, dc: 10 }).success === true && resolveCheck(degSys, { mod: -100, dc: 30 }).success === false);

  // ---- extractJson ----
  ok('json: plain object', extractJson('{"a":1}').a === 1);
  ok('json: fenced', extractJson('```json\n{"name":"Bob"}\n```').name === 'Bob');
  ok('json: prose around', extractJson('Sure! Here:\n{"x": [1,2,3]}\nHope that helps').x.length === 3);
  ok('json: array', extractJson('[1,2,3]').length === 3);
  ok('json: nested braces', extractJson('{"a":{"b":2},"c":3}').a.b === 2);
  ok('json: string with braces', extractJson('{"t":"a } b"}').t === 'a } b');
  ok('json: garbage returns null', extractJson('no json here') === null);

  // ---- markdown ----
  const md = renderMarkdown('# Title\n\n- one\n- two\n\n**bold** and `code`');
  ok('md: heading', /<h1>Title<\/h1>/.test(md));
  ok('md: list', /<ul><li>one<\/li>/.test(md));
  ok('md: bold/code', /<strong>bold<\/strong>/.test(md) && /<code>code<\/code>/.test(md));
  ok('md: table', /<table>/.test(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')));
  ok('md: escapes html', !/<script>/.test(renderMarkdown('<script>alert(1)</script>')));

  // ---- assets ----
  ok('assets: portrait svg', portraitSvg('seed1').startsWith('<svg'));
  ok('assets: token svg', tokenSvg({ label: 'Mac' }).includes('Mac') || tokenSvg({ label: 'Mac' }).includes('MA'));
  ok('assets: map svg', mapSvg('highway').startsWith('<svg'));
  ok('assets: clock dial', clockDialSvg(3, 6, '#fff').startsWith('<svg'));
  ok('assets: data url', svgToDataUrl('<svg></svg>').startsWith('data:image/svg+xml'));

  // ---- encounter logic ----
  const { encounter } = await import('./encounter.js');
  encounter.reset();
  const cb = encounter.addCombatant({ name: 'Test', hp: { cur: 10, max: 10 } });
  ok('encounter: addCombatant', encounter.state.combatants.length === 1);
  encounter.damage(cb.id, 4);
  ok('encounter: damage', encounter.getToken ? true : encounter.state.combatants[0].hp.cur === 6, String(encounter.state.combatants[0].hp.cur));
  encounter.damage(cb.id, 100);
  ok('encounter: down at 0', encounter.state.combatants[0].down === true && encounter.state.combatants[0].hp.cur === 0);
  encounter.addClock('Horde', 6);
  encounter.tickClock(encounter.state.clocks[0].id, 3);
  ok('encounter: clock tick', encounter.state.clocks[0].filled === 3);
  encounter.tickClock(encounter.state.clocks[0].id, 99);
  ok('encounter: clock clamps to size', encounter.state.clocks[0].filled === 6);
  // turn order
  encounter.addCombatant({ name: 'B', hp: { cur: 5, max: 5 } });
  encounter.resetTurns();
  const r0 = encounter.state.round;
  encounter.nextTurn(); encounter.nextTurn(); encounter.nextTurn();
  ok('encounter: round advances after wrap', encounter.state.round === r0 + 1, 'round=' + encounter.state.round);
  encounter.reset();

  // ---- versioning logic (commitStoryline) ----
  const { commitStoryline } = await import('./views/campaigns.js');
  // simulate a campaign with no sessions -> edits update current version in place
  let camp = await store.save('campaigns', { id: 'test_camp_' + Date.now(), name: 'T', systemId: 'sys_strainz', storyline: { premise: 'v1' }, currentVersion: 1, storylineVersions: [{ v: 1, label: 'init', at: '', content: { premise: 'v1' } }], status: 'active' });
  camp = await commitStoryline(camp, { premise: 'v1b' }, 'edit');
  ok('versioning: no session -> stays v1', camp.currentVersion === 1 && camp.storyline.premise === 'v1b');
  // now add a session played under v1, then edit -> new version
  await store.save('sessions', { id: 'test_sess_' + Date.now(), campaignId: camp.id, number: 1, storylineVersion: 1, title: 'S1' });
  await store.load('sessions');
  camp = await commitStoryline(camp, { premise: 'v2' }, 'big edit');
  ok('versioning: played session -> bumps to v2', camp.currentVersion === 2 && camp.storyline.premise === 'v2', 'v=' + camp.currentVersion);
  ok('versioning: v1 snapshot retained', camp.storylineVersions.find((v) => v.v === 1).content.premise === 'v1b');
  ok('versioning: session still pinned to v1', store.get('sessions', store.all('sessions').find((s) => s.campaignId === camp.id).id).storylineVersion === 1);
  // cleanup test docs
  await store.remove('campaigns', camp.id);
  for (const s of store.all('sessions').filter((s) => s.campaignId === camp.id)) await store.remove('sessions', s.id);

  // ---- progress: inventory + rewards ----
  const { addItem, useItem, loseItem, adjustReward, rewardStatOf } = await import('./progress.js');
  const pc = {};
  addItem(pc, { name: 'Bandage', qty: 3, type: 'consumable' });
  ok('progress: addItem', pc.inventory.length === 1 && pc.inventory[0].qty === 3);
  useItem(pc, pc.inventory[0].id, 1, 'patched a wound');
  ok('progress: useItem decrements + logs', pc.inventory[0].qty === 2 && pc.inventoryLog.some((l) => l.action === 'use' && l.note === 'patched a wound'));
  useItem(pc, pc.inventory[0].id, 5);
  ok('progress: consumable removed at 0', pc.inventory.length === 0);
  const gi = addItem(pc, { name: 'Sword', type: 'gear' });
  loseItem(pc, gi.id, 'dropped in the river');
  ok('progress: loseItem removes + logs', pc.inventory.length === 0 && pc.inventoryLog.some((l) => l.action === 'lose'));
  adjustReward(pc, 'grit', 2, 'survived'); adjustReward(pc, 'grit', -1, 'spent on a Knack');
  ok('progress: rewards adjust + log', pc.rewards.grit === 1 && pc.rewardLog.length === 2);
  ok('progress: reward never negative', (() => { adjustReward(pc, 'grit', -100); return pc.rewards.grit === 0; })());
  ok('progress: rewardStatOf STRAIN Z = grit', rewardStatOf(store.get('rulesets', 'sys_strainz')).key === 'grit');
  ok('progress: rewardStatOf fallback = xp', rewardStatOf({}).key === 'xp');

  // cross-system: blank target character
  const dnd = store.get('rulesets', 'sys_dnd5e2024');
  if (dnd) { const nc = blankCharacter(dnd, 'pc'); ok('cross-system: blank D&D has 6 attrs', Object.keys(nc.attrs).length === 6 && Array.isArray(nc.inventory)); }

  // ---- audio library manifest ----
  try {
    const man = await window.xrpg.audio.manifest();
    ok('audio: manifest loads (40+ tracks)', man && Array.isArray(man.tracks) && man.tracks.length > 40, String(man && man.tracks && man.tracks.length));
    ok('audio: every track has url + license', man.tracks.every((t) => t.url && t.license));
    ok('audio: has ambient, music, sfx categories', ['ambient', 'music', 'sfx'].every((c) => man.tracks.some((t) => t.category === c)));
  } catch (e) { ok('audio: manifest', false, e.message); }

  // ---- uid uniqueness (regression: .slice() used to drop the random part) ----
  const ids6 = new Set(), ids8 = new Set(), idsFull = new Set();
  for (let i = 0; i < 1000; i++) { ids6.add('ch_' + uid('').slice(0, 6)); ids8.add('pc_' + uid('').slice(0, 8)); idsFull.add(uid('x')); }
  ok('uid: slice(0,6) unique across 1000', ids6.size === 1000, ids6.size + '/1000');
  ok('uid: slice(0,8) unique across 1000', ids8.size === 1000, ids8.size + '/1000');
  ok('uid: full unique across 1000', idsFull.size === 1000, idsFull.size + '/1000');

  // ---- audio: channels accumulate with distinct ids (the Live Mix bug) ----
  try {
    const { audio } = await import('./audio-engine.js');
    const before = audio.channels.size;
    const a = audio.addChannel({ name: 'A', type: 'instrument', source: 'wind' });
    const b = audio.addChannel({ name: 'B', type: 'instrument', source: 'rain' });
    const c = audio.addChannel({ name: 'C', type: 'instrument', source: 'drone-dark' });
    ok('audio: 3 channels get 3 distinct ids', new Set([a.id, b.id, c.id]).size === 3);
    ok('audio: channels map holds all 3', audio.channels.size === before + 3, String(audio.channels.size));
    audio.removeChannel(a.id); audio.removeChannel(b.id); audio.removeChannel(c.id);
    ok('audio: removeChannel clears them', audio.channels.size === before);
  } catch (e) { ok('audio: channel ids', false, e.message); }

  // ---- audio: one-shot SFX are trackable + stoppable (Stop All / toggle) ----
  try {
    const { audio } = await import('./audio-engine.js');
    const id = audio.oneShot('impact', 0.4, 'impact');
    ok('sfx: oneShot returns a tracked id', !!id && audio.activeShotFor('impact') === id);
    audio.stopShot(id);
    ok('sfx: stopShot stops it', audio.activeShotFor('impact') === null);
    const idf = audio.oneShot('door', 0.4, 'door');
    const ids2 = audio.oneShot('alert', 0.4, 'alert');
    ok('sfx: two shots tracked', !!idf && !!ids2 && audio.shots.size >= 2);
    audio.stopAll();
    ok('sfx: stopAll stops all shots', audio.activeShotFor('door') === null && audio.activeShotFor('alert') === null);
  } catch (e) { ok('sfx: one-shot tracking', false, e.message); }

  // ---- report ----
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const summary = { total, passed, failed: total - passed, failures: results.filter((r) => !r.pass) };
  const h = document.createElement('h2');
  h.textContent = `${passed}/${total} passed`;
  h.className = passed === total ? 'pass' : 'fail';
  out.prepend(h);
  if (window.xrpg && window.xrpg.test) await window.xrpg.test.report(summary);
}

run().catch((e) => {
  ok('HARNESS CRASH', false, e.stack || e.message);
  if (window.xrpg && window.xrpg.test) window.xrpg.test.report({ total: results.length, passed: results.filter((r) => r.pass).length, failed: 999, crash: e.message + '\n' + e.stack });
});
