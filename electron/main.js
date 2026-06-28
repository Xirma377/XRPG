'use strict';

const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');

const store = require('./store');
const ai = require('./ai');
const transcribe = require('./transcribe');
const updater = require('./updater');
let discord = null;
try { discord = require('./discord'); } catch (e) { console.error('[main] discord module failed to load:', e.message); discord = { available: () => false, init() {}, status: () => ({ available: false }) }; }
const { registerIpc } = require('./ipc');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const isDev = !app.isPackaged;

// Dev/test flags: --shot=<route> captures the window to a PNG and quits;
// --test loads the test harness, writes results, and quits.
const argv = process.argv.slice(2);
const shotArg = argv.find((a) => a.startsWith('--shot'));
const SHOT_ROUTE = shotArg ? (shotArg.split('=')[1] || 'dashboard') : null;
const TEST_MODE = argv.includes('--test');
const DEMO_MODE = argv.includes('--demo');
const MAKE_ICONS = argv.includes('--make-icons');
const POPOUT_SHOT = argv.includes('--popout-shot');
const MIX_SHOT = argv.includes('--mix-shot');

// Register the privileged app scheme BEFORE the app is ready so ES modules,
// fetch, and a stable secure origin all work from disk.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'xrpg',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Resolve a xrpg:// request to an absolute file path, guarding against traversal.
function resolveRequest(reqUrl) {
  const parsed = new url.URL(reqUrl);
  const host = parsed.host; // 'app' or 'media'
  let pathname = decodeURIComponent(parsed.pathname);

  let rootDir;
  if (host === 'media') {
    rootDir = store.mediaDir();
  } else {
    rootDir = RENDERER_DIR;
  }

  if (pathname === '' || pathname === '/') pathname = '/index.html';
  // Normalize and prevent path traversal outside the root (separator-aware so
  // a sibling like "renderer-evil" cannot satisfy a bare prefix match).
  const rootN = path.normalize(rootDir);
  const safePath = path.normalize(path.join(rootN, pathname));
  if (safePath !== rootN && !safePath.startsWith(rootN + path.sep)) {
    return null;
  }
  return safePath;
}

function registerProtocol() {
  protocol.handle('xrpg', async (request) => {
    try {
      const filePath = resolveRequest(request.url);
      if (!filePath) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath)) {
        // SPA-style fallback for the app host only.
        const parsed = new url.URL(request.url);
        if (parsed.host !== 'media') {
          const indexPath = path.join(RENDERER_DIR, 'index.html');
          const data = await fs.promises.readFile(indexPath);
          return new Response(data, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
        return new Response('Not found', { status: 404 });
      }
      const fileUrl = url.pathToFileURL(filePath).toString();
      const resp = await net.fetch(fileUrl);
      const headers = new Headers(resp.headers);
      headers.set('content-type', contentType(filePath));
      headers.set('access-control-allow-origin', '*');
      headers.set('cache-control', 'no-cache');
      return new Response(resp.body, { status: 200, headers });
    } catch (err) {
      console.error('[protocol] error', err);
      return new Response('Internal error: ' + err.message, { status: 500 });
    }
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0b0e13',
    show: false,
    autoHideMenuBar: true,
    title: 'XRPG',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      webgl: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (MAKE_ICONS) runMakeIcons();
    else if (POPOUT_SHOT) runPopoutShot();
    else if (MIX_SHOT) runMixShot();
    else if (DEMO_MODE) runDemo();
    else if (SHOT_ROUTE) runShot();
  });

  mainWindow.loadURL(TEST_MODE ? 'xrpg://app/test.html' : 'xrpg://app/index.html');

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) {
      require('electron').shell.openExternal(target);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Open a secondary window for a view (e.g. VTT player display, mixer on a 2nd screen).
const popouts = new Map();
function createPopout(route, mode) {
  const key = (route || '') + '@' + (mode || '1');
  const existing = popouts.get(key);
  if (existing && !existing.isDestroyed()) { if (existing.isMinimized()) existing.restore(); existing.focus(); return existing.id; }
  const w = new BrowserWindow({
    width: 1120, height: 760, backgroundColor: '#0b0e13', autoHideMenuBar: true,
    title: 'XRPG — ' + (route || ''),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, webgl: true },
  });
  w.loadURL(`xrpg://app/index.html?popout=${encodeURIComponent(mode || '1')}#/${route || 'dashboard'}`);
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) require('electron').shell.openExternal(url); return { action: 'deny' }; });
  w.on('closed', () => { popouts.delete(key); });
  popouts.set(key, w);
  return w.id;
}

function encodeIco(images) {
  // images: [{ size, png(Buffer) }]
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const bodies = [];
  images.forEach((img, i) => {
    const b = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1);
    dir.writeUInt8(0, b + 2); dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4); dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(img.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += img.png.length;
    bodies.push(img.png);
  });
  return Buffer.concat([header, dir, ...bodies]);
}

async function runMakeIcons() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  try { fs.mkdirSync(assetsDir, { recursive: true }); } catch {}
  await new Promise((r) => setTimeout(r, 1200));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#141a24"/><stop offset="100%" stop-color="#0a0d12"/></linearGradient><linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff5a4d"/><stop offset="100%" stop-color="#d8392c"/></linearGradient></defs><rect width="256" height="256" rx="56" fill="url(#bg)"/><path d="M128 36l78 44v96l-78 44-78-44V80z" fill="none" stroke="url(#mk)" stroke-width="9" stroke-linejoin="round"/><path d="M128 36v184M50 80l78 44 78-44M128 124L50 176M128 124l78 52" stroke="url(#mk)" stroke-width="5" opacity="0.55" fill="none"/><circle cx="128" cy="124" r="16" fill="#ff5a4d"/></svg>`;
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const snippet = `(async () => {
    const svg = ${JSON.stringify(svg)};
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const out = {};
    for (const s of ${JSON.stringify(sizes)}) {
      const c = document.createElement('canvas'); c.width = s; c.height = s;
      const ctx = c.getContext('2d'); ctx.clearRect(0,0,s,s); ctx.drawImage(img, 0, 0, s, s);
      out[s] = c.toDataURL('image/png').split(',')[1];
    }
    return JSON.stringify(out);
  })()`;
  try {
    const raw = await mainWindow.webContents.executeJavaScript(snippet);
    const map = JSON.parse(raw);
    const images = sizes.map((s) => ({ size: s, png: Buffer.from(map[s], 'base64') }));
    fs.writeFileSync(path.join(assetsDir, 'icon.png'), images.find((i) => i.size === 256).png);
    fs.writeFileSync(path.join(assetsDir, 'icon.ico'), encodeIco(images));
    console.log('[icons] wrote assets/icon.png and assets/icon.ico');
  } catch (e) { console.error('[icons] failed', e.message); }
  app.quit();
}

async function runDemo() {
  const outDir = path.join(__dirname, '..', '.dev');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  await new Promise((r) => setTimeout(r, 1600));
  const setup = `(async () => {
    const { store } = window.__xrpg;
    const story = store.get('storylines','story_longwayhome');
    const content = JSON.parse(JSON.stringify(story));
    delete content.id; delete content._seed; delete content.createdAt; delete content.updatedAt;
    let camp = store.all('campaigns').find(c => c.name === 'DEMO Snow Trap');
    if (!camp) {
      camp = await store.save('campaigns', { id:'camp_demo', name:'DEMO Snow Trap', systemId:'sys_strainz', storylineId:'story_longwayhome', groupId:'grp_vacationers', storyline: content, currentVersion:1, storylineVersions:[{v:1,label:'Initial fork',at:new Date().toISOString(),content:JSON.parse(JSON.stringify(content))}], status:'active', notes:'The party bogged down near Sunset Point.', worldState:{clocks:[],flags:{}} });
      await store.save('sessions', { id:'sess_demo1', campaignId:'camp_demo', systemId:'sys_strainz', number:1, title:'The Snow Trap', blueprintNumber:1, storylineVersion:1, date:new Date().toISOString(), groupId:'grp_vacationers', presentPlayerIds:['plr_sam','plr_jordan','plr_alex'], log:[{type:'event',text:'Leo died in the back of the minivan.',at:Date.now()-3600000},{type:'death',text:'Leo reanimated and bit Sarah.',at:Date.now()-3000000},{type:'decision',text:'The party chose to push north across the median.',at:Date.now()-1200000}], notes:'Dana tried to save Leo with a Medicine check — failed at Desperate.', diceLog:[], summary:'**Recap** — The party watched the I-17 grind to a halt and slowly realized the dead were waking. After Leo turned, they crossed the median and abandoned the SUV at the northbound crash, walking the last cold mile toward Cordes.\\n\\n**Key moments**\\n- Leo died and reanimated (the table\\'s first true horror).\\n- Sarah was lost.\\n- The SUV was abandoned in the median.\\n\\n**Next session** — They reach Cordes Junction on foot and hear Radio Rick for the first time.', reflection:'The kid-in-the-minivan beat landed hard. Next time, give Marcus a moment with the snowplow.', clocks:[{name:'The Highway Wakes',size:6,filled:6}], durationSec:11700 });
    }
    return JSON.stringify({ camp: 'camp_demo', sess: 'sess_demo1' });
  })()`;
  let ids = {};
  try { const raw = await mainWindow.webContents.executeJavaScript(setup); ids = JSON.parse(raw); } catch (e) { console.error('[demo] setup failed', e.message); }
  const routes = [`campaigns/${ids.camp}`, `session/${ids.sess}`, `sessions/${ids.sess}`, 'campaigns'];
  for (const route of routes) {
    try {
      await mainWindow.webContents.executeJavaScript(`location.hash = '#/${route}';`);
      await new Promise((r) => setTimeout(r, 1300));
      const img = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `demo-${route.replace(/[^a-z0-9]/gi, '_')}.png`), img.toPNG());
      console.log('[demo] saved', route);
    } catch (e) { console.error('[demo] shot failed', route, e.message); }
  }
  app.quit();
}

async function runPopoutShot() {
  const outDir = path.join(__dirname, '..', '.dev');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  await new Promise((r) => setTimeout(r, 1400));
  await mainWindow.webContents.executeJavaScript(`location.hash = '#/vtt';`);
  await new Promise((r) => setTimeout(r, 800));
  const id = createPopout('vtt', 'player');
  const w = BrowserWindow.fromId(id);
  try {
    if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-finish-load', r));
    await new Promise((r) => setTimeout(r, 2800));
    w.focus();
    const info = await w.webContents.executeJavaScript("JSON.stringify({popout: window.__popout, canvas: !!document.querySelector('canvas'), cls: document.body.className})");
    console.log('[popout] state', info);
    await new Promise((r) => setTimeout(r, 400));
    const img = await w.webContents.capturePage();
    const png = img.toPNG();
    fs.writeFileSync(path.join(outDir, 'shot-popout-vtt.png'), png);
    console.log('[popout] saved', png.length, 'bytes');
  } catch (e) { console.error('[popout] failed', e.message); }
  app.quit();
}

async function runMixShot() {
  const outDir = path.join(__dirname, '..', '.dev');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  await new Promise((r) => setTimeout(r, 1400));
  await mainWindow.webContents.executeJavaScript(`location.hash = '#/mixer';`);
  await new Promise((r) => setTimeout(r, 1000));
  await mainWindow.webContents.executeJavaScript(`(async () => {
    const { audio } = await import('xrpg://app/js/audio-engine.js');
    audio.ensure();
    ['wind','rain','drone-dark','heartbeat'].forEach((s, i) => { const ch = audio.addChannel({ name: ({wind:'Wind',rain:'Rain','drone-dark':'Dark Drone',heartbeat:'Heartbeat'})[s], type:'instrument', source:s, gain: 0.4 + i*0.1 }); });
    return audio.channels.size;
  })();`);
  await new Promise((r) => setTimeout(r, 900));
  const n = await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.channel-strip').length`);
  console.log('[mix-shot] channel strips visible:', n);
  const img = await mainWindow.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'shot-mix-multi.png'), img.toPNG());
  app.quit();
}

async function runShot() {
  const outDir = path.join(__dirname, '..', '.dev');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  const routes = SHOT_ROUTE.split(',');
  await new Promise((r) => setTimeout(r, 1400));
  for (const route of routes) {
    try {
      // Optional "route@TabLabel" clicks a tab after navigating.
      const [hashRoute, tabLabel] = route.split('@');
      await mainWindow.webContents.executeJavaScript(`location.hash = '#/${hashRoute}';`);
      await new Promise((r) => setTimeout(r, route === routes[0] ? 1400 : 1100));
      if (tabLabel && tabLabel[0] === '^') {
        // scroll an element matching text into view (^Some Heading)
        const needle = tabLabel.slice(1).toLowerCase();
        await mainWindow.webContents.executeJavaScript(`(() => { const els = Array.from(document.querySelectorAll('h4,h3,.side-card')); const t = els.find(e => e.textContent.trim().toLowerCase().includes(${JSON.stringify(needle)})); if (t) t.scrollIntoView({block:'center'}); return !!t; })();`);
        await new Promise((r) => setTimeout(r, 500));
      } else if (tabLabel && (tabLabel[0] === '.' || tabLabel[0] === '#')) {
        await mainWindow.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(tabLabel)}); if (el) el.click(); return !!el; })();`);
        await new Promise((r) => setTimeout(r, 700));
      } else if (tabLabel) {
        await mainWindow.webContents.executeJavaScript(`(() => { const t = Array.from(document.querySelectorAll('.tab')).find(b => b.textContent.trim().toLowerCase().includes(${JSON.stringify(tabLabel.toLowerCase())})); if (t) t.click(); return !!t; })();`);
        await new Promise((r) => setTimeout(r, 700));
      }
      const img = await mainWindow.webContents.capturePage();
      const file = path.join(outDir, `shot-${route.replace(/[^a-z0-9]/gi, '_')}.png`);
      fs.writeFileSync(file, img.toPNG());
      console.log('[shot] saved', file);
    } catch (e) {
      console.error('[shot] failed for', route, e.message);
    }
  }
  app.quit();
}

// Single instance lock so data isn't corrupted by two writers.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await store.init();
    registerProtocol();
    registerIpc({ ipcMain, store, ai, transcribe, updater, discord, getWindow: () => mainWindow, createPopout });
    updater.init(() => mainWindow);
    if (discord && discord.available && discord.available()) {
      discord.init({ getWindow: () => mainWindow, store, transcribe });
      // auto-connect on startup if a token is set and the user hasn't opted out
      if (!SHOT_ROUTE && !TEST_MODE && !DEMO_MODE && !MAKE_ICONS && !POPOUT_SHOT && !MIX_SHOT) {
        setTimeout(async () => {
          try { const s = await store.getSettings(); if (s.discordAutoConnect !== false && await store.hasSecret('discord')) discord.connect(); } catch (e) {}
        }, 2500);
      }
    }

    // Allow microphone access for session recording (app origin only).
    const ses = require('electron').session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'media' || permission === 'audioCapture');
    });
    ses.setPermissionCheckHandler((wc, permission) => permission === 'media' || permission === 'audioCapture');

    createWindow();

    // Background update check shortly after launch (packaged builds only).
    if (!SHOT_ROUTE && !TEST_MODE && !DEMO_MODE && !MAKE_ICONS && !POPOUT_SHOT) {
      setTimeout(async () => { try { await updater.check(await store.getSettings(), { silent: true }); } catch (e) {} }, 5000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
