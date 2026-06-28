'use strict';
// Offline tests for the Discord recording audio pipeline (no bot/connection needed).
// Run: node scripts/test-discord-audio.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const discord = require('../electron/discord.js');
const T = discord._test;
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; } else { fail++; console.log('  ✗', name, detail || ''); } };

// 1. WAV header is correct (mono 16k 16-bit)
(() => {
  const pcm = Buffer.alloc(T.OUT_FRAME * 2 * 5); // 5 frames of silence
  const wav = T.wavFromPcm(pcm);
  ok('wav: RIFF/WAVE magic', wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE');
  ok('wav: PCM format', wav.readUInt16LE(20) === 1);
  ok('wav: mono', wav.readUInt16LE(22) === 1);
  ok('wav: 16kHz', wav.readUInt32LE(24) === T.OUT_RATE);
  ok('wav: 16-bit', wav.readUInt16LE(34) === 16);
  ok('wav: data size matches', wav.readUInt32LE(40) === pcm.length && wav.length === 44 + pcm.length);
})();

// 2. downmixDecimate: stereo 48k frame -> mono 16k (320 samples), averaging works
(() => {
  // build a 960-sample stereo frame with L=1000, R=2000 everywhere -> mono = 1500
  const frame = Buffer.alloc(T.FRAME_SAMPLES * T.IN_CH * 2);
  for (let i = 0; i < T.FRAME_SAMPLES; i++) { frame.writeInt16LE(1000, i * 4); frame.writeInt16LE(2000, i * 4 + 2); }
  const mono = T.downmixDecimate(frame);
  ok('downmix: output length 320 samples', mono.length === T.OUT_FRAME * 2, String(mono.length));
  let allMid = true; for (let i = 0; i < T.OUT_FRAME; i++) { if (mono.readInt16LE(i * 2) !== 1500) { allMid = false; break; } }
  ok('downmix: (L+R)/2 averaging', allMid);
  // clipping guard
  const loud = Buffer.alloc(T.FRAME_SAMPLES * T.IN_CH * 2);
  for (let i = 0; i < T.FRAME_SAMPLES; i++) { loud.writeInt16LE(32767, i * 4); loud.writeInt16LE(32767, i * 4 + 2); }
  const lm = T.downmixDecimate(loud);
  ok('downmix: no overflow', lm.readInt16LE(0) === 32767);
})();

// 3. round-trip a timed temp file -> WAV, and mixdown of two overlapping users sums + aligns
(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xrpg-rectest-'));
  const writeTemp = (file, frames) => { // frames: [{tMs, value}]
    const fd = fs.openSync(file, 'w');
    for (const f of frames) {
      const buf = Buffer.alloc(T.REC_BYTES);
      buf.writeInt32LE(f.tMs, 0);
      for (let i = 0; i < T.OUT_FRAME; i++) buf.writeInt16LE(f.value, 4 + i * 2);
      fs.writeSync(fd, buf);
    }
    fs.closeSync(fd);
    return frames.length;
  };
  // user A speaks at slot 0 and slot 2 (value 100); user B speaks at slot 2 (value 50)
  const aFile = path.join(dir, 'a.pcmt');
  const bFile = path.join(dir, 'b.pcmt');
  const aN = writeTemp(aFile, [{ tMs: 0, value: 100 }, { tMs: 40, value: 100 }]); // slots 0 and 2
  const bN = writeTemp(bFile, [{ tMs: 40, value: 50 }]); // slot 2

  // per-user WAV
  const a = T.readTempToWav(aFile, aN);
  ok('readTempToWav: tms captured', a.tms.length === 2 && a.tms[0] === 0 && a.tms[1] === 40);
  ok('readTempToWav: wav frames', a.wavBuf.length === 44 + aN * T.OUT_FRAME * 2);

  // mixdown: slot0=A(100), slot1=silence(0), slot2=A+B(150)
  const mix = T.buildMixdown([{ temp: aFile, frames: aN }, { temp: bFile, frames: bN }], null);
  ok('mixdown: produced wav', mix && mix.length > 44);
  const data = mix.slice(44);
  const sampleAt = (slot) => data.readInt16LE(slot * T.OUT_FRAME * 2);
  ok('mixdown: slot0 = A only (100)', sampleAt(0) === 100, String(sampleAt(0)));
  ok('mixdown: slot1 = silence (gap filled)', sampleAt(1) === 0, String(sampleAt(1)));
  ok('mixdown: slot2 = A+B summed (150)', sampleAt(2) === 150, String(sampleAt(2)));
  ok('mixdown: length covers 3 slots', data.length === 3 * T.OUT_FRAME * 2, String(data.length));

  try { fs.unlinkSync(aFile); fs.unlinkSync(bFile); fs.rmdirSync(dir); } catch (e) {}
})();

// 4. deferred-decode round trip: raw [tMs|len|opus] -> decodeUserRecording -> decoded frames
(() => {
  const OpusScript = require('../node_modules/opusscript');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xrpg-decode-'));
  const rawTemp = path.join(dir, 'u.opus');
  const decTemp = path.join(dir, 'u.dec');
  const enc = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  const FR = 960; // 20ms @48k stereo
  const fd = fs.openSync(rawTemp, 'w');
  const PACKETS = 5;
  for (let p = 0; p < PACKETS; p++) {
    // a non-silent stereo frame so decode produces real samples
    const frame = Buffer.alloc(FR * 2 * 2);
    for (let i = 0; i < FR; i++) { const v = ((i + p) % 200) * 30 - 3000; frame.writeInt16LE(v, i * 4); frame.writeInt16LE(v, i * 4 + 2); }
    const packet = enc.encode(frame, FR);
    const head = Buffer.allocUnsafe(6);
    head.writeInt32LE(p * 20, 0);            // 20ms apart
    head.writeUInt16LE(packet.length, 4);
    fs.writeSync(fd, head); fs.writeSync(fd, packet);
  }
  fs.closeSync(fd); try { enc.delete(); } catch (e) {}

  const frames = T.decodeUserRecording(rawTemp, decTemp);
  ok('decodeUserRecording: frame per packet', frames === PACKETS, frames + '/' + PACKETS);
  const r = T.readTempToWav(decTemp, frames);
  ok('decoded: tms preserved & spaced 20ms', r.tms.length === PACKETS && r.tms[0] === 0 && r.tms[PACKETS - 1] === (PACKETS - 1) * 20);
  ok('decoded: WAV is mono16k 16-bit of right length', r.wavBuf.length === 44 + PACKETS * T.OUT_FRAME * 2);
  // truncated / garbage trailer must not crash or add frames
  fs.appendFileSync(rawTemp, Buffer.from([0, 0, 0, 0, 50, 0])); // a header claiming 50 bytes with no body
  const frames2 = T.decodeUserRecording(rawTemp, decTemp);
  ok('decodeUserRecording: ignores truncated trailing record', frames2 === PACKETS, String(frames2));

  try { fs.unlinkSync(rawTemp); fs.unlinkSync(decTemp); fs.rmdirSync(dir); } catch (e) {}
})();

console.log(`[discord-audio] ${pass} passed, ${fail} failed`);
// Exit gracefully (process.exitCode, not process.exit) so libuv can close the
// opusscript WASM handles cleanly instead of asserting on an abrupt teardown.
process.exitCode = fail ? 1 : 0;
