# CLAUDE.md — XRPG

Project context for Claude Code. Loaded automatically as memory; read it before editing anything. It encodes the **app architecture** and the **canon, tone, and hard constraints** locked in for the flagship content. When in doubt, preserve canon and ask before changing it.

---

## 0. What this project is now

**XRPG** is a comprehensive **game-master desktop app** (Electron) for running tabletop RPGs end-to-end: campaigns, characters (PC/NPC) with inventory & rewards, rules lookup, a dice engine, a combat/encounter tracker, a virtual tabletop (with a pop-out player display), an audio mixer with a real royalty-free library, session recording with AI recap, native system/storyline editors, and hybrid Claude AI integration. It is **system-agnostic** and ships with **eight** game systems — STRAIN Z (flagship), D&D 5E (2024, SRD 5.2), Pathfinder 2E (Remaster), Call of Cthulhu 7E (percentile), Heroes & Hazards (d20), Hearts on Fire (PbtA), Neon Static (original cyberpunk d10), and a Mörk Borg-compatible system. Versions/licenses are labeled per system.

There are **two layers**:
1. **The XRPG app** — the Electron application (the primary deliverable).
2. **Flagship content** — STRAIN Z: its system, the "The Long Way Home" storyline, canonical NPCs, and a demo party — all encoded as JSON **seeds** loaded on first run. The original `STRAIN-Z-Campaign-Guide.md` and `strain-z-teaser.html` remain at the repo root as source/asset references; the teaser can serve as an attract-mode trailer.

### Layout
```
XRPG/
├─ package.json                 # Electron app (npm start / npm run dist)
├─ electron/                    # main process
│  ├─ main.js                   # window, custom xrpg:// protocol, dev flags
│  ├─ preload.js                # contextBridge → window.xrpg (safe API)
│  ├─ ipc.js                    # all IPC handlers
│  ├─ store.js                  # file-based data store (userData), atomic writes, safeStorage
│  ├─ ai.js                     # Anthropic Messages API proxy (streaming)
│  └─ transcribe.js             # optional Whisper-compatible transcription
├─ renderer/                    # UI (vanilla ES modules, served via xrpg://)
│  ├─ index.html  test.html
│  ├─ css/                      # base, components, layout, views, vtt, mixer
│  └─ js/                       # core libs + js/views/* (one per nav section)
├─ content/seeds/*.json         # seeded systems, storyline, NPCs, party, scene
├─ assets/                      # generated icon.ico / icon.png
├─ STRAIN-Z-Campaign-Guide.md   # source of the STRAIN Z seed content
└─ strain-z-teaser.html         # the animated teaser (attract asset)
```

### Commands
- **Run the app:** `npm start` (Electron). First run seeds STRAIN Z + demo systems.
- **Build installer:** `npm run dist` (electron-builder → Windows NSIS → `dist/XRPG-Setup-<version>.exe`). Unsigned (no code-signing cert configured; `win.forceCodeSigning:false`). Also emits `latest.yml` + `.blockmap` for auto-update.
- **Publish a release:** bump `version` in `package.json`, then `npm run publish` (electron-builder `--publish always`) with a `GH_TOKEN` env var to push the installer + `latest.yml` to the GitHub release. Clients then auto-update.
- **Auto-update:** `electron-updater` (`electron/updater.js`); feed is `build.publish` in package.json (GitHub `Xirma377/XRPG`) or a custom URL via Settings → Updates (`settings.updateFeedUrl`, generic provider). Only runs in the **packaged** app. About dialog (click the sidebar logo) + Settings → Updates expose check/install. Copyright **© Xirma. All rights reserved.** (`license: UNLICENSED`, `private: true`).
- **Dev/test flags** (each captures/runs then quits):
  - `electron . --test` → runs `renderer/test.js` harness, writes `.dev/test-results.json`. **Keep this green.**
  - `electron . --shot=route[,route2]` → screenshots view(s) to `.dev/shot-*.png` (e.g. `--shot=dashboard,vtt`).
  - `electron . --demo` → creates a demo campaign+session and screenshots the flow.
  - `electron . --make-icons` → regenerates `assets/icon.*`.
- Visual testing: the app screenshots **itself** via `capturePage()` (computer-use can't grab the dev window by name). Use `--shot`/`--demo`, then Read the PNG.

### Architecture conventions (do not break)
- **Renderer is vanilla JS ES modules** served over a registered, secure custom scheme **`xrpg://`** (main `protocol.handle`). No bundler. Media is served at `xrpg://media/<kind>/<id>`.
- **Strict CSP** (`script-src 'self' xrpg:`) → **no inline scripts, no `eval`/`new Function`**. Derived-stat formulas use the hand-written safe evaluator in `js/expr.js`. `window.prompt/alert/confirm` are **unsupported in Electron** — use `ui.js` `modal`/`confirm`/`promptText`.
- **Data store**: one JSON file per doc under `userData/XRPG/<collection>/<id>.json`; binaries under `media/`. Atomic writes. Secrets (API keys) encrypted via `safeStorage` and **never returned to the renderer** — AI calls run in main.
- **Rules engine is data-driven**: a system defines `attributes`, `deriveds` (formulas), `dice` (`resolution`: roll-under / roll-high / **degrees** (PF2e) / **percentile** (CoC) / pbta / pool), `tracks`, `conditions`, `reference`, `bestiary`, `rewardStat`, etc. The dice roller, sheets, tracker, and AI grounding all read it. New resolutions live in `dice.js resolveCheck` + the `views/dice.js` branches. Don't hardcode any one system's assumptions in shared code. **System & storyline editing is native** (form-based `js/editors.js` `objListEditor`, in the Systems/Storylines "Edit" tabs) with a raw-JSON escape hatch.
- **Characters**: belong to one system (`systemId`) but a player can own characters across systems. Inventory + rewards mutate via `js/progress.js` (logged); "Copy to System" maps attributes onto a target system. Custom fields are per-character.
- **Audio**: a curated **download-on-demand** library (`content/audio-library.json`, real CC0/PD/CC-BY tracks) cached in `media/library/` via main-process `audio:fetch`; the `js/audio-engine.js` synth bank is the offline fallback; users can import their own. The mixer has full transport (per-channel play/pause/stop, pause-all/stop-all) with **in-place strip updates** (never rebuild all strips on a single channel event). The audio engine starts on first user interaction (no manual "start" button). Honor CC-BY attributions (Credits panel).
- **IDs**: use `util.js uid(prefix)` for renderer-side ids. Its counter + randomness come **first**, so `uid('').slice(0, N)` stays unique — but prefer `uid('ch')` over `'ch_' + uid('').slice(...)`. Never slice a `Date.now()`-first id (the old bug: every audio channel/token/inventory id collided, so only the latest survived in its Map).
- **Multi-window**: `window:popout` opens a secondary window in `?popout=` mode (no shell) — used for the VTT **player display**. The main process broadcasts `store:changed` so windows stay live; the editing window doesn't react to its own VTT scene changes (only the popout player view re-applies `setScene`).
- **Versioning (key requirement)**: a Campaign **forks** a Storyline into its own working copy with `storylineVersions[]`. Each played Session pins `storylineVersion`. `commitStoryline()` (in `views/campaigns.js`) auto-creates a new version when the current one already has played sessions, so **editing a campaign never loses past play history**. The `--test` harness asserts this.
- **AI is hybrid**: live (Anthropic key in `safeStorage`, streamed via IPC) **or** a copy/paste **bridge** (no key). See `js/ai-client.js`.
- **Generated visuals** — portraits, tokens, maps, monster icons, and the app icon are all **generated** (`js/assets.js` SVG). Audio is the curated royalty-free library above + a synth fallback (no bundled binary assets in the repo).
- **View lifecycle**: each `js/views/*.js` exports `render(...params)`; interactive views (vtt, mixer, combat, session, dice) keep module-level handles and **must tear down** timers/listeners/RAF/audio nodes on re-entry.
- **Discord (online sessions)**: a bot runs in the **main process** (`electron/discord.js`, deps `discord.js` + `@discordjs/voice` + `prism-media` + `libsodium-wrappers` + `opusscript`; pure-JS/wasm, no ffmpeg/native). Token is a `safeStorage` secret (`discord`) — **never** returned to the renderer. It joins a voice channel and records **per-user**: each speaker's Opus is decoded (opusscript) → mono-16k WAV (Whisper-ideal) with per-frame timestamps in a temp file, enabling a best-effort **time-aligned mixdown** without ffmpeg. Per-user tracks + mixdown are saved via `store.saveMedia('audio',…)`; `transcribeRecording()` uses verbose_json segments to build a speaker-labeled, chronologically-interleaved transcript into `session.transcript` (feeds the AI recap). Slash commands (`/roll /check /sheet /hp`) are forwarded to the renderer (`discord-bridge.js`) so they reuse the one dice/rules engine, then reply via `discord:slashReply`. Players link to Discord users via `player.discordUserId` (one user ↔ one player; GM maps to `session.discordGmUserId`). Other features: text-channel relay (announce/recap/roll replies), chat mirror → session log, rich presence, and ambience **broadcast** (Ogg/WAV native; mp3 needs ffmpeg on PATH). UI: Settings → Discord (token/connect/channels/toggles) + the Session Runner **Discord panel** (`buildDiscord`). Renderer singleton `js/discord.js` subscribes to `discord:event` once; session subscriptions go through `unsub` and tear down on re-entry. Audio pipeline is unit-tested via `npm run test:discord` (`scripts/test-discord-audio.js`).

---

## 2. Tone pillars (apply to everything)

- **Dread over gore.** The horror is helplessness, cold, and inevitability — not splatter.
- **The dead are NOT the main threat.** Cold, fuel, panic, and other living people are. The dead are the *pressure* that turns ordinary problems lethal. Keep this front of mind in every scene and every line of teaser copy.
- **Grounded realism.** Real Arizona geography, real winter, plausible human behavior. Avoid genre camp in the writing.
- **Quiet beats earn loud ones.** Protect the small human moments; they make the shocks land.
- **Content warnings (canon):** child death and reanimation (Session 1), a pandemic framing layered over the real early days of COVID-19 (late Feb 2020), despair and exposure deaths. Handle with care; never gratuitous.

---

## 3. Campaign canon — do not contradict

### System: 3d6 Roll-Under
- Roll **3d6**, succeed if total **≤ Attribute + Ease Modifier**.
- **Attributes:** Brawn, Agility, Wits, Charm. Start 8 each, distribute 10 points, max 14 at creation (cap 16 later).
- **Ease:** Simple +2 · Average +0 · Hard −2 · Desperate −4 · Heroic −6.
- **Criticals:** natural 3 = crit success; natural 18 = crit failure.
- **Clean Hit:** succeed by 5+ → +2 damage.
- **Headshot:** −4 (Desperate) to hit; instantly destroys a zombie. Ranged beyond short range: extra −2.
- **Vitality (VIT) = 6 + Brawn.** Down at 0.
- **Composure** = 3 (+1 if Wits ≥ 12, +1 if Charm ≥ 12; max 5). Break at 0.
- **Cold ladder:** Chilled → Shivering → Frostnipped → Hypothermic. Hourly Brawn check, difficulty worsening one step each consecutive exposed hour. Central system — the snow is the quiet villain.
- **Infection:** everyone is already a carrier; **any death → reanimation in 2–6 hours**; a skin-breaking **bite → die in 1d6 days, then turn**. **No cure exists.**
- **Advancement:** 1 Grit per session; 3 Grit = +1 attribute (cap 16); 1 Grit = a new Knack or +1 max Composure.
- **Hordes are Clocks, not HP** — countdowns you buy time against or escape, never "defeat."
- **Guns are loud and ammo is scarce** — a gunshot fills the nearest horde/Wakes clock.

### Bestiary shorthand
Wakers (fresh, fast, coordinated) · Shamblers (standard slow) · Cold-Stiffs (frozen, sluggish, reactivate near heat) · The Trapped (pinned in cars/wreckage) · Crawlers · the Horde (mass clock). **Only head/brain destruction is a true kill;** body damage cripples.

### Setting & timeline
- **When:** late February 2020. The world thinks it's a severe respiratory virus; it doesn't know the dead reanimate.
- **Where:** the I-17 corridor and the Quad Cities — Prescott, Prescott Valley, Chino Valley, Dewey-Humboldt — plus Paulden. Elevation 3,900–5,400 ft (that's why there's snow and why cold is lethal).
- **Key locations:** Sunset Point Rest Area (I-17) · Cordes Junction · SR-69 (Mayer → Dewey) · Whiskey Row & Courthouse Plaza (downtown Prescott) · Prescott Regional Airport / Ernest A. Love Field · **Deep Well Ranch** (the military safe zone) · **Radio Rick's compound** (Chino/Paulden outskirts).
- **Collapse timeline:** runs **Day 0 → ~Day 14**.

### The campaign arc — "The Long Way Home" (3 acts)
- **Act I — The Road (Days 0–1):** the I-17 Snow Trap and the scramble off the highway. Goal: get home. It slowly becomes impossible. (Sessions 1–2.)
- **Act II — Nowhere to Go (Days 2–10):** the cordon goes up and the map forks toward **two refuges**:
  - **The Safe Zone (Deep Well Ranch) — "Operation Hearthstone."** National Guard cordon: fences, screening, rationing, curfew. Looks like salvation; is overwhelmed triage with a buried contingency (**"Operation Ashfall"** — abandon and sanitize). *Fear the Walking Dead* season-1 register: the safe zone is the threat in a uniform. Screening is theater because everyone's already infected; anyone who dies inside turns inside.
  - **Rick's Compound (Chino/Paulden).** Prepper acreage — well, livestock, food stores, walls. Freedom on a knife's edge; every newcomer is a math problem. Rick runs the radios that feed the players outside intel and distrusts the Guard.
- **Act III — The Fall & The Lead (Days 11–14):** **the Catastrophe** — Ashfall executes as a basin-sized horde (drawn by the Whiskey Row fire) breaches the half-abandoned cordon; whatever refuge the players held becomes untenable. In the chaos, **the Lead** surfaces: a rumored **federal field-research lab in Phoenix** ("the cure"), almost certainly unreliable.
  - **Finale choice (no right answer):** ① **the Plane** (Guard evac — safety, surrender autonomy); ② **Phoenix** (chase the cure into the epicenter — hope, probably a lie); ③ **the Compound** (dig in); ④ optional **the High Country** (strike out north).

### NPCs / factions
- **Session 1:** **Mac** (aggressive trucker, wildcard) · **Sarah & Leo** (mother and feverish son — the emotional anchor; Leo's death→reanimation is the first true horror) · **the Paramedic** (gets bitten; doomed but useful).
- **Recurring:** **Radio Rick** (prepper, ham operator, intel source, "build a life" refuge) · **Captain Reyes** (Guard commander, impossible triage) · **Dr. Elena Rosas** (vet in Dewey, reluctant leader of armed ranchers) · the faceless **Feds / Phoenix rumor**.

### Canon notes / known decisions
- The real CDC is in **Atlanta**. The Phoenix site is deliberately framed as a **CDC/federal field-response lab** (commandeered hospital or state public-health lab), kept a *rumor* and possibly false. Do not "correct" it to Atlanta or make the cure confirmed.
- **"Sarah, Anywhere":** Sarah/Leo can be introduced at the traffic jam, the rest area, or on the Cordes hike — wherever the players are around Hour 5. Keep that flexibility.

---

## 4. Campaign-guide writing conventions

This document is a **reference manual**, so it intentionally uses formatting that normal prose would avoid. Keep these conventions when editing:

- **Headers, tables, and bullet lists are expected** (stat blocks, difficulty tables, timelines). Don't "flatten" them into prose.
- **Read-aloud / boxed text** uses Markdown blockquotes (`>`). GM sidebars use a `> ### 🅂🄸🄳🄴🄱🄰🅁` heading inside a blockquote.
- **NPC stat-block format:** `Brawn / Agility / Wits / Charm | VIT | Composure` + role notes.
- **Tension trackers are "Clocks"** written like `Name (0/6)`.
- Voice is GM-facing, second person, practical, evocative but economical. American spelling.
- The guide may contain **spoilers** (it's for the GM). That's fine here — the spoiler rule below applies to the **teaser only**.
- When expanding sessions, match the existing template: *Situation → read-aloud → phased beats → checks & clocks → branches/options → NPC fates → rewards.*

---

## 5. The teaser — HARD constraints (read before touching the HTML)

The teaser is finished and tuned. Respect these or you'll regress deliberate decisions:

### Spoiler & threat rules (non-negotiable)
- **Spoiler-free.** No safe zone, no Rick, no cure/Phoenix, no finale, no Sarah/Leo specifics. Premise and mood only.
- **NEVER name the threat.** No "zombie," "undead," "the dead," "infected," "outbreak," etc. **Allude only.** The dread is carried by the government emergency alert ("Remain in your vehicle. Do not approach other motorists. **Do not render aid.**") and the line **"Something is wrong out there." → "And it isn't the storm."** Keep it implied.

### Technical constraints
- **Single self-contained `.html` file.** No build step, no external JS bundles. Web fonts via Google Fonts `<link>` are OK.
- **NO `localStorage` / `sessionStorage`** or any browser storage (breaks in sandboxed embeds). State lives in JS variables only.
- **Audio is gesture-gated.** Everything starts from the big **"Watch Trailer"** button, which also unlocks/`resume()`s the `AudioContext`. Don't try to autoplay sound on load.
- **Accessibility:** `prefers-reduced-motion` is honored (snow goes static, animations off, sequence still plays); there's a **mute** toggle, **replay**, and **skip**. Preserve all of these.

### Sound design (procedural, Web Audio — no audio files)
Ambient bed: wind (filtered noise + slow LFO), low detuned drone, and a **heartbeat that accelerates** as dread builds. One-shots: phone **buzz**, the **WEA two-tone** attention signal, cinematic **impacts**, **static**, **dice clacks**. **Title reveal:** `titleRise()` = a deep, ominous low-frequency **build** (dissonant sub cluster + opening lowpass) that crescendos as the title forms, landing on `deepBoom()` when the Z hits. Keep levels conservative to avoid clipping on the climax.

### Visual sequence (beats, in order)
`February 2020` → `Interstate 17 / Arizona high country` → **phone Emergency Alert** (~11s on screen, with buzz + alert tone) → `traffic hasn't moved in three hours` (brake-light glow blooms) → `the snow won't stop` → `temperature is dropping` → **3d6 dice** lock + "Roll 3d6. Stay under. Stay alive." → `Something is wrong out there.` → `And it isn't the storm.` → **TITLE**: "STRAIN" blurs in (frost white), then **"Z" fades in separately in blood-red, flickers, settles to a pulsing red glow** → subtitle/tagline → controls.

### Design tokens (don't drift)
- **Fonts:** `Oswald` (kickers/UI), `Share Tech Mono` (broadcast/system/dice), `Creepster` (the title — horror display).
- **Colors:** `--void #06080b`, `--frost #e4eef5`, `--ice #92bad6`, `--steel #5a6c7e`, `--ember #ff2a1f` (brake light / alert — used sparingly), `--blood #d81a10` (the Z).
- Cinematic overlays: vignette + scanlines + animated film grain. Brake-light glow + blurred tail-lights, both pulsing.

### Rejected / do-NOT-readd
- **Blood drips on the Z were tried and removed** — do not bring them back.
- No high-pitched "screech" stinger on the title (replaced by the deep build).
- Don't make the brake light subtle (it was deliberately brightened).

---

## 6. Working agreements for Claude Code

**For the XRPG app:**
- After changing renderer code, **verify with the self-screenshot loop** (`electron . --shot=<route>` → Read the PNG) and keep **`electron . --test` green** (add a case in `renderer/js/test.js` when you add core logic).
- Respect the architecture conventions in §0 (CSP/no-eval, data-driven systems, secrets in main, per-view teardown, versioning, hybrid AI, generated assets).
- Prefer the existing `ui.js` primitives and `assets.js`/`audio-engine.js` generators over new dependencies. Keep zero runtime npm deps unless asked.
- When adding an interactive view, export a `teardown()` and register cleanup of timers/listeners/RAF/audio nodes.

**For the STRAIN Z content (guide, seeds, teaser):**
- **Preserve canon and the rejected-ideas list.** If a request conflicts with something locked in here, flag it and confirm before overriding. Canon now lives in `content/seeds/*.json` as well as the guide — keep them consistent.
- **Match the existing voice** (GM-facing, evocative, economical) when writing campaign content.
- **The teaser is a single fragile timeline** — change one thing at a time and keep it playable (verify `prefers-reduced-motion`, mute, replay, skip).

---

## 7. Open threads / TODO

**App (built; possible enhancements):**
- The XRPG app is complete and passing its test harness + two adversarial-review passes. Core: dashboard, systems, rules, characters, storylines, campaigns (versioned), groups, dice, combat tracker, VTT, audio mixer, session runner, recorder, AI Studio, settings.
- Possible future work: cloud/sync backup, multi-window player display for the VTT, a packaged signed installer (`npm run dist`), on-device Whisper transcription bundled, more seeded systems, drag-reorder in the combat tracker, PDF export of session recaps.

**STRAIN Z content:**
- [ ] The guide's Sessions 2–5 still read as the old single-line version in the Markdown; the **seeded** storyline (`content/seeds/strain-z.storyline.json`) already follows the three-act arc. Reconcile the guide prose to match if desired.
- [ ] Optional teaser variants (15-sec cutdown, loop mode); optional printable assets. The teaser can be wired in as an attract-mode intro in the app.
