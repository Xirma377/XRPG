// Live "broadcast app audio to Discord": tap the audio engine's master output and
// stream it to the bot as a CONTINUOUS 48 kHz stereo PCM feed (not MediaRecorder/WebM,
// which delivers bursty container chunks that stutter). The bot frames + Opus-encodes
// it. Covers the soundboard, mixer, every format — because we capture decoded output.
import audio from './audio-engine.js';
import discord from './discord.js';

let active = false;
let captureDest = null;   // MediaStreamDestination in the engine context
let capCtx = null;        // a 48 kHz context that resamples the captured stream
let srcNode = null;
let proc = null;
let capSink = null;

export function isBroadcasting() { return active; }

export async function startAppBroadcast() {
  if (active) return { ok: true };
  active = true;
  audio.ensure();
  if (!audio.ctx || !audio.master) { active = false; return { ok: false, reason: 'audio-not-started' }; }
  const r = await discord.liveStart().catch((e) => ({ ok: false, reason: e.message }));
  if (!r || r.ok === false) { active = false; return r || { ok: false, reason: 'liveStart-failed' }; }
  try {
    // tap master (parallel to the speakers) → a MediaStream → a 48k context that
    // resamples it → a ScriptProcessor that hands us 48k stereo PCM.
    captureDest = audio.ctx.createMediaStreamDestination();
    audio.master.connect(captureDest);
    const AC = window.AudioContext || window.webkitAudioContext;
    capCtx = new AC({ sampleRate: 48000 });
    srcNode = capCtx.createMediaStreamSource(captureDest.stream);
    proc = capCtx.createScriptProcessor(2048, 2, 2);
    capSink = capCtx.createMediaStreamDestination(); // keeps proc processing, no speaker output
    srcNode.connect(proc);
    proc.connect(capSink);
    proc.onaudioprocess = (e) => {
      if (!active) return;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
      const n = inL.length;
      const pcm = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) {
        let l = inL[i] * 32767; if (l > 32767) l = 32767; else if (l < -32768) l = -32768;
        let rr = inR[i] * 32767; if (rr > 32767) rr = 32767; else if (rr < -32768) rr = -32768;
        pcm[2 * i] = l; pcm[2 * i + 1] = rr;
      }
      discord.liveChunk(new Uint8Array(pcm.buffer));
    };
    return { ok: true };
  } catch (e) {
    await stopAppBroadcast();
    return { ok: false, reason: 'capture-failed', detail: e.message };
  }
}

export async function stopAppBroadcast() {
  active = false;
  try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } } catch (e) {}
  try { if (srcNode) srcNode.disconnect(); } catch (e) {}
  try { if (capSink) capSink.disconnect(); } catch (e) {}
  try { if (captureDest && audio.master) audio.master.disconnect(captureDest); } catch (e) {}
  try { if (capCtx && capCtx.state !== 'closed') await capCtx.close(); } catch (e) {}
  proc = srcNode = capSink = captureDest = capCtx = null;
  try { await discord.liveStop(); } catch (e) {}
  return { ok: true };
}

export default { isBroadcasting, startAppBroadcast, stopAppBroadcast };
