import { el, clear } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, badge, modal, confirm, toast, field, input, select, checkbox } from '../ui.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { invalidateLive, invalidateModel } from '../ai-client.js';
import { brandLogoSvg } from '../assets.js';
import updates from '../updates.js';
import discord from '../discord.js';
import { setBuiltinsHidden, showAllBuiltins } from '../seed.js';
import { importShared } from '../share.js';

let unsub = [];
export function teardown() { unsub.forEach((u) => u && u()); unsub = []; }

export async function render() {
  shell.crumbs([{ label: 'Settings' }]);
  shell.actions(null);
  teardown();
  const settings = await store.getSettings();
  const info = await window.xrpg.app.info();
  const models = await window.xrpg.ai.models();
  const hasAnthropic = await store.hasSecret('anthropic');
  const hasTranscribe = await store.hasSecret('transcription');

  const wrap = el('div.view-pad');
  wrap.appendChild(el('h2', { style: { marginBottom: '18px' } }, 'Settings'));

  // ---- Role ----
  const roleSec = section('Mode', 'Game Master mode unlocks the full toolkit. Player mode is a streamlined experience for building and playing your own character.');
  const role = settings.role || 'gm';
  const roleRow = el('div.row.gap-2');
  const setRole = async (r) => {
    if (r === (settings.role || 'gm')) return;
    await store.setSettings({ role: r });
    toast(r === 'player' ? 'Switched to Player mode' : 'Switched to GM mode', { type: 'success' });
    setTimeout(() => location.reload(), 350); // rebuild nav/shell for the new role
  };
  const gmBtn = button('Game Master', { icon: 'swords', variant: role === 'gm' ? 'primary' : 'default', onClick: () => setRole('gm') });
  const plBtn = button('Player', { icon: 'mask', variant: role === 'player' ? 'primary' : 'default', onClick: () => setRole('player') });
  roleRow.appendChild(gmBtn); roleRow.appendChild(plBtn);
  roleSec.appendChild(roleRow);
  roleSec.appendChild(el('p.small.faint', { style: { marginTop: '8px' } }, 'Currently: ' + (role === 'player' ? 'Player' : 'Game Master') + ' mode.'));
  wrap.appendChild(roleSec);

  // ---- AI ----
  const aiSec = section('AI Integration (Claude)', 'Connect Claude for live storyline evolution, NPC and campaign generation, and session recaps. Without a key, XRPG uses a copy/paste bridge instead.');
  const keyStatus = el('span', hasAnthropic ? badge('Key set', { color: 'var(--good)' }) : badge('No key — bridge mode', { color: 'var(--warn)' }));
  const keyInput = input({ type: 'password', placeholder: hasAnthropic ? '•••••••••• (saved)' : 'sk-ant-...' });
  aiSec.appendChild(field('Anthropic API key', keyInput, { hint: 'Stored encrypted on this device via the OS keychain. Never displayed or sent anywhere except api.anthropic.com.' }));
  const keyRow = el('div.row.gap-2');
  keyRow.appendChild(button('Save key', { variant: 'primary', icon: 'save', onClick: async () => { if (!keyInput.value.trim()) { toast('Enter a key first', { type: 'warn' }); return; } await store.setSecret('anthropic', keyInput.value.trim()); invalidateLive(); keyInput.value = ''; toast('Key saved', { type: 'success' }); render(); } }));
  if (hasAnthropic) keyRow.appendChild(button('Test connection', { icon: 'spark', onClick: async () => { toast('Testing…', { timeout: 1200 }); try { const r = await window.xrpg.ai.test(settings.aiModel); toast(r.ok ? 'Connected ✓' : 'Unexpected reply: ' + r.text, { type: r.ok ? 'success' : 'warn' }); } catch (e) { toast('Failed: ' + e.message, { type: 'error' }); } } }));
  if (hasAnthropic) keyRow.appendChild(button('Remove key', { variant: 'ghost', icon: 'trash', onClick: async () => { await store.setSecret('anthropic', ''); invalidateLive(); toast('Key removed', { type: 'success' }); render(); } }));
  keyRow.appendChild(keyStatus);
  aiSec.appendChild(keyRow);

  const modelSel = select(models.models.map((m) => ({ value: m.id, label: m.label })), { value: settings.aiModel || models.default, onChange: async (v) => { await store.setSettings({ aiModel: v }); invalidateModel(); toast('Model set', { type: 'success', timeout: 1000 }); } });
  aiSec.appendChild(field('Model', modelSel));
  wrap.appendChild(aiSec);

  // ---- Transcription ----
  const tSec = section('Session Transcription', 'Claude can\'t transcribe audio directly. The live transcript uses your browser\'s speech engine when available; for high-quality transcription of recordings, add an OpenAI-compatible Whisper key (optional).');
  const tStatus = hasTranscribe ? badge('Key set', { color: 'var(--good)' }) : badge('Optional', { variant: 'dim' });
  const tKey = input({ type: 'password', placeholder: hasTranscribe ? '•••••••••• (saved)' : 'sk-... (OpenAI Whisper)' });
  tSec.appendChild(field('Transcription API key', tKey, { hint: 'Used only for the "Transcribe recording" button. Sent only to your configured endpoint.' }));
  const tBase = input({ value: settings.transcriptionBaseUrl || '', placeholder: 'https://api.openai.com/v1/audio/transcriptions (default)' });
  tSec.appendChild(field('Endpoint (optional)', tBase, { hint: 'Override for self-hosted/compatible Whisper servers.' }));
  const tModel = input({ value: settings.transcriptionModel || 'whisper-1' });
  tSec.appendChild(field('Model', tModel));
  const tRow = el('div.row.gap-2');
  tRow.appendChild(button('Save', { variant: 'primary', icon: 'save', onClick: async () => {
    if (tKey.value.trim()) await store.setSecret('transcription', tKey.value.trim());
    const payload = { transcriptionModel: tModel.value.trim() || 'whisper-1' };
    // Only overwrite the endpoint when the user actually typed one (empty = leave unchanged).
    if (tBase.value.trim()) payload.transcriptionBaseUrl = tBase.value.trim();
    await store.setSettings(payload);
    tKey.value = ''; toast('Saved', { type: 'success' }); render();
  } }));
  if (hasTranscribe) tRow.appendChild(button('Remove key', { variant: 'ghost', icon: 'trash', onClick: async () => { await store.setSecret('transcription', ''); toast('Removed', { type: 'success' }); render(); } }));
  tRow.appendChild(tStatus);
  tSec.appendChild(tRow);
  wrap.appendChild(tSec);

  // ---- Discord ----
  await buildDiscordSettings(wrap, settings);

  // ---- Data ----
  const dSec = section('Data & Backup', 'All your data lives in local files on this device. Back up or move it any time.');
  const dataRow = el('div.row.gap-2.wrap');
  dataRow.appendChild(button('Open data folder', { icon: 'folder', onClick: () => window.xrpg.shell.openDataFolder() }));
  dataRow.appendChild(button('Export everything', { icon: 'download', onClick: async () => { const dump = await store.exportAll(); const path = await window.xrpg.dialog.saveJson('xrpg-backup.xrpg', dump); if (path) toast('Backup saved', { type: 'success' }); } }));
  dataRow.appendChild(button('Import / restore', { icon: 'upload', title: 'Import a system, storyline, character, shared bundle, or a full backup', onClick: async () => { const dump = await window.xrpg.dialog.openJson(); if (!dump) return; if (dump.kind === 'xrpg-doc' || dump.kind === 'xrpg-bundle') { await importShared(dump); } else { await store.importAll(dump, { merge: true }); toast('Data imported', { type: 'success' }); } } }));
  dSec.appendChild(dataRow);
  const dataRow2 = el('div.row.gap-2.wrap', { style: { marginTop: '10px' } });
  dataRow2.appendChild(button('Restore built-in content', { icon: 'refresh', onClick: async () => { if (await confirm({ title: 'Restore built-in content?', message: 'Re-adds the default STRAIN Z system, storyline, demo systems and party if they were deleted. Your own content is untouched.' })) { await window.xrpg.store.reseed({ overwrite: false }); await store.loadAll(); toast('Built-in content restored', { type: 'success' }); } } }));
  dSec.appendChild(dataRow2);
  // Built-in (seeded) content visibility. Built-ins are read-only; you can hide
  // them from the lists (your own copies are unaffected) and bring them back any time.
  dSec.appendChild(el('div.divider', { style: { marginTop: '14px' } }, 'Built-in content'));
  const hideRow = el('div.col.gap-2');
  hideRow.appendChild(checkbox('Hide all built-in content (systems, storylines, characters, scenes)', {
    checked: !!appState.settings.builtinsHidden,
    onChange: async (val) => { await setBuiltinsHidden(val); toast(val ? 'Built-in content hidden' : 'Built-in content shown', { type: 'success' }); },
  }));
  const hideBtns = el('div.row.gap-2.wrap');
  hideBtns.appendChild(button('Show all built-ins', { icon: 'eye', size: 'sm', onClick: async () => { await showAllBuiltins(); toast('All built-ins shown', { type: 'success' }); } }));
  hideRow.appendChild(hideBtns);
  hideRow.appendChild(el('p.small.faint', 'Built-in systems, storylines, characters and scenes are read-only. Use “Copy to Edit” on any of them to make your own editable version — your copies are never overwritten when the built-ins update.'));
  dSec.appendChild(hideRow);
  dSec.appendChild(el('p.small.faint', { style: { marginTop: '10px' } }, 'Data folder: ' + info.dataDir));
  wrap.appendChild(dSec);

  // ---- Updates ----
  const uSec = section('Updates', 'XRPG can update itself when new releases are published. Updates download in the background; you choose when to restart and install.');
  const uStatus = el('div.small.mute', 'Checking…');
  const uRow = el('div.row.gap-2.wrap');
  const checkBtn = button('Check for Updates', { icon: 'refresh', variant: 'primary', onClick: async () => { uStatus.textContent = 'Checking for updates…'; const r = await updates.check(); if (!r.ok) uStatus.textContent = r.reason === 'dev' ? 'Updates are only checked in the installed app (not in dev).' : r.reason === 'unavailable' ? 'Updater not available in this build.' : 'Could not check: ' + (r.reason || 'unknown'); } });
  uRow.appendChild(checkBtn);
  const installBtn = button('Restart & Install', { icon: 'download', variant: 'cool', onClick: () => updates.install() });
  installBtn.classList.add('hidden');
  uRow.appendChild(installBtn);
  uSec.appendChild(uRow);
  uSec.appendChild(uStatus);
  // live status from the update client
  const applyUpd = (e) => {
    if (!e) return;
    if (e.type === 'checking') uStatus.textContent = 'Checking for updates…';
    else if (e.type === 'available') uStatus.textContent = `Update v${e.version} found — downloading…`;
    else if (e.type === 'not-available') uStatus.textContent = "You're on the latest version (v" + info.version + ').';
    else if (e.type === 'progress') uStatus.textContent = `Downloading update… ${e.percent}%`;
    else if (e.type === 'downloaded') { uStatus.textContent = `Update v${e.version} ready.`; installBtn.classList.remove('hidden'); }
    else if (e.type === 'error') uStatus.textContent = 'Update error: ' + (e.message || 'unknown');
    else if (e.type === 'idle') uStatus.textContent = 'Up to date (v' + info.version + ').';
  };
  applyUpd(updates.status && updates.status.type !== 'idle' ? updates.status : { type: 'idle' });
  const offUpd = updates.on('status', applyUpd);
  unsub.push(offUpd);
  // advanced: custom update feed
  const feedI = input({ value: settings.updateFeedUrl || '', placeholder: 'https://your-server/updates/ (optional — overrides the default release feed)' });
  feedI.addEventListener('change', async () => { await store.setSettings({ updateFeedUrl: feedI.value.trim() }); toast('Update feed saved', { type: 'success', timeout: 1200 }); });
  uSec.appendChild(field('Custom update feed (advanced)', feedI, { hint: 'Leave blank to use the default GitHub release feed.' }));
  wrap.appendChild(uSec);

  // ---- About ----
  const aSec = section('About', '');
  const aHead = el('div.row.gap-4', { style: { alignItems: 'center', marginBottom: '12px' } });
  const logo = el('div', { style: { width: '54px', height: '54px', flex: 'none' } }); logo.innerHTML = brandLogoSvg(54);
  aHead.appendChild(logo);
  const aTitle = el('div');
  aTitle.appendChild(el('div', { style: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '22px', letterSpacing: '.04em' } }, [el('span', { style: { color: 'var(--accent)' } }, 'X'), document.createTextNode('RPG')]));
  aTitle.appendChild(el('div.small.mute', 'Game-master console · v' + info.version));
  aTitle.appendChild(el('div.tiny.mute', { style: { marginTop: '4px' } }, 'Copyright © Xirma. All rights reserved.'));
  aHead.appendChild(aTitle);
  aSec.appendChild(aHead);
  const grid = el('div.meta-grid');
  const mi = (l, v) => { const m = el('div.meta-item'); m.appendChild(el('div.ml', l)); m.appendChild(el('div.mv', v)); return m; };
  grid.appendChild(mi('Version', 'v' + info.version));
  grid.appendChild(mi('Electron', info.electron));
  grid.appendChild(mi('Chromium', info.chrome));
  grid.appendChild(mi('Node', info.node));
  aSec.appendChild(grid);
  aSec.appendChild(el('p.small.mute', { style: { marginTop: '12px' } }, 'A game-master console for tabletop RPGs — campaigns, characters, rules, virtual tabletop, audio, recording, and Claude AI. Audio from Kevin MacLeod (incompetech.com, CC-BY) and Wikimedia Commons (CC0/PD/CC-BY); see the Mixer Credits panel.'));
  wrap.appendChild(aSec);

  shell.render(wrap);
}

function section(title, desc) {
  const s = el('div.settings-section');
  s.appendChild(el('h3', title));
  if (desc) s.appendChild(el('p.sdesc', desc));
  return s;
}

async function buildDiscordSettings(wrap, settings) {
  let avail = false;
  try { avail = await window.xrpg.discord.available(); } catch (e) {}
  const sec = section('Discord — Online Sessions', 'Run sessions over Discord: link members to players, record each speaker on a separate track, relay rolls and recaps to a channel, and use /roll, /check, /sheet, /hp in chat.');
  if (!avail) { sec.appendChild(el('p.small.warn', 'Discord libraries are unavailable in this build.')); wrap.appendChild(sec); return; }

  const hasToken = await store.hasSecret('discord');
  let stat = { connected: false, guilds: [] };
  try { stat = await window.xrpg.discord.status(); } catch (e) {}

  const status = stat.connected ? badge('Connected: ' + stat.botTag, { color: 'var(--good)' })
    : hasToken ? badge('Token set — not connected', { color: 'var(--warn)' })
    : badge('No token', { variant: 'dim' });
  const tokenI = input({ type: 'password', placeholder: hasToken ? '•••••••••• (saved)' : 'Bot token from discord.com/developers' });
  sec.appendChild(field('Discord bot token', tokenI, { hint: 'Create an application at discord.com/developers → Bot → Reset Token. Enable the "Server Members Intent" and "Message Content Intent" there, and invite the bot to your server with Connect, Speak, and Send Messages. Stored encrypted on this device; never sent anywhere but Discord.' }));
  const row = el('div.row.gap-2.wrap');
  row.appendChild(button('Save token', { variant: 'primary', icon: 'save', onClick: async () => { if (!tokenI.value.trim()) { toast('Enter a token first', { type: 'warn' }); return; } await store.setSecret('discord', tokenI.value.trim()); tokenI.value = ''; toast('Token saved', { type: 'success' }); render(); } }));
  if (hasToken && !stat.connected) row.appendChild(button('Connect', { icon: 'spark', onClick: async () => { toast('Connecting…', { timeout: 2000 }); let r; try { r = await window.xrpg.discord.connect(); } catch (e) { r = { reason: e.message }; } if (r && r.connected) toast('Connected ✓', { type: 'success' }); else toast('Connect failed: ' + (r.detail || r.reason || 'unknown'), { type: 'error', timeout: 4000 }); render(); } }));
  if (stat.connected) row.appendChild(button('Disconnect', { variant: 'ghost', onClick: async () => { await window.xrpg.discord.disconnect(); toast('Disconnected'); render(); } }));
  if (hasToken) row.appendChild(button('Remove token', { variant: 'ghost', icon: 'trash', onClick: async () => { await window.xrpg.discord.disconnect().catch(() => {}); await store.setSecret('discord', ''); toast('Removed', { type: 'success' }); render(); } }));
  row.appendChild(status);
  sec.appendChild(row);

  if (stat.connected && stat.degradedIntents) sec.appendChild(el('p.small.warn', { style: { marginTop: '8px' } }, 'Connected with limited permissions — enable the Server Members and Message Content intents in the Developer Portal for member auto-linking and chat mirroring.'));

  if (stat.connected && stat.guilds.length) {
    const guildId = settings.discordGuildId || stat.guilds[0].id;
    sec.appendChild(field('Server', select(stat.guilds.map((g) => ({ value: g.id, label: g.name })), { value: guildId, onChange: async (v) => { await store.setSettings({ discordGuildId: v, discordVoiceChannelId: '', discordTextChannelId: '' }); render(); } })));
    let vchans = [], tchans = [];
    try { vchans = await window.xrpg.discord.voiceChannels(guildId); } catch (e) {}
    try { tchans = await window.xrpg.discord.textChannels(guildId); } catch (e) {}
    if (vchans.length) sec.appendChild(field('Default voice channel', select([{ value: '', label: '(choose at session start)' }].concat(vchans.map((c) => ({ value: c.id, label: c.name }))), { value: settings.discordVoiceChannelId || '', onChange: (v) => store.setSettings({ discordVoiceChannelId: v }) })));
    sec.appendChild(field('Relay / mirror text channel', select([{ value: '', label: '(none)' }].concat(tchans.map((c) => ({ value: c.id, label: '#' + c.name }))), { value: settings.discordTextChannelId || '', onChange: async (v) => { await store.setSettings({ discordTextChannelId: v }); await window.xrpg.discord.refreshSettings().catch(() => {}); } }), { hint: 'Where the bot posts rolls/recaps and reads chat to mirror into the session.' }));
  }

  const toggles = el('div.col.gap-2', { style: { marginTop: '12px' } });
  const tog = (label, key, def) => checkbox(label, { checked: settings[key] !== undefined ? settings[key] : def, onChange: async (val) => { await store.setSettings({ [key]: val }); await window.xrpg.discord.refreshSettings().catch(() => {}); } });
  toggles.appendChild(tog('Auto-connect the bot on startup', 'discordAutoConnect', true));
  toggles.appendChild(tog('Enable slash commands (/roll, /check, /sheet, /hp)', 'discordSlashCommands', true));
  toggles.appendChild(tog('Mirror Discord text chat into the session log', 'discordMirrorChat', false));
  toggles.appendChild(tog('Update the bot’s rich-presence status', 'discordPresence', true));
  toggles.appendChild(tog('Post a recording-consent notice when recording starts/stops', 'discordConsentNotice', true));
  sec.appendChild(toggles);

  wrap.appendChild(sec);
}
