// Session Setup wizard — guides the GM through starting a session:
// mode (online/in-person) → connect Discord → join voice → link members to
// players → attendance → start recording → go. Skippable at every step.
import { el, clear } from '../util.js';
import { modal, button, select, checkbox, toast, field, badge } from '../ui.js';
import store from '../store.js';
import router from '../router.js';
import discord from '../discord.js';

const ONLINE = ['connect', 'voice', 'link', 'attendance', 'record', 'finish'];
const INPERSON = ['attendance', 'finish'];
const TITLES = { connect: 'Connect Discord', voice: 'Join voice', link: 'Link players', attendance: 'Attendance', record: 'Recording', finish: 'Ready' };

export function openSessionWizard(working, campaign, saveNow) {
  const offs = [];
  const m = modal({ title: 'Session setup', width: 560, noBackdropClose: true, onClose: () => { offs.forEach((o) => o && o()); offs.length = 0; } });
  const state = { mode: null, idx: 0, seq: [] };

  // ---- player/link helpers (mirror the session Discord panel) ----
  const playersForLink = () => {
    const grp = store.get('groups', campaign && campaign.groupId);
    if (grp && (grp.playerIds || []).length) return grp.playerIds.map((id) => store.get('players', id)).filter(Boolean);
    return store.all('players');
  };
  const linkValueFor = (memberId) => {
    if (working.discordGmUserId === memberId) return 'gm';
    const p = store.all('players').find((x) => x.discordUserId === memberId);
    return p ? p.id : '';
  };
  const setLink = async (memberId, value) => {
    const toClear = store.all('players').filter((p) => p.discordUserId === memberId && value !== p.id);
    for (const p of toClear) { p.discordUserId = ''; await store.save('players', p); }
    if (working.discordGmUserId === memberId && value !== 'gm') working.discordGmUserId = null;
    if (value === 'gm') { working.discordGmUserId = memberId; saveNow(); }
    else if (value) { const p = store.get('players', value); if (p) { p.discordUserId = memberId; await store.save('players', p); } }
  };
  const buildLinkMap = (members) => {
    const map = {};
    members.forEach((mem) => {
      const v = linkValueFor(mem.id);
      if (v === 'gm') map[mem.id] = { role: 'gm', label: 'GM' };
      else if (v) { const p = store.get('players', v); const pc = store.where('characters', (c) => c.kind === 'pc' && c.playerId === v && c.systemId === (campaign && campaign.systemId))[0]; map[mem.id] = { playerId: v, characterId: pc ? pc.id : null, label: p ? p.name : mem.displayName, role: 'player' }; }
    });
    return map;
  };

  // re-render the active step when Discord state changes
  ['status', 'members', 'voiceJoin', 'voiceLeave', 'recordingState'].forEach((ev) => offs.push(discord.on(ev, () => { if (state.mode) render(); })));

  async function render() {
    const content = m.body; clear(content);
    if (!state.mode) { renderMode(content); m.setFooter(button('Cancel', { variant: 'ghost', onClick: () => m.close() })); return; }
    content.appendChild(el('div.tiny.mute', { style: { marginBottom: '10px', letterSpacing: '.04em' } }, `Step ${state.idx + 1} of ${state.seq.length} · ${TITLES[state.seq[state.idx]]}`));
    try { await STEP[state.seq[state.idx]](content); } catch (e) { content.appendChild(el('p.small.warn', 'Step error: ' + e.message)); }
    const isLast = state.idx === state.seq.length - 1;
    const back = button('Back', { variant: 'ghost', onClick: () => { if (state.idx === 0) { state.mode = null; state.idx = 0; } else state.idx--; render(); } });
    const next = isLast
      ? button('Enter session', { variant: 'primary', icon: 'play', onClick: () => m.close() })
      : button('Next', { variant: 'primary', onClick: () => { state.idx++; render(); } });
    m.setFooter(back, next);
  }

  function renderMode(content) {
    content.appendChild(el('p.mute', { style: { marginTop: 0 } }, 'How are you running this session?'));
    const choice = (title, desc, onClick) => {
      const b = el('button.btn', { style: { display: 'block', width: '100%', textAlign: 'left', padding: '14px', marginBottom: '10px', whiteSpace: 'normal', height: 'auto' } });
      b.appendChild(el('div', { style: { fontWeight: '600', fontSize: '15px' } }, title));
      b.appendChild(el('div.small.mute', { style: { marginTop: '2px' } }, desc));
      b.addEventListener('click', onClick);
      return b;
    };
    content.appendChild(choice('🎧  Online — via Discord', 'Connect the bot, link players to Discord users, and record each speaker.', () => { state.mode = 'online'; state.seq = ONLINE; state.idx = 0; render(); }));
    content.appendChild(choice('🎲  In-person', 'Just mark who showed up and jump in.', () => { state.mode = 'inperson'; state.seq = INPERSON; state.idx = 0; render(); }));
  }

  const STEP = {
    async connect(c) {
      let avail = false; try { avail = await window.xrpg.discord.available(); } catch (e) {}
      if (!avail) { c.appendChild(el('p.warn', 'Discord isn’t available in this build. Click Next to continue with manual attendance.')); return; }
      let stat = {}; try { stat = await window.xrpg.discord.status(); } catch (e) {}
      const hasToken = await store.hasSecret('discord');
      if (stat.connected) {
        c.appendChild(el('p', [badge('Connected: ' + (stat.botTag || ''), { color: 'var(--good)' })]));
        if (stat.degradedIntents) c.appendChild(el('p.small.warn', 'Connected with limited permissions — enable the Server Members & Message Content intents in the Developer Portal for auto-linking and chat mirroring.'));
        c.appendChild(el('p.small.mute', 'Bot is online. Click Next to pick a voice channel.'));
      } else if (hasToken) {
        c.appendChild(el('p.mute', 'A bot token is saved but the bot isn’t connected.'));
        c.appendChild(button('Connect bot', { variant: 'primary', icon: 'spark', onClick: async () => { toast('Connecting…', { timeout: 2000 }); let r; try { r = await window.xrpg.discord.connect(); } catch (e) { r = { reason: e.message }; } if (!(r && r.connected)) toast('Connect failed: ' + (r.detail || r.reason || ''), { type: 'error', timeout: 4000 }); render(); } }));
      } else {
        c.appendChild(el('p.mute', 'No bot token yet. Add one in Settings → Discord, then reopen this wizard.'));
        c.appendChild(button('Open Settings', { variant: 'ghost', onClick: () => { m.close(); router.go('settings'); } }));
      }
    },

    async voice(c) {
      let stat = {}; try { stat = await window.xrpg.discord.status(); } catch (e) {}
      if (!stat.connected) { c.appendChild(el('p.mute', 'Not connected — go Back to connect, or Next to skip.')); return; }
      if (stat.voice) { c.appendChild(el('p', [badge('In voice: ' + stat.voice.channelName, { color: 'var(--good)' })])); c.appendChild(button('Leave channel', { size: 'sm', variant: 'ghost', onClick: async () => { await window.xrpg.discord.leaveVoice(); render(); } })); return; }
      const settings = await store.getSettings();
      const guildId = settings.discordGuildId || (stat.guilds[0] && stat.guilds[0].id);
      let vchans = []; try { vchans = await window.xrpg.discord.voiceChannels(guildId); } catch (e) {}
      if (!vchans.length) { c.appendChild(el('p.mute', 'No voice channels found. Set a server in Settings → Discord.')); return; }
      let chosen = settings.discordVoiceChannelId || vchans[0].id;
      c.appendChild(field('Voice channel', select(vchans.map((v) => ({ value: v.id, label: v.name })), { value: chosen, onChange: (v) => { chosen = v; } })));
      c.appendChild(button('Join voice', { variant: 'primary', onClick: async () => { toast('Joining…', { timeout: 1500 }); const r = await window.xrpg.discord.joinVoice(guildId, chosen).catch((e) => ({ ok: false, reason: e.message })); if (!r.ok) toast('Join failed: ' + (r.detail || r.reason), { type: 'error' }); render(); } }));
    },

    async link(c) {
      let stat = {}; try { stat = await window.xrpg.discord.status(); } catch (e) {}
      if (!stat.voice) { c.appendChild(el('p.mute', 'Join a voice channel first (Back), or Next to skip.')); return; }
      const members = (stat.members || []).filter((mm) => !mm.bot);
      if (!members.length) { c.appendChild(el('p.mute', 'No one is in the voice channel yet. Ask players to join, then this updates automatically.')); return; }
      const opts = [{ value: '', label: '— unlinked —' }, { value: 'gm', label: 'GM (me)' }].concat(playersForLink().map((p) => ({ value: p.id, label: p.name })));
      const list = el('div.col.gap-1');
      members.forEach((mem) => {
        const row = el('div.row.gap-2', { style: { alignItems: 'center' } });
        row.appendChild(el('span', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: mem.displayName }, mem.displayName));
        row.appendChild(select(opts, { value: linkValueFor(mem.id), onChange: (v) => setLink(mem.id, v) }));
        list.appendChild(row);
      });
      c.appendChild(list);
      c.appendChild(button('Auto-link by name', { size: 'sm', variant: 'ghost', onClick: async () => { let n = 0; for (const mem of members) { if (linkValueFor(mem.id)) continue; const p = playersForLink().find((pp) => !pp.discordUserId && pp.name && pp.name.toLowerCase() === mem.displayName.toLowerCase()); if (p) { await setLink(mem.id, p.id); n++; } } toast(n ? `Linked ${n} player(s)` : 'No name matches', { type: n ? 'success' : 'warn' }); render(); } }));
    },

    async attendance(c) {
      const players = playersForLink();
      if (!players.length) { c.appendChild(el('p.mute', 'No players in this campaign’s group. Add players and assign a group to the campaign first.')); return; }
      working.presentPlayerIds = working.presentPlayerIds || [];
      const inVoice = new Set();
      if (state.mode === 'online') { try { const stat = await window.xrpg.discord.status(); (stat.members || []).forEach((mm) => { const p = store.all('players').find((x) => x.discordUserId === mm.id); if (p) inVoice.add(p.id); }); } catch (e) {} }
      let changed = false;
      players.forEach((p) => { if (inVoice.has(p.id) && !working.presentPlayerIds.includes(p.id)) { working.presentPlayerIds.push(p.id); changed = true; } });
      if (changed) saveNow();
      c.appendChild(el('p.small.mute', { style: { marginTop: 0 } }, state.mode === 'online' ? 'Pre-checked anyone already in the voice channel.' : 'Check who’s at the table.'));
      const list = el('div.col.gap-1');
      players.forEach((p) => {
        const cb = checkbox(p.name + (inVoice.has(p.id) ? ' · in voice' : ''), { checked: working.presentPlayerIds.includes(p.id), onChange: (val) => { if (val) { if (!working.presentPlayerIds.includes(p.id)) working.presentPlayerIds.push(p.id); } else working.presentPlayerIds = working.presentPlayerIds.filter((x) => x !== p.id); saveNow(); } });
        list.appendChild(cb);
      });
      c.appendChild(list);
      const quick = el('div.row.gap-2', { style: { marginTop: '8px' } });
      quick.appendChild(button('All', { size: 'sm', variant: 'ghost', onClick: () => { working.presentPlayerIds = players.map((p) => p.id); saveNow(); render(); } }));
      quick.appendChild(button('None', { size: 'sm', variant: 'ghost', onClick: () => { working.presentPlayerIds = []; saveNow(); render(); } }));
      c.appendChild(quick);
    },

    async record(c) {
      let stat = {}; try { stat = await window.xrpg.discord.status(); } catch (e) {}
      if (!stat.voice) { c.appendChild(el('p.mute', 'Join a voice channel to record (Back), or Next to skip — you can record later from the Discord panel.')); return; }
      if (stat.recording && stat.recording.active) { c.appendChild(el('p', [badge('● Recording', { color: 'var(--ember,#ff2a1f)' })])); c.appendChild(button('Stop recording', { size: 'sm', variant: 'danger', onClick: async () => { await window.xrpg.discord.stopRecording({ mixdown: true }); render(); } })); return; }
      c.appendChild(el('p.small.mute', { style: { marginTop: 0 } }, 'Records each speaker on a separate track (plus a mixdown and a speaker-labeled transcript). A consent notice is posted to the text channel — toggle in Settings.'));
      c.appendChild(button('Start recording everyone', { variant: 'primary', icon: 'mic', onClick: async () => { const members = (stat.members || []).filter((mm) => !mm.bot); const r = await window.xrpg.discord.startRecording(working.id, { linkMap: buildLinkMap(members) }).catch((e) => ({ ok: false, reason: e.message })); if (!r.ok) toast('Record failed: ' + (r.reason || ''), { type: 'error' }); else toast('Recording started', { type: 'success' }); render(); } }));
    },

    async finish(c) {
      const present = (working.presentPlayerIds || []).length;
      let stat = {}; try { stat = await window.xrpg.discord.status(); } catch (e) {}
      const ul = el('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } });
      ul.appendChild(el('li.small', `Mode: ${state.mode === 'online' ? 'Online (Discord)' : 'In-person'}`));
      ul.appendChild(el('li.small', `${present} player${present === 1 ? '' : 's'} marked present`));
      if (state.mode === 'online') {
        ul.appendChild(el('li.small', stat.voice ? `In voice: ${stat.voice.channelName}` : 'Not in a voice channel'));
        ul.appendChild(el('li.small', stat.recording && stat.recording.active ? 'Recording: on' : 'Recording: off'));
      }
      c.appendChild(ul);
      c.appendChild(el('p.small.mute', { style: { marginTop: '10px' } }, 'You can reopen this anytime from the “Setup” button in the session header.'));
    },
  };

  // remember it's been shown so we don't auto-pop it again for this session
  if (!working.wizardShown) { working.wizardShown = true; saveNow(); }
  render();
  return m;
}

export default { openSessionWizard };
