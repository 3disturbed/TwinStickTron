# UltraDark — Implementation Plan

**How this plan is executed:** with Claude Code, installed on the DarksGames
production server, working directly in this repo (`/root/TwinStickWaveShooter`)
and deploying to the DarksGames stack. Each phase below is sized to be run as
one or a few Claude Code sessions; every phase states its goal, tasks, a
ready-to-paste **session prompt**, and **acceptance checks** that must pass
before the phase is called done.

Companion document: [SDD.md](SDD.md) — all section references (§) point there.

---

## 0. Ground rules (read before every session)

These encode the realities of this box; violating them has bitten before.

1. **This server IS production.** The multi-tenant box also serves the
   DarksGames site and unrelated `/srv/apps` tenants. No experiment may
   touch nginx defaults, other units, or shared config. Risky web-facing
   work is staged on its own subdomain — which UltraDark has by design.
2. **Two stacks, one box.** UltraDark deploys to
   `/srv/darksgames/games/ultradark` as user `darks` via
   `add-game ultradark.darksgames.app ultradark` — never to `/srv/apps`
   (that's the unrelated PM2 stack, whatever its README implies).
3. **Git is the rollback point.** Development happens in
   `/root/TwinStickWaveShooter` (root-owned dev checkout); deploys are
   rsync/copy to the game dir + `chown -R darks:darks`. Commit before every
   deploy. The GitHub remote is `git@github.com:3disturbed/TwinStickWaveShooter.git`
   — push whenever the remote exists (needs one-time `gh auth login` +
   `gh repo create`, see §7).
4. **No build step, no browser on the box.** All checks must run headless
   (`npm run check`); visual/feel verification is done from a real browser
   against the staging URL and reported as manual — never claimed as
   "verified" from the server.
5. **`.env` discipline:** secrets live in the deployed `.env` (mode 600),
   which `add-game` preserves (it upserts `PORT=` only). Commit
   `.env.example` instead. Never commit `server/db/*.db*`.
6. **After any `add-game` or unit restart:** verify
   `systemctl status darksgame@ultradark` is active and
   `ss -lntp | grep <port>` shows `127.0.0.1` before moving on.
7. **Definition of done, every phase:** `npm run check` green → commit →
   deploy → `curl` the staging URL for the new behaviour → update the
   README status checklist.

---

## 1. Phase 0 — Skeleton & staging pipeline (½ day)

**Goal:** an empty-but-real game: repo scaffold, server that serves the
client and answers `/api/health`, deployed and reachable over TLS at
`https://ultradark.darksgames.app`.

Tasks:
- `package.json` (`express`, `ws`, `better-sqlite3`; `npm start`;
  `npm run check` wiring eslint + `tools/check-imports.mjs` + `node --test`).
- `server/index.js`: static `client/`, `GET /api/health`, `GET /j/:code`
  → serves `index.html`; ws upgrade endpoint that accepts and echoes PING.
- `client/index.html` + `js/main.js`: canvas boots, renders the arena grid
  and a controllable ship locally (no netcode yet).
- `shared/constants.js`, `shared/rng.js` with unit tests.
- `.env.example`, `.gitignore` (`.env`, `server/db/`, `node_modules/`).
- Deploy: copy to `/srv/darksgames/games/ultradark`, `npm ci --omit=dev`
  as darks, run `add-game ultradark.darksgames.app ultradark`, verify per
  ground rule 6.

**Session prompt:** *"Implement Phase 0 of /root/TwinStickWaveShooter/IMPLEMENTATION_PLAN.md.
Follow the ground rules section first. Stop after the acceptance checks pass
and report each check's actual output."*

**Acceptance:** `npm run check` green locally; `curl -s https://ultradark.darksgames.app/api/health`
returns `{"ok":true}`; page HTML served at `/` and `/j/TEST00`;
`systemctl status darksgame@ultradark` active.

---

## 2. Phase 1 — Solo vertical slice (2–3 days)

**Goal:** the game is *fun alone* before it is networked. Fixed-step local
sim (the same code that will run on the server), waves 1–5 with Drone /
Mite / Weaver / Spinner, dash, smart bomb, multiplier + banking UI, hitstop,
shake, pooled particles, glow-sprite neon rendering, game over + restart.

Key discipline: **the sim is written in `server/sim.js` + `shared/` from
day one** and driven locally in the browser this phase — the client
temporarily embeds the authoritative sim. Networking later swaps the
driver, not the game. `tools/sim-harness.mjs` lands this phase and runs the
sim headless for 5 waves with scripted inputs, asserting invariants
(§3.11).

**Session prompt:** *"Implement Phase 1 per IMPLEMENTATION_PLAN.md §2 and
SDD §2.2–2.5, §2.10, §3.7. The sim must live in server/sim.js + shared/ and
be driven by the client via a local-loop driver. Land tools/sim-harness.mjs
and extend npm run check to run it. Deploy to staging when checks pass."*

**Acceptance:** harness runs 5 waves headless, no invariant failures, <2 ms
mean tick; manual: game playable at staging URL with keyboard+mouse and
gamepad, 60 fps on a mid phone (reported by human tester — request it).

---

## 3. Phase 2 — Lobbies, links, co-op netcode (3–4 days)

**Goal:** the headline feature. Rooms, 6-char codes, `POST /api/rooms`,
`/j/:code` join flow, INVITE button (Web Share API + clipboard + QR),
binary protocol (§3.4), 30 Hz server sim / 15 Hz delta snapshots, client
prediction + reconciliation for own ship, interpolation for the rest,
pattern-seeded projectiles (§3.3), drop-in spectate→spawn, disconnect
grace, downed/revive loop (§2.6).

Order within the phase: protocol + round-trip unit tests → single-player
*through the server* (kills the local-loop driver) → second client →
prediction/reconciliation → spectate/drop-in → revive loop →
`tools/bot-client.mjs` soak (8 rooms × 4 bots, watch tick p95 and RSS).

**Session prompt:** *"Implement Phase 2 per IMPLEMENTATION_PLAN.md §3 and
SDD §3.3–3.5. Work in the listed order; after each step run npm run check
and the new protocol round-trip tests. Finish with the bot soak test and
report tick p95 and memory."*

**Acceptance:** two browsers complete a 5-wave run together via a shared
link; protocol tests green; pattern determinism test green (same seed →
identical bullets at t on two instances); soak: 8×4 bots, tick p95 < 4 ms,
no RSS growth over 10 min; reconnect within 30 s resumes the pilot.

---

## 4. Phase 3 — Full content (4–5 days)

**Goal:** the whole game per SDD §2: all 12 enemies, 5 bosses, waves 1–25
with budget scaling (§2.9), the 40-mod draft pool + team mods (§2.7), 4
pilots with signature abilities (§2.8), Overdrive, revive insurance, **the
dark** (lightmap rendering §3.7 + design §2.4), death recap, edge arrows,
soundtrack layers + pentatonic kill runs, accessibility settings (§2.11).

Split across sessions by content type (enemies+waves / bosses / drafts+pilots
/ the-dark+audio+accessibility) — each lands with sim-harness coverage
(e.g. harness proves every wave recipe terminates and every mod applies
without NaN/leak across 25 waves).

**Acceptance:** harness clears waves 1–25 with 1 and with 4 scripted bots;
every mod and pilot exercised in harness without invariant failures; manual
full run to wave 25 co-op on staging; The UltraDark fight readable in a
dark room *and* with floor-brightness accessibility raised.

---

## 5. Phase 4 — Meta & platform (2–3 days)

**Goal:** retention layer. SQLite leaderboards (server-authoritative
submission at run end, §3.8), weekly/all-time boards + API + UI, Daily Dark
(seed-of-the-day, one attempt, own board), PWA (manifest + sw.js caching the
shell, never `/ws` or `/api`), optional DG account sign-in via the existing
site SDK + s2s verification against `dg-accounts` for leaderboard identity.

**Acceptance:** scores persist across restarts; daily seed identical for
two rooms on the same date and rolls at UTC midnight; Lighthouse-style PWA
installability confirmed manually; leaderboard rejects a forged
client-submitted score (endpoint doesn't exist — verify by code review +
test that scores only originate in room teardown).

---

## 6. Phase 5 — Polish, soak, launch (2 days + soak window)

- Performance pass against every budget in SDD §3.6 (measure, don't assert).
- 48 h idle-and-active soak: bots hourly via cron, `journalctl` reviewed for
  errors, RSS flat.
- Balance pass from real runs (wave-reached histogram in logs).
- Rate limits verified (`POST /api/rooms` flood → 429).
- **Launch:** flip the darksgames.app catalog card `status: "soon"` →
  `"live"` (edit the *deployed* `site/games.js` in place, then commit the
  same change to `/root/DarksGamesSite`, bumping `sw.js` VERSION and the
  `?v=` busters past the deployed numbers — house rule).

---

## 7. One-time external dependency (user action)

GitHub-side repo creation requires API auth that the box does not have
(`gh` is installed but logged out; SSH can push but cannot create repos).
Once, as the user:

```bash
gh auth login
gh repo create TwinStickWaveShooter --private --source /root/TwinStickWaveShooter --push
```

Until then the repo is local-only — which makes commits the *only* rollback
point, so committing early and often is mandatory (ground rule 3).

---

## 8. Schedule summary

| Phase | Scope | Estimate |
|---|---|---|
| 0 | Skeleton + staging pipeline | 0.5 d |
| 1 | Solo vertical slice | 2–3 d |
| 2 | Lobbies + co-op netcode | 3–4 d |
| 3 | Full content | 4–5 d |
| 4 | Meta & platform | 2–3 d |
| 5 | Polish + soak + launch | 2 d + soak |
| | **Total** | **~14–18 working days** |

Riskiest phase is 2 (netcode); its mitigations are already structural —
sim/driver separation in Phase 1, protocol unit tests before any gameplay
integration, pattern-seeding to keep bandwidth trivial, and the bot soak
harness so regressions show up as numbers, not vibes.
