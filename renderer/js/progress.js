// Inventory + reward/stat tracking mutations with logging.
// Functions mutate the character object; the caller persists it.
import { uid } from './util.js';

export function rewardStatOf(system) {
  if (system && system.rewardStat && system.rewardStat.key) return system.rewardStat;
  return { key: 'xp', name: 'XP', perSession: null };
}

function ensure(char) {
  if (!Array.isArray(char.inventory)) char.inventory = [];
  if (!Array.isArray(char.inventoryLog)) char.inventoryLog = [];
  if (!char.rewards || typeof char.rewards !== 'object') char.rewards = {};
  if (!Array.isArray(char.rewardLog)) char.rewardLog = [];
  if (!Array.isArray(char.customFields)) char.customFields = [];
}

function logInv(char, action, item, qty, note, sessionId) {
  char.inventoryLog.push({ at: Date.now(), action, item, qty, note: note || '', sessionId: sessionId || null });
  if (char.inventoryLog.length > 500) char.inventoryLog.shift();
}

export function addItem(char, spec) {
  ensure(char);
  const item = {
    id: 'itm_' + uid('').slice(0, 6),
    name: spec.name || 'Item', qty: spec.qty != null ? spec.qty : 1,
    type: spec.type || 'gear', equipped: !!spec.equipped, notes: spec.notes || '',
    weight: spec.weight || '', value: spec.value || '',
  };
  char.inventory.push(item);
  logInv(char, 'add', item.name, item.qty, spec.note, spec.sessionId);
  return item;
}

export function updateItem(char, id, patch) {
  ensure(char);
  const it = char.inventory.find((x) => x.id === id);
  if (it) Object.assign(it, patch);
  return it;
}

export function useItem(char, id, qty = 1, note, sessionId) {
  ensure(char);
  const it = char.inventory.find((x) => x.id === id);
  if (!it) return;
  it.qty = Math.max(0, (it.qty || 0) - qty);
  logInv(char, 'use', it.name, qty, note, sessionId);
  if (it.qty === 0 && it.type === 'consumable') {
    char.inventory = char.inventory.filter((x) => x.id !== id);
  }
}

export function loseItem(char, id, note, sessionId) {
  ensure(char);
  const it = char.inventory.find((x) => x.id === id);
  if (!it) return;
  logInv(char, 'lose', it.name, it.qty, note, sessionId);
  char.inventory = char.inventory.filter((x) => x.id !== id);
}

export function removeItem(char, id) {
  ensure(char);
  char.inventory = char.inventory.filter((x) => x.id !== id);
}

export function adjustReward(char, key, delta, reason, sessionId) {
  ensure(char);
  const before = char.rewards[key] || 0;
  let after = before + delta;
  if (after < 0) after = 0;
  const applied = after - before; // log the actual change after clamping
  char.rewards[key] = after;
  char.rewardLog.push({ at: Date.now(), currency: key, delta: applied, reason: reason || '', sessionId: sessionId || null });
  if (char.rewardLog.length > 500) char.rewardLog.shift();
  return char.rewards[key];
}

export function ensureProgress(char) { ensure(char); return char; }
