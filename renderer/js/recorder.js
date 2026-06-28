// Session audio recorder: MediaRecorder + best-effort live speech-to-text.
import { Emitter, blobToBase64 } from './util.js';
import store from './store.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Recorder extends Emitter {
  constructor() {
    super();
    this.state = 'idle'; // idle | recording | paused | stopped
    this.chunks = [];
    this.mediaRecorder = null;
    this.stream = null;
    this.startedAt = 0;
    this.elapsed = 0;
    this.transcript = '';
    this.interim = '';
    this.recognition = null;
    this.supportsSpeech = !!SR;
    this._timer = null;
  }

  async start() {
    if (this.state === 'recording') return;
    // Note: transcript is NOT cleared here — cross-session bleed is prevented by
    // the runner calling reset() when a session opens, and the caller seeds
    // this.transcript from any existing/pasted transcript so it's appended to.
    this.interim = '';
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.chunks = [];
    this.mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.mediaRecorder.start(1000);
    this.startedAt = performance.now();
    this.elapsed = 0;
    this.state = 'recording';
    this._startTimer();
    this._startSpeech();
    this.emit('state', this.state);
  }

  _startTimer() {
    this._timer = setInterval(() => {
      if (this.state === 'recording') { this.elapsed = (performance.now() - this.startedAt) / 1000; this.emit('tick', this.elapsed); }
    }, 250);
  }

  _startSpeech() {
    if (!SR) { this.emit('speech-unavailable'); return; }
    try {
      this.recognition = new SR();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
      this.recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) this.transcript += (this.transcript && !this.transcript.endsWith(' ') ? ' ' : '') + r[0].transcript.trim();
          else interim += r[0].transcript;
        }
        this.interim = interim;
        this.emit('transcript', { transcript: this.transcript, interim });
      };
      this.recognition.onerror = (e) => { this.emit('speech-error', e.error); };
      this.recognition.onend = () => { if (this.state === 'recording') { try { this.recognition.start(); } catch {} } };
      this.recognition.start();
    } catch (e) { this.emit('speech-unavailable'); }
  }

  pause() { if (this.state !== 'recording') return; this.mediaRecorder.pause(); this.state = 'paused'; if (this.recognition) try { this.recognition.stop(); } catch {} this.emit('state', this.state); }
  resume() { if (this.state !== 'paused') return; this.mediaRecorder.resume(); this.startedAt = performance.now() - this.elapsed * 1000; this.state = 'recording'; this._startSpeech(); this.emit('state', this.state); }

  async stop() {
    if (!this.mediaRecorder || (this.state !== 'recording' && this.state !== 'paused')) return null;
    // Set state BEFORE stopping recognition so its async onend won't restart it.
    this.state = 'stopped';
    const done = new Promise((resolve) => { this.mediaRecorder.onstop = () => resolve(); });
    this.mediaRecorder.stop();
    if (this.recognition) { try { this.recognition.onend = null; this.recognition.stop(); } catch {} }
    clearInterval(this._timer);
    await done;
    this.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(this.chunks, { type: 'audio/webm' });
    this.emit('state', this.state);
    return blob;
  }

  async saveBlob(blob) {
    const b64 = await blobToBase64(blob);
    const saved = await store.saveMediaBase64('audio', `session-${Date.now()}.webm`, b64);
    return saved;
  }

  reset() {
    if (this.state === 'recording' || this.state === 'paused') { try { this.mediaRecorder.stop(); } catch {} try { this.recognition && this.recognition.stop(); } catch {} if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); }
    clearInterval(this._timer);
    this.state = 'idle'; this.elapsed = 0; this.transcript = ''; this.interim = ''; this.chunks = [];
  }
}
