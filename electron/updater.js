'use strict';

// Auto-update via electron-updater. The release feed is configured in
// package.json build.publish (GitHub by default); a generic feed URL can be
// supplied at runtime through settings.updateFeedUrl. Fails gracefully in dev.

const { app } = require('electron');
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }

let getWin = () => null;
function send(type, data) {
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send('update:event', Object.assign({ type }, data || {}));
}

function init(getWindow) {
  getWin = getWindow || (() => null);
  if (!autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', (info) => send('available', { version: info && info.version }));
  autoUpdater.on('update-not-available', (info) => send('not-available', { version: info && info.version }));
  autoUpdater.on('error', (err) => send('error', { message: String((err && err.message) || err) }));
  autoUpdater.on('download-progress', (p) => send('progress', { percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => send('downloaded', { version: info && info.version }));
}

function applyFeed(settings) {
  if (!autoUpdater) return;
  try {
    if (settings && settings.updateFeedUrl) autoUpdater.setFeedURL({ provider: 'generic', url: settings.updateFeedUrl });
  } catch (e) { /* fall back to package.json publish config */ }
}

async function check(settings, { silent } = {}) {
  if (!autoUpdater) return { ok: false, reason: 'unavailable' };
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  applyFeed(settings);
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo && r.updateInfo.version, current: app.getVersion() };
  } catch (e) {
    if (!silent) send('error', { message: e.message });
    return { ok: false, reason: e.message };
  }
}

function quitAndInstall() { if (autoUpdater) { try { autoUpdater.quitAndInstall(); } catch (e) {} } }

module.exports = { init, check, quitAndInstall, available: () => !!autoUpdater };
