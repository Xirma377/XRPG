import { el, clear, uid, deepClone, fmtClock, fmtDateTime, debounce } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, badge, chip, modal, confirm, toast, field, input, textarea, select, tabs, segmented, copyText } from '../ui.js';
import { setMarkdown } from '../markdown.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import encounter from '../encounter.js';
import audio, { ONESHOTS } from '../audio-engine.js';
import { Recorder } from '../recorder.js';
import { generate, liveAvailable } from '../ai-client.js';
import { resolveCheck } from '../dice.js';
import { allDeriveds } from '../rules.js';
import { renderSessionBlueprint } from '../storyrender.js';
import { startSession } from './campaigns.js';
import { portraitNode } from '../portrait.js';
import { adjustReward, rewardStatOf, useItem } from '../progress.js';
import discord from '../discord.js';
import { openSessionWizard } from './session-wizard.js';
import { wireSfxToggle } from '../sfx.js';

let rec = null;
let unsub = [];
let recUnsub = []; // recorder-event listeners (re-bound each time the Recap tab opens)
let elapsedTimer = null;
let activeWorking = null;
let openedAt = 0;
let combatTabUnsub = null;

// Fold wall-clock time spent in the runner into the session's durationSec.
function foldElapsed() {
  if (!activeWorking || !openedAt) return;
  activeWorking.durationSec = (activeWorking.durationSec || 0) + Math.floor((Date.now() - openedAt) / 1000);
  openedAt = Date.now();
}

export async function render(id) {
  await teardown();
  const session = id ? store.get('sessions', id) : appState.session;
  if (!session) return launcher();

  appState.setSession(session.id);
  const campaign = store.get('campaigns', session.campaignId);
  const sys = store.get('rulesets', session.systemId) || appState.system;
  shell.crumbs([{ label: 'Run Session' }, { label: campaign ? campaign.name : '', to: campaign ? ['campaigns', campaign.id] : null }, { label: `S${session.number}` }]);

  let working = deepClone(session);
  activeWorking = working;
  // A fresh session opening: clear any leftover recorder transcript.
  if (rec && rec.state !== 'recording' && rec.state !== 'paused') rec.reset();
  const saveNotes = debounce(async () => { await store.save('sessions', working); }, 500);
  const saveNow = async () => { await store.save('sessions', working); };

  // ----- header / actions -----
  const sessionTimer = el('span.mono', fmtClock(working.durationSec || 0));
  shell.actions([
    sessionTimer,
    button('Setup', { icon: 'spark', size: 'sm', title: 'Session setup wizard: Discord, player links, attendance, recording', onClick: () => openSessionWizard(working, campaign, saveNow) }),
    button('Player Display', { icon: 'eye', size: 'sm', title: 'Open the tabletop in a separate window for players', onClick: () => window.xrpg.window.popout('vtt', 'player') }),
    button('Pop Mixer', { icon: 'music', size: 'sm', onClick: () => window.xrpg.window.popout('mixer', 'mixer') }),
    button('End Session', { icon: 'stop', size: 'sm', variant: 'danger', onClick: () => endSession(working, campaign) }),
  ]);
  // running elapsed since opened
  openedAt = Date.now();
  elapsedTimer = setInterval(() => { const tot = (working.durationSec || 0) + Math.floor((Date.now() - openedAt) / 1000); sessionTimer.textContent = fmtClock(tot); }, 1000);

  const wrap = el('div.view-pad');
  const detail = el('div.detail');
  const main = el('div');
  const side = el('div.detail-side');
  detail.appendChild(main); detail.appendChild(side);

  // ----- main tabs -----
  const blueprint = campaign && campaign.storyline && working.blueprintNumber != null ? (campaign.storyline.sessions || []).find((s) => s.number === working.blueprintNumber) : null;
  main.appendChild(tabs([
    { key: 'brief', label: 'Brief', icon: 'scroll', render: () => buildBrief(blueprint, campaign) },
    { key: 'log', label: 'Notes & Log', icon: 'edit', render: () => buildLog(working, saveNotes, saveNow) },
    { key: 'combat', label: 'Combat', icon: 'swords', render: () => buildCombat(sys, campaign) },
    { key: 'recap', label: 'Recap & Reflect', icon: 'spark', render: () => buildRecap(working, campaign, saveNow) },
  ], { value: blueprint ? 'brief' : 'log' }));

  // ----- side tools -----
  side.appendChild(buildParty(working, campaign, sys));
  side.appendChild(buildPresence(working, sys, campaign, saveNow));
  side.appendChild(buildClocks());
  side.appendChild(buildDice(working, sys, saveNow));
  side.appendChild(buildDiscord(working, campaign, sys, saveNotes));
  side.appendChild(buildAudio());
  side.appendChild(buildAiTools(working, campaign, saveNow));

  // Discord → session log: rolls (slash commands) and mirrored chat.
  unsub.push(discord.on('roll', (e) => {
    working.diceLog = working.diceLog || []; working.diceLog.push({ label: e.label, total: e.total, success: e.success, at: Date.now(), source: 'discord', by: e.by });
    working.log = working.log || []; working.log.push({ type: 'roll', text: e.text, at: Date.now() });
    saveNotes();
  }));
  unsub.push(discord.on('chat', (e) => {
    if (!e || !e.content) return;
    working.log = working.log || []; working.log.push({ type: 'chat', text: `${e.author}: ${e.content}`, at: e.at || Date.now() });
    saveNotes();
  }));
  unsub.push(discord.on('recordingComplete', (r) => { attachRecording(working, r); saveNow(); }));

  wrap.appendChild(detail);
  shell.render(wrap);

  // First time this session is opened, walk the GM through setup.
  if (!working.wizardShown && !window.__popout) openSessionWizard(working, campaign, saveNow);
}

// ---------- Launcher ----------
function launcher() {
  shell.crumbs([{ label: 'Run Session' }]);
  shell.actions(null);
  const wrap = el('div.view-pad');
  wrap.appendChild(el('h2', { style: { marginBottom: '6px' } }, 'Run a Session'));
  wrap.appendChild(el('p.dim', { style: { marginBottom: '20px' } }, 'Start a new session from a campaign, or resume a recent one. The runner gives you the brief, live notes, clocks, dice, audio cues, recording, and an AI recap — all in one place.'));

  const camps = store.all('campaigns');
  if (!camps.length) {
    wrap.appendChild(empty('No campaigns', { icon: 'flag', hint: 'Create a campaign first, then run a session.', action: button('New campaign', { variant: 'primary', onClick: () => router.go('campaigns', 'new') }) }));
    shell.render(wrap); return;
  }

  wrap.appendChild(el('h3', { style: { marginBottom: '10px' } }, 'Start a new session'));
  const grid = el('div.card-grid');
  camps.forEach((c) => {
    const sessCount = store.where('sessions', (s) => s.campaignId === c.id).length;
    const card = el('div.card.clickable');
    const grp = store.get('groups', c.groupId);
    card.appendChild(el('div', { style: { fontWeight: 600, fontSize: '15px' } }, c.name));
    card.appendChild(el('div.small.mute', `${grp ? grp.name + ' · ' : ''}${sessCount} played`));
    card.appendChild(el('div', { style: { marginTop: '10px' } }, button('Start Session ' + (sessCount + 1), { variant: 'primary', icon: 'play', onClick: () => startSession(c) })));
    grid.appendChild(card);
  });
  wrap.appendChild(grid);

  const recent = store.all('sessions').sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
  if (recent.length) {
    wrap.appendChild(el('h3', { style: { margin: '24px 0 10px' } }, 'Resume recent'));
    recent.forEach((s) => {
      const row = el('div.session-row');
      row.appendChild(el('div.sn', String(s.number)));
      const meta = el('div.grow');
      meta.appendChild(el('div', { style: { fontWeight: 600 } }, s.title));
      meta.appendChild(el('div.small.mute', `${(store.get('campaigns', s.campaignId) || {}).name || ''} · ${fmtDateTime(s.date)}`));
      row.appendChild(meta);
      row.addEventListener('click', () => router.go('session', s.id));
      wrap.appendChild(row);
    });
  }
  shell.render(wrap);
}

// ---------- Brief ----------
function buildBrief(blueprint, campaign) {
  if (!blueprint) {
    const col = el('div.col.gap-4');
    if (campaign && campaign.storyline && campaign.storyline.premise) { col.appendChild(el('h3', 'Premise')); col.appendChild(el('p.prose.selectable', campaign.storyline.premise)); }
    col.appendChild(empty('No session brief', { icon: 'scroll', hint: 'This session isn\'t linked to a storyline blueprint. Use Notes & Log to capture play.' }));
    return col;
  }
  return renderSessionBlueprint(blueprint);
}

// ---------- Notes & Log ----------
function buildLog(working, saveNotes, saveNow) {
  const col = el('div.col.gap-4');
  // quick log
  const logCard = el('div.card');
  logCard.appendChild(el('h3', { style: { marginBottom: '10px' } }, 'Session Log'));
  const logBox = el('div.col.gap-2', { style: { maxHeight: '280px', overflowY: 'auto', marginBottom: '12px' } });
  function drawLog() {
    clear(logBox);
    if (!(working.log || []).length) { logBox.appendChild(el('p.small.mute', 'No log entries yet. Capture beats, dice, deaths, and decisions as you play.')); return; }
    working.log.slice().reverse().forEach((entry) => {
      const row = el('div.beat');
      const bh = el('div.bh');
      bh.appendChild(badge(entry.type || 'note', { variant: 'dim' }));
      bh.appendChild(el('span.small.mute', new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      row.appendChild(bh);
      row.appendChild(el('div.bb.selectable', entry.text));
      logBox.appendChild(row);
    });
  }
  drawLog();
  logCard.appendChild(logBox);
  const entryI = input({ placeholder: 'Log a beat, roll, death, decision…' });
  const addEntry = (type) => { const v = entryI.value.trim(); if (!v) return; working.log = working.log || []; working.log.push({ type, text: v, at: Date.now() }); entryI.value = ''; saveNow(); drawLog(); };
  entryI.addEventListener('keydown', (e) => { if (e.key === 'Enter') addEntry('note'); });
  const addRow = el('div.row.gap-2');
  addRow.appendChild(entryI);
  addRow.appendChild(button('Add', { variant: 'primary', icon: 'plus', onClick: () => addEntry('note') }));
  logCard.appendChild(addRow);
  const typeRow = el('div.row.gap-2', { style: { marginTop: '8px' } });
  ['event', 'death', 'decision', 'loot', 'npc'].forEach((t) => typeRow.appendChild(button(t, { size: 'sm', variant: 'ghost', onClick: () => addEntry(t) })));
  logCard.appendChild(typeRow);
  col.appendChild(logCard);

  // free notes
  const notesCard = el('div.card');
  notesCard.appendChild(el('h3', { style: { marginBottom: '10px' } }, 'Freeform Notes'));
  const notesT = textarea({ value: working.notes || '', rows: 10, placeholder: 'Anything you want to remember…', autosize: true });
  notesT.addEventListener('input', () => { working.notes = notesT.value; saveNotes(); });
  notesCard.appendChild(notesT);
  col.appendChild(notesCard);
  return col;
}

// ---------- Recap & Reflection (recorder + AI) ----------
function buildRecap(working, campaign, saveNow) {
  const col = el('div.col.gap-4');

  // ----- Recorder -----
  const recCard = el('div.card');
  recCard.appendChild(el('h3', { style: { marginBottom: '4px' } }, 'Record the Session'));
  recCard.appendChild(el('p.small.mute', { style: { marginBottom: '12px' } }, 'Capture audio and a live transcript, then let Claude summarize and recommend next steps.'));

  rec = rec || new Recorder();
  const status = el('div.row.gap-4', { style: { marginBottom: '10px' } });
  const recDot = el('span.status-pill', 'Idle');
  const recTime = el('span.mono.big', '00:00');
  status.appendChild(recDot); status.appendChild(recTime);
  recCard.appendChild(status);

  const controls = el('div.row.gap-2');
  const startBtn = button('Record', { variant: 'danger', icon: 'record', onClick: async () => {
    try {
      // Continue/append to any pasted or previously-captured transcript.
      if (rec.state !== 'paused') rec.transcript = working.transcript || '';
      await rec.start();
    } catch (e) { toast('Microphone unavailable: ' + e.message, { type: 'error' }); }
  } });
  const pauseBtn = button('Pause', { icon: 'pause', onClick: () => { if (rec.state === 'recording') rec.pause(); else if (rec.state === 'paused') rec.resume(); } });
  const stopBtn = button('Stop & Save', { icon: 'stop', onClick: async () => {
    const blob = await rec.stop();
    if (blob) { const saved = await rec.saveBlob(blob); working.audioMediaId = saved.id; working.transcript = rec.transcript || working.transcript; working.durationSec = (working.durationSec || 0) + Math.floor(rec.elapsed); await saveNow(); toast('Recording saved', { type: 'success' }); drawAudio(); transcriptT.value = working.transcript || ''; }
  } });
  controls.appendChild(startBtn); controls.appendChild(pauseBtn); controls.appendChild(stopBtn);
  recCard.appendChild(controls);

  if (!rec.supportsSpeech) {
    recCard.appendChild(el('p.small', { style: { marginTop: '10px', color: 'var(--warn)' } }, 'Live speech-to-text isn\'t available in this build — audio still records. Paste or import a transcript below, or set a transcription key in Settings to auto-transcribe the recording.'));
  }

  // saved audio playback
  const audioWrap = el('div', { style: { marginTop: '10px' } });
  function drawAudio() { clear(audioWrap); if (working.audioMediaId) { const a = el('audio', { controls: true, src: `xrpg://media/audio/${working.audioMediaId}`, style: { width: '100%' } }); audioWrap.appendChild(a); } }
  drawAudio();
  recCard.appendChild(audioWrap);
  col.appendChild(recCard);

  // ----- Transcript -----
  const transCard = el('div.card');
  const th = el('div.row.between');
  th.appendChild(el('h3', 'Transcript'));
  const tActions = el('div.row.gap-2');
  const hasDiscordTracks = (working.discordRecordings || []).length > 0;
  tActions.appendChild(button(hasDiscordTracks ? 'Transcribe (speaker-labeled)' : 'Transcribe recording', { size: 'sm', icon: 'mic', onClick: async () => {
    if (!(await store.hasSecret('transcription'))) { toast('Set a transcription API key in Settings → AI', { type: 'warn' }); return; }
    // Online (Discord): transcribe each speaker's own track and interleave them by
    // time → a "Name: …" transcript. Otherwise fall back to the single mixed recording.
    if (hasDiscordTracks) {
      toast('Transcribing each speaker…', { timeout: 2500 });
      const r = await window.xrpg.discord.transcribeRecording(working.discordRecordings).catch((e) => ({ ok: false, reason: e.message }));
      if (!r.ok) { toast('Transcription failed: ' + (r.reason || ''), { type: 'error' }); return; }
      working.transcript = r.transcript || working.transcript; transcriptT.value = working.transcript || ''; await saveNow();
      toast('Speaker-labeled transcript ready', { type: 'success' });
      return;
    }
    if (!working.audioMediaId) { toast('No recording to transcribe', { type: 'warn' }); return; }
    toast('Transcribing…', { timeout: 1500 });
    try {
      const r = await window.xrpg.transcribe.whisper({ kind: 'audio', mediaId: working.audioMediaId });
      // If the transcription endpoint diarizes (per-segment speaker), label it; OpenAI
      // Whisper does not, so this falls back to plain text. (Per-speaker separation is
      // guaranteed via the Discord per-user recordings.)
      let text = r.text || '';
      if (Array.isArray(r.segments) && r.segments.some((s) => s.speaker != null || s.speaker_id != null)) {
        text = r.segments.map((s) => `Speaker ${s.speaker != null ? s.speaker : s.speaker_id}: ${(s.text || '').trim()}`).join('\n');
      }
      working.transcript = text; transcriptT.value = text; await saveNow(); toast('Transcribed', { type: 'success' });
    } catch (e) { toast('Transcription failed: ' + e.message, { type: 'error' }); }
  } }));
  th.appendChild(tActions);
  transCard.appendChild(th);
  const transcriptT = textarea({ value: working.transcript || '', rows: 6, placeholder: 'Live transcript appears here while recording. You can also paste or edit it.', autosize: false });
  transcriptT.addEventListener('input', () => { working.transcript = transcriptT.value; saveNow(); });
  transCard.appendChild(transcriptT);
  col.appendChild(transCard);

  // live transcript updates — buildRecap re-runs each time the Recap tab is opened,
  // so drop any prior recorder listeners first to avoid stacking them.
  recUnsub.forEach((u) => u && u()); recUnsub = [];
  recUnsub.push(rec.on('transcript', ({ transcript, interim }) => { transcriptT.value = transcript + (interim ? ' ' + interim : ''); working.transcript = transcript; }));
  recUnsub.push(rec.on('tick', (s) => { recTime.textContent = fmtClock(s); }));
  recUnsub.push(rec.on('state', (st) => {
    recDot.textContent = st === 'recording' ? 'Recording' : st === 'paused' ? 'Paused' : st === 'stopped' ? 'Stopped' : 'Idle';
    recDot.classList.toggle('live', st === 'recording');
    if (st === 'recording' && !recDot.querySelector('.dot')) recDot.prepend(Object.assign(document.createElement('span'), { className: 'dot' }));
  }));

  // ----- AI Recap -----
  const recapCard = el('div.card');
  recapCard.appendChild(el('h3', { style: { marginBottom: '8px' } }, 'AI Recap & Recommendations'));
  const summaryOut = el('div.prose.selectable', { style: { minHeight: '40px' } });
  if (working.summary) setMarkdown(summaryOut, working.summary);
  else summaryOut.appendChild(el('p.small.mute', 'Generate a recap from your transcript and notes.'));
  const summarizeBtn = button('Summarize with Claude', { variant: 'primary', icon: 'spark', onClick: async () => {
    const sysCtx = buildRecapContext(working, campaign);
    clear(summaryOut); const streamEl = el('div.ai-stream'); summaryOut.appendChild(streamEl);
    summarizeBtn.disabled = true;
    try {
      const res = await generate({ system: sysCtx.system, prompt: sysCtx.prompt, max_tokens: 2048, bridgeTitle: 'Session Recap', onDelta: (d, full) => { streamEl.textContent = full; } });
      working.summary = res.text; await saveNow();
      clear(summaryOut); setMarkdown(summaryOut, working.summary);
      toast('Recap saved to session', { type: 'success' });
    } catch (e) { clear(summaryOut); summaryOut.appendChild(el('p.small', { style: { color: 'var(--bad)' } }, e.message)); }
    finally { summarizeBtn.disabled = false; }
  } });
  recapCard.appendChild(el('div.row.gap-2', [summarizeBtn, button('Copy', { size: 'sm', icon: 'copy', onClick: () => copyText(working.summary || '') })]));
  recapCard.appendChild(summaryOut);
  col.appendChild(recapCard);

  // ----- Reflection -----
  const reflectCard = el('div.card');
  reflectCard.appendChild(el('h3', { style: { marginBottom: '8px' } }, 'Reflect'));
  reflectCard.appendChild(el('p.small.mute', { style: { marginBottom: '10px' } }, 'Your own notes for next time — what landed, what to change, ideas for the players.'));
  const reflectT = textarea({ value: working.reflection || '', rows: 5, placeholder: 'What worked? What would you change? New ideas for involving players or introducing NPCs?', autosize: true });
  reflectT.addEventListener('input', () => { working.reflection = reflectT.value; const d = debounce(saveNow, 400); d(); });
  reflectCard.appendChild(reflectT);
  reflectCard.appendChild(el('div.row.gap-2', { style: { marginTop: '8px' } }, [
    button('Brainstorm with Claude', { size: 'sm', icon: 'spark', variant: 'cool', onClick: async () => {
      const ctx = buildRecapContext(working, campaign, 'reflect');
      const m = modal({ title: 'Reflection ideas', width: 640 });
      const out = el('div.ai-stream'); m.setBody(out);
      try { await generate({ system: ctx.system, prompt: ctx.prompt, bridgeTitle: 'Reflection', onDelta: (d, full) => { out.textContent = full; } }); } catch (e) { out.textContent = e.message; }
    } }),
  ]));
  col.appendChild(reflectCard);

  return col;
}

function buildRecapContext(working, campaign, mode) {
  const sys = appState.system;
  let ctxText = '';
  if (campaign) { ctxText += `Campaign: ${campaign.name}\n`; if (campaign.storyline && campaign.storyline.premise) ctxText += `Premise: ${campaign.storyline.premise}\n`; }
  const pcs = campaign ? store.where('characters', (c) => c.kind === 'pc' && c.systemId === campaign.systemId) : [];
  if (pcs.length) ctxText += 'PCs: ' + pcs.map((p) => `${p.name} (protects ${p.tie || '?'}, fears ${p.fear || '?'})`).join('; ') + '\n';
  const material = `Notes:\n${working.notes || '(none)'}\n\nLog:\n${(working.log || []).map((l) => `[${l.type}] ${l.text}`).join('\n') || '(none)'}\n\nTranscript:\n${working.transcript || '(none)'}`;
  const system = `You are an expert GM assistant for ${sys ? sys.name : 'a tabletop RPG'}. Keep the established tone. ${ctxText}`;
  if (mode === 'reflect') {
    return { system, prompt: `Based on this session material, give me 5 specific, creative ideas to make the next session better — especially ways to involve each player using their ties/fears, and one new NPC to introduce.\n\n${material}` };
  }
  return { system, prompt: `Summarize this session and recommend the next one.\n\nProduce:\n1. **Recap** (1-2 paragraphs)\n2. **Key moments** (bullets: decisions, deaths, NPC fates, clocks)\n3. **Open threads**\n4. **Next-session recommendations** (3-5 concrete ideas, including how to involve each PC and a possible new NPC).\n\n${material}` };
}

// ---------- Embedded combat tracker (so the GM never leaves the runner) ----------
function buildCombat(sys, campaign) {
  const col = el('div.col.gap-4');
  if (!encounter.state.combatants.length) encounter.state.mode = (sys && sys.dice && (sys.dice.resolution === 'roll-high' || sys.dice.resolution === 'degrees')) ? 'numeric' : 'phase';
  const bar = el('div.row.between');
  const roundEl = el('div.big.display', 'Round ' + encounter.state.round);
  bar.appendChild(roundEl);
  const ctrl = el('div.row.gap-2');
  ctrl.appendChild(iconButton('chevL', { title: 'Previous turn', onClick: () => encounter.prevTurn() }));
  ctrl.appendChild(button('Next Turn', { icon: 'chevR', size: 'sm', onClick: () => encounter.nextTurn() }));
  ctrl.appendChild(button('Roll Init', { icon: 'dice', size: 'sm', onClick: () => { encounter.rollInitiativeAll(sys); toast('Initiative rolled', { type: 'success', timeout: 900 }); } }));
  bar.appendChild(ctrl);
  col.appendChild(bar);

  const addRow = el('div.row.gap-2.wrap');
  addRow.appendChild(button('Add Party', { size: 'sm', icon: 'users', onClick: () => { partyForCampaign(campaign, sys).forEach((pc) => encounter.addFromCharacter(pc, sys)); toast('Party added', { type: 'success', timeout: 900 }); } }));
  addRow.appendChild(button('Add Combatant', { size: 'sm', icon: 'plus', onClick: () => quickCombatant(sys) }));
  if (sys && sys.bestiary && sys.bestiary.length) addRow.appendChild(button('From Bestiary', { size: 'sm', icon: 'zombie', onClick: () => bestiaryAdd(sys) }));
  addRow.appendChild(button('Clear', { size: 'sm', variant: 'ghost', icon: 'refresh', onClick: async () => { if (await confirm({ title: 'Clear combat?', message: 'Remove all combatants?', danger: true })) encounter.reset(); } }));
  addRow.appendChild(button('Full Tracker', { size: 'sm', variant: 'ghost', icon: 'swords', onClick: () => router.go('combat') }));
  col.appendChild(addRow);

  const listBox = el('div');
  col.appendChild(listBox);
  function draw() {
    roundEl.textContent = 'Round ' + encounter.state.round;
    clear(listBox);
    if (!encounter.state.combatants.length) { listBox.appendChild(empty('No combatants', { icon: 'swords', hint: 'Add the party or threats to start tracking initiative.' })); return; }
    encounter.state.combatants.forEach((c) => listBox.appendChild(combatRow(c, sys)));
  }
  draw();
  // dedupe: the Combat tab can re-render on every selection — keep one live sub
  if (combatTabUnsub) combatTabUnsub();
  combatTabUnsub = encounter.on('change', draw);
  unsub.push(() => { if (combatTabUnsub) { combatTabUnsub(); combatTabUnsub = null; } });
  return col;
}

function combatRow(c, sys) {
  const row = el('div.combatant' + (c.active ? ' active' : '') + (c.down ? ' down' : ''));
  const ini = el('div.ini');
  if (encounter.state.mode === 'phase') ini.textContent = c.ini === 'fast' ? 'F' : c.ini === 'slow' ? 'S' : '—';
  else ini.textContent = c.ini != null ? c.ini : '—';
  row.appendChild(ini);
  const meta = el('div.cmeta');
  meta.appendChild(el('div.cname', c.name + (c.down ? ' (DOWN)' : '')));
  if (c.conditions && c.conditions.length) meta.appendChild(el('div.csub', c.conditions.join(' · ')));
  if (c.hp) { const pct = c.hp.max ? c.hp.cur / c.hp.max * 100 : 0; const bar = el('div.hpbar' + (pct < 25 ? ' crit' : pct < 50 ? ' low' : '')); bar.appendChild(el('span', { style: { width: pct + '%' } })); meta.appendChild(bar); }
  row.appendChild(meta);
  if (c.hp) {
    const hc = el('div.row.gap-1');
    hc.appendChild(iconButton('minus', { size: 13, onClick: () => encounter.damage(c.id, 1) }));
    hc.appendChild(el('span.mono.small', { style: { minWidth: '46px', textAlign: 'center' } }, `${c.hp.cur}/${c.hp.max}`));
    hc.appendChild(iconButton('plus', { size: 13, onClick: () => encounter.damage(c.id, -1) }));
    row.appendChild(hc);
  }
  row.appendChild(iconButton('trash', { size: 13, title: 'Remove', onClick: () => encounter.remove(c.id) }));
  return row;
}

function partyForCampaign(campaign, sys) {
  const grp = store.get('groups', campaign && campaign.groupId);
  let pcs = store.where('characters', (c) => c.kind === 'pc' && c.systemId === (campaign && campaign.systemId));
  if (grp && (grp.playerIds || []).length) { const ids = grp.playerIds; const inGrp = pcs.filter((c) => ids.includes(c.playerId)); if (inGrp.length) pcs = inGrp; }
  return pcs;
}

async function quickCombatant(sys) {
  const { promptText } = await import('../ui.js');
  const name = await promptText({ title: 'Add combatant', label: 'Name' });
  if (!name) return;
  encounter.addCombatant({ name, kind: 'threat', hp: { cur: 10, max: 10 } });
}

function bestiaryAdd(sys) {
  const m = modal({ title: 'Add from Bestiary', width: 480 });
  const list = el('div.col.gap-1', { style: { maxHeight: '60vh', overflowY: 'auto' } });
  sys.bestiary.forEach((b) => {
    const row = el('div.vtt-token-row');
    row.appendChild(el('div.tn', b.name));
    if (b.meta) row.appendChild(el('span.tiny.mute', b.meta));
    row.addEventListener('click', () => { const hp = b.hp || 10; encounter.addCombatant({ name: b.name, kind: 'threat', hp: { cur: hp, max: hp }, defense: b.ac }); toast(`Added ${b.name}`, { type: 'success', timeout: 800 }); });
    list.appendChild(row);
  });
  m.setBody(list);
}

// ---------- Side tools ----------
function buildParty(session, campaign, sys) {
  const card = el('div.side-card');
  card.appendChild(el('h4', 'The Party'));
  const box = el('div.col.gap-2', { style: { marginTop: '8px' } });
  card.appendChild(box);
  const rs = rewardStatOf(sys);
  const resDef = (sys.deriveds || []).find((d) => d.resource);

  function partyPcs() {
    const grp = store.get('groups', campaign && campaign.groupId);
    let pcs = store.where('characters', (c) => c.kind === 'pc' && c.systemId === (campaign && campaign.systemId));
    if (grp && (grp.playerIds || []).length) { const ids = grp.playerIds; const inGrp = pcs.filter((c) => ids.includes(c.playerId)); if (inGrp.length) pcs = inGrp; }
    return pcs;
  }
  async function adjHp(pc, delta) {
    if (!resDef) return;
    const max = allDeriveds(sys, pc)[resDef.key];
    if (!pc.resources) pc.resources = {};
    const cur = pc.resources[resDef.key] != null ? pc.resources[resDef.key] : max;
    pc.resources[resDef.key] = Math.max(0, Math.min(max, cur + delta));
    await store.save('characters', pc);
  }
  function draw() {
    clear(box);
    const pcs = partyPcs();
    if (!pcs.length) { box.appendChild(el('p.small.mute', 'No player characters in this system yet.')); return; }
    pcs.forEach((pc) => {
      const row = el('div', { style: { padding: '6px 0', borderBottom: '1px solid var(--line-soft)' } });
      const top = el('div.row.gap-2');
      top.appendChild(portraitNode(pc, 30, { round: true }));
      const meta = el('div.grow', { style: { minWidth: 0 } });
      const nm = el('div.small', { style: { fontWeight: 600, cursor: 'pointer' } }, pc.name); nm.addEventListener('click', () => router.go('characters', pc.id));
      meta.appendChild(nm);
      const der = allDeriveds(sys, pc);
      if (resDef) {
        const max = der[resDef.key]; const cur = (pc.resources && pc.resources[resDef.key] != null) ? pc.resources[resDef.key] : max;
        const pct = max ? cur / max : 0;
        const bar = el('div.hpbar' + (pct < 0.25 ? ' crit' : pct < 0.5 ? ' low' : ''), { style: { maxWidth: '150px' } }); bar.appendChild(el('span', { style: { width: Math.max(0, Math.min(100, pct * 100)) + '%' } }));
        meta.appendChild(bar);
        meta.appendChild(el('div.tiny.mute', `${resDef.abbr || 'HP'} ${cur}/${max} · ${rs.name} ${(pc.rewards && pc.rewards[rs.key]) || 0}`));
      }
      if (pc.conditions && pc.conditions.length) meta.appendChild(el('div.tiny', { style: { color: 'var(--bad)' } }, pc.conditions.join(', ')));
      top.appendChild(meta);
      const ctrl = el('div.row.gap-1');
      if (resDef) { ctrl.appendChild(iconButton('minus', { size: 13, title: 'Damage', onClick: async () => { await adjHp(pc, -1); draw(); } })); ctrl.appendChild(iconButton('plus', { size: 13, title: 'Heal', onClick: async () => { await adjHp(pc, 1); draw(); } })); }
      ctrl.appendChild(iconButton('grip', { size: 14, title: 'More', onClick: (e) => pcMenu(e, pc, rs, draw) }));
      top.appendChild(ctrl);
      row.appendChild(top);
      box.appendChild(row);
    });
  }
  draw();
  unsub.push(store.on('change:characters', draw));
  card.appendChild(button(`Award ${rs.name} to party`, { size: 'sm', variant: 'ghost', icon: 'spark', onClick: () => awardParty(partyPcs(), rs) }));
  return card;
}

function pcMenu(e, pc, rs, redraw) {
  const menu = [
    { label: 'Open sheet', icon: 'user', onClick: () => router.go('characters', pc.id) },
    { label: `Award ${rs.name}…`, icon: 'spark', onClick: async () => { const v = await promptTextLocal('Amount', '1'); if (v) { adjustReward(pc, rs.key, parseInt(v, 10) || 0, 'Awarded in session', appState.activeSessionId); await store.save('characters', pc); redraw(); } } },
  ];
  (pc.inventory || []).filter((i) => i.type === 'consumable').slice(0, 6).forEach((it) => menu.push({ label: `Use: ${it.name} (${it.qty})`, icon: 'minus', onClick: async () => { useItem(pc, it.id, 1, '', appState.activeSessionId); await store.save('characters', pc); redraw(); toast(`${pc.name} used ${it.name}`, { type: 'success', timeout: 900 }); } }));
  import('../ui.js').then(({ contextMenu }) => contextMenu(menu, e.clientX - 150, e.clientY));
}
function promptTextLocal(title, value) { return import('../ui.js').then(({ promptText }) => promptText({ title, value })); }

async function awardParty(pcs, rs) {
  const { promptText } = await import('../ui.js');
  const v = await promptText({ title: `Award ${rs.name} to the whole party`, label: 'Amount each', value: String(rs.perSession || 1) });
  if (v == null) return;
  const amt = parseInt(v, 10) || 0;
  for (const pc of pcs) { adjustReward(pc, rs.key, amt, 'End-of-session award', appState.activeSessionId); await store.save('characters', pc); }
  toast(`Awarded ${amt} ${rs.name} to ${pcs.length} PCs`, { type: 'success' });
}

function buildPresence(working, sys, campaign, saveNow) {
  const card = el('div.side-card');
  card.appendChild(el('h4', 'At the Table'));
  const grp = store.get('groups', campaign && campaign.groupId);
  const players = grp ? (grp.playerIds || []).map((id) => store.get('players', id)).filter(Boolean) : [];
  if (!players.length) { card.appendChild(el('p.small.mute', 'No group assigned.')); return card; }
  players.forEach((p) => {
    const present = (working.presentPlayerIds || []).includes(p.id);
    const row = el('label.checkbox', { style: { padding: '5px 0' } });
    const cb = el('input', { type: 'checkbox' }); cb.checked = present;
    cb.addEventListener('change', () => { working.presentPlayerIds = working.presentPlayerIds || []; if (cb.checked) { if (!working.presentPlayerIds.includes(p.id)) working.presentPlayerIds.push(p.id); } else working.presentPlayerIds = working.presentPlayerIds.filter((x) => x !== p.id); saveNow(); });
    row.appendChild(cb); row.appendChild(el('span.checkbox-box'));
    row.appendChild(el('span', { style: { width: '9px', height: '9px', borderRadius: '50%', background: p.color, display: 'inline-block' } }));
    row.appendChild(el('span', p.name));
    card.appendChild(row);
  });
  return card;
}

function buildClocks() {
  const card = el('div.side-card');
  const h = el('div.row.between'); h.appendChild(el('h4', { style: { margin: 0 } }, 'Clocks')); h.appendChild(iconButton('plus', { size: 15, onClick: () => addClock() })); card.appendChild(h);
  const box = el('div', { style: { marginTop: '8px' } });
  card.appendChild(box);
  function draw() {
    clear(box);
    if (!encounter.state.clocks.length) { box.appendChild(el('p.small.mute', 'No clocks running.')); return; }
    encounter.state.clocks.forEach((clk) => {
      const row = el('div.row.between', { style: { padding: '4px 0' } });
      row.appendChild(el('span.small', `${clk.name} (${clk.filled}/${clk.size})`));
      const ctrl = el('div.row.gap-1');
      ctrl.appendChild(iconButton('minus', { size: 13, onClick: () => encounter.tickClock(clk.id, -1) }));
      ctrl.appendChild(iconButton('plus', { size: 13, onClick: () => encounter.tickClock(clk.id, 1) }));
      row.appendChild(ctrl);
      box.appendChild(row);
    });
  }
  draw();
  unsub.push(encounter.on('change', draw));
  card.appendChild(button('Open Combat Tracker', { size: 'sm', variant: 'ghost', icon: 'swords', onClick: () => router.go('combat') }));
  function addClock() { const sys = appState.system; const n = (sys && sys.clockTemplates && sys.clockTemplates[0]) || { name: 'Clock', size: 6 }; encounter.addClock(n.name, n.size); }
  return card;
}

function buildDice(working, sys, saveNow) {
  const card = el('div.side-card');
  card.appendChild(el('h4', 'Quick Dice'));
  const out = el('div.mono', { style: { fontSize: '15px', margin: '6px 0', minHeight: '20px' } }, '—');
  card.appendChild(out);
  const presets = (sys && sys.rollPresets) ? sys.rollPresets.slice(0, 6) : [];
  const grid = el('div.preset-grid');
  const roll = (preset) => {
    const a = (sys.attributes || []).find((x) => x.key === preset.attr) || (sys.deriveds || []).find((x) => x.key === preset.attr);
    const aval = a ? (a.default || 0) : 0;
    const res = sys.dice.resolution;
    let opts = {};
    if (res === 'roll-under') { const em = preset.ease ? (sys.easeLadder.find((e) => e.name === preset.ease) || {}).mod || 0 : 0; opts.target = aval + em; }
    else if (res === 'percentile') opts.target = aval;
    else opts.mod = aval; // roll-high / degrees / pbta
    const r = resolveCheck(sys, opts);
    let txt = `${preset.name}: [${(r.dice || []).join(',')}] ${r.summary}`;
    if (r.success === true) txt += ' ✓'; if (r.success === false) txt += ' ✗';
    out.textContent = txt;
    working.diceLog = working.diceLog || []; working.diceLog.push({ label: preset.name, total: r.total, success: r.success, at: Date.now() });
    working.log = working.log || []; working.log.push({ type: 'roll', text: txt, at: Date.now() }); // visible in Notes & Log
    saveNow();
  };
  presets.forEach((p) => { const b = el('button.preset-btn'); b.appendChild(el('div.pn', p.name)); b.addEventListener('click', () => roll(p)); grid.appendChild(b); });
  card.appendChild(grid);
  card.appendChild(button('Full Dice Roller', { size: 'sm', variant: 'ghost', icon: 'dice', onClick: () => router.go('dice') }));
  return card;
}

function buildAudio() {
  const card = el('div.side-card');
  const h = el('div.row.between'); h.appendChild(el('h4', { style: { margin: 0 } }, 'Audio Cues'));
  h.appendChild(el('div.row.gap-1', [iconButton('pause', { size: 14, title: 'Pause all', onClick: () => audio.pauseAll() }), iconButton('stop', { size: 14, title: 'Stop all', onClick: () => audio.stopAll() })]));
  card.appendChild(h);
  // ambient scenes
  const presets = store.all('mixerpresets');
  if (presets.length) presets.forEach((p) => card.appendChild(button(p.name, { size: 'sm', icon: 'music', onClick: () => playScene(p) })));
  else card.appendChild(el('p.small.mute', { style: { margin: '8px 0' } }, 'Save scenes in the Mixer for one-tap ambient.'));
  // real SFX (download-on-demand) + synth
  const sfxRow = el('div.row.wrap.gap-1', { style: { marginTop: '8px' } });
  card.appendChild(sfxRow);
  window.xrpg.audio.manifest().then((man) => {
    (man.tracks || []).filter((t) => t.category === 'sfx').slice(0, 10).forEach((t) => {
      const b = button(t.name, { size: 'sm', variant: 'outline' });
      wireSfxToggle(b, t.id, async () => { try { const r = await window.xrpg.audio.fetch(t); audio.oneShotFile(r.url, 1, t.id); } catch { toast('SFX failed', { type: 'error' }); } }, unsub);
      sfxRow.appendChild(b);
    });
  }).catch(() => {});
  const synthRow = el('div.row.wrap.gap-1', { style: { marginTop: '6px' } });
  ['impact', 'thunder', 'gunshot', 'alert', 'heartbeat-spike'].forEach((o) => { const b = iconButton('bolt', { size: 15, title: 'synth: ' + o }); wireSfxToggle(b, o, () => audio.oneShot(o, 0.6, o), unsub); synthRow.appendChild(b); });
  card.appendChild(synthRow);
  card.appendChild(button('Open Mixer', { size: 'sm', variant: 'ghost', icon: 'music', onClick: () => router.go('mixer') }));
  return card;
}

function playScene(p) {
  audio.ensure();
  Array.from(audio.channels.keys()).forEach((id) => audio.removeChannel(id));
  (p.channels || []).forEach((c) => {
    const ch = audio.addChannel({ name: c.name, type: c.type, source: c.source, url: c.url, meta: c.meta, gain: c.volume, loop: c.loop });
    if (c.playing !== false) audio.play(ch.id);
  });
  toast(`Scene: ${p.name}`, { type: 'success', timeout: 1200 });
}

// ---------- Discord panel ----------
function attachRecording(working, r) {
  if (!r || !r.ok || !(r.manifest && r.manifest.length)) return;
  working.discordRecordings = working.discordRecordings || [];
  // Dedup: endSession and the recordingComplete event can both deliver the same
  // result — skip if this recording (by its first track's mediaId) is already attached.
  const firstId = r.manifest[0] && r.manifest[0].mediaId;
  if (firstId && working.discordRecordings.some((t) => t.mediaId === firstId)) return;
  // APPEND across record segments so ending+resuming a session keeps every recording.
  working.discordRecordings = working.discordRecordings.concat(r.manifest);
  if (r.mixdown) {
    working.discordMixdowns = working.discordMixdowns || [];
    working.discordMixdowns.push(r.mixdown);
    working.discordMixdownUrl = r.mixdown.url;
    working.discordMixdownMediaId = r.mixdown.mediaId;
    if (!working.audioMediaId) working.audioMediaId = r.mixdown.mediaId;
  }
  toast(`Recording saved: ${r.manifest.length} track(s)`, { type: 'success' });
}

// Stop an active Discord recording and attach it to the session (used on End Session).
async function stopDiscordRecordingIfActive(working) {
  try {
    const st = await window.xrpg.discord.status();
    if (st && st.recording && st.recording.active) {
      toast('Saving Discord recording…', { timeout: 4000 });
      const r = await window.xrpg.discord.stopRecording({ mixdown: true });
      attachRecording(working, r);
    }
  } catch (e) {}
}

function buildDiscord(working, campaign, sys, saveNotes) {
  const card = el('div.side-card');
  card.appendChild(el('h4', { style: { margin: '0 0 6px' } }, 'Discord — Online Session'));
  const body = el('div'); card.appendChild(body);
  const dotEls = new Map();

  const playersForLink = () => {
    const grp = store.get('groups', campaign && campaign.groupId);
    if (grp && (grp.playerIds || []).length) return grp.playerIds.map((id) => store.get('players', id)).filter(Boolean);
    return store.all('players');
  };

  const linkValueFor = (memberId) => {
    if (working.discordGmUserId === memberId) return 'gm';
    const p = store.all('players').find((x) => x.discordUserId === memberId);
    return p ? p.id : '';
  };
  const setLink = async (memberId, value) => {
    // clear any existing player link to this member FIRST (awaited, so a rapid
    // re-link can't leave two players sharing one discordUserId)
    const toClear = store.all('players').filter((p) => p.discordUserId === memberId && value !== p.id);
    for (const p of toClear) { p.discordUserId = ''; await store.save('players', p); }
    if (working.discordGmUserId === memberId && value !== 'gm') working.discordGmUserId = null;
    if (value === 'gm') { working.discordGmUserId = memberId; saveNotes(); }
    else if (value) { const p = store.get('players', value); if (p) { p.discordUserId = memberId; await store.save('players', p); } }
  };

  const drawImpl = async () => {
    clear(body); dotEls.clear();
    let avail = false; try { avail = await window.xrpg.discord.available(); } catch (e) {}
    if (!avail) { body.appendChild(el('p.small.mute', 'Discord unavailable in this build.')); return; }
    let stat = { connected: false, guilds: [] }; try { stat = await window.xrpg.discord.status(); } catch (e) {}

    if (!stat.connected) {
      body.appendChild(el('p.small.mute', stat.connecting ? 'Connecting…' : 'Bot not connected.'));
      body.appendChild(button('Open Settings', { size: 'sm', variant: 'ghost', onClick: () => router.go('settings') }));
      return;
    }
    body.appendChild(el('p.tiny.mute', { style: { margin: '0 0 6px' } }, 'Bot: ' + (stat.botTag || '')));

    // text-channel relay (visible whenever connected + a channel is configured)
    if (stat.textChannelId) {
      const relay = el('div.row.gap-1.wrap', { style: { marginBottom: '8px' } });
      relay.appendChild(button('Announce session', { size: 'sm', variant: 'ghost', onClick: async () => { const r = await window.xrpg.discord.postMessage(null, { embed: { title: `${campaign ? campaign.name : 'Session'} — S${working.number}`, description: working.title || 'The session is starting.', color: 0xd81a10 } }).catch((e) => ({ ok: false })); toast(r && r.ok ? 'Posted to channel' : 'Post failed', { type: r && r.ok ? 'success' : 'error' }); } }));
      relay.appendChild(button('Post recap', { size: 'sm', variant: 'ghost', onClick: async () => { const txt = (working.summary || working.recap || '').trim(); if (!txt) { toast('No recap yet — generate one in Recap tab', { type: 'warn' }); return; } const r = await window.xrpg.discord.postMessage(null, { embed: { title: `Recap — S${working.number}`, description: txt.slice(0, 3900), color: 0xd81a10 } }).catch(() => ({ ok: false })); toast(r && r.ok ? 'Recap posted' : 'Post failed', { type: r && r.ok ? 'success' : 'error' }); } }));
      body.appendChild(relay);
    }

    if (!stat.voice) {
      const settings = await store.getSettings();
      const guildId = settings.discordGuildId || (stat.guilds[0] && stat.guilds[0].id);
      let vchans = []; try { vchans = await window.xrpg.discord.voiceChannels(guildId); } catch (e) {}
      if (!vchans.length) { body.appendChild(el('p.small.mute', 'No voice channels found. Set a server in Settings.')); return; }
      let chosen = settings.discordVoiceChannelId || vchans[0].id;
      const sel = select(vchans.map((c) => ({ value: c.id, label: c.name })), { value: chosen, onChange: (v) => { chosen = v; } });
      body.appendChild(field('Voice channel', sel));
      body.appendChild(button('Join voice', { size: 'sm', variant: 'primary', onClick: async () => { toast('Joining…', { timeout: 1500 }); const r = await window.xrpg.discord.joinVoice(guildId, chosen).catch((e) => ({ ok: false, reason: e.message })); if (!r.ok) toast('Join failed: ' + (r.detail || r.reason), { type: 'error' }); draw(); } }));
      return;
    }

    // In voice
    const vrow = el('div.row.between', { style: { alignItems: 'center' } });
    vrow.appendChild(el('span.small', '🔊 ' + (stat.voice.channelName || 'voice')));
    vrow.appendChild(button('Leave', { size: 'sm', variant: 'ghost', onClick: async () => { try { await import('../discord-broadcast.js').then((b) => b.stopAppBroadcast()); } catch (e) {} await window.xrpg.discord.leaveVoice(); draw(); } }));
    body.appendChild(vrow);

    // members + links
    const members = (stat.members || []).filter((m) => !m.bot);
    const opts = [{ value: '', label: '— unlinked —' }, { value: 'gm', label: 'GM (me)' }].concat(playersForLink().map((p) => ({ value: p.id, label: p.name })));
    const mlist = el('div.col.gap-1', { style: { margin: '8px 0' } });
    if (!members.length) mlist.appendChild(el('p.tiny.mute', 'No one in the channel yet.'));
    members.forEach((m) => {
      const rowm = el('div.row.gap-2', { style: { alignItems: 'center' } });
      const dot = el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', flex: 'none', background: m.speaking ? 'var(--good)' : 'var(--steel,#5a6c7e)' } });
      dotEls.set(m.id, dot);
      rowm.appendChild(dot);
      const dn = m.displayName || m.username || m.id;
      rowm.appendChild(el('span.small', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: dn }, dn));
      const sel = select(opts, { value: linkValueFor(m.id), onChange: (v) => setLink(m.id, v) });
      sel.style.maxWidth = '120px';
      rowm.appendChild(sel);
      mlist.appendChild(rowm);
    });
    body.appendChild(mlist);

    // auto-link by name
    body.appendChild(button('Auto-link by name', { size: 'sm', variant: 'ghost', onClick: async () => {
      let n = 0;
      for (const m of members) {
        if (linkValueFor(m.id)) continue;
        const p = playersForLink().find((pp) => !pp.discordUserId && pp.name && pp.name.toLowerCase() === m.displayName.toLowerCase());
        if (p) { await setLink(m.id, p.id); n++; }
      }
      toast(n ? `Linked ${n} player(s)` : 'No name matches found', { type: n ? 'success' : 'warn' });
      draw();
    } }));

    // record controls
    const recRow = el('div.row.gap-2', { style: { marginTop: '8px' } });
    if (stat.recording && stat.recording.active) {
      recRow.appendChild(el('span.small', { style: { color: 'var(--ember,#ff2a1f)' } }, '● Recording…'));
      recRow.appendChild(button('Stop & save', { size: 'sm', variant: 'danger', onClick: async () => { toast('Finalizing recording…', { timeout: 2000 }); const r = await window.xrpg.discord.stopRecording({ mixdown: true }).catch((e) => ({ ok: false, reason: e.message })); if (!r.ok) toast('Stop failed: ' + (r.reason || ''), { type: 'error' }); draw(); } }));
    } else {
      recRow.appendChild(button('Start recording', { size: 'sm', variant: 'primary', onClick: async () => {
        const linkMap = {};
        members.forEach((m) => { const v = linkValueFor(m.id); if (v === 'gm') linkMap[m.id] = { role: 'gm', label: 'GM' }; else if (v) { const p = store.get('players', v); const pc = store.where('characters', (c) => c.kind === 'pc' && c.playerId === v && c.systemId === (campaign && campaign.systemId))[0]; linkMap[m.id] = { playerId: v, characterId: pc ? pc.id : null, label: p ? p.name : m.displayName, role: 'player' }; } });
        const r = await window.xrpg.discord.startRecording(working.id, { linkMap }).catch((e) => ({ ok: false, reason: e.message }));
        if (!r.ok) toast('Record failed: ' + (r.reason || ''), { type: 'error' }); else toast('Recording started', { type: 'success' });
        draw();
      } }));
    }
    body.appendChild(recRow);

    // existing recordings
    if (working.discordRecordings && working.discordRecordings.length) {
      const rsec = el('div', { style: { marginTop: '10px' } });
      rsec.appendChild(el('div.tiny.mute', 'Recorded tracks'));
      working.discordRecordings.forEach((tr) => {
        const r2 = el('div.row.between', { style: { alignItems: 'center' } });
        r2.appendChild(el('span.tiny', { title: tr.label }, `${tr.label}${tr.role === 'gm' ? ' (GM)' : ''}`));
        const a = el('audio', { src: tr.url, controls: '', style: { height: '24px', maxWidth: '120px' } });
        r2.appendChild(a);
        rsec.appendChild(r2);
      });
      if (working.discordMixdownUrl) { rsec.appendChild(el('div.tiny.mute', { style: { marginTop: '4px' } }, 'Mixdown')); rsec.appendChild(el('audio', { src: working.discordMixdownUrl, controls: '', style: { height: '26px', width: '100%' } })); }
      rsec.appendChild(button('Transcribe (speaker-labeled)', { size: 'sm', icon: 'spark', onClick: async () => {
        toast('Transcribing each track…', { timeout: 2500 });
        const r = await window.xrpg.discord.transcribeRecording(working.discordRecordings).catch((e) => ({ ok: false, reason: e.message }));
        if (!r.ok) { toast('Transcription failed: ' + (r.reason || ''), { type: 'error' }); return; }
        working.transcript = r.transcript || working.transcript;
        saveNotes();
        toast('Transcript ready (see Recap)', { type: 'success' });
      } }));
      body.appendChild(rsec);
    }

    // Broadcast the WHOLE app's audio (mixer + soundboard + everything) to the channel.
    const bsec = el('div', { style: { marginTop: '12px', borderTop: '1px solid var(--line,#2a2f3a)', paddingTop: '10px' } });
    const bb = await import('../discord-broadcast.js');
    const on = bb.isBroadcasting();
    bsec.appendChild(el('div.row.between', { style: { alignItems: 'center' } }, [
      el('span.small', on ? '📢 Broadcasting app audio' : '📢 Broadcast app audio'),
      button(on ? 'Stop' : 'Start', { size: 'sm', variant: on ? 'ghost' : 'primary', onClick: async () => {
        if (bb.isBroadcasting()) { await bb.stopAppBroadcast(); toast('Broadcast stopped'); }
        else { const r = await bb.startAppBroadcast(); if (!r || r.ok === false) toast('Broadcast failed: ' + (r && (r.detail || r.reason) || ''), { type: 'error' }); else toast('Players now hear the mixer & soundboard', { type: 'success' }); }
        draw();
      } }),
    ]));
    if (on && discord.broadcastStatus) bsec.appendChild(el('p.tiny', { style: { marginTop: '2px', color: discord.broadcastStatus === 'error' ? 'var(--ember,#ff2a1f)' : 'var(--mute)' } }, discord.broadcastStatus === 'error' ? ('Error: ' + (discord.broadcastError || '')) : ('Status: ' + discord.broadcastStatus)));
    bsec.appendChild(el('p.tiny.mute', { style: { marginTop: '4px' } }, 'Plays everything this app produces (Mixer scenes, Audio Cues, soundboard) into the voice channel. Play a sound to test.'));
    body.appendChild(bsec);
  };

  // Serialize redraws: a burst of events (voiceJoin/status/members) must not run
  // concurrent async draws, or the member list gets appended multiple times.
  let drawing = false, drawAgain = false;
  const draw = async () => {
    if (drawing) { drawAgain = true; return; }
    drawing = true;
    try { await drawImpl(); } finally { drawing = false; if (drawAgain) { drawAgain = false; draw(); } }
  };

  draw();
  ['status', 'members', 'voiceJoin', 'voiceLeave', 'recordingState', 'recordingComplete', 'broadcastState'].forEach((ev) => unsub.push(discord.on(ev, () => draw())));
  unsub.push(discord.on('speaking', (e) => { const d = dotEls.get(e.userId); if (d) d.style.background = e.speaking ? 'var(--good)' : 'var(--steel,#5a6c7e)'; }));
  return card;
}

function buildAiTools(working, campaign, saveNow) {
  const card = el('div.side-card');
  card.appendChild(el('h4', 'On the Fly'));
  card.appendChild(button('Introduce an NPC', { size: 'sm', icon: 'npc', wfull: true, onClick: () => quickNpc(working, campaign, saveNow) }));
  card.appendChild(el('div', { style: { height: '6px' } }));
  card.appendChild(button('Improv a complication', { size: 'sm', icon: 'spark', onClick: async () => {
    const sys = appState.system;
    const m = modal({ title: 'Complication', width: 560 }); const out = el('div.ai-stream'); m.setBody(out);
    try { await generate({ system: `You are a GM assistant for ${sys ? sys.name : 'a TTRPG'}. Keep it short and runnable.`, prompt: `Give me one surprising but fair complication to drop into the current scene right now${campaign ? ' in the campaign "' + campaign.name + '"' : ''}. One paragraph.`, onDelta: (d, full) => { out.textContent = full; } }); } catch (e) { out.textContent = e.message; }
  } }));
  return card;
}

async function quickNpc(working, campaign, saveNow) {
  const sys = appState.system;
  if (!sys) { toast('No active game system', { type: 'warn' }); return; }
  const m = modal({ title: 'Introduce an NPC', width: 560 });
  const out = el('div.ai-stream'); out.textContent = 'Generating…';
  m.setBody(out);
  let text = '';
  try {
    const ctx = `System: ${sys ? sys.name : ''}. ${campaign ? 'Campaign: ' + campaign.name + '. ' + ((campaign.storyline && campaign.storyline.premise) || '') : ''}`;
    const res = await generate({ system: `You are a GM assistant. Return a JSON object with keys name, role, attrs (keys: ${(sys.attributes || []).map((a) => a.key).join(', ')}), statBlock, wants, notes, threat (boolean).`, prompt: `Invent one NPC who could walk into the current scene. Make them vivid and immediately useful. ${ctx}`, bridgeTitle: 'Quick NPC', onDelta: (d, full) => { text = full; out.textContent = full; } });
    text = res.text || text;
  } catch (e) { out.textContent = e.message; return; }
  m.setFooter(
    button('Close', { variant: 'ghost', onClick: () => m.close() }),
    button('Add to roster', { variant: 'primary', icon: 'plus', onClick: async () => {
      const { extractJson } = await import('../ai-client.js');
      const json = extractJson(text);
      const { blankCharacter } = await import('../rules.js');
      const c = blankCharacter(sys, 'npc'); c.id = 'npc_' + uid('').slice(0, 8); c.portraitSeed = uid('seed');
      if (json) { c.name = json.name || 'NPC'; c.role = json.role || ''; c.statBlock = json.statBlock || ''; c.wants = json.wants || ''; c.notes = json.notes || ''; c.threat = !!json.threat; if (json.attrs) (sys.attributes || []).forEach((a) => { if (json.attrs[a.key] != null) c.attrs[a.key] = json.attrs[a.key]; }); }
      else { c.name = 'New NPC'; c.notes = text; }
      await store.save('characters', c);
      working.npcIntroduced = working.npcIntroduced || []; working.npcIntroduced.push(c.id); saveNow();
      m.close(); toast(`${c.name} added`, { type: 'success' });
    } }),
  );
}

async function endSession(working, campaign) {
  if (!(await confirm({ title: 'End session?', message: 'Save and close this session? You can reopen it any time from the Session Log.', okLabel: 'End session' }))) return;
  await stopDiscordRecordingIfActive(working); // stop + save the bot recording
  try { await import('../discord-broadcast.js').then((b) => b.stopAppBroadcast()); } catch (e) {}
  if (rec && (rec.state === 'recording' || rec.state === 'paused')) { const blob = await rec.stop(); if (blob) { const saved = await rec.saveBlob(blob); working.audioMediaId = saved.id; working.transcript = rec.transcript || working.transcript; } }
  foldElapsed();
  if (rec) rec.reset();
  await store.save('sessions', working);
  activeWorking = null; openedAt = 0;
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  unsub.forEach((u) => u && u()); unsub = [];
  recUnsub.forEach((u) => u && u()); recUnsub = [];
  appState.setSession(null);
  toast('Session saved', { type: 'success' });
  router.go('sessions', working.id);
}

export async function teardown() {
  unsub.forEach((u) => u && u()); unsub = [];
  recUnsub.forEach((u) => u && u()); recUnsub = [];
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  // Fold accrued time and persist (awaited so a subsequent store read is fresh).
  if (activeWorking) {
    foldElapsed();
    const w = activeWorking;
    activeWorking = null; openedAt = 0;
    if (rec && rec.state !== 'recording' && rec.state !== 'paused') rec.reset();
    try { await store.save('sessions', w); } catch {}
    return;
  }
  if (rec && rec.state !== 'recording' && rec.state !== 'paused') rec.reset();
  activeWorking = null; openedAt = 0;
}
