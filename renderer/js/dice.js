// Dice engine: notation parsing, rolling, and system-aware resolution.
import { Emitter } from './util.js';

export function rollDie(sides) { return 1 + Math.floor(Math.random() * sides); }

// Parse simple dice notation like "3d6", "2d6+2", "1d20-1", "4d6kh3".
export function parseNotation(str) {
  const m = String(str).trim().match(/^(\d+)d(\d+)(?:(kh|kl)(\d+))?\s*([+-]\s*\d+)?$/i);
  if (!m) return null;
  return {
    count: parseInt(m[1], 10),
    sides: parseInt(m[2], 10),
    keep: m[3] ? { mode: m[3].toLowerCase(), n: parseInt(m[4], 10) } : null,
    mod: m[5] ? parseInt(m[5].replace(/\s/g, ''), 10) : 0,
  };
}

export function rollNotation(str) {
  const p = parseNotation(str);
  if (!p) return null;
  let dice = [];
  for (let i = 0; i < p.count; i++) dice.push(rollDie(p.sides));
  let kept = dice.slice();
  if (p.keep) {
    const sorted = dice.slice().sort((a, b) => b - a);
    kept = p.keep.mode === 'kh' ? sorted.slice(0, p.keep.n) : sorted.slice(-p.keep.n);
  }
  const sum = kept.reduce((a, b) => a + b, 0) + p.mod;
  return { notation: str, dice, kept, mod: p.mod, total: sum };
}

// Resolve a check against a game system's dice config.
// system.dice.resolution: 'roll-under' | 'roll-high' | 'pbta' | 'pool' | 'flat'
export function resolveCheck(system, opts = {}) {
  const cfg = (system && system.dice) || {};
  const res = cfg.resolution || 'flat';

  if (res === 'roll-under') {
    // 3d6 (or configured) ≤ target. opts.target = attribute + ease.
    const notation = cfg.notation || '3d6';
    const r = rollNotation(notation) || { dice: [], total: 0 };
    const target = Number(opts.target || 0);
    const total = r.total;
    const success = total <= target;
    const margin = target - total; // positive = succeeded by this much
    const crit = cfg.crit || {};
    const isCritSuccess = (crit.success || []).includes(total);
    const isCritFail = (crit.failure || []).includes(total);
    const clean = cfg.cleanHit && success && margin >= (cfg.cleanHit.by || 5);
    return {
      kind: 'roll-under', notation, dice: r.dice, total, target,
      success, margin, critSuccess: isCritSuccess, critFail: isCritFail,
      cleanHit: !!clean, cleanHitEffect: clean ? cfg.cleanHit.effect : null,
      summary: `${total} vs ${target}`,
    };
  }

  if (res === 'roll-high') {
    // d20 + mod ≥ DC.
    const notation = cfg.notation || '1d20';
    const r = rollNotation(notation) || { dice: [], total: 0 };
    const mod = Number(opts.mod || 0);
    const dc = Number(opts.target || opts.dc || 10);
    const total = r.total + mod;
    const natural = r.dice[0] || 0;
    const crit = cfg.crit || { success: [20], failure: [1] };
    return {
      kind: 'roll-high', notation, dice: r.dice, mod, total, target: dc,
      success: total >= dc, margin: total - dc, natural,
      critSuccess: (crit.success || [20]).includes(natural),
      critFail: (crit.failure || [1]).includes(natural),
      summary: `${total} vs DC ${dc}`,
    };
  }

  if (res === 'pbta') {
    // 2d6 + stat: 10+ strong, 7-9 mixed, 6- miss.
    const r = rollNotation(cfg.notation || '2d6') || { dice: [], total: 0 };
    const stat = Number(opts.mod || 0);
    const total = r.total + stat;
    let band = total >= 10 ? 'strong' : total >= 7 ? 'weak' : 'miss';
    return {
      kind: 'pbta', notation: cfg.notation || '2d6', dice: r.dice, mod: stat, total,
      band, success: band !== 'miss', summary: `${total} (${band})`,
    };
  }

  if (res === 'percentile') {
    // Call of Cthulhu: roll d100 ≤ skill, with hard (≤half) and extreme (≤fifth) levels.
    const roll = rollDie(100);
    const skill = Math.max(0, Number(opts.target != null ? opts.target : 50));
    const hard = Math.floor(skill / 2);
    const extreme = Math.floor(skill / 5);
    let level;
    const fumble = roll === 100 || (skill < 50 && roll >= 96);
    if (roll === 1) level = 'critical';
    else if (roll <= extreme) level = 'extreme';
    else if (roll <= hard) level = 'hard';
    else if (roll <= skill) level = 'regular';
    else level = fumble ? 'fumble' : 'fail';
    const success = roll <= skill && roll !== 100;
    const labels = { critical: 'Critical', extreme: 'Extreme', hard: 'Hard', regular: 'Success', fail: 'Failure', fumble: 'Fumble' };
    return {
      kind: 'percentile', notation: '1d100', dice: [roll], total: roll, target: skill,
      success, level, critSuccess: roll === 1, critFail: fumble,
      summary: `${roll} vs ${skill} — ${labels[level]}`,
    };
  }

  if (res === 'degrees') {
    // Pathfinder 2e: d20 + mod vs DC. Crit success ≥ DC+10, crit fail ≤ DC−10.
    // Nat 20 shifts the degree up one step, nat 1 shifts down one step.
    const notation = cfg.notation || '1d20';
    const r = rollNotation(notation) || { dice: [0], total: 0 };
    const mod = Number(opts.mod || 0);
    const dc = Number(opts.target || opts.dc || 10);
    const total = r.total + mod;
    const natural = r.dice[0] || 0;
    let step; // 0 crit-fail, 1 fail, 2 success, 3 crit-success
    if (total >= dc + 10) step = 3;
    else if (total >= dc) step = 2;
    else if (total <= dc - 10) step = 0;
    else step = 1;
    if (natural === 20) step = Math.min(3, step + 1);
    else if (natural === 1) step = Math.max(0, step - 1);
    const degrees = ['critical-failure', 'failure', 'success', 'critical-success'];
    const degree = degrees[step];
    const labels = { 'critical-success': 'Critical Success', success: 'Success', failure: 'Failure', 'critical-failure': 'Critical Failure' };
    return {
      kind: 'degrees', notation, dice: r.dice, mod, total, target: dc, natural,
      degree, success: step >= 2, critSuccess: step === 3, critFail: step === 0,
      summary: `${total} vs DC ${dc} — ${labels[degree]}`,
    };
  }

  if (res === 'pool') {
    // Dice pool: count successes >= threshold.
    const count = Number(opts.count || 1);
    const sides = cfg.poolSides || 6;
    const threshold = cfg.poolThreshold || (opts.threshold || 6);
    const dice = [];
    for (let i = 0; i < count; i++) dice.push(rollDie(sides));
    const successes = dice.filter((d) => d >= threshold).length;
    return { kind: 'pool', dice, successes, success: successes > 0, summary: `${successes} success${successes === 1 ? '' : 'es'}` };
  }

  // flat: just roll notation
  const r = rollNotation(cfg.notation || '1d20') || { dice: [], total: 0 };
  return { kind: 'flat', dice: r.dice, total: r.total, summary: String(r.total) };
}

// Probability of rolling <= target on the system's roll-under dice (Monte-Carlo-free for 3d6).
export function rollUnderProbability(notation, target) {
  const p = parseNotation(notation);
  if (!p) return null;
  // Keep-highest/keep-lowest changes the distribution; this exact DP only models
  // summing all dice, so don't report a misleading exact value for kh/kl.
  if (p.keep) return null;
  // exact distribution via dynamic programming
  let dist = { 0: 1 };
  for (let d = 0; d < p.count; d++) {
    const next = {};
    for (const [s, c] of Object.entries(dist)) {
      for (let face = 1; face <= p.sides; face++) {
        const k = Number(s) + face;
        next[k] = (next[k] || 0) + c;
      }
    }
    dist = next;
  }
  const totalCombos = Math.pow(p.sides, p.count);
  let le = 0;
  for (const [s, c] of Object.entries(dist)) if (Number(s) + p.mod <= target) le += c;
  return le / totalCombos;
}

export const diceLog = new Emitter();
const history = [];
export function logRoll(entry) {
  const e = { ...entry, at: Date.now() };
  history.unshift(e);
  if (history.length > 200) history.pop();
  diceLog.emit('roll', e);
  return e;
}
export function getHistory() { return history.slice(); }
export function clearHistory() { history.length = 0; diceLog.emit('clear'); }
