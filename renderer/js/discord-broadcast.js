// Live "broadcast app audio to Discord": tap the audio engine's master output,
// record it as WebM/Opus via MediaRecorder, and stream the chunks to the bot,
// which feeds them straight into the voice channel. Covers the soundboard, the
// mixer, and every format — because we capture the decoded output, not files.
import audio from './audio-engine.js';
import discord from './discord.js';

let recorder = null;
let dest = null;
let active = false;

export function isBroadcasting() { return active; }

export async function startAppBroadcast() {
  if (active) return { ok: true };
  active = true; // claim immediately so a re-entrant call can't build a second recorder
  audio.ensure();
  if (!audio.ctx || !audio.master) { active = false; return { ok: false, reason: 'audio-not-started' }; }
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    active = false; return { ok: false, reason: 'unsupported', detail: 'This build can’t capture WebM/Opus audio.' };
  }
  const r = await discord.liveStart().catch((e) => ({ ok: false, reason: e.message }));
  if (!r || r.ok === false) { active = false; return r || { ok: false, reason: 'liveStart-failed' }; }
  try {
    dest = audio.ctx.createMediaStreamDestination();
    audio.master.connect(dest); // tap master in parallel with the speakers
    recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 96000 });
    recorder.ondataavailable = async (e) => {
      if (!active || !e.data || !e.data.size) return;
      try { const ab = await e.data.arrayBuffer(); discord.liveChunk(new Uint8Array(ab)); } catch (err) {}
    };
    recorder.onerror = () => { stopAppBroadcast(); };
    recorder.start(100); // 100ms chunks → smoother feed, smaller gaps
    active = true;
    return { ok: true };
  } catch (e) {
    await stopAppBroadcast();
    return { ok: false, reason: 'capture-failed', detail: e.message };
  }
}

export async function stopAppBroadcast() {
  active = false;
  try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
  recorder = null;
  try { if (dest && audio.master) audio.master.disconnect(dest); } catch (e) {}
  dest = null;
  try { await discord.liveStop(); } catch (e) {}
  return { ok: true };
}

export default { isBroadcasting, startAppBroadcast, stopAppBroadcast };
