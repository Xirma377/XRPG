# XRPG

A comprehensive **game-master desktop app** (Electron) for running tabletop RPGs end-to-end: campaigns, characters (PC/NPC) with inventory & rewards, rules lookup, a dice engine, a combat/encounter tracker, a virtual tabletop with a pop-out player display, an audio mixer with a royalty-free library, session recording with AI recap, native system/storyline editors, **online sessions over Discord**, and hybrid Claude AI integration.

It is **system-agnostic** and ships with eight game systems — STRAIN Z (flagship), D&D 5E (2024, SRD 5.2), Pathfinder 2E (Remaster), Call of Cthulhu 7E, Heroes & Hazards, Hearts on Fire (PbtA), Neon Static (original cyberpunk d10), and a Mörk Borg-compatible system.

## Develop

```bash
npm install
npm start            # run the app (Electron); first run seeds STRAIN Z + demo systems
npm run test:discord # unit tests for the Discord recording/audio pipeline
electron . --test    # renderer test harness (kept green)
```

## Build & release

```bash
npm run dist     # Windows NSIS installer → dist/XRPG-Setup-<version>.exe (+ latest.yml for auto-update)
npm run publish  # build and publish a release to GitHub (needs GH_TOKEN)
```

The packaged app auto-updates from the GitHub release feed (`build.publish` in `package.json`).

## Features at a glance

- **Campaigns & versioning** — a campaign forks a storyline into its own working copy; editing never loses past play history.
- **Characters** — belong to a system; inventory/rewards/consumables are logged; copy a character across systems.
- **Virtual tabletop** — maps & tokens with a pop-out player display window.
- **Audio mixer** — download-on-demand royalty-free library + a synth fallback, with full per-channel transport.
- **Sessions** — a command-center runner with recording → AI recap, recommendations, and reflection.
- **Discord** — link members to players, record each speaker on a separate track (+ a time-aligned mixdown and speaker-labeled transcript), `/roll` `/check` `/sheet` `/hp` slash commands, text relay, chat mirror, and rich presence.
- **AI** — hybrid: a live Anthropic key or a copy/paste bridge.

See [CLAUDE.md](CLAUDE.md) for architecture and the STRAIN Z canon.

---

Copyright © Xirma. All rights reserved.
