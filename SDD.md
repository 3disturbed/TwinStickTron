# UltraDark — Software Design Document

**Repo:** TwinStickWaveShooter · **Public name:** UltraDark
**Platform:** Browser (desktop + mobile + gamepad), installable PWA
**Hosting:** DarksGames stack — `ultradark.darksgames.app`
**Status:** Design complete, pre-implementation
**Document owner:** DarksGames · Last updated 2026-08-19

---

## 1. Vision

A neon co-op twin-stick wave shooter with the arcade purity of Ultratron and
one killer trick it never had: **you can pull three friends into your arena
with a single link, in under ten seconds, with no install and no sign-up.**

Runs are 15–25 minutes. Death is fast, restarting is instant, and every
system in the game offers a safe choice and a greedy one. The deeper you go,
the more the arena itself goes dark — until the final fight is lit by nothing
but your own muzzle flash.

### 1.1 Elevator pitch

> Ultratron's DNA — one arena, waves of robots, a score multiplier you're
> terrified of losing — rebuilt as a link-first co-op roguelite. Draft
> upgrades between waves into ridiculous builds, share one multiplier with
> your squad, and push toward the UltraDark.

### 1.2 Design pillars

1. **Ten seconds to together.** Link → lobby → playing co-op in under 10
   seconds. No account, no download, no friction. Every design decision that
   adds a step before "you are shooting robots with your friend" is wrong.
2. **Always one more wave.** Short runs, instant restarts, a wave counter
   that taunts you. The lobby survives the run — "again?" is one click.
3. **Greed is the game.** Bank your score or let it ride. Take the safe
   draft or the cursed one. Trigger Overdrive or play it cool. Revive your
   friend or protect the multiplier. Tension comes from choices, not stats.
4. **Readable chaos.** Hundreds of entities on screen, zero unfair deaths.
   Strict silhouette, telegraph, and contrast rules — if it can kill you,
   you saw it coming.

### 1.3 Why it wins the genre

Ultratron, Geometry Wars and Nex Machina are all solo scoreboards. Co-op
twin-sticks exist (Assault Android Cactus, Helldivers' DNA) but none are
**zero-friction browser co-op**. The web is UltraDark's superpower: the
invite link *is* the distribution, the lobby *is* the party, and every run
that ends with "one more?" is retention no installed game can match. Add
roguelite drafting (which Ultratron predates) and a shared-fate multiplier
(which nobody has) and there is no direct competitor.

---

## 2. Game design

### 2.1 Core loop

```
CREATE / JOIN LOBBY  →  WAVE (60–120s)  →  INTERMISSION (draft, 20s)
        ↑                    │ every 5th wave: BOSS
        │                    ↓
   "AGAIN?" ←──────  RUN ENDS: squad wipe (runs are ENDLESS)
                     → score screen → leaderboard → same lobby, one click
```

- **Session:** runs are ENDLESS — waves climb forever at a constant rate
  (boss roster cycles every 5th wave past 25, boss HP keeps the same
  per-wave slope). A typical run is 15–25 minutes. A wipe ends
  the run for everyone (co-op is shared-fate; see 2.6).
- **Intermission:** 20-second timer, vote-to-skip. Draft happens here.
- Depth is the score: leaderboards record the wave reached alongside the
  banked score, so "how deep did you get" is the bragging number.

### 2.2 Moment-to-moment controls

| Action | Gamepad | Keyboard/Mouse | Touch |
|---|---|---|---|
| Move | Left stick | WASD | Left virtual stick |
| Aim + fire | Right stick (fire on deflection) | Mouse aim, hold LMB | Right virtual stick |
| Dash (i-frames, 2s cooldown) | RB / L3 | Space / Shift | Swipe on move stick |
| Smart bomb (banked, max 3) | LB | RMB / E | Dedicated button |
| Signature ability | RT | Q | Dedicated button |

Feel targets: ship reaches full speed in <80 ms, stops in <60 ms (high
acceleration, low drift — Ultratron-tight, not Asteroids-floaty). Fire is
continuous while aiming. Aim assist (optional, default-on for touch/pad):
±6° magnetism to nearest threat, never on mines/pickups.

### 2.3 The multiplier — shared fate, banked greed

- Kills build a **squad-shared multiplier**, ×1 → ×10, decaying slowly when
  no kills land.
- Any player taking a hit **halves** it. Your friend's dodge matters to you.
- **Banking:** at any intermission the squad banks its unbanked score —
  banked score is safe forever. Unbanked score keeps multiplying but a wipe
  loses *all* of it. The end-of-run screen shows what you would have had.
- **Overdrive:** at a sustained ×10, the arena shifts palette, enemies gain
  +20% speed, and all score is doubled — until someone gets hit. Overdrive
  seconds survived is a tracked stat and leaderboard.
- **Revives cost banked score** (a visible "insurance premium"). Reviving is
  almost always correct — but it *hurts*, and that's the point.

### 2.4 Waves and the dark

- Waves are authored *recipes* (enemy mix, spawn cadence, arena hazard), not
  raw RNG — seeded variation within a recipe so runs feel fresh but fair.
- Wave budget scales with player count (see 2.9) — never with hit points
  alone. More players = more enemies, not spongier ones.
- **The dark:** from wave 16, arena edge lighting begins to fail. By wave 21+
  the arena is lit primarily by muzzle flash, projectiles, and explosions —
  your own gunfire is your torch. Enemy eyes/engines stay visible (readable
  chaos rule) as points of light in the black. This is the game's signature
  image and the reason for its name.

### 2.5 Enemy roster (launch: 12 + 5 bosses)

Every enemy obeys three rules: **unique silhouette** at 24 px, **telegraph
before any attack** (≥350 ms), **death teaches** (on-kill effects are
previewed by the enemy's idle animation).

| Enemy | Role | Behaviour |
|---|---|---|
| Drone | Chaff | Slow homing; dies to anything; multiplier fuel |
| Mite swarm | Pressure | Fast, tiny, flanks in groups of 8 |
| Weaver | Aim test | Sine-wave approach, fires 3-round bursts |
| Brute | Tank | Slow, splits into 4 Mites on death |
| Spinner | Zoning | Emits a bullet ring **on death** — position before you kill |
| Mortar | Area denial | Arcing AoE shells onto telegraphed circles |
| Sniper | Priority target | Laser sightline telegraph, then instant beam |
| Leech | Multiplier threat | Contact drains multiplier instead of health |
| Warden | Order-of-kill puzzle | Projects shield bubbles onto nearby enemies |
| Forge | Objective | Stationary spawner; the wave won't end while it lives |
| Ghost | Timing test | Phased/immune except during its own firing window |
| Magnet | Control | Pulls players toward it (into other threats) |

**Bosses** (every 5th wave, mechanics scale with player count):

- **W5 · Hexagon Prime** — rotating six-beam laser hex; dash through gaps.
- **W10 · The Choir** — splits into harmonics that must die within 3 s of
  each other or resurrect.
- **W15 · Foundry** — armoured spawner; vulnerable only while its doors are
  open to spawn; co-op wants split roles (door campers vs. add control).
- **W20 · Null Shepherd** — herds players with expanding darkness zones.
- **W25 · The UltraDark** — lights out. The arena is fully dark; the boss is
  visible only when lit by your fire. Final phase: it eats your bullets'
  light. Victory screen: the arena lights come back up.

### 2.6 Co-op rules

- 1–4 players, drop-in (joiners spectate until the next intermission, then
  spawn in), drop-out safe (disconnect = 30 s reconnect grace, then their
  pilot ejects and their drafted mods convert to a squad pickup).
- **Downed, not dead:** a killed player drops a core; any teammate channels
  1.5 s in contact to revive (costs banked score, see 2.3). Uncollected for
  15 s → that player is out until the next wave. **All players down = wipe,
  run over.** Solo players get 3 lives instead of the revive loop.
- Friendly fire: never. Bodies don't block; bullets pass through allies.
- All balance knobs (wave budget, boss HP, pickup counts) key off live
  player count and rebalance at wave boundaries, so drop-in/out never
  breaks difficulty.

### 2.7 Drafting — builds in 20 seconds

At each intermission every player simultaneously drafts **1 of 3 mods**
(20 s timer; no-pick = auto-random so nobody holds the lobby hostage).

- Launch pool: **40 mods** in four families —
  **Ballistics** (what your bullets do: pierce, ricochet, split, slow-heavy
  rounds), **Field** (what happens around you: orbitals, shockwave on dash,
  static discharge), **Chassis** (what you are: speed, magnet radius, dash
  charges, revive speed), **Echo** (what happens on events: on-kill chains,
  on-bank bursts, on-hit retaliation).
- Mods stack and combo deliberately: *Ricochet + Pierce + Heavy Rounds* is a
  pinball build; *Orbital + Static + Magnet Chassis* is a melee-adjacent
  aura build. Synergy tags are shown on the card face.
- Rarity (common/rare/epic) gates power, weighted by wave depth. One
  **cursed** option appears occasionally: big power, real drawback
  ("+60% damage, dash cooldown +1 s").
- Every 5th intermission (post-boss) the squad also **votes one Team Mod**
  (squad-wide effect: shared bomb charge on boss kills, cheaper revives…).

### 2.8 Pilots (launch: 4, all free)

Pilots differ in signature ability + one stat lean; weapons come from drafts.

- **VANTA** — all-rounder. *Blink Volley:* short teleport that fires a
  radial burst on exit.
- **EMBER** — close-range lean. *Flame Wall:* temporary wall that blocks
  enemy bullets and burns enemies through it.
- **HALO** — support lean. *Aegis Field:* projected bubble; allies inside
  can't drop the multiplier from hits (hits still down them).
- **ONYX** — heavy lean. *Gravity Well:* pulls enemies and enemy bullets
  into a point, then pops.

### 2.9 Difficulty & fairness

- Wave budget formula: `budget = base(wave) × (0.65 + 0.35 × players)` —
  4-player is ~2× solo density, not 4×; chaos scales, spongebags don't.
- Spawns never materialise within 320 units of a player and always announce
  with a 500 ms warp-in telegraph.
- Off-screen threats that are about to matter get edge-of-screen arrows
  (Snipers, Mortars, inbound Mite flanks).
- Death recap: killed-by callout with a 2 s ghost replay, so every death is
  a lesson, not a mystery.

### 2.10 Feel & juice specification

Budgeted, not vibes — these are implementation requirements:

- **Hitstop:** 30 ms on boss hits, 50 ms on player death, none on chaff
  (chaff dies in bulk; hitstop there would stutter).
- **Screenshake:** trauma-based (shake = trauma², decays linearly), capped;
  slider 0–100% in settings, capped contribution per event.
- **Particles:** pooled, budget 1,500 live; enemy deaths burst in the
  enemy's colour; multiplier milestones pulse the arena grid.
- **Sound:** layered soundtrack — base synth layer + drum layer at ×4 +
  lead layer at ×8 + everything-distorts in Overdrive. Kill sounds pitch up
  through a pentatonic run within a combo window (Peggle rule).
- **Neon rendering:** pre-baked glow sprites (no runtime `shadowBlur` — too
  slow), additive compositing for projectiles/explosions, arena grid that
  reacts (ripples from explosions, dims per §2.4).

### 2.11 Accessibility

Screenshake/flash intensity sliders, photosensitivity mode (no full-screen
flashes, capped strobe rate), three colourblind-safe palettes (enemy colour
never the only signal — silhouette is primary), full remapping, hold-vs-
toggle fire, aim assist strength slider, UI scale, and "the dark" floor
brightness option (raises minimum ambient light without changing gameplay).

### 2.12 Meta & retention

- **Leaderboards:** solo and squad, weekly + all-time, per-mode. Stored
  server-side; name defaults to pilot callsign, links to DG account when
  signed in.
- **Daily Dark:** one shared daily seed (same waves/drafts offered for
  everyone), one attempt per day, own leaderboard. The watercooler mode.
- **Mutators** (post-launch): lobby toggles that trade rules for score
  multipliers (glass cannon, bullet-time-on-dash, no bombs).
- **DG Accounts (optional):** sign-in via the existing DarksGames account
  SDK for persistent stats, leaderboard identity and cosmetic unlocks
  (trail colours, ship skins). **Playing never requires an account.**
- **Monetisation:** none at launch. Design space reserved for cosmetic-only
  purchases via DG accounts once the platform's Stripe integration is live.

---

## 3. Technical design

### 3.1 Constraints (from the hosting environment)

- Deploys to the DarksGames stack: `/srv/darksgames/games/ultradark`, run by
  systemd unit `darksgame@ultradark`, `npm start`, `PORT` from `.env`,
  registered via `add-game ultradark.darksgames.app ultradark`, nginx
  terminates TLS and proxies to `127.0.0.1:<port>`.
- **No build step.** The server has no bundler; the client is plain ES
  modules served statically, same pattern as Space Dwarves. This is a
  feature: what's in git is what runs.
- Node 20+, dependencies minimal: `express`, `ws`, `better-sqlite3`. No
  client-side dependencies at all.
- Single Node process hosts every room (rooms are objects, not processes).

### 3.2 Architecture overview

```
Browser client (canvas, ES modules)
  │  HTTPS: static files + REST (lobby create/join, leaderboards)
  │  WSS:   /ws?room=CODE — binary gameplay protocol
  ▼
nginx (TLS, proxy)  →  Node: Express + ws  ── rooms: Map<code, Room>
                                │
                                ▼  each Room: authoritative sim @ 30 Hz
                          SQLite (leaderboards, daily seeds, account links)
```

**The server is the host.** There is no P2P and no host migration problem;
a room lives in server memory, players are equal clients.

### 3.3 Simulation & netcode

- **Server tick:** 30 Hz fixed-timestep authoritative sim per room.
  Movement, spawning, all collision (enemy↔player-bullet, player↔threat)
  resolve server-side. Server is the single truth for health, score,
  multiplier, drafts.
- **Snapshots:** 15 Hz, binary, delta-encoded against the last snapshot the
  client acknowledged. Quantisation: positions as u16 across a 2048-unit
  arena (sub-pixel at render scale), headings u8, entity ids u16.
- **Client:** fixed-step (60 Hz) local prediction of **own ship only**, with
  server reconciliation (replay unacked inputs on correction, snap if error
  > 48 units). Everything else — other players, enemies — renders
  interpolated 100 ms behind latest snapshot.
- **Enemy projectiles are pattern-seeded, not replicated.** The server sends
  `{patternId, seed, origin, t0}` (~10 bytes) and both sides run the same
  deterministic generator from `shared/patterns.js`. A Spinner death-ring of
  32 bullets costs 10 bytes, not 32 entity streams. Hit *verdicts* stay
  server-side; the client's copies are visual and self-correct because the
  generator is deterministic in `(seed, t)`.
- **Player bullets:** simulated server-side; the client spawns a predicted
  tracer instantly on fire (input→muzzle-flash latency 0 ms perceived) and
  reconciles kills from snapshots. Kill confirmation ≤ 100 ms at 60 ms RTT.
- **Bandwidth target:** ≤ 20 KB/s per client at 4-player peak. Input
  upstream: 30 Hz batched (seq, buttons bitfield, move/aim vectors
  quantised) ≈ 12 bytes/frame.
- **Clock:** clients sync a server-time estimate (ping/2 offset, smoothed)
  for interpolation timing and pattern playback.

### 3.4 Wire protocol (WSS, binary, little-endian)

| ID | Dir | Message | Payload sketch |
|---|---|---|---|
| 0x01 | C→S | HELLO | protocol ver, resume token?, name, pilot |
| 0x02 | S→C | WELCOME | your id, room state, wave, roster |
| 0x03 | C→S | INPUT | seq u16, dt u8, move i8×2, aim i8×2, buttons u8 |
| 0x04 | S→C | SNAPSHOT | tick u32, ackSeq u16, delta entity blocks |
| 0x05 | S→C | EVENT | kills, pickups, downs, revives, bank, wave start/end (reliable, ordered) |
| 0x06 | S→C | PATTERN | patternId u8, seed u32, origin, t0 |
| 0x07 | C→S | DRAFT_PICK / VOTE | choice u8 |
| 0x08 | S↔C | PING/PONG | t, for clock sync |
| 0x09 | S→C | ROSTER | join/leave/spectate changes |

JSON is allowed only in the lobby REST endpoints, never on the hot path.

### 3.5 Lobby & join-by-link flow

```
POST /api/rooms            → { code: "KRV7DP", joinUrl }
GET  /j/KRV7DP             → serves the game client with room pre-filled
WSS  /ws?room=KRV7DP       → HELLO → spectate or spawn per §2.6
```

- Codes: 6 chars from an unambiguous alphabet (no 0/O/1/I), ~10^9 space,
  expire when the room empties (10-minute grace for reconnects).
- The share link is first-class UI: giant **INVITE** button in lobby and
  intermission → native share sheet (Web Share API) on mobile, clipboard +
  QR code on desktop.
- Public visibility is opt-in later; launch is private-by-link only.
- Room cap: 64 concurrent rooms (soft, config) — beyond it, room creation
  returns "server full, retry shortly" with backoff; existing runs are
  never degraded.

### 3.6 Performance budgets

| Budget | Target |
|---|---|
| Server CPU per room tick | ≤ 2 ms average at 4 players, 600 entities |
| Server memory | ≤ 256 MB total at room cap |
| Client frame | 60 fps on a mid-range phone (2022+); DPR capped at 2 |
| Live particles | ≤ 1,500 (pooled) |
| Cold load → menu | ≤ 2 s on 4G (no bundler; total client ≤ 300 KB before art) |
| Link click → in lobby | ≤ 10 s including first visit |

Spatial hashing (128-unit buckets) for all collision; object pools for
entities, bullets, particles on both sides; zero allocations in the server
tick hot path (pre-allocated snapshot buffers).

### 3.7 Rendering

Canvas 2D, one fullscreen canvas + offscreen atlas canvases. Neon look per
§2.10: pre-rendered glow sprites at load (drawn once with blur into the
atlas), additive `globalCompositeOperation` pass for emissive elements, grid
background on its own cached layer, "the dark" implemented as a multiply-
composited lightmap fed by light emitters (muzzle flashes, projectiles,
enemy eyes). WebGL2 is a post-launch optimisation, not a launch dependency —
the art direction (sprites + additive glow) is chosen to make Canvas 2D
sufficient.

### 3.8 Data & persistence

SQLite via `better-sqlite3` (synchronous, WAL mode — fine at this scale):

- `scores(id, mode, squad_size, score, wave, names_json, dg_account_ids_json, seed, created_at)`
- `daily(seed_date PRIMARY KEY, seed)`
- `settings` are client-side only (localStorage).

Runs are ephemeral (server memory). Leaderboard writes happen at run end,
server-side, from server-authoritative scores — the client never submits a
score, so leaderboards can't be forged by a modified client.

DG account linkage uses the existing `dg-accounts` service (s2s call to
verify a session token → account id) — optional, launch-window permitting.

### 3.9 Security & abuse

- Server-authoritative everything (§3.3): speed, fire-rate, damage and score
  are computed server-side; client input is clamped (move/aim vectors
  normalised, fire cadence enforced by server cooldowns).
- Input flood → drop + brief mute; malformed frame → disconnect.
- Room codes are unguessable-enough and unlisted; no chat at launch
  (pings/emotes only) — nothing user-generated to moderate.
- Rate limits on `POST /api/rooms` per IP. `.env` gets 600 perms and real
  secrets stay out of git (`.env.example` committed instead).

### 3.10 Repository layout

```
TwinStickWaveShooter/
├── README.md / SDD.md / IMPLEMENTATION_PLAN.md
├── package.json              # express, ws, better-sqlite3; npm start
├── .env.example              # PORT=, DB_PATH=, ROOM_CAP=
├── server/
│   ├── index.js              # express static + REST + ws upgrade
│   ├── room.js               # Room: lifecycle, roster, intermissions
│   ├── sim.js                # 30 Hz authoritative simulation
│   ├── waves.js              # wave recipes & budget scaling
│   ├── enemies.js            # behaviours (data-driven where possible)
│   ├── protocol.js           # binary encode/decode (mirrors client)
│   ├── snapshot.js           # delta compression + ack tracking
│   └── db.js                 # sqlite: scores, daily seeds
├── shared/                   # imported by BOTH sides — determinism lives here
│   ├── constants.js          # arena size, tick rates, quantisation
│   ├── patterns.js           # seeded projectile pattern generators
│   ├── mods.js               # the 40-mod pool, tags, rarities
│   └── rng.js                # seedable PRNG (mulberry32)
├── client/
│   ├── index.html            # also served for /j/:code
│   ├── js/
│   │   ├── main.js  net.js  predict.js  interp.js
│   │   ├── render/  (renderer, glowAtlas, particles, lightmap, ui)
│   │   ├── input/   (keyboard+mouse, gamepad, touch)
│   │   └── screens/ (menu, lobby, draft, scorescreen)
│   ├── sw.js + manifest      # PWA shell caching (never cache /ws or /api)
│   └── assets/               # audio; sprites are largely procedural
└── tools/
    ├── check-imports.mjs     # resolves every ES import (Space Dwarves pattern)
    ├── sim-harness.mjs       # headless: run N waves of sim, assert invariants
    └── bot-client.mjs        # headless ws clients for load testing rooms
```

The `shared/` directory is the determinism boundary: anything both sides
must agree on (patterns, RNG, constants, mod definitions) lives there and is
imported by both — divergence becomes structurally impossible rather than a
discipline problem.

### 3.11 Testing strategy (no browser on the server)

The production box cannot run a browser, so the game must be testable
headlessly:

- `tools/sim-harness.mjs` — runs the full server sim without networking:
  scripted bot inputs, N waves, asserts invariants (no NaN positions, no
  entity leaks, wave budgets honoured, run ends correctly). Runs in CI-style
  via `npm run check` alongside `check-imports` and eslint.
- `tools/bot-client.mjs` — real WebSocket clients that join a room and play
  (randomly but legally); used to soak-test 8 rooms × 4 bots and watch tick
  CPU / memory.
- `node --test` unit tests for protocol round-tripping (encode→decode
  equality), snapshot delta/ack edge cases, and pattern determinism (same
  seed → identical bullet sets at t on two fresh instances).
- Visual/feel testing happens in a real browser against the staging
  subdomain — stated plainly as manual, per house rules.

---

## 4. Success metrics

| Metric | Target |
|---|---|
| Link click → playing (new player, median) | < 10 s |
| Invite conversion (links opened → joined a run) | > 50% |
| Median run length | 12–20 min |
| "Again?" rate (runs followed by another in same lobby) | > 45% |
| D1 retention of players who played co-op | > 25% |
| Server tick p95 at 4-player boss waves | < 4 ms |

The single most important number is the first row. Everything about
UltraDark is designed around a friend clicking a link mid-conversation and
being in the arena before the conversation moves on.

---

## 5. Out of scope at launch

PvP of any kind · text chat · accounts-required features · monetisation ·
native builds · public matchmaking (private links only) ·
WebGL renderer (Canvas 2D budgeted to suffice) · host-side mod tools.

Each is deliberately deferred, not rejected; §2.12 and §3.7 note the ones
with reserved design space.
