'use strict';

// Discord integration for online sessions.
// - Bot joins a voice channel and records each speaker on a separate track.
// - Per-user audio is captured by decoding Opus directly (opusscript) into compact
//   mono 16 kHz WAV (ideal for Whisper) with per-frame timestamps, so we can build a
//   time-aligned mixdown WITHOUT ffmpeg or an Ogg muxer.
// - Slash commands are forwarded to the renderer (reusing the dice/rules engine).
// - Text relay, chat mirror, and rich presence round it out.
//
// Everything runs in the main process. The bot token lives in safeStorage and is
// never sent to the renderer. The whole module degrades gracefully (available:false)
// if the optional deps are missing, so app startup never depends on Discord.

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');

let dpkg = null; // discord.js
let voice = null; // @discordjs/voice
let OpusScript = null;
let prism = null; // prism-media (ogg/webm opus demuxers, for broadcast)
let depError = null;
try {
  dpkg = require('discord.js');
  voice = require('@discordjs/voice');
  OpusScript = require('opusscript');
  prism = require('prism-media');
} catch (e) {
  depError = e.message;
}

// ---- audio constants ----
const IN_RATE = 48000; // Discord voice
const IN_CH = 2;
const FRAME_SAMPLES = 960; // 20ms @ 48k
const OUT_RATE = 16000; // mono target (Whisper-friendly, compact)
const DECIM = IN_RATE / OUT_RATE; // 3
const OUT_FRAME = FRAME_SAMPLES / DECIM; // 320 samples per 20ms @16k
const REC_BYTES = 4 + OUT_FRAME * 2; // timed temp record: int32 tMs + pcm16

// ---- module state ----
let deps = { getWindow: () => null, store: null, transcribe: null };
let client = null;
let connecting = false;
let ready = false;
let botUser = null;
let degradedIntents = false; // privileged intents unavailable
let conn = null; // voice connection
let reconnecting = false; // guards the Disconnected recovery race
let voiceInfo = null; // { guildId, channelId, channelName }
let player = null; // audio player for broadcast
let speakingSet = new Set();
let rec = null; // active recording state
let pendingSlash = new Map(); // requestId -> { interaction, timer }
let slashSeq = 0;
let cachedSettings = {};

function send(type, data) {
  const w = deps.getWindow && deps.getWindow();
  if (w && !w.isDestroyed()) {
    try { w.webContents.send('discord:event', Object.assign({ type }, data || {})); } catch (e) {}
  }
}

function log(...a) { try { console.log('[discord]', ...a); } catch (e) {} }

function available() { return !!(dpkg && voice && OpusScript); }

function init(d) {
  deps = Object.assign(deps, d || {});
  if (!available()) { log('unavailable:', depError); return; }
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

function intentList(full) {
  const I = dpkg.GatewayIntentBits;
  const base = [I.Guilds, I.GuildVoiceStates, I.GuildMessages];
  if (full) return base.concat([I.GuildMembers, I.MessageContent]);
  return base;
}

async function connect() {
  if (!available()) return { ok: false, reason: 'unavailable', detail: depError };
  if (ready && client) return status();
  if (connecting) return { ok: false, reason: 'connecting' };
  const token = deps.store ? await deps.store.getSecret('discord') : null;
  if (!token) return { ok: false, reason: 'no-token' };
  cachedSettings = (deps.store ? await deps.store.getSettings() : {}) || {};

  connecting = true;
  const tryLogin = (full) => new Promise((resolve, reject) => {
    const c = new dpkg.Client({ intents: intentList(full), partials: [dpkg.Partials.Channel, dpkg.Partials.Message] });
    let settled = false;
    c.once(dpkg.Events.ClientReady, () => { settled = true; resolve(c); });
    c.once(dpkg.Events.Error, (e) => { if (!settled) { settled = true; reject(e); } });
    c.login(token).catch((e) => { if (!settled) { settled = true; reject(e); } });
    setTimeout(() => { if (!settled) { settled = true; reject(new Error('Login timed out')); } }, 20000);
  });

  try {
    let c;
    try {
      c = await tryLogin(true);
      degradedIntents = false;
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/disallowed intents/i.test(msg)) {
        log('privileged intents disallowed, retrying with base intents');
        c = await tryLogin(false);
        degradedIntents = true;
      } else {
        throw e;
      }
    }
    client = c;
    botUser = c.user;
    ready = true;
    connecting = false;
    wireClient();
    await registerCommands().catch((e) => log('command registration failed:', e.message));
    if (cachedSettings.discordPresence !== false) setPresence(cachedSettings.discordPresenceText || 'Running a tabletop session').catch(() => {});
    const st = status();
    send('ready', st);
    send('status', st);
    return st;
  } catch (e) {
    connecting = false;
    ready = false;
    try { if (client) client.destroy(); } catch (_) {}
    client = null;
    const msg = String(e && e.message || e);
    send('error', { message: msg });
    return { ok: false, reason: 'login-failed', detail: msg };
  }
}

function wireClient() {
  client.on(dpkg.Events.Error, (e) => { log('client error', e && e.message); send('error', { message: String(e && e.message || e) }); });
  client.on(dpkg.Events.ShardDisconnect, () => { ready = false; send('status', status()); });
  client.on(dpkg.Events.ShardResume, () => { ready = true; send('status', status()); });
  client.on(dpkg.Events.GuildCreate, () => { registerCommands().catch(() => {}); send('status', status()); });

  client.on(dpkg.Events.VoiceStateUpdate, (oldS, newS) => {
    if (!voiceInfo) return;
    // someone joined/left our channel, or mute/deaf changed
    const relevant = (newS.channelId === voiceInfo.channelId) || (oldS.channelId === voiceInfo.channelId);
    if (!relevant) return;
    // if a new non-bot user joined while recording, capture them
    if (rec && newS.channelId === voiceInfo.channelId && newS.member && !newS.member.user.bot) {
      ensureUserCapture(newS.id, displayNameOf(newS.member));
    }
    // if a user LEFT our channel mid-recording, free their live receiver subscription
    // (what they said is still buffered + saved at stop). Prevents stream/fd accumulation.
    if (rec && oldS.channelId === voiceInfo.channelId && newS.channelId !== voiceInfo.channelId) {
      const u = rec.users.get(newS.id);
      if (u && u.stream) { try { u.stream.destroy(); } catch (e) {} u.stream = null; }
    }
    send('members', { channelId: voiceInfo.channelId, members: currentMembers() });
  });

  // text chat mirror
  client.on(dpkg.Events.MessageCreate, (m) => {
    try {
      if (m.author && m.author.bot) return;
      if (!cachedSettings.discordMirrorChat) return;
      const watch = cachedSettings.discordTextChannelId;
      if (watch && m.channelId !== watch) return;
      send('chat', { channelId: m.channelId, authorId: m.author.id, author: m.member ? displayNameOf(m.member) : m.author.username, content: m.content || '', at: Date.now() });
    } catch (e) {}
  });

  // slash commands → renderer
  client.on(dpkg.Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;
    // Acknowledge within Discord's 3s window. If defer fails, try a normal reply
    // so editReply still works later; only bail if we truly can't acknowledge.
    let acked = false;
    try { await interaction.deferReply(); acked = true; }
    catch (e) { log('deferReply failed', e.message); try { await interaction.reply('Working…'); acked = true; } catch (e2) { log('reply failed', e2.message); } }
    if (!acked) return;
    const requestId = 'slash_' + (++slashSeq);
    const options = {};
    try { interaction.options.data.forEach((o) => { options[o.name] = o.value; }); } catch (e) {}
    const payload = {
      requestId,
      command: interaction.commandName,
      options,
      discordUserId: interaction.user.id,
      username: interaction.member ? displayNameOf(interaction.member) : interaction.user.username,
      guildId: interaction.guildId,
    };
    const timer = setTimeout(() => {
      if (pendingSlash.has(requestId)) {
        pendingSlash.delete(requestId);
        interaction.editReply('XRPG did not respond in time. Is a session open in the app?').catch(() => {});
      }
    }, 12000);
    pendingSlash.set(requestId, { interaction, timer });
    send('slash', payload);
  });
}

function slashReply(requestId, reply) {
  const pend = pendingSlash.get(requestId);
  if (!pend) return false;
  clearTimeout(pend.timer);
  pendingSlash.delete(requestId);
  const { interaction } = pend;
  try {
    if (reply && reply.embed) interaction.editReply({ embeds: [embedFrom(reply.embed)] }).catch((err) => log('editReply failed', requestId, err.message));
    else interaction.editReply(String((reply && reply.content) || 'Done.')).catch((err) => log('editReply failed', requestId, err.message));
  } catch (e) { return false; }
  return true;
}

function embedFrom(e) {
  const b = new dpkg.EmbedBuilder();
  if (e.title) b.setTitle(String(e.title).slice(0, 250));
  if (e.description) b.setDescription(String(e.description).slice(0, 4000));
  if (e.color != null) b.setColor(e.color);
  if (Array.isArray(e.fields)) e.fields.slice(0, 25).forEach((f) => b.addFields({ name: String(f.name).slice(0, 250), value: String(f.value).slice(0, 1000), inline: !!f.inline }));
  if (e.footer) b.setFooter({ text: String(e.footer).slice(0, 2000) });
  return b;
}

async function registerCommands() {
  if (!client || !client.user) return;
  if (cachedSettings.discordSlashCommands === false) return;
  const cmds = [
    new dpkg.SlashCommandBuilder().setName('roll').setDescription('Roll dice, e.g. 3d6+2').addStringOption((o) => o.setName('notation').setDescription('Dice notation like 3d6+2 or 1d20').setRequired(true)),
    new dpkg.SlashCommandBuilder().setName('check').setDescription('Make a check with your linked character').addStringOption((o) => o.setName('attribute').setDescription('Attribute/skill key or name').setRequired(true)).addIntegerOption((o) => o.setName('ease').setDescription('Ease/difficulty modifier (optional)')),
    new dpkg.SlashCommandBuilder().setName('sheet').setDescription('Show your linked character sheet'),
    new dpkg.SlashCommandBuilder().setName('hp').setDescription('Show your linked character HP/resources'),
  ].map((c) => c.toJSON());
  const rest = new dpkg.REST({ version: '10' }).setToken(await deps.store.getSecret('discord'));
  const guilds = [...client.guilds.cache.keys()];
  for (const gid of guilds) {
    try { await rest.put(dpkg.Routes.applicationGuildCommands(client.user.id, gid), { body: cmds }); } catch (e) { log('cmd reg guild', gid, e.message); }
  }
}

async function disconnect() {
  try { await leaveVoice(); } catch (e) {}
  try { if (client) client.destroy(); } catch (e) {}
  client = null; ready = false; botUser = null;
  send('status', status());
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Guild / channel / member queries
// ---------------------------------------------------------------------------

function displayNameOf(member) {
  if (!member) return 'Unknown';
  return member.nickname || (member.user && (member.user.globalName || member.user.username)) || 'Unknown';
}

function status() {
  return {
    available: available(),
    connected: !!(client && ready),
    connecting,
    degradedIntents,
    botTag: botUser ? botUser.tag : null,
    botId: botUser ? botUser.id : null,
    guilds: client && ready ? [...client.guilds.cache.values()].map((g) => ({ id: g.id, name: g.name })) : [],
    voice: voiceInfo ? { guildId: voiceInfo.guildId, channelId: voiceInfo.channelId, channelName: voiceInfo.channelName } : null,
    recording: rec ? { active: true, sessionId: rec.sessionId, since: rec.t0Wall, users: [...rec.users.keys()] } : null,
    members: voiceInfo ? currentMembers() : [],
    textChannelId: cachedSettings.discordTextChannelId || null,
  };
}

async function listVoiceChannels(guildId) {
  if (!client || !ready) return [];
  const g = client.guilds.cache.get(guildId);
  if (!g) return [];
  let channels;
  try { channels = await g.channels.fetch(); } catch (e) { channels = g.channels.cache; }
  return [...channels.values()].filter((c) => c && (c.type === dpkg.ChannelType.GuildVoice || c.type === dpkg.ChannelType.GuildStageVoice)).map((c) => ({ id: c.id, name: c.name }));
}

async function listTextChannels(guildId) {
  if (!client || !ready) return [];
  const g = client.guilds.cache.get(guildId);
  if (!g) return [];
  let channels;
  try { channels = await g.channels.fetch(); } catch (e) { channels = g.channels.cache; }
  return [...channels.values()].filter((c) => c && c.type === dpkg.ChannelType.GuildText).map((c) => ({ id: c.id, name: c.name }));
}

function currentMembers() {
  if (!client || !voiceInfo) return [];
  const g = client.guilds.cache.get(voiceInfo.guildId);
  const ch = g && g.channels.cache.get(voiceInfo.channelId);
  if (!ch || !ch.members) return [];
  return [...ch.members.values()].map((m) => ({
    id: m.id,
    username: m.user ? m.user.username : '',
    displayName: displayNameOf(m),
    bot: !!(m.user && m.user.bot),
    speaking: speakingSet.has(m.id),
    selfMute: !!(m.voice && m.voice.selfMute),
    selfDeaf: !!(m.voice && m.voice.selfDeaf),
  }));
}

// ---------------------------------------------------------------------------
// Voice join / leave
// ---------------------------------------------------------------------------

async function joinVoice(guildId, channelId) {
  if (!client || !ready) return { ok: false, reason: 'not-connected' };
  const g = client.guilds.cache.get(guildId);
  if (!g) return { ok: false, reason: 'no-guild' };
  let ch;
  try { ch = await g.channels.fetch(channelId); } catch (e) { ch = g.channels.cache.get(channelId); }
  if (!ch) return { ok: false, reason: 'no-channel' };

  // Switching channels: stop any active recording (its streams are bound to the old
  // receiver) and fully tear down the old connection + its listeners first.
  if (rec) { try { await stopRecording({ mixdown: true }); } catch (e) {} }
  if (conn) { try { conn.removeAllListeners(); conn.destroy(); } catch (e) {} conn = null; }
  reconnecting = false;
  conn = voice.joinVoiceChannel({ channelId, guildId, adapterCreator: g.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  try {
    await voice.entersState(conn, voice.VoiceConnectionStatus.Ready, 20000);
  } catch (e) {
    try { conn.removeAllListeners(); conn.destroy(); } catch (_) {}
    conn = null;
    return { ok: false, reason: 'voice-timeout', detail: e.message };
  }
  conn.on('stateChange', (_o, n) => {
    if (n.status === voice.VoiceConnectionStatus.Disconnected) {
      if (reconnecting || !conn) return; // guard against thrashing on flapping connections
      reconnecting = true;
      // try to resume; if it fully drops, clean up
      Promise.race([
        voice.entersState(conn, voice.VoiceConnectionStatus.Signalling, 5000),
        voice.entersState(conn, voice.VoiceConnectionStatus.Connecting, 5000),
      ]).catch(() => { try { conn && conn.destroy(); } catch (e) {} })
        .finally(() => { reconnecting = false; });
    }
  });
  voiceInfo = { guildId, channelId, channelName: ch.name };

  const receiver = conn.receiver;
  // Fresh connection ⇒ fresh receiver, but be explicit so listeners never stack.
  try { receiver.speaking.removeAllListeners('start'); receiver.speaking.removeAllListeners('end'); } catch (e) {}
  receiver.speaking.on('start', (userId) => { speakingSet.add(userId); send('speaking', { userId, speaking: true }); if (rec) ensureUserCapture(userId, memberName(userId)); });
  receiver.speaking.on('end', (userId) => { speakingSet.delete(userId); send('speaking', { userId, speaking: false }); });

  send('voiceJoin', { guildId, channelId, channelName: ch.name, members: currentMembers() });
  send('status', status());
  return { ok: true, channelName: ch.name, members: currentMembers() };
}

function memberName(userId) {
  if (!client || !voiceInfo) return userId;
  const g = client.guilds.cache.get(voiceInfo.guildId);
  const m = g && g.members.cache.get(userId);
  return m ? displayNameOf(m) : userId;
}

async function leaveVoice() {
  if (rec) await stopRecording({ mixdown: true }).catch(() => {});
  stopBroadcast();
  if (conn) { try { conn.receiver && conn.receiver.speaking.removeAllListeners(); } catch (e) {} try { conn.removeAllListeners(); conn.destroy(); } catch (e) {} conn = null; }
  reconnecting = false;
  voiceInfo = null;
  speakingSet = new Set();
  send('voiceLeave', {});
  send('status', status());
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recording (per-user, decode → mono16k WAV + timed temp for mixdown)
// ---------------------------------------------------------------------------

function recTempDir(sessionId) {
  return path.join(os.tmpdir(), 'xrpg-rec', String(sessionId || 'session'));
}

async function startRecording(sessionId, opts = {}) {
  if (!conn || !voiceInfo) return { ok: false, reason: 'not-in-voice' };
  if (rec) return { ok: false, reason: 'already-recording' };
  const dir = recTempDir(sessionId + '_' + Date.now());
  await fsp.mkdir(dir, { recursive: true });
  rec = {
    sessionId,
    dir,
    t0: Date.now(),
    t0Wall: Date.now(),
    users: new Map(), // userId -> { username, decoder, stream, temp, fd, frames, startOffsetMs, label }
    linkMap: opts.linkMap || {},
  };
  // capture everyone currently in the channel (non-bot)
  for (const m of currentMembers()) { if (!m.bot) ensureUserCapture(m.id, m.displayName); }

  // consent notice
  if (cachedSettings.discordConsentNotice !== false) {
    const tc = cachedSettings.discordTextChannelId;
    if (tc) postMessage(tc, '🔴 **Session recording started.** Each speaker is being recorded for the game master\'s session notes. Leave the voice channel if you do not consent.').catch(() => {});
  }
  send('recordingState', { active: true, sessionId, users: [...rec.users.keys()] });
  send('status', status());
  return { ok: true, users: [...rec.users.values()].map((u) => ({ userId: u.userId, label: u.label })) };
}

function ensureUserCapture(userId, username) {
  if (!rec || !conn) return;
  if (rec.users.has(userId)) return;
  // don't record the bot itself
  if (botUser && userId === botUser.id) return;
  const temp = path.join(rec.dir, userId + '.opus');
  let ws;
  try { ws = fs.createWriteStream(temp, { highWaterMark: 1 << 20 }); } catch (e) { log('temp open failed', e.message); return; }
  ws.on('error', (e) => log('rec write error', e.message));
  const stream = conn.receiver.subscribe(userId, { end: { behavior: voice.EndBehaviorType.Manual } });
  const name = username || memberName(userId);
  const u = { userId, username: name, stream, ws, temp, packets: 0, startOffsetMs: Date.now() - rec.t0, label: name };
  rec.users.set(userId, u);
  // HOT PATH (≈50/sec/speaker): NO decode, NO sync I/O — just buffer the raw Opus
  // packet + timestamp to an async stream. Decoding is deferred to stopRecording so
  // the main-process event loop (and the voice connection) is never blocked.
  stream.on('data', (packet) => {
    if (!rec || !rec.users.has(userId) || !packet || !packet.length || packet.length > 0xffff) return;
    const out = Buffer.allocUnsafe(6 + packet.length);
    out.writeInt32LE(Math.max(0, Date.now() - rec.t0), 0);
    out.writeUInt16LE(packet.length, 4);
    packet.copy(out, 6);
    // Honor backpressure so the write buffer can't grow unbounded under a disk stall
    // (which would cause GC pauses that starve the voice heartbeat).
    if (!ws.write(out)) { try { stream.pause(); ws.once('drain', () => { try { stream.resume(); } catch (e) {} }); } catch (e) {} }
    u.packets++;
  });
  stream.on('error', () => {});
  log('capturing', userId, u.label);
}

// Deferred decode (runs once, at stop): raw [tMs|len|opus] records -> decoded
// fixed-size [tMs|mono16k] records that readTempToWav/buildMixdown understand.
function decodeUserRecording(rawTemp, decodedTemp) {
  let raw; try { raw = fs.readFileSync(rawTemp); } catch (e) { return 0; }
  let dec; try { dec = new OpusScript(IN_RATE, IN_CH, OpusScript.Application.AUDIO); } catch (e) { return 0; }
  let out; try { out = fs.openSync(decodedTemp, 'w'); } catch (e) { try { dec.delete(); } catch (_) {} return 0; }
  let frames = 0, off = 0;
  const recBuf = Buffer.allocUnsafe(REC_BYTES);
  try {
    while (off + 6 <= raw.length) {
      const tMs = raw.readInt32LE(off);
      const len = raw.readUInt16LE(off + 4);
      off += 6;
      if (len <= 0 || off + len > raw.length) break;
      const packet = raw.subarray(off, off + len);
      off += len;
      let pcm; try { pcm = dec.decode(packet); } catch (e) { continue; }
      if (!pcm || pcm.length < FRAME_SAMPLES * IN_CH * 2) continue;
      const mono16 = downmixDecimate(pcm);
      recBuf.writeInt32LE(tMs, 0);
      mono16.copy(recBuf, 4);
      fs.writeSync(out, recBuf);
      frames++;
    }
  } finally { try { fs.closeSync(out); } catch (e) {} try { dec.delete(); } catch (e) {} }
  return frames;
}

// stereo int16 @48k (960 frames) -> mono int16 @16k (320 samples) Buffer
function downmixDecimate(pcm) {
  const out = Buffer.allocUnsafe(OUT_FRAME * 2);
  for (let i = 0; i < OUT_FRAME; i++) {
    // average DECIM stereo samples
    let acc = 0;
    for (let j = 0; j < DECIM; j++) {
      const idx = (i * DECIM + j) * IN_CH; // sample index in stereo array
      const off = idx * 2;
      const l = pcm.readInt16LE(off);
      const r = pcm.readInt16LE(off + 2);
      acc += (l + r) / 2;
    }
    let v = Math.round(acc / DECIM);
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    out.writeInt16LE(v, i * 2);
  }
  return out;
}

async function stopRecording(opts = {}) {
  if (!rec) return { ok: false, reason: 'not-recording' };
  const cur = rec;
  rec = null; // stop accepting frames
  send('recordingState', { active: false });

  // stop streams and flush each user's raw-opus write stream to disk
  await Promise.all([...cur.users.values()].map((u) => new Promise((resolve) => {
    try { u.stream && u.stream.destroy(); } catch (e) {}
    if (!u.ws) return resolve();
    try { u.ws.end(() => resolve()); u.ws.on('error', () => resolve()); } catch (e) { resolve(); }
  })));

  if (cachedSettings.discordConsentNotice !== false) {
    const tc = cachedSettings.discordTextChannelId;
    if (tc) postMessage(tc, '⏹️ Session recording stopped.').catch(() => {});
  }

  // Decode (deferred from the live path) → per-user WAV + manifest
  const manifest = [];
  const tmsByUser = {};
  const decodedTemps = [];
  for (const u of cur.users.values()) {
    try {
      const decodedTemp = path.join(cur.dir, u.userId + '.dec');
      const frames = decodeUserRecording(u.temp, decodedTemp);
      if (!frames) continue;
      const { wavBuf, tms, durationMs } = readTempToWav(decodedTemp, frames);
      if (!wavBuf || !wavBuf.length || tms.length === 0) continue;
      const link = cur.linkMap[u.userId] || {};
      const label = link.label || u.label || u.username || u.userId;
      const saved = await deps.store.saveMedia('audio', sanitizeName(label) + '.wav', wavBuf);
      manifest.push({
        userId: u.userId,
        username: u.username,
        label,
        playerId: link.playerId || null,
        characterId: link.characterId || null,
        role: link.role || 'player',
        mediaId: saved.id,
        url: saved.url,
        bytes: saved.bytes,
        durationMs,
        startOffsetMs: tms.length ? tms[0] : 0,
      });
      tmsByUser[u.userId] = { tms, mediaId: saved.id, label };
      decodedTemps.push({ temp: decodedTemp, frames });
    } catch (e) { log('process user track failed', e.message); }
  }

  // best-effort time-aligned mixdown (from the decoded temps)
  let mixdown = null;
  if (opts.mixdown !== false && decodedTemps.length) {
    try {
      const wavBuf = buildMixdown(decodedTemps, (pct) => send('mixdownProgress', { percent: pct }));
      if (wavBuf && wavBuf.length > 44) {
        const saved = await deps.store.saveMedia('audio', 'mixdown.wav', wavBuf);
        mixdown = { mediaId: saved.id, url: saved.url, bytes: saved.bytes };
      }
    } catch (e) { log('mixdown failed', e.message); }
  }

  // cleanup temp dir (raw + decoded)
  try {
    for (const u of cur.users.values()) { try { fs.unlinkSync(u.temp); } catch (e) {} }
    for (const d of decodedTemps) { try { fs.unlinkSync(d.temp); } catch (e) {} }
    fs.rmdirSync(cur.dir);
  } catch (e) {}

  // keep last recording timing in memory for transcription interleave
  lastRecording = { sessionId: cur.sessionId, manifest, mixdown, tmsByUser, durationMs: maxDuration(tmsByUser) };
  const result = { ok: true, manifest, mixdown, durationMs: lastRecording.durationMs };
  send('recordingComplete', result);
  send('status', status());
  return result;
}

let lastRecording = null;

function maxDuration(tmsByUser) {
  let m = 0;
  for (const k of Object.keys(tmsByUser)) { const t = tmsByUser[k].tms; if (t && t.length) m = Math.max(m, Math.max(...t) + 20); }
  return m;
}

function readTempToWav(temp, frames) {
  const fd = fs.openSync(temp, 'r');
  try {
    const tms = [];
    const pcmChunks = [];
    const buf = Buffer.allocUnsafe(REC_BYTES);
    for (let i = 0; i < frames; i++) {
      const n = fs.readSync(fd, buf, 0, REC_BYTES, i * REC_BYTES);
      if (n < REC_BYTES) break;
      tms.push(buf.readInt32LE(0));
      pcmChunks.push(Buffer.from(buf.slice(4)));
    }
    const pcm = Buffer.concat(pcmChunks);
    // min/max guards against any non-monotonic timestamp (e.g. a system clock jump).
    const durationMs = tms.length ? (Math.max(...tms) - Math.min(...tms) + 20) : 0;
    return { wavBuf: wavFromPcm(pcm), tms, durationMs };
  } finally { try { fs.closeSync(fd); } catch (e) {} }
}

// time-aligned mono16k mixdown from timed temp files (cursor-based, bounded memory)
function buildMixdown(temps, onProgress) {
  const readers = temps.map((t) => ({ fd: fs.openSync(t.temp, 'r'), frames: t.frames, idx: 0, buf: Buffer.allocUnsafe(REC_BYTES), slot: -1, pcm: null }));
  const advance = (r) => {
    if (r.idx >= r.frames) { r.slot = Infinity; r.pcm = null; return; }
    const n = fs.readSync(r.fd, r.buf, 0, REC_BYTES, r.idx * REC_BYTES);
    r.idx++;
    if (n < REC_BYTES) { r.slot = Infinity; r.pcm = null; return; }
    r.slot = Math.round(r.buf.readInt32LE(0) / 20); // 20ms slots
    r.pcm = Buffer.from(r.buf.slice(4));
  };
  try {
    readers.forEach(advance);
    const chunks = [];
    let cursor = 0;
    let maxSlot = 0;
    readers.forEach((r) => { if (r.frames > 0 && isFinite(r.slot)) maxSlot = Math.max(maxSlot, r.slot); });
    // also account for tail: re-scan not needed, we stop when all readers exhausted
    let guard = 0;
    const SILENCE = Buffer.alloc(OUT_FRAME * 2);
    while (true) {
      let s = Infinity;
      for (const r of readers) if (r.slot < s) s = r.slot;
      if (!isFinite(s)) break;
      // gap fill
      while (cursor < s) { chunks.push(SILENCE); cursor++; if (++guard > 50_000_000) throw new Error('mixdown overrun'); }
      // sum all readers at slot s
      const mix = new Int32Array(OUT_FRAME);
      for (const r of readers) {
        while (r.slot === s) {
          for (let i = 0; i < OUT_FRAME; i++) mix[i] += r.pcm.readInt16LE(i * 2);
          advance(r);
        }
      }
      const outF = Buffer.allocUnsafe(OUT_FRAME * 2);
      for (let i = 0; i < OUT_FRAME; i++) { let v = mix[i]; if (v > 32767) v = 32767; else if (v < -32768) v = -32768; outF.writeInt16LE(v, i * 2); }
      chunks.push(outF);
      cursor = s + 1;
      if (onProgress && maxSlot && (cursor % 500 === 0)) onProgress(Math.min(99, Math.round((cursor / maxSlot) * 100)));
    }
    if (onProgress) onProgress(100);
    return wavFromPcm(Buffer.concat(chunks));
  } finally { readers.forEach((r) => { try { fs.closeSync(r.fd); } catch (e) {} }); }
}

function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(OUT_RATE, 24);
  header.writeUInt32LE(OUT_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

function sanitizeName(s) { return String(s || 'track').replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 60) || 'track'; }

// ---------------------------------------------------------------------------
// Transcription (per-user, interleaved by absolute time)
// ---------------------------------------------------------------------------

async function transcribeRecording(callerManifest) {
  if (!deps.transcribe) return { ok: false, reason: 'no-transcriber' };
  // Prefer the in-memory recording (has per-frame timing for true interleaving);
  // fall back to the session's saved manifest (e.g. after an app restart) → per-speaker blocks.
  let src = lastRecording;
  if (!src || !src.manifest || !src.manifest.length) {
    if (Array.isArray(callerManifest) && callerManifest.length) src = { manifest: callerManifest, tmsByUser: {} };
    else return { ok: false, reason: 'no-recording' };
  }
  const apiKey = await deps.store.getSecret('transcription');
  if (!apiKey) return { ok: false, reason: 'no-key' };
  const settings = await deps.store.getSettings();
  const segments = [];
  const perUser = [];
  for (const tr of src.manifest) {
    try {
      const buf = await deps.store.readMedia('audio', tr.mediaId);
      const r = await deps.transcribe.whisper({ apiKey, audioBuffer: buf, filename: tr.label + '.wav', model: settings.transcriptionModel || 'whisper-1', baseUrl: settings.transcriptionBaseUrl, responseFormat: 'verbose_json' });
      perUser.push({ label: tr.label, text: r.text });
      const tinfo = src.tmsByUser[tr.userId];
      const tms = tinfo ? tinfo.tms : null;
      if (Array.isArray(r.segments) && r.segments.length && tms) {
        for (const seg of r.segments) {
          const frameIdx = Math.min(tms.length - 1, Math.max(0, Math.round((seg.start || 0) * 50))); // 50 frames/sec
          segments.push({ label: tr.label, role: tr.role, at: tms[frameIdx], text: (seg.text || '').trim() });
        }
      } else if (r.text) {
        segments.push({ label: tr.label, role: tr.role, at: tr.startOffsetMs || 0, text: r.text.trim() });
      }
      send('transcribeProgress', { label: tr.label });
    } catch (e) { log('transcribe failed', tr.label, e.message); perUser.push({ label: tr.label, text: '', error: e.message }); }
  }
  segments.sort((a, b) => a.at - b.at);
  const transcript = segments.map((s) => `${s.label}: ${s.text}`).filter((l) => l.trim().length > (l.indexOf(':') + 2)).join('\n');
  return { ok: true, transcript, perUser, segments };
}

// ---------------------------------------------------------------------------
// Text relay + presence
// ---------------------------------------------------------------------------

async function postMessage(channelId, message) {
  if (!client || !ready) return { ok: false, reason: 'not-connected' };
  const id = channelId || cachedSettings.discordTextChannelId;
  if (!id) return { ok: false, reason: 'no-channel' };
  try {
    const ch = await client.channels.fetch(id);
    if (!ch || !ch.isTextBased || !ch.isTextBased()) return { ok: false, reason: 'not-text' };
    if (message && typeof message === 'object' && message.embed) await ch.send({ embeds: [embedFrom(message.embed)] });
    else await ch.send(String(message).slice(0, 1900));
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'send-failed', detail: e.message }; }
}

async function setPresence(text) {
  if (!client || !client.user) return { ok: false };
  try { client.user.setPresence({ activities: [{ name: String(text).slice(0, 120) }], status: 'online' }); return { ok: true }; } catch (e) { return { ok: false, detail: e.message }; }
}

// ---------------------------------------------------------------------------
// Audio broadcast (play a file to the voice channel) — NO ffmpeg.
// We feed Discord raw Opus packets directly: Ogg/Opus & WebM/Opus are demuxed
// (prism), WAV is decoded + opus-encoded (opusscript). Anything else (mp3, flac,
// Ogg/Vorbis) needs ffmpeg, which we don't bundle — those are rejected cleanly
// instead of letting @discordjs/voice fall back to a missing ffmpeg.
// ---------------------------------------------------------------------------

function stopBroadcast() {
  if (player) { try { player.removeAllListeners(); player.stop(true); } catch (e) {} player = null; }
}

// Peek the Ogg header to distinguish Opus (playable) from Vorbis (needs ffmpeg).
function isOggOpus(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).includes('OpusHead');
  } catch (e) { return false; }
}

async function broadcastFile(filePath, opts = {}) {
  if (!conn || !voiceInfo) return { ok: false, reason: 'not-in-voice' };
  const ext = (path.extname(filePath || '') || '').toLowerCase();
  let resource;
  try {
    if (ext === '.ogg' || ext === '.opus') {
      if (!prism || !isOggOpus(filePath)) return { ok: false, reason: 'needs-ffmpeg', detail: 'This file is Ogg/Vorbis (not Opus). Broadcasting it needs ffmpeg on PATH; use a WAV or Opus file instead.' };
      const demux = fs.createReadStream(filePath).pipe(new prism.opus.OggDemuxer());
      demux.on('error', (e) => { log('ogg demux error', e.message); stopBroadcast(); });
      resource = voice.createAudioResource(demux, { inputType: voice.StreamType.Opus });
    } else if (ext === '.webm') {
      if (!prism) return { ok: false, reason: 'needs-ffmpeg', detail: 'WebM broadcast requires prism-media.' };
      const demux = fs.createReadStream(filePath).pipe(new prism.opus.WebmDemuxer());
      demux.on('error', (e) => { log('webm demux error', e.message); stopBroadcast(); });
      resource = voice.createAudioResource(demux, { inputType: voice.StreamType.Opus });
    } else if (ext === '.wav') {
      let buf;
      try {
        const st = await fsp.stat(filePath);
        if (st.size > 120 * 1024 * 1024) return { ok: false, reason: 'too-large', detail: 'WAV is over 120 MB; convert to Ogg/Opus to broadcast.' };
        buf = await fsp.readFile(filePath); // async — never blocks the voice heartbeat
      } catch (e) { return { ok: false, reason: 'read-failed', detail: e.message }; }
      const stream = wavToOpusStream(buf);
      if (!stream) return { ok: false, reason: 'bad-wav', detail: 'Not a readable 16-bit PCM WAV file.' };
      resource = voice.createAudioResource(stream, { inputType: voice.StreamType.Opus });
    } else {
      return { ok: false, reason: 'unsupported-format', detail: ext + ' needs ffmpeg; use an Ogg/Opus or WAV file' };
    }
  } catch (e) { return { ok: false, reason: 'resource-failed', detail: e.message }; }
  if (!player) { player = voice.createAudioPlayer(); conn.subscribe(player); }
  player.removeAllListeners(voice.AudioPlayerStatus.Idle); // avoid stacking loop handlers
  player.play(resource);
  // once() so a failed re-broadcast can't leave a stale Idle listener firing in a livelock
  if (opts.loop) player.once(voice.AudioPlayerStatus.Idle, () => { broadcastFile(filePath, opts).catch(() => {}); });
  return { ok: true };
}

// Encode a 16-bit PCM WAV (passed as a Buffer) into an Opus packet stream for Discord
// (opusscript). Returns null for anything that isn't a readable PCM16 WAV.
const { Readable } = require('stream');
function wavToOpusStream(buf) {
  if (!buf || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12, dataOff = -1, dataLen = 0, rate = 48000, ch = 1, bits = 16;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 24 <= buf.length) { ch = buf.readUInt16LE(off + 10) || 1; rate = buf.readUInt32LE(off + 12) || 48000; bits = buf.readUInt16LE(off + 22) || 16; }
    else if (id === 'data') { dataOff = off + 8; dataLen = Math.min(sz, buf.length - dataOff); break; }
    off += 8 + sz + (sz & 1);
  }
  if (dataOff < 0 || dataLen <= 0 || bits !== 16) return null;
  const enc = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  const FR = 960; // 20ms @48k stereo
  const bps = (bits / 8) * ch; // bytes per source sample-frame
  const samples = Math.floor(dataLen / bps);
  const out = new Readable({ read() {} });
  let done = false;
  const cleanup = () => { if (done) return; done = true; try { enc.delete(); } catch (e) {} };
  out.on('close', cleanup); // free the encoder if playback is stopped/abandoned
  let s = 0;
  const pump = () => {
    if (done) return;
    let pushed = 0;
    while (s < samples && pushed < 15) { // small batches so encoding never blocks the loop for long
      const frame = Buffer.allocUnsafe(FR * 2 * 2); // stereo int16
      for (let i = 0; i < FR; i++) {
        const srcIdx = Math.floor(((s + i) / 48000) * rate); // map 48k output sample -> source sample
        let l = 0, r = 0;
        if (srcIdx < samples) {
          const base = dataOff + srcIdx * bps;
          if (base + 2 <= buf.length) l = buf.readInt16LE(base);
          r = (ch > 1 && base + 4 <= buf.length) ? buf.readInt16LE(base + 2) : l;
        }
        frame.writeInt16LE(l, i * 4); frame.writeInt16LE(r, i * 4 + 2);
      }
      try { out.push(enc.encode(frame, FR)); } catch (e) {}
      s += FR; pushed++;
    }
    if (s >= samples) { cleanup(); out.push(null); }
    else setImmediate(pump);
  };
  pump();
  return out;
}

module.exports = {
  available, init, connect, disconnect, status,
  listVoiceChannels, listTextChannels,
  joinVoice, leaveVoice,
  startRecording, stopRecording, transcribeRecording,
  postMessage, setPresence,
  slashReply, broadcastFile, stopBroadcast,
  refreshSettings: async () => { cachedSettings = (deps.store ? await deps.store.getSettings() : {}) || {}; if (ready && cachedSettings.discordSlashCommands !== false) registerCommands().catch(() => {}); return { ok: true }; },
  getMembers: () => currentMembers(),
  // exported for offline tests of the audio pipeline (no Discord connection needed)
  _test: { downmixDecimate, wavFromPcm, buildMixdown, readTempToWav, decodeUserRecording, REC_BYTES, OUT_FRAME, OUT_RATE, FRAME_SAMPLES, IN_CH },
};
