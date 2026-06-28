'use strict';

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

// Collections are independent folders of <id>.json documents.
const COLLECTIONS = [
  'rulesets',     // game systems / rule sets
  'storylines',   // narrative blueprints (versioned internally)
  'campaigns',    // instances: a storyline run with one player group
  'sessions',     // actual-play records (immutable history)
  'characters',   // PCs and NPCs
  'players',      // people
  'groups',       // tables (sets of players)
  'scenes',       // VTT scenes/maps
  'mixerpresets', // audio mixer presets
  'soundboards',  // audio cue boards
  'generations',  // AI generation history
  'notes',        // standalone notes / lore / handouts
];

const MEDIA_KINDS = ['audio', 'maps', 'tokens', 'portraits', 'handouts', 'misc', 'library'];

let ROOT = null;
let MEDIA = null;
let SEED_DIR = null;

function id(prefix) {
  const rand = crypto.randomBytes(8).toString('hex');
  return `${prefix || 'x'}_${Date.now().toString(36)}_${rand}`;
}

function rootDir() { return ROOT; }
function mediaDir() { return MEDIA; }

function collDir(coll) {
  if (!COLLECTIONS.includes(coll)) throw new Error('Unknown collection: ' + coll);
  return path.join(ROOT, coll);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function atomicWrite(file, data) {
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function init() {
  ROOT = path.join(app.getPath('userData'), 'data');
  MEDIA = path.join(ROOT, 'media');
  SEED_DIR = path.join(__dirname, '..', 'content', 'seeds');

  await ensureDir(ROOT);
  for (const c of COLLECTIONS) await ensureDir(collDir(c));
  for (const k of MEDIA_KINDS) await ensureDir(path.join(MEDIA, k));

  await seedDefaults();
}

// ---- Settings (non-secret) ----
function settingsFile() { return path.join(ROOT, 'settings.json'); }

async function getSettings() {
  try {
    const raw = await fsp.readFile(settingsFile(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Serialize read-modify-write per file so concurrent IPC saves don't clobber.
let settingsLock = Promise.resolve();
let secretsLock = Promise.resolve();

function setSettings(obj) {
  const run = async () => {
    const current = await getSettings();
    const next = { ...current, ...obj };
    await atomicWrite(settingsFile(), JSON.stringify(next, null, 2));
    return next;
  };
  settingsLock = settingsLock.then(run, run);
  return settingsLock;
}

// ---- Secrets (API keys), encrypted at rest via Electron safeStorage ----
function secretFile() { return path.join(ROOT, 'secrets.bin'); }

async function readSecrets() {
  try {
    const buf = await fsp.readFile(secretFile());
    if (safeStorage.isEncryptionAvailable()) {
      const dec = safeStorage.decryptString(buf);
      return JSON.parse(dec);
    }
    // Fallback: plain JSON (only when OS encryption unavailable).
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return {};
  }
}

async function writeSecrets(obj) {
  const json = JSON.stringify(obj);
  let buf;
  if (safeStorage.isEncryptionAvailable()) {
    buf = safeStorage.encryptString(json);
  } else {
    buf = Buffer.from(json, 'utf8');
  }
  await atomicWrite(secretFile(), buf);
}

async function getSecret(key) {
  const s = await readSecrets();
  return s[key] || null;
}

function setSecret(key, value) {
  const run = async () => {
    const s = await readSecrets();
    if (value == null || value === '') delete s[key];
    else s[key] = value;
    await writeSecrets(s);
    return true;
  };
  secretsLock = secretsLock.then(run, run);
  return secretsLock;
}

async function hasSecret(key) {
  const s = await readSecrets();
  return Boolean(s[key]);
}

// ---- Generic collection CRUD ----
async function list(coll) {
  const dir = collDir(coll);
  let files;
  try { files = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, f), 'utf8');
      out.push(JSON.parse(raw));
    } catch (e) {
      console.error('[store] failed to read', coll, f, e.message);
    }
  }
  return out;
}

async function get(coll, docId) {
  try {
    const raw = await fsp.readFile(path.join(collDir(coll), docId + '.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function put(coll, doc) {
  const now = new Date().toISOString();
  const d = { ...doc };
  if (!d.id) d.id = id(coll.slice(0, 3));
  if (!d.createdAt) d.createdAt = now;
  d.updatedAt = now;
  await atomicWrite(path.join(collDir(coll), d.id + '.json'), JSON.stringify(d, null, 2));
  return d;
}

async function remove(coll, docId) {
  try {
    await fsp.unlink(path.join(collDir(coll), docId + '.json'));
    return true;
  } catch {
    return false;
  }
}

// ---- Media (binary assets) ----
function safeName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

// data: a base64 string (no data-url prefix) or a Buffer.
async function saveMedia(kind, filename, data) {
  if (!MEDIA_KINDS.includes(kind)) kind = 'misc';
  const ext = path.extname(filename || '') || '';
  const newName = id('m') + ext;
  const dest = path.join(MEDIA, kind, newName);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
  await atomicWrite(dest, buf);
  return {
    id: newName,
    kind,
    url: `xrpg://media/${kind}/${newName}`,
    originalName: safeName(filename),
    bytes: buf.length,
  };
}

// Resolve a media path safely: reject unknown kinds and any id that isn't a
// plain basename (blocks ../ traversal and absolute paths from the renderer).
function safeMediaPath(kind, mediaId) {
  if (!MEDIA_KINDS.includes(kind)) throw new Error('Unknown media kind');
  const name = path.basename(String(mediaId || ''));
  if (!name || name !== mediaId || name.includes('..')) throw new Error('Invalid media id');
  const dir = path.resolve(path.join(MEDIA, kind));
  const p = path.resolve(path.join(dir, name));
  if (p !== dir && !p.startsWith(dir + path.sep)) throw new Error('Path outside media directory');
  return p;
}

async function readMedia(kind, mediaId) {
  const buf = await fsp.readFile(safeMediaPath(kind, mediaId));
  return buf;
}

async function deleteMedia(kind, mediaId) {
  try {
    await fsp.unlink(safeMediaPath(kind, mediaId));
    return true;
  } catch {
    return false;
  }
}

// ---- Curated audio library (download-on-demand + cache) ----
function libraryFile(id, ext) { return path.join(MEDIA, 'library', `${safeName(id)}.${safeName(ext || 'mp3')}`); }

async function audioManifest() {
  try {
    const p = path.join(__dirname, '..', 'content', 'audio-library.json');
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch { return { tracks: [], credits: [] }; }
}

async function audioCachedIds() {
  try {
    const files = await fsp.readdir(path.join(MEDIA, 'library'));
    return files.map((f) => f.replace(/\.[^.]+$/, ''));
  } catch { return []; }
}

// Ensure a library track is downloaded; returns { id, url, cached, bytes }.
async function audioFetch(track) {
  if (!track || !track.id || !track.url) throw new Error('Bad track');
  const id = safeName(track.id);
  const ext = safeName(track.ext || (track.url.split('.').pop() || 'mp3').split('?')[0]).slice(0, 5);
  const dest = libraryFile(id, ext);
  const rel = `xrpg://media/library/${id}.${ext}`;
  try {
    const st = await fsp.stat(dest);
    if (st.size > 0) return { id, url: rel, cached: true, bytes: st.size };
  } catch { /* not cached */ }
  // download
  const resp = await fetch(track.url, { headers: { 'User-Agent': 'XRPG/1.0' } });
  if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) throw new Error('Empty download');
  await atomicWrite(dest, buf);
  return { id, url: rel, cached: false, bytes: buf.length };
}

async function audioForget(id) {
  try {
    const files = await fsp.readdir(path.join(MEDIA, 'library'));
    for (const f of files) if (f.replace(/\.[^.]+$/, '') === safeName(id)) await fsp.unlink(path.join(MEDIA, 'library', f));
    return true;
  } catch { return false; }
}

// ---- Export / Import / Backup ----
async function exportAll() {
  const dump = { kind: 'xrpg-export', version: 1, exportedAt: new Date().toISOString(), collections: {} };
  for (const c of COLLECTIONS) {
    dump.collections[c] = await list(c);
  }
  dump.settings = await getSettings();
  // Note: media binaries are not embedded here (kept separate). A media list is included.
  dump.media = {};
  for (const k of MEDIA_KINDS) {
    try {
      const files = await fsp.readdir(path.join(MEDIA, k));
      dump.media[k] = files;
    } catch { dump.media[k] = []; }
  }
  return dump;
}

async function importAll(dump, { merge = true } = {}) {
  if (!dump || dump.kind !== 'xrpg-export') throw new Error('Not a valid XRPG export');
  for (const c of COLLECTIONS) {
    const docs = (dump.collections && dump.collections[c]) || [];
    for (const doc of docs) {
      if (!merge) { await put(c, doc); continue; }
      const existing = await get(c, doc.id);
      if (!existing) await put(c, doc);
    }
  }
  if (dump.settings) await setSettings(dump.settings);
  return true;
}

// Serialize a single collection doc and its referenced media into one bundle.
async function exportDoc(coll, docId) {
  const doc = await get(coll, docId);
  if (!doc) throw new Error('Document not found');
  return { kind: 'xrpg-doc', collection: coll, doc, exportedAt: new Date().toISOString() };
}

// ---- Seeding default content (systems, storyline, demos) ----
async function seedDefaults() {
  let seedFiles = [];
  try { seedFiles = await fsp.readdir(SEED_DIR); } catch { return; }

  for (const file of seedFiles) {
    if (!file.endsWith('.json')) continue;
    let payload;
    try {
      const raw = await fsp.readFile(path.join(SEED_DIR, file), 'utf8');
      payload = JSON.parse(raw);
    } catch (e) {
      console.error('[seed] bad seed file', file, e.message);
      continue;
    }
    // Seed file shape: { collection: 'rulesets', docs: [ ... ] }
    const coll = payload.collection;
    if (!COLLECTIONS.includes(coll)) continue;
    for (const doc of payload.docs || []) {
      if (!doc.id) continue;
      const existing = await get(coll, doc.id);
      if (!existing) {
        // Tag as seed so we can offer "reset to default" without clobbering edits.
        await put(coll, { ...doc, _seed: true });
      }
    }
  }
}

// Force-restore seeds (used by "reset built-in content").
async function reseed({ overwrite = false } = {}) {
  let seedFiles = [];
  try { seedFiles = await fsp.readdir(SEED_DIR); } catch { return false; }
  for (const file of seedFiles) {
    if (!file.endsWith('.json')) continue;
    const raw = await fsp.readFile(path.join(SEED_DIR, file), 'utf8');
    const payload = JSON.parse(raw);
    const coll = payload.collection;
    if (!COLLECTIONS.includes(coll)) continue;
    for (const doc of payload.docs || []) {
      if (!doc.id) continue;
      const existing = await get(coll, doc.id);
      if (!existing || overwrite) await put(coll, { ...doc, _seed: true });
    }
  }
  return true;
}

module.exports = {
  COLLECTIONS, MEDIA_KINDS, id,
  init, rootDir, mediaDir,
  getSettings, setSettings,
  getSecret, setSecret, hasSecret,
  list, get, put, remove,
  saveMedia, readMedia, deleteMedia,
  audioManifest, audioCachedIds, audioFetch, audioForget,
  exportAll, importAll, exportDoc,
  reseed,
};
