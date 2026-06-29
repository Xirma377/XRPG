'use strict';

const { dialog, shell, app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function registerIpc({ ipcMain, store, ai, transcribe, updater, discord, getWindow, createPopout }) {
  const streams = new Map(); // requestId -> AbortController
  const { BrowserWindow } = require('electron');
  const broadcast = (channel, payload, exceptId) => { BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed() && w.webContents.id !== exceptId) w.webContents.send(channel, payload); }); };

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_evt, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (err) {
        console.error(`[ipc:${channel}]`, err);
        return { ok: false, error: err.message || String(err) };
      }
    });
  };

  // ---- Store CRUD ----
  handle('store:list', (coll) => store.list(coll));
  handle('store:get', (coll, id) => store.get(coll, id));
  // put/remove broadcast a change so other windows (e.g. a popped-out player display) stay live.
  ipcMain.handle('store:put', async (_e, coll, doc) => { try { const saved = await store.put(coll, doc); broadcast('store:changed', { coll, id: saved.id }, _e.sender.id); return { ok: true, data: saved }; } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('store:remove', async (_e, coll, id) => { try { const r = await store.remove(coll, id); broadcast('store:changed', { coll, id, removed: true }, _e.sender.id); return { ok: true, data: r }; } catch (err) { return { ok: false, error: err.message }; } });
  handle('store:exportAll', () => store.exportAll());
  handle('store:importAll', (dump, opts) => store.importAll(dump, opts));
  handle('store:exportDoc', (coll, id) => store.exportDoc(coll, id));
  handle('store:reseed', (opts) => store.reseed(opts));

  // ---- Settings ----
  handle('settings:get', () => store.getSettings());
  handle('settings:set', (obj) => store.setSettings(obj));

  // ---- Secrets (never expose the value back to the renderer) ----
  handle('secret:has', (key) => store.hasSecret(key));
  handle('secret:set', (key, value) => store.setSecret(key, value));

  // ---- Media ----
  handle('media:save', (kind, filename, base64) => store.saveMedia(kind, filename, base64));
  handle('media:read', async (kind, id) => {
    const buf = await store.readMedia(kind, id);
    return buf.toString('base64');
  });
  handle('media:delete', (kind, id) => store.deleteMedia(kind, id));

  handle('media:importFile', async (kind, filters) => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Import file',
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const filePath = res.filePaths[0];
    const buf = await fsp.readFile(filePath);
    const saved = await store.saveMedia(kind, path.basename(filePath), buf);
    return saved;
  });

  // Save a media blob arriving as base64 from the renderer (e.g. recordings).
  handle('media:saveBase64', (kind, filename, base64) => store.saveMedia(kind, filename, base64));

  // ---- Curated audio library ----
  handle('audio:manifest', () => store.audioManifest());
  handle('audio:cached', () => store.audioCachedIds());
  handle('audio:fetch', (track) => store.audioFetch(track));
  handle('audio:forget', (id) => store.audioForget(id));

  // ---- AI (non-streaming) ----
  handle('ai:models', () => ({ models: ai.MODELS, default: ai.DEFAULT_MODEL }));

  handle('ai:complete', async (opts) => {
    const apiKey = await store.getSecret('anthropic');
    return ai.complete({ ...opts, apiKey });
  });

  handle('ai:test', async (model) => {
    const apiKey = await store.getSecret('anthropic');
    if (!apiKey) throw new Error('No Anthropic API key set.');
    return ai.testConnection({ apiKey, model });
  });

  // ---- AI (streaming) ----
  ipcMain.handle('ai:stream:start', async (evt, requestId, opts) => {
    const apiKey = await store.getSecret('anthropic');
    const controller = new AbortController();
    streams.set(requestId, controller);
    const send = (payload) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ai:stream:event', { requestId, ...payload });
      }
    };
    if (!apiKey) {
      send({ type: 'error', error: 'No Anthropic API key set.' });
      streams.delete(requestId);
      return { ok: false, error: 'no key' };
    }
    // Run without awaiting so the renderer call returns immediately.
    ai.stream({ ...opts, apiKey, signal: controller.signal }, (e) => send(e))
      .catch((err) => send({ type: 'error', error: err.message }))
      .finally(() => streams.delete(requestId));
    return { ok: true };
  });

  ipcMain.handle('ai:stream:cancel', async (_evt, requestId) => {
    const c = streams.get(requestId);
    if (c) { c.abort(); streams.delete(requestId); }
    return { ok: true };
  });

  // ---- Transcription (optional Whisper backend) ----
  handle('transcribe:whisper', async ({ kind, mediaId }) => {
    const apiKey = await store.getSecret('transcription');
    if (!apiKey) throw new Error('No transcription API key set (Settings → AI).');
    const settings = await store.getSettings();
    const buf = await store.readMedia(kind, mediaId);
    return transcribe.whisper({
      apiKey,
      audioBuffer: buf,
      filename: mediaId,
      model: settings.transcriptionModel || 'whisper-1',
      baseUrl: settings.transcriptionBaseUrl,
      responseFormat: 'verbose_json', // returns .segments (+ .speaker if the endpoint diarizes)
    });
  });

  // ---- File dialogs ----
  handle('dialog:saveJson', async (defaultName, data) => {
    const win = getWindow();
    const res = await dialog.showSaveDialog(win, {
      title: 'Export',
      defaultPath: defaultName || 'xrpg-export.json',
      filters: [{ name: 'XRPG / JSON', extensions: ['xrpg', 'json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, JSON.stringify(data, null, 2), 'utf8');
    return res.filePath;
  });

  handle('dialog:openJson', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Import',
      properties: ['openFile'],
      filters: [{ name: 'XRPG / JSON', extensions: ['xrpg', 'json'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const raw = await fsp.readFile(res.filePaths[0], 'utf8');
    return JSON.parse(raw);
  });

  handle('dialog:saveText', async (defaultName, text) => {
    const win = getWindow();
    const res = await dialog.showSaveDialog(win, {
      title: 'Save',
      defaultPath: defaultName || 'export.txt',
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, text, 'utf8');
    return res.filePath;
  });

  // ---- App / shell ----
  handle('app:info', async () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    dataDir: store.rootDir(),
  }));

  handle('shell:openExternal', (target) => {
    if (/^https?:\/\//i.test(target)) return shell.openExternal(target);
    return false;
  });

  handle('shell:openDataFolder', () => shell.openPath(store.rootDir()));
  handle('window:popout', (route, mode) => (createPopout ? createPopout(route, mode) : null));

  // ---- Discord ----
  const dc = discord || { available: () => false };
  handle('discord:available', () => !!(dc.available && dc.available()));
  handle('discord:status', () => (dc.status ? dc.status() : { available: false }));
  handle('discord:setToken', (token) => store.setSecret('discord', token));
  handle('discord:hasToken', () => store.hasSecret('discord'));
  handle('discord:connect', () => dc.connect());
  handle('discord:disconnect', () => dc.disconnect());
  handle('discord:voiceChannels', (guildId) => dc.listVoiceChannels(guildId));
  handle('discord:textChannels', (guildId) => dc.listTextChannels(guildId));
  handle('discord:members', () => (dc.getMembers ? dc.getMembers() : []));
  handle('discord:joinVoice', (guildId, channelId) => dc.joinVoice(guildId, channelId));
  handle('discord:leaveVoice', () => dc.leaveVoice());
  handle('discord:startRecording', (sessionId, opts) => dc.startRecording(sessionId, opts));
  handle('discord:stopRecording', (opts) => dc.stopRecording(opts));
  handle('discord:transcribeRecording', (manifest) => dc.transcribeRecording(manifest));
  handle('discord:postMessage', (channelId, message) => dc.postMessage(channelId, message));
  handle('discord:setPresence', (text) => dc.setPresence(text));
  handle('discord:slashReply', (requestId, reply) => (dc.slashReply ? dc.slashReply(requestId, reply) : false));
  handle('discord:refreshSettings', () => (dc.refreshSettings ? dc.refreshSettings() : { ok: true }));
  handle('discord:broadcast', async (kind, mediaId, opts) => {
    if (!dc.broadcastFile) return { ok: false, reason: 'unavailable' };
    const p = store.safeMediaPath(kind, mediaId);
    return dc.broadcastFile(p, opts);
  });
  handle('discord:stopBroadcast', () => (dc.stopBroadcast ? dc.stopBroadcast() : null));
  // live app-audio broadcast (renderer captures master output → bot)
  handle('discord:liveStart', () => (dc.liveBroadcastStart ? dc.liveBroadcastStart() : { ok: false, reason: 'unavailable' }));
  ipcMain.on('discord:liveChunk', (_e, chunk) => { try { if (dc.liveBroadcastChunk) dc.liveBroadcastChunk(chunk); } catch (err) {} });
  handle('discord:liveStop', () => (dc.liveBroadcastStop ? dc.liveBroadcastStop() : null));

  // ---- Auto-update ----
  handle('update:available', () => (updater ? updater.available() : false));
  handle('update:check', async () => { const s = await store.getSettings(); return updater ? updater.check(s, {}) : { ok: false, reason: 'unavailable' }; });
  handle('update:install', () => { if (updater) updater.quitAndInstall(); return true; });

  // Test harness: write results to disk and quit (used by `electron . --test`).
  // Exits non-zero on any failure so CI can gate on it.
  ipcMain.handle('test:report', async (_evt, results) => {
    let failed = 1;
    try {
      const dir = path.join(__dirname, '..', '.dev');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'test-results.json'), JSON.stringify(results, null, 2));
      failed = Number(results && results.failed) || 0;
      console.log(`[test] ${results.passed}/${results.total} passed`);
    } catch (e) { console.error('[test] write failed', e); }
    setTimeout(() => app.exit(failed > 0 ? 1 : 0), 200);
    return { ok: true };
  });
  handle('clipboard:write', async (text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return true;
  });
  handle('clipboard:read', async () => {
    const { clipboard } = require('electron');
    return clipboard.readText();
  });
}

module.exports = { registerIpc };
