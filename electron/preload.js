'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function unwrap(res) {
  if (res && res.ok) return res.data;
  throw new Error((res && res.error) || 'IPC error');
}

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).then(unwrap);

// ---- Streaming AI: route events by requestId to per-call handlers ----
const streamHandlers = new Map();
ipcRenderer.on('ai:stream:event', (_evt, payload) => {
  const h = streamHandlers.get(payload.requestId);
  if (!h) return;
  h(payload);
  if (payload.type === 'done' || payload.type === 'error') {
    streamHandlers.delete(payload.requestId);
  }
});

let reqCounter = 0;
function nextRequestId() {
  reqCounter += 1;
  return `req_${Date.now().toString(36)}_${reqCounter}`;
}

const api = {
  // ---- generic store ----
  store: {
    list: (coll) => invoke('store:list', coll),
    get: (coll, id) => invoke('store:get', coll, id),
    put: (coll, doc) => invoke('store:put', coll, doc),
    remove: (coll, id) => invoke('store:remove', coll, id),
    exportAll: () => invoke('store:exportAll'),
    importAll: (dump, opts) => invoke('store:importAll', dump, opts),
    exportDoc: (coll, id) => invoke('store:exportDoc', coll, id),
    reseed: (opts) => invoke('store:reseed', opts),
    onChanged: (cb) => ipcRenderer.on('store:changed', (_e, p) => cb(p)),
  },

  window: {
    popout: (route, mode) => invoke('window:popout', route, mode),
  },

  updates: {
    available: () => invoke('update:available'),
    check: () => invoke('update:check'),
    install: () => invoke('update:install'),
    onEvent: (cb) => ipcRenderer.on('update:event', (_e, p) => cb(p)),
  },

  discord: {
    available: () => invoke('discord:available'),
    status: () => invoke('discord:status'),
    setToken: (token) => invoke('discord:setToken', token),
    hasToken: () => invoke('discord:hasToken'),
    connect: () => invoke('discord:connect'),
    disconnect: () => invoke('discord:disconnect'),
    voiceChannels: (guildId) => invoke('discord:voiceChannels', guildId),
    textChannels: (guildId) => invoke('discord:textChannels', guildId),
    members: () => invoke('discord:members'),
    joinVoice: (guildId, channelId) => invoke('discord:joinVoice', guildId, channelId),
    leaveVoice: () => invoke('discord:leaveVoice'),
    startRecording: (sessionId, opts) => invoke('discord:startRecording', sessionId, opts),
    stopRecording: (opts) => invoke('discord:stopRecording', opts),
    transcribeRecording: (manifest) => invoke('discord:transcribeRecording', manifest),
    postMessage: (channelId, message) => invoke('discord:postMessage', channelId, message),
    setPresence: (text) => invoke('discord:setPresence', text),
    slashReply: (requestId, reply) => invoke('discord:slashReply', requestId, reply),
    refreshSettings: () => invoke('discord:refreshSettings'),
    broadcast: (kind, mediaId, opts) => invoke('discord:broadcast', kind, mediaId, opts),
    stopBroadcast: () => invoke('discord:stopBroadcast'),
    onEvent: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('discord:event', h); return () => ipcRenderer.removeListener('discord:event', h); },
  },

  settings: {
    get: () => invoke('settings:get'),
    set: (obj) => invoke('settings:set', obj),
  },

  secret: {
    has: (key) => invoke('secret:has', key),
    set: (key, value) => invoke('secret:set', key, value),
  },

  media: {
    save: (kind, filename, base64) => invoke('media:save', kind, filename, base64),
    saveBase64: (kind, filename, base64) => invoke('media:saveBase64', kind, filename, base64),
    read: (kind, id) => invoke('media:read', kind, id),
    delete: (kind, id) => invoke('media:delete', kind, id),
    importFile: (kind, filters) => invoke('media:importFile', kind, filters),
  },

  ai: {
    models: () => invoke('ai:models'),
    complete: (opts) => invoke('ai:complete', opts),
    test: (model) => invoke('ai:test', model),
    // stream(opts, onEvent) -> { cancel() }
    stream: (opts, onEvent) => {
      const requestId = nextRequestId();
      streamHandlers.set(requestId, onEvent);
      ipcRenderer.invoke('ai:stream:start', requestId, opts).then((res) => {
        if (res && res.ok === false) {
          const h = streamHandlers.get(requestId);
          if (h) { h({ type: 'error', error: res.error || 'stream failed' }); streamHandlers.delete(requestId); }
        }
      });
      return {
        cancel: () => ipcRenderer.invoke('ai:stream:cancel', requestId),
        requestId,
      };
    },
  },

  transcribe: {
    whisper: (args) => invoke('transcribe:whisper', args),
  },

  audio: {
    manifest: () => invoke('audio:manifest'),
    cached: () => invoke('audio:cached'),
    fetch: (track) => invoke('audio:fetch', track),
    forget: (id) => invoke('audio:forget', id),
  },

  dialog: {
    saveJson: (name, data) => invoke('dialog:saveJson', name, data),
    openJson: () => invoke('dialog:openJson'),
    saveText: (name, text) => invoke('dialog:saveText', name, text),
  },

  app: {
    info: () => invoke('app:info'),
  },

  shell: {
    openExternal: (url) => invoke('shell:openExternal', url),
    openDataFolder: () => invoke('shell:openDataFolder'),
  },

  clipboard: {
    write: (text) => invoke('clipboard:write', text),
    read: () => invoke('clipboard:read'),
  },

  test: {
    report: (results) => invoke('test:report', results),
  },
};

contextBridge.exposeInMainWorld('xrpg', api);
