import { el, clear, uid, deepClone, fmtDateTime } from '../util.js';
import { icon } from '../icons.js';
import { button, iconButton, empty, badge, chip, modal, confirm, toast, field, input, textarea, select, copyText } from '../ui.js';
import { setMarkdown } from '../markdown.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { generate, liveAvailable, extractJson } from '../ai-client.js';
import { blankCharacter, allDeriveds } from '../rules.js';
import { commitStoryline } from './campaigns.js';

const TOOLS = [
  { id: 'npc', name: 'Generate NPC', icon: 'npc', desc: 'A fully-statted NPC grounded in your system & campaign.', json: true },
  { id: 'encounter', name: 'Build Encounter', icon: 'swords', desc: 'Threats, tactics, clocks, and a twist.' },
  { id: 'readaloud', name: 'Read-Aloud / Scene', icon: 'scroll', desc: 'Evocative boxed text for a moment.' },
  { id: 'involve', name: 'Involve the Players', icon: 'users', desc: 'Hooks that pull on each PC\'s ties & fears.' },
  { id: 'evolve', name: 'Evolve the Story', icon: 'spark', desc: 'React to what the players did; propose next beats.' },
  { id: 'storyline', name: 'New Storyline', icon: 'flag', desc: 'A full multi-session campaign outline.', json: true },
  { id: 'recap', name: 'Session Recap', icon: 'history', desc: 'Summarize notes/transcript & recommend next session.' },
];

let activeTool = 'npc';

export async function render(entry, entryId) {
  shell.crumbs([{ label: 'AI Studio' }]);
  const live = await liveAvailable(true);
  shell.actions([
    el('span.ai-mode-tag.' + (live ? 'ai-mode-live' : 'ai-mode-bridge'), [icon('spark', 13), live ? 'Live (API key set)' : 'Bridge mode (no key)']),
    button('AI Settings', { icon: 'gear', size: 'sm', onClick: () => router.go('settings') }),
  ]);

  // entry routing
  let presetCampaignId = appState.activeCampaignId;
  if (entry === 'campaign' && entryId) { activeTool = 'evolve'; presetCampaignId = entryId; }
  if (entry === 'storyline' && entryId) { activeTool = 'storyline'; }

  const wrap = el('div.view-pad');
  if (!live) {
    wrap.appendChild(el('div.notice.warn', { style: { marginBottom: '16px' } }, 'No Anthropic API key set — running in bridge mode. Every generation gives you a ready-to-paste prompt for Claude (here or claude.ai), and you paste the reply back. Add a key in Settings for one-click live generation.'));
  }

  const layout = el('div.ai-layout');
  // tool list
  const toolCol = el('div.ai-tools');
  TOOLS.forEach((t) => {
    const b = el('button.ai-tool' + (t.id === activeTool ? ' active' : ''));
    b.appendChild(el('div.tt', [icon(t.icon, 16), t.name]));
    b.appendChild(el('div.td', t.desc));
    b.addEventListener('click', () => { activeTool = t.id; render(entry, entryId); });
    toolCol.appendChild(b);
  });
  layout.appendChild(toolCol);

  // main panel
  const panel = el('div.col.gap-4');
  layout.appendChild(panel);
  wrap.appendChild(layout);

  buildToolPanel(panel, activeTool, presetCampaignId);

  shell.render(wrap);
}

function campaignSelector(value) {
  const camps = store.all('campaigns');
  return select([{ value: '', label: '— No campaign context —' }, ...camps.map((c) => ({ value: c.id, label: c.name }))], { value: value || '' });
}

function buildToolPanel(panel, toolId, presetCampaignId) {
  clear(panel);
  const tool = TOOLS.find((t) => t.id === toolId);
  panel.appendChild(el('h2', tool.name));
  panel.appendChild(el('p.dim', tool.desc));

  const campSel = campaignSelector(presetCampaignId);
  panel.appendChild(field('Campaign context', campSel, { hint: 'Grounds the generation in your world, PCs, and recent sessions.' }));

  // tool-specific input
  let extraInput = null;
  if (toolId === 'npc') extraInput = input({ placeholder: 'Optional: a concept (e.g. "a paranoid pharmacist hoarding insulin")' });
  else if (toolId === 'encounter') extraInput = input({ placeholder: 'Optional: situation (e.g. "ambush at a frozen gas station")' });
  else if (toolId === 'readaloud') extraInput = textarea({ placeholder: 'Describe the moment to narrate…', rows: 2 });
  else if (toolId === 'evolve') extraInput = textarea({ placeholder: 'What did the players just do? Key outcomes, deaths, choices…', rows: 3 });
  else if (toolId === 'storyline') extraInput = textarea({ placeholder: 'Premise / pitch for the new storyline…', rows: 2 });
  else if (toolId === 'recap') extraInput = textarea({ placeholder: 'Paste session notes or transcript (or pick a session below)…', rows: 4 });
  if (extraInput) panel.appendChild(field(toolId === 'recap' ? 'Notes / transcript' : 'Your input', extraInput));

  // recap: session picker
  let sessionSel = null;
  if (toolId === 'recap') {
    const sessions = store.all('sessions').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    sessionSel = select([{ value: '', label: '— Or pick a recorded session —' }, ...sessions.map((s) => ({ value: s.id, label: `${(store.get('campaigns', s.campaignId) || {}).name || ''} · S${s.number} ${s.title}` }))], { value: '', onChange: (v) => { if (v) { const s = store.get('sessions', v); extraInput.value = (s.transcript || '') + '\n\n' + (s.notes || ''); campSel.value = s.campaignId || ''; } } });
    panel.appendChild(field('Session', sessionSel));
  }

  const genBtn = button('Generate', { variant: 'primary', icon: 'spark', onClick: run });
  const stopBtn = button('Stop', { variant: 'ghost', icon: 'stop', onClick: () => { if (currentStream) currentStream.cancel(); } });
  stopBtn.classList.add('hidden');
  panel.appendChild(el('div.row.gap-2', [genBtn, stopBtn]));

  const output = el('div.ai-output');
  output.appendChild(el('div.empty', [icon('spark', 36, { class: 'empty-icon' }), el('p.empty-hint', 'Your generation will appear here.')]));
  panel.appendChild(output);

  const applyRow = el('div.row.gap-2.wrap');
  panel.appendChild(applyRow);

  let currentStream = null;
  let lastText = '';

  async function run() {
    const campaign = campSel.value ? store.get('campaigns', campSel.value) : null;
    const ctx = buildContext(campaign);
    const { system, prompt } = buildPrompt(toolId, ctx, extraInput ? extraInput.value : '');

    clear(output); clear(applyRow);
    const streamEl = el('div.ai-stream');
    output.appendChild(streamEl);
    genBtn.classList.add('hidden'); stopBtn.classList.remove('hidden');
    lastText = '';

    try {
      const res = await generate({
        system, prompt, temperature: toolId === 'storyline' ? 0.9 : 0.85, max_tokens: toolId === 'storyline' ? 4096 : 2048,
        bridgeTitle: tool.name,
        onController: (c) => { currentStream = c; },
        onDelta: (delta, full) => { lastText = full; streamEl.textContent = full; output.scrollTop = output.scrollHeight; },
      });
      lastText = res.text || lastText;
      // render markdown for prose tools
      if (!tool.json) { clear(output); const prose = el('div.prose.selectable'); setMarkdown(prose, lastText); output.appendChild(prose); }
      // save generation
      await store.save('generations', { id: 'gen_' + uid('').slice(0, 8), tool: toolId, campaignId: campaign ? campaign.id : null, systemId: appState.activeSystemId, input: extraInput ? extraInput.value : '', output: lastText, mode: res.mode });
      buildApply(applyRow, toolId, lastText, campaign);
      if (res.mode !== 'cancel') toast('Generated', { type: 'success', timeout: 1200 });
    } catch (e) {
      clear(output); output.appendChild(el('div.empty', [icon('warn', 32, { class: 'empty-icon' }), el('p.empty-msg', 'Generation failed'), el('p.empty-hint', e.message)]));
    } finally {
      genBtn.classList.remove('hidden'); stopBtn.classList.add('hidden'); currentStream = null;
    }
  }

  function buildApply(row, toolId, text, campaign) {
    clear(row);
    row.appendChild(button('Copy', { icon: 'copy', size: 'sm', onClick: () => copyText(text) }));
    if (toolId === 'npc') {
      row.appendChild(button('Add as NPC', { icon: 'plus', variant: 'primary', size: 'sm', onClick: () => applyNpc(text) }));
    } else if (toolId === 'storyline') {
      row.appendChild(button('Create storyline', { icon: 'plus', variant: 'primary', size: 'sm', onClick: () => applyStoryline(text) }));
    } else if (toolId === 'recap' && campaign) {
      row.appendChild(button('Save to a session', { icon: 'save', variant: 'primary', size: 'sm', onClick: () => applyRecap(text, campaign) }));
    } else if ((toolId === 'evolve' || toolId === 'involve' || toolId === 'encounter' || toolId === 'readaloud') && campaign) {
      row.appendChild(button('Append to campaign notes', { icon: 'save', size: 'sm', onClick: async () => { const c = deepClone(campaign); c.notes = (c.notes || '') + `\n\n--- ${tool.name} (${fmtDateTime(new Date().toISOString())}) ---\n` + text; await store.save('campaigns', c); toast('Saved to campaign notes', { type: 'success' }); } }));
    }
  }
}

// ---------- Context + prompt building ----------
function buildContext(campaign) {
  const sys = appState.system;
  const lines = [];
  if (sys) {
    lines.push(`GAME SYSTEM: ${sys.name} — ${sys.tagline || ''}`);
    if (sys.dice) lines.push(`Dice: ${sys.dice.summary || sys.dice.notation}`);
    if (sys.attributes) lines.push(`Attributes: ${sys.attributes.map((a) => a.name).join(', ')}`);
    if (sys.deriveds) lines.push(`Derived stats: ${sys.deriveds.map((d) => `${d.name} = ${d.formula}`).join('; ')}`);
    if (sys.npcStatFormat) lines.push(`NPC stat block format: ${sys.npcStatFormat}`);
  }
  if (campaign) {
    const story = campaign.storyline || {};
    lines.push(`\nCAMPAIGN: ${campaign.name}`);
    if (story.premise) lines.push(`Premise: ${story.premise}`);
    if (story.tone) lines.push(`Tone: ${story.tone}`);
    // PCs
    const grp = store.get('groups', campaign.groupId);
    const pcs = store.where('characters', (c) => c.kind === 'pc' && c.systemId === campaign.systemId);
    if (pcs.length) {
      lines.push('\nPLAYER CHARACTERS:');
      pcs.slice(0, 6).forEach((pc) => lines.push(`- ${pc.name} (${pc.role || ''})${pc.tie ? `, protects: ${pc.tie}` : ''}${pc.fear ? `, fears: ${pc.fear}` : ''}`));
    }
    // NPCs
    if (story.npcs && story.npcs.length) {
      const npcs = story.npcs.map((id) => store.get('characters', id)).filter(Boolean);
      if (npcs.length) { lines.push('\nKEY NPCS:'); npcs.slice(0, 8).forEach((n) => lines.push(`- ${n.name}: ${n.role || ''}`)); }
    }
    // recent sessions
    const sessions = store.where('sessions', (s) => s.campaignId === campaign.id).sort((a, b) => (b.number || 0) - (a.number || 0));
    if (sessions.length) {
      lines.push('\nRECENT SESSIONS:');
      sessions.slice(0, 4).forEach((s) => lines.push(`- S${s.number} ${s.title}${s.summary ? ': ' + s.summary.slice(0, 240) : ''}`));
    }
    if (campaign.notes) lines.push(`\nGM NOTES: ${campaign.notes.slice(0, 800)}`);
  }
  return { sys, campaign, text: lines.join('\n') };
}

function buildPrompt(toolId, ctx, userInput) {
  const sys = ctx.sys;
  const attrKeys = sys && sys.attributes ? sys.attributes.map((a) => a.key) : [];
  const baseSystem = `You are an expert game master's assistant for the tabletop RPG system "${sys ? sys.name : 'a tabletop RPG'}". Be vivid, grounded, and concise. Match the established tone. Never break the established canon. Here is the working context:\n\n${ctx.text}`;

  switch (toolId) {
    case 'npc':
      return {
        system: baseSystem + `\n\nReturn ONLY a JSON object (no prose) with keys: name, role, attrs (an object with keys: ${attrKeys.join(', ')} as integers), statBlock (a one-line stat string in the system's format), wants, notes (2-4 sentences), tags (array of short strings), threat (boolean).`,
        prompt: `Create one memorable NPC for this campaign.${userInput ? ' Concept: ' + userInput : ''}`,
      };
    case 'encounter':
      return { system: baseSystem, prompt: `Design a tense encounter${userInput ? ' — ' + userInput : ''}. Include: the setup, 1-3 threats with quick stat blocks, environmental pressure, a clock or countdown, enemy tactics, and one twist or hard choice. Keep it runnable at the table.` };
    case 'readaloud':
      return { system: baseSystem, prompt: `Write 1-2 short read-aloud (boxed text) passages for this moment, in the system's voice (second person, evocative, economical): ${userInput || 'the current scene'}. Then a one-line GM note on what to watch for.` };
    case 'involve':
      return { system: baseSystem, prompt: `Suggest 4-6 specific ways to pull each player character deeper in, using their ties and fears. For each: which PC, the hook, and how to introduce it this session.${userInput ? ' Focus: ' + userInput : ''}` };
    case 'evolve':
      return { system: baseSystem, prompt: `The players just did the following: ${userInput || '(see recent sessions above)'}.\n\nAs their GM, react: (1) consequences that should ripple forward, (2) 3-4 concrete beats for the next session, (3) any NPC whose status or stance changes, (4) a new complication or NPC to introduce. Keep canon intact and the tone consistent.` };
    case 'storyline':
      return {
        system: baseSystem + `\n\nReturn ONLY a JSON object with keys: name, subtitle, premise, tone, contentWarnings (array), setting (object with when, where), acts (array of {id, title, days, summary}), sessions (array of {number, title, subtitle, act, situation, readAlouds (array of strings), checksClocks (array), rewards}), locations (array of {name, tags, desc}), factions (array of {name, desc}), timeline (array of {when, what}). Aim for 3 acts and 4-6 sessions.`,
        prompt: `Design a complete ${sys ? sys.name : ''} storyline.${userInput ? ' Pitch: ' + userInput : ''}`,
      };
    case 'recap':
      return { system: baseSystem, prompt: `Here are the session notes/transcript:\n\n"""${userInput || '(none provided)'}"""\n\nProduce:\n1. **Recap** — a tight 1-2 paragraph summary of what happened.\n2. **Key moments** — bullet list (decisions, deaths, NPC fates, clocks advanced).\n3. **Threads left open** — what's unresolved.\n4. **Recommendations for next session** — 3-5 concrete suggestions, including how to involve each PC and any new NPC to introduce.` };
    default:
      return { system: baseSystem, prompt: userInput || 'Help me run my game.' };
  }
}

// ---------- Apply actions ----------
async function applyNpc(text) {
  const json = extractJson(text);
  if (!json) { toast('Could not parse NPC JSON — copy & add manually', { type: 'warn' }); return; }
  const sys = appState.system;
  if (!sys) { toast('No active game system', { type: 'warn' }); return; }
  const c = blankCharacter(sys, 'npc');
  c.id = 'npc_' + uid('').slice(0, 8);
  c.name = json.name || 'Generated NPC';
  c.role = json.role || '';
  c.statBlock = json.statBlock || '';
  c.wants = json.wants || '';
  c.notes = json.notes || '';
  c.tags = Array.isArray(json.tags) ? json.tags : [];
  c.threat = !!json.threat;
  c.portraitSeed = uid('seed');
  if (json.attrs) for (const a of (sys.attributes || [])) if (json.attrs[a.key] != null) c.attrs[a.key] = json.attrs[a.key];
  await store.save('characters', c);
  toast(`Added ${c.name}`, { type: 'success' });
  router.go('characters', c.id);
}

async function applyStoryline(text) {
  const json = extractJson(text);
  if (!json) { toast('Could not parse storyline JSON — copy & add manually', { type: 'warn' }); return; }
  const story = {
    id: 'story_' + uid('').slice(0, 8), systemId: appState.activeSystemId,
    name: json.name || 'Generated Storyline', subtitle: json.subtitle || '',
    premise: json.premise || '', tone: json.tone || '', contentWarnings: json.contentWarnings || [],
    setting: json.setting || {}, acts: json.acts || [], sessions: json.sessions || [],
    locations: json.locations || [], factions: json.factions || [], npcs: [], timeline: json.timeline || [],
    _seed: false, _aiGenerated: true,
  };
  await store.save('storylines', story);
  toast('Storyline created', { type: 'success' });
  router.go('storylines', story.id);
}

async function applyRecap(text, campaign) {
  const sessions = store.where('sessions', (s) => s.campaignId === campaign.id).sort((a, b) => (b.number || 0) - (a.number || 0));
  if (!sessions.length) { toast('No sessions in this campaign yet', { type: 'warn' }); return; }
  const sel = select(sessions.map((s) => ({ value: s.id, label: `S${s.number} — ${s.title}` })), {});
  const m = modal({ title: 'Save recap to session', width: 420, body: [field('Session', sel)] });
  m.setFooter(button('Save', { variant: 'primary', onClick: async () => { const s = deepClone(store.get('sessions', sel.value)); s.summary = text; await store.save('sessions', s); m.close(); toast('Recap saved', { type: 'success' }); } }));
}
