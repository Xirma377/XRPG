// Renderer-side Discord client. Subscribes to main-process discord events once and
// re-broadcasts via an Emitter, while caching live status/members/speaking state.
import { Emitter } from './util.js';

class Discord extends Emitter {
  constructor() {
    super();
    this.status = { available: false, connected: false };
    this.members = [];
    this.speaking = new Set();
    this.recording = null;
    if (window.xrpg && window.xrpg.discord && window.xrpg.discord.onEvent) {
      window.xrpg.discord.onEvent((e) => this._onEvent(e));
    }
  }

  _onEvent(e) {
    if (!e) return;
    switch (e.type) {
      case 'status': case 'ready':
        this.status = e; if (Array.isArray(e.members)) this.members = e.members; this.recording = e.recording || null; break;
      case 'members': case 'voiceJoin':
        if (Array.isArray(e.members)) this.members = e.members; break;
      case 'voiceLeave':
        this.members = []; this.speaking = new Set(); break;
      case 'speaking':
        if (e.speaking) this.speaking.add(e.userId); else this.speaking.delete(e.userId); break;
      case 'recordingState':
        this.recording = e.active ? { active: true, sessionId: e.sessionId } : null; break;
      default: break;
    }
    this.emit(e.type, e);
    this.emit('any', e);
  }

  // pass-throughs (each returns a promise; callers try/catch)
  async refreshStatus() { try { this.status = await window.xrpg.discord.status(); if (Array.isArray(this.status.members)) this.members = this.status.members; this.emit('status', this.status); } catch (e) {} return this.status; }
  available() { return window.xrpg.discord.available(); }
  hasToken() { return window.xrpg.discord.hasToken(); }
  setToken(t) { return window.xrpg.discord.setToken(t); }
  connect() { return window.xrpg.discord.connect(); }
  disconnect() { return window.xrpg.discord.disconnect(); }
  voiceChannels(g) { return window.xrpg.discord.voiceChannels(g); }
  textChannels(g) { return window.xrpg.discord.textChannels(g); }
  joinVoice(g, c) { return window.xrpg.discord.joinVoice(g, c); }
  leaveVoice() { return window.xrpg.discord.leaveVoice(); }
  startRecording(sid, opts) { return window.xrpg.discord.startRecording(sid, opts); }
  stopRecording(opts) { return window.xrpg.discord.stopRecording(opts); }
  transcribeRecording(manifest) { return window.xrpg.discord.transcribeRecording(manifest); }
  postMessage(c, m) { return window.xrpg.discord.postMessage(c, m); }
  setPresence(t) { return window.xrpg.discord.setPresence(t); }
  slashReply(id, reply) { return window.xrpg.discord.slashReply(id, reply); }
  refreshSettings() { return window.xrpg.discord.refreshSettings(); }
  broadcast(kind, mediaId, opts) { return window.xrpg.discord.broadcast(kind, mediaId, opts); }
  stopBroadcast() { return window.xrpg.discord.stopBroadcast(); }
}

export const discord = new Discord();
export default discord;
