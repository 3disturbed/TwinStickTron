// Fixture generator for the C# port (UltraDarkNative).
//
// Emits JSON capturing what THIS implementation does, so the C# port can be
// asserted against the real thing rather than against a reading of the code.
// Nothing here is used by the game at runtime.
//
//   node tools/gen-fixtures.mjs [outDir]        # default ../UltraDarkNative/fixtures
//
// Comparison policy (mirrored in UltraDarkNative/PORTING.md):
//   * integers and decisions  -> exact
//   * trig-derived floats     -> tolerance; sin/cos/atan2 are implementation
//                                defined in ECMAScript, so bit-parity with V8
//                                is not achievable and is not attempted.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { mulberry32, randInt, pick } from "../shared/rng.js";
import {
  PILOTS, EK, ZK, PS, PHASE, MULT, PLAYER, WAVE, ARENA_W, ARENA_H, MAX_PLAYERS,
} from "../shared/constants.js";
import { ENEMIES } from "../shared/enemies.js";
import { CK, CONSUMABLES, rollConsumable } from "../shared/consumables.js";
import { MODS, CLASS_MODS, classModsFor, computeStats, draftOffer, modById } from "../shared/mods.js";
import { SHOP_ITEMS, shopFor, shopItemById } from "../shared/shop.js";
import { spawnPattern, PT } from "../shared/patterns.js";
import { stepPlayerMovement, startDash } from "../shared/movement.js";
import { makeWave, bossFor, bossHp } from "../server/waves.js";
import { encodeSnapshot, encodeInput, encodePong, encodePing, PROTO, MSG, BTN, PF, EF } from "../shared/protocol.js";
import { Sim } from "../server/sim.js";
import { TICK_DT } from "../shared/constants.js";

const OUT = path.resolve(process.argv[2] ?? "../UltraDarkNative/fixtures");
const SOURCE = "TwinStickWaveShooter@" + (process.env.FIXTURE_COMMIT ?? "HEAD");

function write(rel, obj) {
  const full = path.join(OUT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(obj, null, 1) + "\n");
  console.log(`  ${rel}  (${JSON.stringify(obj).length} bytes)`);
}

const b64 = (ab) => Buffer.from(ab instanceof ArrayBuffer ? new Uint8Array(ab) : ab).toString("base64");

// ---------------------------------------------------------------- rng
function rngFixture() {
  const cases = [];
  for (const seed of [0, 1, 42, 12345, 0x9e3779b9, 0xffffffff, 2654435761, 987654321]) {
    const rng = mulberry32(seed);
    const out = [];
    for (let i = 0; i < 1000; i++) out.push(rng());
    cases.push({ seed: seed >>> 0, values: out });
  }
  // randInt / pick ride the same stream and must advance it identically
  const rng = mulberry32(777);
  const ints = [], picks = [];
  const arr = ["a", "b", "c", "d", "e"];
  for (let i = 0; i < 200; i++) { ints.push(randInt(rng, 3, 11)); picks.push(arr.indexOf(pick(rng, arr))); }
  write("rng/mulberry32.json", { source: SOURCE, comparison: "exact", cases, randInt: { seed: 777, lo: 3, hi: 11, values: ints }, pick: { indices: picks } });
}

// ---------------------------------------------------------------- waves
function waveFixture() {
  const cases = [];
  for (let wave = 1; wave <= 60; wave++) {
    for (const players of [1, 2, 4, 8]) {
      for (const seed of [1, 12345]) {
        const w = makeWave(wave, players, mulberry32((seed ^ (wave * 2654435761)) >>> 0));
        cases.push({
          wave, players, seed,
          boss: w.boss ?? null,
          entries: w.entries.map(e => ({ t: e.t, kind: e.kind, count: e.count })),
        });
      }
    }
  }
  const boss = [];
  for (let wave = 1; wave <= 120; wave++) {
    const kind = bossFor(wave);
    boss.push({ wave, kind: kind ?? null, hp: kind ? [1, 2, 4, 8].map(p => bossHp(kind, p, wave)) : null });
  }
  write("gameplay/waves.json", { source: SOURCE, comparison: "exact-kinds-counts, tolerance-t", cases });
  write("gameplay/bosshp.json", { source: SOURCE, comparison: "exact", players: [1, 2, 4, 8], boss });
}

// ---------------------------------------------------------------- stats
function statsFixture() {
  const single = MODS.map(m => ({
    id: m.id, family: m.family, rarity: m.rarity, cursed: !!m.cursed,
    name: m.name, desc: m.desc, heal: m.heal ?? null,
    stats: computeStats(PILOTS[0], [m.id]),
  }));
  // stacking must be order independent for the ops used, and stack multiplicatively
  const combos = [];
  const rng = mulberry32(4242);
  for (let i = 0; i < 120; i++) {
    const n = randInt(rng, 1, 6);
    const ids = [];
    for (let k = 0; k < n; k++) ids.push(MODS[Math.floor(rng() * MODS.length)].id);
    const pilot = Math.floor(rng() * PILOTS.length);
    combos.push({ pilot, ids, stats: computeStats(PILOTS[pilot], ids) });
  }
  write("gameplay/mods.json", {
    source: SOURCE, comparison: "tolerance", count: MODS.length,
    baseStats: PILOTS.map((p, i) => ({ pilot: i, stats: computeStats(p, []) })),
    single, combos,
  });

  const classMods = CLASS_MODS.map(m => ({
    id: m.id, pilot: m.pilot, name: m.name, desc: m.desc,
    stats: computeStats(PILOTS[m.pilot], [m.id]),
  }));
  write("gameplay/classmods.json", {
    source: SOURCE, comparison: "tolerance", count: CLASS_MODS.length,
    perPilot: PILOTS.map((_, i) => ({ pilot: i, ids: classModsFor(i).map(m => m.id) })),
    classMods,
  });

  const shop = SHOP_ITEMS.map(i => ({
    id: i.id, pilot: i.pilot, price: i.price, once: !!i.once,
    name: i.name, desc: i.desc, heal: i.heal ?? null, bombs: i.bombs ?? null,
    stats: computeStats(PILOTS[i.pilot ?? 0], [i.id]),
  }));
  write("gameplay/shop.json", {
    source: SOURCE, comparison: "tolerance", count: SHOP_ITEMS.length,
    perPilot: PILOTS.map((_, i) => ({ pilot: i, ids: shopFor(i).map(s => s.id) })),
    // modById() must resolve shop ids too — that is how a purchase becomes a stat
    resolvesThroughModById: SHOP_ITEMS.map(i => ({ id: i.id, found: !!modById(i.id) })),
    shop,
  });
}

// ---------------------------------------------------------------- draft
function draftFixture() {
  const cases = [];
  for (const seed of [1, 7, 12345, 0xbeef]) {
    for (const wave of [1, 2, 3, 4, 5, 9, 17, 40]) {
      const rng = mulberry32(seed);
      const offers = [];
      for (let i = 0; i < 30; i++) offers.push(draftOffer(rng, wave));
      cases.push({ seed, wave, offers });
    }
  }
  write("gameplay/draft.json", { source: SOURCE, comparison: "exact", cases });
}

// ---------------------------------------------------------------- consumables
function consumableFixture() {
  const cases = [];
  for (const seed of [1, 99, 12345]) {
    const rng = mulberry32(seed);
    const rolls = [];
    for (let i = 0; i < 500; i++) rolls.push(rollConsumable(rng));
    cases.push({ seed, rolls });
  }
  write("gameplay/consumables.json", {
    source: SOURCE, comparison: "exact",
    kinds: Object.entries(CONSUMABLES).map(([k, v]) => ({ kind: Number(k), name: v.name, glyph: v.glyph, color: v.color, desc: v.desc })),
    cases,
  });
}

// ---------------------------------------------------------------- patterns
function patternFixture() {
  const cases = [];
  for (const pid of [PT.RING, PT.FAN, PT.SPOKES, PT.ORB]) {
    for (const seed of [1, 12345, 0xabcdef]) {
      for (const angle of [0, 0.5, -1.25, Math.PI]) {
        cases.push({ pid, seed, x: 512.5, y: 300.25, angle, bullets: spawnPattern(pid, seed, 512.5, 300.25, angle) });
      }
    }
  }
  write("gameplay/patterns.json", { source: SOURCE, comparison: "tolerance (counts + r exact)", cases });
}

// ---------------------------------------------------------------- movement
function movementFixture() {
  const cases = [];
  for (const stats of [{ speed: 1 }, { speed: 1.18 }, { speed: 0.78 }]) {
    for (const inp of [{ mx: 1, my: 0 }, { mx: 0.5, my: 0.5 }, { mx: -1, my: -1 }, { mx: 0, my: 0 }]) {
      const p = { x: 200, y: 200, vx: 0, vy: 0, dashT: 0, aim: 0.7 };
      const steps = [];
      for (let i = 0; i < 120; i++) {
        if (i === 40) startDash(p, inp);
        stepPlayerMovement(p, inp, stats, TICK_DT);
        steps.push([p.x, p.y, p.vx, p.vy, p.dashT]);
      }
      cases.push({ stats, input: inp, dashAtStep: 40, steps });
    }
  }
  write("gameplay/movement.json", { source: SOURCE, comparison: "tolerance", tickDt: TICK_DT, cases });
}

// ---------------------------------------------------------------- enemies / pilots tables
function tableFixture() {
  write("gameplay/tables.json", {
    source: SOURCE, comparison: "exact",
    arena: { ARENA_W, ARENA_H, MAX_PLAYERS },
    enemies: Object.entries(ENEMIES).map(([k, d]) => ({ kind: Number(k), ...d })),
    pilots: PILOTS,
    ek: EK, zk: ZK, ps: PS, phase: PHASE, ck: CK,
    mult: MULT, player: PLAYER, wave: WAVE,
  });
}

// ---------------------------------------------------------------- protocol
function protocolFixture() {
  const P = (o) => ({ id: 1, pilot: 0, state: 0, x: 0, y: 0, aim: 0, hp: 3, dashCd: 0, abilCd: 0, bombs: 1, flags: 0, orbitals: 0, cons: [], cores: 0, ...o });
  const snapshots = [
    { name: "empty", snap: { tick: 0, phase: 0, wave: 0, phaseT: 0, mult: 1, unbanked: 0, banked: 0, enemiesLeft: 0, stasis: 0, players: [], enemies: [], bullets: [], zones: [], pickups: [] } },
    { name: "one-player", snap: { tick: 7, phase: 1, wave: 3, phaseT: 42, mult: 2.5, unbanked: 1234, banked: 5678, enemiesLeft: 9, stasis: 0, players: [P({ x: 100.125, y: 200.375, aim: 1.5 })], enemies: [], bullets: [], zones: [], pickups: [] } },
    // quantisation edges: half-way values expose Math.round vs banker's rounding
    { name: "rounding-edges", snap: { tick: 0xdeadbeef, phase: 2, wave: 25, phaseT: 65535, mult: 10, unbanked: 4294967295, banked: 2147483648, enemiesLeft: 65535, stasis: 25.5, players: [P({ id: 255, pilot: 7, state: 3, x: 0.0625, y: ARENA_H, aim: Math.PI * 2 - 1e-9, hp: 255, dashCd: 25.55, abilCd: 254.5, bombs: 3, flags: 15, orbitals: 3, cons: [1, 2, 3], cores: 65535 })], enemies: [], bullets: [], zones: [], pickups: [] } },
    // endless: wave clamps to the u8 on the wire
    { name: "wave-clamp", snap: { tick: 1, phase: 1, wave: 300, phaseT: 0, mult: 1, unbanked: 0, banked: 0, enemiesLeft: 0, stasis: 0, players: [], enemies: [], bullets: [], zones: [], pickups: [] } },
    {
      name: "full", snap: {
        tick: 123456, phase: 1, wave: 17, phaseT: 512, mult: 7.3, unbanked: 98765, banked: 43210, enemiesLeft: 31, stasis: 4.5,
        players: [P({ id: 1, x: 10.5, y: 20.25, aim: 0.1, cons: [1] }), P({ id: 2, pilot: 3, state: 1, x: 2047.875, y: 1151.5, aim: 6.28, hp: 5, dashCd: 1.95, abilCd: 12, bombs: 2, flags: 3, orbitals: 2, cons: [5, 4, 3], cores: 300 })],
        enemies: [{ id: 1, kind: EK.DRONE, x: 300.125, y: 400.875, hpPct: 100, flags: 0 }, { id: 65000, kind: EK.ULTRADARK, x: 1024, y: 576, hpPct: 1, flags: EF.ENRAGED | EF.PHASED }],
        bullets: [{ id: 9, x: 1.125, y: 2.25, owner: 1 }, { id: 64999, x: 2047.75, y: 1151.125, owner: 255 }],
        zones: [{ kind: ZK.WARP, x: 5.5, y: 6.5, r: 23, ttl: 0.5 }, { kind: ZK.DARK, x: 1000.0625, y: 500.9375, r: 8191.875, ttl: 6553.5 }],
        pickups: [{ id: 3, kind: CK.BOMB, x: 700.5, y: 800.25, ttl: 12 }, { id: 65000, kind: CK.REPAIR, x: 0, y: 0, ttl: 25.5 }],
      },
    },
  ].map(c => ({ ...c, bytes: b64(encodeSnapshot(c.snap)) }));

  const inputs = [];
  for (const [seq, mx, my, ax, ay, buttons] of [
    [0, 0, 0, 0, 0, 0], [1, 1, -1, 0.5, -0.5, BTN.FIRE],
    [65535, -1, 1, 0.007874015748031496, -0.9999, BTN.FIRE | BTN.DASH | BTN.BOMB | BTN.ABILITY | BTN.USE],
    [30000, 0.5, 0.5, 2, -2, BTN.DASH],           // out-of-range clamps to +-127
    [123, 0.00390625, -0.00390625, 0.5, 0.5, BTN.USE],
  ]) inputs.push({ seq, mx, my, ax, ay, buttons, bytes: b64(encodeInput(seq, mx, my, ax, ay, buttons)) });

  const pings = [0, 1.5, 1234567.89, Number.MAX_SAFE_INTEGER].map(t => ({ t, bytes: b64(encodePing(t)) }));
  const pongs = [[0, 0, 0], [1.5, 1700000000000, 4294967295], [99.25, 1.5, 7]]
    .map(([c, s, tk]) => ({ clientT: c, serverMs: s, tick: tk, bytes: b64(encodePong(c, s, tk)) }));

  write("protocol/snapshots.json", { source: SOURCE, comparison: "byte-exact", proto: PROTO, ackOffset: 5, snapshots });
  write("protocol/messages.json", {
    source: SOURCE, comparison: "byte-exact", proto: PROTO,
    msg: MSG, btn: BTN, playerFlags: PF, enemyFlags: EF,
    inputs, pings, pongs,
  });
}

// ---------------------------------------------------------------- sim traces
// The trace bots must produce byte-identical inputs in C#. So they use ONLY
// operations that are bit-exact across runtimes: + - * / comparisons and
// sqrt (IEEE-754 requires sqrt to be correctly rounded; sin/cos/atan2 are
// implementation defined and are never used here). Distances are compared
// squared. The result is then quantised through the same int8 packing the
// wire uses, which also absorbs any float drift in the sim beneath it.
const PATROL = [
  { x: ARENA_W * 0.25, y: ARENA_H * 0.25 }, { x: ARENA_W * 0.75, y: ARENA_H * 0.25 },
  { x: ARENA_W * 0.75, y: ARENA_H * 0.75 }, { x: ARENA_W * 0.25, y: ARENA_H * 0.75 },
];
const FLEE_R2 = 170 * 170;
const CROWD_R2 = 200 * 200;
const q7f = (x) => Math.max(-127, Math.min(127, Math.round(x * 127))) / 127;

function unit(dx, dy) {
  const d2 = dx * dx + dy * dy;
  if (d2 <= 0) return [1, 0];
  const d = Math.sqrt(d2);
  return [dx / d, dy / d];
}

function botInput(t, p, sim) {
  // nearest enemy by squared distance; ties broken by the lower id
  let near = null, nd2 = Infinity, crowd = 0;
  for (const e of sim.enemies.values()) {
    const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 < CROWD_R2) crowd++;
    if (d2 < nd2 || (d2 === nd2 && near && e.id < near.id)) { nd2 = d2; near = e; }
  }
  let ax = 1, ay = 0;
  if (near) [ax, ay] = unit(near.x - p.x, near.y - p.y);

  let mx, my;
  if (near && nd2 < FLEE_R2) {
    [mx, my] = unit(p.x - near.x, p.y - near.y);        // kite off the threat
  } else {
    const g = PATROL[(Math.floor(t / 90) + p.id) % 4];  // integer corner select
    [mx, my] = unit(g.x - p.x, g.y - p.y);
  }
  return {
    seq: t & 0xffff,
    mx: q7f(mx), my: q7f(my), ax: q7f(ax), ay: q7f(ay),
    buttons: BTN.FIRE
      | (t % 53 === 0 ? BTN.DASH : 0)
      | (t % 97 === 0 ? BTN.ABILITY : 0)
      | (crowd >= 6 ? BTN.BOMB : 0)
      | (t % 149 === 0 ? BTN.USE : 0),
  };
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;

function traceFixture(nPlayers, seed, ticks, startWave = 1) {
  const sim = new Sim();
  sim.seedAll(seed);
  sim.dailySeed = seed;                       // pin wave recipes too
  for (let i = 1; i <= nPlayers; i++) sim.addPlayer(i, `BOT${i}`, (i - 1) % PILOTS.length);
  sim.startRun();
  if (startWave > 1) sim.startWave(startWave);   // jump straight to the deep roster / bosses

  const perTick = [];
  const keyframes = [];
  const events = [];
  for (let t = 0; t < ticks; t++) {
    for (const p of sim.players.values()) p.input = botInput(t, p, sim);
    sim.step(TICK_DT);
    for (const ev of sim.events) events.push({ t, ...ev });
    sim.events.length = 0;

    // keep the trace productive: a wipe restarts the run deterministically
    if (sim.phase === PHASE.GAMEOVER) sim.action(sim.players.values().next().value, { t: "again" });

    perTick.push([
      sim.phase, sim.wave, sim.enemies.size, sim.pBullets.length, sim.eBullets.length,
      sim.zones.length, sim.pickups.size, sim.pending.length,
      Math.round(sim.unbanked), Math.round(sim.banked), Math.round(sim.mult * 1e6),
    ].join(","));

    if (t % 30 === 0) {
      keyframes.push({
        t,
        players: [...sim.players.values()].map(p => ({
          id: p.id, state: p.state, hp: p.hp, bombs: p.bombs, cores: p.cores,
          mods: p.mods.slice(), cons: p.cons.slice(),
          x: r6(p.x), y: r6(p.y), vx: r6(p.vx), vy: r6(p.vy), aim: r6(p.aim),
        })),
        enemies: [...sim.enemies.values()].map(e => ({
          id: e.id, kind: e.kind, hp: r6(e.hp), x: r6(e.x), y: r6(e.y),
        })),
      });
    }
  }
  return {
    source: SOURCE, seed, players: nPlayers, ticks, startWave, tickDt: TICK_DT,
    comparison: "perTick exact (integers); keyframes tolerance (trig-derived floats)",
    botInput: "nearest enemy by squared distance (ties -> lower id); aim = unit vector to it; "
      + "move = flee it when d2 < 170^2 else unit vector to PATROL[(floor(t/90)+id)%4], the four 25%/75% "
      + "arena corners; all four axes quantised through q7(x)=clamp(round(x*127),-127,127)/127; "
      + "buttons = FIRE | (t%53==0 ? DASH) | (t%97==0 ? ABILITY) | (crowd>=6 ? BOMB) | (t%149==0 ? USE), "
      + "crowd = enemies with d2 < 200^2. On GAMEOVER the lowest seat issues action {t:'again'}.",
    perTick, keyframes, events,
  };
}

// ---------------------------------------------------------------- main
console.log(`fixtures -> ${OUT}`);
mkdirSync(OUT, { recursive: true });
rngFixture();
tableFixture();
waveFixture();
statsFixture();
draftFixture();
consumableFixture();
patternFixture();
movementFixture();
protocolFixture();
for (const n of [1, 2, 4, 8]) write(`sim/trace-${n}p.json`, traceFixture(n, 0x51ED0000 + n, 5400));
// deep traces: bosses, the full 12-enemy roster, snipers, consumable drops
write("sim/trace-boss.json", traceFixture(4, 0xB0550005, 5400, 5));
write("sim/trace-deep.json", traceFixture(4, 0xDEE00024, 7200, 24));
console.log("done");
