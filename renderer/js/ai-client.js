// Hybrid AI client: uses the Anthropic API when a key is set (live, streaming),
// otherwise falls back to a copy/paste "prompt bridge" the user runs in Claude.
import { el, clear } from './util.js';
import { modal, button, textarea, toast, copyText, badge } from './ui.js';
import { icon } from './icons.js';
import store from './store.js';

let _liveCache = null;
export async function liveAvailable(force) {
  if (_liveCache == null || force) _liveCache = await store.hasSecret('anthropic');
  return _liveCache;
}
export function invalidateLive() { _liveCache = null; }

let _model = null;
export async function getModel() {
  if (_model) return _model;
  const s = await store.getSettings();
  _model = s.aiModel || 'claude-sonnet-4-6';
  return _model;
}
export function invalidateModel() { _model = null; }

const STREAM_IDLE_TIMEOUT = 90000; // reject if no stream event for this long

// Run a generation. Returns { text, mode }. Streams deltas via onDelta when live.
// opts.onController(ctrl) receives { cancel() } for live streams (no-op in bridge mode).
export async function generate({ system, prompt, messages, onDelta, onController, temperature = 0.85, max_tokens = 2048, allowBridge = true, bridgeTitle }) {
  const live = await liveAvailable();
  const model = await getModel();
  const msgs = messages || [{ role: 'user', content: prompt }];
  if (live) {
    return streamLive({ system, messages: msgs, model, temperature, max_tokens }, onDelta, onController);
  }
  if (onController) onController({ cancel: () => {} });
  if (allowBridge) {
    const text = await bridge({ system, prompt: prompt || msgs.map((m) => m.content).join('\n\n'), title: bridgeTitle });
    if (text == null) return { text: '', mode: 'cancel' };
    if (onDelta) onDelta(text, text);
    return { text, mode: 'bridge' };
  }
  throw new Error('No AI key set and bridge disabled.');
}

function streamLive(opts, onDelta, onController) {
  return new Promise((resolve, reject) => {
    let text = '';
    let settled = false;
    let watchdog = null;
    const ctrl = window.xrpg.ai.stream(opts, (e) => {
      if (settled) return; // ignore any event after resolve/reject (no re-arming)
      armWatchdog();
      if (e.type === 'delta') { text += e.text; if (onDelta) onDelta(e.text, text); }
      else if (e.type === 'done') { finish(() => resolve({ text: e.text || text, usage: e.usage, mode: e.aborted ? 'cancel' : 'live' })); }
      else if (e.type === 'error') { finish(() => reject(new Error(e.error || 'AI error'))); }
    });
    function finish(fn) { clearTimeout(watchdog); if (settled) return; settled = true; fn(); }
    function armWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { try { ctrl.cancel(); } catch {} finish(() => reject(new Error('AI stream timed out (no response).'))); }, STREAM_IDLE_TIMEOUT);
    }
    armWatchdog();
    if (onController) onController({ cancel: () => { try { ctrl.cancel(); } catch {} finish(() => resolve({ text, mode: 'cancel' })); } });
  });
}

// Copy/paste bridge: show prompt, let the user paste Claude's reply.
function bridge({ system, prompt, title }) {
  return new Promise((resolve) => {
    const full = (system ? `# Instructions for Claude\n${system}\n\n# Request\n` : '') + prompt;
    const replyT = textarea({ placeholder: "Paste Claude's full reply here…", rows: 8 });
    const promptBox = el('div.bridge-box.selectable', full);
    const m = modal({
      title: title || 'Run in Claude (no API key)', width: 680, class: 'bridge-modal',
      body: [
        el('div.row.between', [el('span.ai-mode-tag.ai-mode-bridge', [icon('spark', 13), 'Bridge mode']), el('span.small.mute', 'No Anthropic key set — copy this prompt into Claude, then paste the reply back.')]),
        el('div.field', [el('span.field-label', 'Prompt'), promptBox]),
        el('div.row.gap-2', [
          button('Copy prompt', { icon: 'copy', variant: 'primary', onClick: () => copyText(full, 'Prompt copied — paste it into Claude') }),
          button('Open Claude.ai', { icon: 'link', onClick: () => window.xrpg.shell.openExternal('https://claude.ai/new') }),
        ]),
        el('div.field', [el('span.field-label', "Claude's reply"), replyT]),
      ],
      onClose: () => resolve(null),
    });
    m.setFooter(
      button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
      button('Use this reply', { variant: 'primary', icon: 'check', onClick: () => { const v = replyT.value.trim(); m.close(); resolve(v || null); } }),
    );
    setTimeout(() => copyText(full, 'Prompt copied to clipboard'), 100);
  });
}

// Extract a JSON object/array from a model reply (handles ```json fences and prose).
export function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // find first { or [ and matching last } or ]
  const firstObj = t.indexOf('{'); const firstArr = t.indexOf('[');
  let start = -1, openCh = '{', closeCh = '}';
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) { start = firstArr; openCh = '['; closeCh = ']'; }
  else if (firstObj !== -1) { start = firstObj; }
  if (start === -1) return null;
  // balance scan
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}
