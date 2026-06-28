// Boot-time Discord bridge: answers slash commands using the existing dice/rules
// engine and the player↔character links, then replies to Discord. Roll results are
// re-emitted as a 'roll' event so an open Session Runner can log them.
import discord from './discord.js';
import store from './store.js';
import appState from './state.js';
import { rollNotation, resolveCheck } from './dice.js';
import { allDeriveds, statLine } from './rules.js';

const BRAND = 0xd81a10;

let started = false;
export function initDiscordBridge() {
  if (started) return;
  started = true;
  discord.on('slash', (p) => { handleSlash(p).catch((e) => safeReply(p.requestId, { content: 'Error: ' + e.message })); });
}

function safeReply(requestId, reply) { try { discord.slashReply(requestId, reply); } catch (e) {} }

function charForUser(discordUserId) {
  const player = store.all('players').find((p) => p.discordUserId && p.discordUserId === discordUserId);
  if (!player) return { error: 'Your Discord account isn’t linked to a player yet. Ask the GM to link you in XRPG → Session → Discord.' };
  const sysId = appState.activeSystemId;
  const pcs = store.where('characters', (c) => c.kind === 'pc' && c.playerId === player.id);
  const pc = pcs.find((c) => c.systemId === sysId) || pcs[0];
  if (!pc) return { error: `No character is assigned to ${player.name} yet.`, player };
  const system = store.get('rulesets', pc.systemId);
  if (!system) return { error: `Character’s game system is missing.`, player, pc };
  return { player, pc, system };
}

function findAttr(system, pc, query) {
  const q = String(query || '').trim().toLowerCase();
  const attrs = (system.attributes || []);
  let a = attrs.find((x) => x.key.toLowerCase() === q || (x.name || '').toLowerCase() === q || (x.abbr || '').toLowerCase() === q);
  if (a) return { key: a.key, name: a.name || a.key, value: Number((pc.attrs || {})[a.key] || 0), kind: 'attribute' };
  // try deriveds
  const der = allDeriveds(system, pc);
  const d = (system.deriveds || []).find((x) => x.key.toLowerCase() === q || (x.name || '').toLowerCase() === q || (x.abbr || '').toLowerCase() === q);
  if (d) return { key: d.key, name: d.name || d.key, value: Number(der[d.key] || 0), kind: 'derived' };
  return null;
}

async function handleSlash(p) {
  const cmd = p.command;
  if (cmd === 'roll') {
    const r = rollNotation(p.options.notation);
    if (!r) { safeReply(p.requestId, { content: `\`${p.options.notation}\` isn’t valid dice notation (try 3d6+2 or 1d20).` }); return; }
    const desc = `🎲 **${r.total}**  ·  [${r.dice.join(', ')}]${r.mod ? `  ${r.mod > 0 ? '+' : ''}${r.mod}` : ''}`;
    safeReply(p.requestId, { embed: { title: `${p.username} rolled ${r.notation}`, description: desc, color: BRAND } });
    discord.emit('roll', { label: `/roll ${r.notation}`, total: r.total, success: null, text: `${p.username} rolled ${r.notation}: ${r.dice.join(', ')}${r.mod ? (r.mod > 0 ? '+' : '') + r.mod : ''} = ${r.total}`, by: p.username });
    return;
  }

  if (cmd === 'check') {
    const ctx = charForUser(p.discordUserId);
    if (ctx.error) { safeReply(p.requestId, { content: ctx.error }); return; }
    const ease = Number(p.options.ease || 0);
    const attr = findAttr(ctx.system, ctx.pc, p.options.attribute);
    if (!attr) { safeReply(p.requestId, { content: `“${p.options.attribute}” isn’t an attribute or stat in ${ctx.system.name}.` }); return; }
    const res = (ctx.system.dice || {}).resolution || 'flat';
    const useTarget = ['roll-under', 'percentile', 'flat'].includes(res);
    const opts = useTarget ? { target: attr.value + ease } : { mod: attr.value + ease };
    const r = resolveCheck(ctx.system, opts);
    const outcome = r.success === true ? '✅ Success' : r.success === false ? '❌ Failure' : '—';
    const extra = r.critSuccess ? ' · CRIT!' : r.critFail ? ' · CRITICAL FAIL' : r.cleanHit ? ' · Clean Hit' : (r.band ? ' · ' + r.band : '');
    const fields = [
      { name: 'Roll', value: `${(r.dice || []).join(', ') || '—'} → **${r.total != null ? r.total : '—'}**`, inline: true },
      { name: attr.name, value: String(attr.value) + (ease ? ` (ease ${ease > 0 ? '+' : ''}${ease})` : ''), inline: true },
      { name: 'Result', value: `${outcome}${extra}\n${r.summary || ''}`, inline: false },
    ];
    safeReply(p.requestId, { embed: { title: `${ctx.pc.name} — ${attr.name} check`, color: BRAND, fields, footer: ctx.system.name } });
    discord.emit('roll', { label: `${attr.name} check`, total: r.total, success: r.success, text: `${ctx.pc.name} (${p.username}) — ${attr.name} check: ${r.summary || ''} → ${outcome}`, by: p.username });
    return;
  }

  if (cmd === 'sheet') {
    const ctx = charForUser(p.discordUserId);
    if (ctx.error) { safeReply(p.requestId, { content: ctx.error }); return; }
    const line = statLine(ctx.system, ctx.pc);
    const fields = [];
    if (ctx.pc.role) fields.push({ name: 'Role', value: String(ctx.pc.role), inline: true });
    const cond = (ctx.pc.conditions || []).join(', ');
    if (cond) fields.push({ name: 'Conditions', value: cond, inline: true });
    safeReply(p.requestId, { embed: { title: ctx.pc.name, description: line, color: BRAND, fields, footer: ctx.system.name } });
    return;
  }

  if (cmd === 'hp') {
    const ctx = charForUser(p.discordUserId);
    if (ctx.error) { safeReply(p.requestId, { content: ctx.error }); return; }
    const der = allDeriveds(ctx.system, ctx.pc);
    const ress = (ctx.system.deriveds || []).filter((d) => d.resource);
    if (!ress.length) { safeReply(p.requestId, { content: `${ctx.system.name} has no tracked resources.` }); return; }
    const lines = ress.map((d) => {
      const max = Number(der[d.key] || 0);
      // resources are stored as plain scalars on the character (see characters.js/session.js)
      const cur = (ctx.pc.resources && ctx.pc.resources[d.key] != null) ? ctx.pc.resources[d.key] : max;
      return `**${d.abbr || d.name || d.key}** ${cur}/${max}`;
    });
    safeReply(p.requestId, { embed: { title: `${ctx.pc.name} — resources`, description: lines.join('\n'), color: BRAND, footer: ctx.system.name } });
    return;
  }

  safeReply(p.requestId, { content: 'Unknown command.' });
}

export default { initDiscordBridge };
