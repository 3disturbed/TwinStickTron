# UltraDark

**A neon co-op twin-stick wave shooter. Send one link, and your friends are
in your arena in seconds — no install, no sign-up.**

> Ultratron's arcade DNA — one arena, waves of robots, a multiplier you're
> terrified of losing — rebuilt as a link-first co-op roguelite for the
> browser.

Repo codename: **TwinStickWaveShooter** · Public name: **UltraDark**
Lives at: `https://ultradark.darksgames.app` (DarksGames catalog entry: *UltraDark*, status **soon**)

---

## What makes it market-leading

- **Ten seconds to together.** Create a lobby, tap INVITE, send the link.
  1–4 player drop-in co-op with zero friction — the invite link is the
  entire onboarding funnel.
- **Greed is the game.** A squad-shared ×10 multiplier that halves when
  anyone gets hit, score you must choose to bank or let ride, revives that
  cost banked score, and an Overdrive state that doubles everything until
  someone bleeds.
- **Builds in 20 seconds.** Between waves, each player drafts 1 of 3 mods
  from a 40-mod pool with deliberate synergies — pinball ricochet builds,
  orbital aura builds, cursed high-risk picks.
- **The dark.** From wave 16 the arena lights start failing; the final boss
  is fought by muzzle-flash light alone. It's the signature image the game
  is named for.
- **Readable chaos.** Hundreds of entities, zero unfair deaths: strict
  silhouette/telegraph rules, death recaps with ghost replay, spawn
  protection, accessibility sliders for shake/flash/aim assist.

Full design: **[SDD.md](SDD.md)** · Build sequence: **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)**

## Tech at a glance

| Layer | Choice |
|---|---|
| Client | Plain ES modules + Canvas 2D, no build step, installable PWA |
| Server | Node 20+, Express (static + lobby REST) + `ws` (binary protocol) |
| Sim | Server-authoritative 30 Hz; 15 Hz delta snapshots; client prediction for own ship |
| Trick | Enemy bullet patterns are seed-replicated (~10 bytes), not entity-streamed |
| Data | SQLite (`better-sqlite3`) for leaderboards & daily seeds |
| Hosting | DarksGames stack: systemd `darksgame@ultradark`, nginx TLS proxy |

## Repository layout

See [SDD.md §3.10](SDD.md) for the annotated tree. Short version:
`server/` (authoritative sim, rooms, protocol), `client/` (canvas game, no
dependencies), `shared/` (deterministic code imported by both sides —
patterns, RNG, mod pool), `tools/` (headless sim harness, bot load-tester,
import checker).

## Development

This project is developed **on the DarksGames production server itself**
using Claude Code — there is no separate dev environment. The workflow,
guardrails and phase-by-phase build sequence live in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Highlights:

```bash
npm start          # run the server (PORT from .env)
npm run check      # eslint + import resolution + headless sim harness + unit tests
node tools/bot-client.mjs --rooms 8 --bots 4   # soak test
```

- No bundler, no transpile — what's in git is what runs.
- The box has no browser: feel/visual testing happens against the staging
  URL from a real device; everything else is covered headlessly by
  `npm run check` (see SDD §3.11).

## Deployment (DarksGames stack)

```bash
# first time: register domain, port, TLS, systemd unit
add-game ultradark.darksgames.app ultradark
# code lives at /srv/darksgames/games/ultradark, owned by darks
# then per deploy:
systemctl restart darksgame@ultradark   # server changes only
# client-only changes need no restart — players get them next page load
```

Secrets stay in `.env` (mode 600, never committed); `.env.example` is the
template.

## Status

- [x] Software Design Document
- [x] Implementation plan
- [x] Catalog entry on darksgames.app (status: soon)
- [ ] Phase 0 — skeleton + staging deploy
- [ ] Phase 1 — solo vertical slice
- [ ] Phase 2 — lobbies & co-op netcode
- [ ] Phase 3 — full content (enemies, bosses, drafts, the dark)
- [ ] Phase 4 — meta (leaderboards, Daily Dark, PWA, accounts)
- [ ] Phase 5 — polish, soak, flip catalog card to LIVE
