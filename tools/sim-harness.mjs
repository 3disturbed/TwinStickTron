// Headless sim harness (SDD §3.11): runs the REAL authoritative sim with
// scripted bots — no network, no browser — and asserts invariants. This is
// how gameplay code gets exercised on a box with no display.

import { Sim } from "../server/sim.js";
import { PHASE, PS, TICK_DT, ARENA_W, ARENA_H } from "../shared/constants.js";
import { BTN } from "../shared/protocol.js";
import { shopItemById } from "../shared/shop.js";

// bots shop like players: first affordable item, then ready-up
function botShop(sim, ev) {
  const p = sim.players.get(ev.to);
  if (!p) return;
  for (const id of ev.items) {
    const it = shopItemById(id);
    if (it && p.cores >= it.price) { sim.action(p, { t: "buy", id }); break; }
  }
  sim.action(p, { t: "shop_done" });
}

const SIM_MINUTES = Number(process.env.HARNESS_MINUTES || 5);

function runScenario(nPlayers) {
  const sim = new Sim();
  for (let i = 1; i <= nPlayers; i++) sim.addPlayer(i, `BOT${i}`, (i - 1) % 8);
  sim.startRun();

  let maxWave = 0, gameovers = 0, kills = 0, ticks = 0;
  let busyNs = 0n;
  const totalTicks = Math.round(SIM_MINUTES * 60 / TICK_DT);

  for (let t = 0; t < totalTicks; t++) {
    // scripted bots: aim at the nearest enemy, orbit the centre, kite away
    // from close threats, bomb when swarmed — legal inputs, decent play
    for (const p of sim.players.values()) {
      // nearest enemy + crowd pressure
      let nearest = null, nd = Infinity, crowd = 0;
      for (const e of sim.enemies.values()) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < nd) { nd = d; nearest = e; }
        if (d < 160) crowd++;
      }
      // movement: orbit unless threatened, then flee the nearest enemy
      const ang = t * 0.025 + p.id * 1.7;
      let mx = ARENA_W / 2 + Math.cos(ang) * 420 - p.x;
      let my = ARENA_H / 2 + Math.sin(ang) * 280 - p.y;
      if (nearest && nd < 170) { mx = p.x - nearest.x; my = p.y - nearest.y; }
      const ml = Math.hypot(mx, my) || 1;
      // aim: at the nearest enemy (aimbot — this tests the sim, not the bot)
      let ax = 1, ay = 0;
      if (nearest) { const al = nd || 1; ax = (nearest.x - p.x) / al; ay = (nearest.y - p.y) / al; }
      let buttons = BTN.FIRE;
      if (nearest && nd < 90) buttons |= BTN.DASH;
      if ((crowd > 4 || (p.hp === 1 && crowd > 1)) && p.bombs > 0) buttons |= BTN.BOMB;
      if (t % 500 === p.id % 500) buttons |= BTN.ABILITY;
      if (p.cons.length > 0 && t % 150 === 7) buttons |= BTN.USE; // burn consumables
      p.input = { seq: t, mx: mx / ml, my: my / ml, ax, ay, buttons };
    }
    const t0 = process.hrtime.bigint();
    sim.step(TICK_DT);
    busyNs += process.hrtime.bigint() - t0;
    ticks++;

    // drain events like Room does; auto-pick drafts, auto-restart runs
    for (const ev of sim.events) {
      if (ev.t === "draft_offer") {
        const p = sim.players.get(ev.to);
        if (p) sim.action(p, { t: "pick", id: ev.offer[0] });
      } else if (ev.t === "kill") kills++;
      else if (ev.t === "gameover" || ev.t === "victory") {
        gameovers++;
        const p = sim.players.values().next().value;
        sim.action(p, { t: "again" });
      } else if (ev.t === "intermission") {
        const p = sim.players.values().next().value;
        if (sim.unbanked > 0 && Math.random() < 0.5) sim.action(p, { t: "bank" });
      } else if (ev.t === "shop_offer") {
        botShop(sim, ev);
      }
    }
    sim.events.length = 0;
    maxWave = Math.max(maxWave, sim.wave);

    // ---- invariants, every tick ----
    for (const p of sim.players.values()) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error(`NaN player pos at tick ${t}`);
      if (p.x < 0 || p.x > ARENA_W || p.y < 0 || p.y > ARENA_H) throw new Error(`player out of bounds at tick ${t}: ${p.x},${p.y}`);
    }
    for (const e of sim.enemies.values()) {
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) throw new Error(`NaN enemy pos at tick ${t}`);
    }
    if (sim.enemies.size > 800) throw new Error(`enemy leak: ${sim.enemies.size} at tick ${t}`);
    if (sim.pBullets.length > 3000) throw new Error(`bullet leak: ${sim.pBullets.length} at tick ${t}`);
    if (sim.eBullets.length > 5000) throw new Error(`enemy bullet leak at tick ${t}`);
    if (sim.mult < 1 || sim.mult > 10.01 || !Number.isFinite(sim.mult)) throw new Error(`multiplier out of range: ${sim.mult}`);
    if (sim.banked < 0 || sim.unbanked < 0) throw new Error(`negative score`);
    // snapshot must always encode (protocol invariant)
    if (t % 100 === 0) sim.buildSnapshot();
  }

  const avgMs = Number(busyNs / BigInt(ticks)) / 1e6;
  return { nPlayers, maxWave, gameovers, kills, avgMs: Math.round(avgMs * 1000) / 1000 };
}

// Deep-wave smoke: jump straight into late waves so Snipers, Ghosts,
// Wardens, Forges and all three late bosses actually execute — the organic
// scenarios above rarely get past the first boss in harness time.
function runDeep() {
  const sim = new Sim();
  for (let i = 1; i <= 4; i++) sim.addPlayer(i, `BOT${i}`, (i - 1) % 8);
  sim.startRun();
  let kills = 0;
  for (const wave of [7, 9, 12, 14, 15, 20, 25, 30, 42]) { // 30+/42: endless cycle
    sim.startWave(wave);
    for (let t = 0; t < Math.round(45 / TICK_DT); t++) {
      for (const p of sim.players.values()) {
        // keep bots alive-ish: respawn energy comes from startWave resets
        let nearest = null, nd = Infinity;
        for (const e of sim.enemies.values()) {
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < nd) { nd = d; nearest = e; }
        }
        const ang = t * 0.03 + p.id * 1.7;
        let mx = ARENA_W / 2 + Math.cos(ang) * 420 - p.x;
        let my = ARENA_H / 2 + Math.sin(ang) * 280 - p.y;
        if (nearest && nd < 170) { mx = p.x - nearest.x; my = p.y - nearest.y; }
        const ml = Math.hypot(mx, my) || 1;
        let ax = 1, ay = 0;
        if (nearest) { ax = (nearest.x - p.x) / (nd || 1); ay = (nearest.y - p.y) / (nd || 1); }
        p.input = { seq: t, mx: mx / ml, my: my / ml, ax, ay, buttons: BTN.FIRE | (nearest && nd < 90 ? BTN.DASH : 0) };
      }
      sim.step(TICK_DT);
      for (const ev of sim.events) {
        if (ev.t === "kill") kills++;
        if (ev.t === "draft_offer") { const p = sim.players.get(ev.to); if (p) sim.action(p, { t: "pick", id: ev.offer[0] }); }
        if (ev.t === "shop_offer") botShop(sim, ev);
        if (ev.t === "gameover" || ev.t === "victory") { const p = sim.players.values().next().value; sim.action(p, { t: "again" }); }
      }
      sim.events.length = 0;
      for (const p of sim.players.values()) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error(`deep: NaN player pos wave ${wave}`);
      }
      for (const e of sim.enemies.values()) {
        if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) throw new Error(`deep: NaN enemy pos wave ${wave} kind ${e.kind}`);
      }
      if (sim.enemies.size > 900) throw new Error(`deep: enemy leak wave ${wave}: ${sim.enemies.size}`);
      if (t % 90 === 0) sim.buildSnapshot();
      if (sim.phase !== 1) break; // wave cleared or run ended — next forced wave
    }
  }
  return kills;
}

console.log(`sim-harness: ${SIM_MINUTES} simulated minutes per scenario…`);
const deepKills = runDeep();
console.log(`  deep-wave smoke (waves 7→25, all bosses): ${deepKills} kills, invariants held`);
if (deepKills < 30) throw new Error("deep-wave smoke barely killed anything — late-wave combat broken?");
const results = [runScenario(1), runScenario(4), runScenario(8)];
for (const r of results) {
  console.log(`  ${r.nPlayers}p: reached wave ${r.maxWave}, ${r.kills} kills, ${r.gameovers} run-ends, avg tick ${r.avgMs}ms`);
  if (r.maxWave < 2) throw new Error(`${r.nPlayers}p scenario never progressed past wave 1`);
  if (r.kills < 20) throw new Error(`${r.nPlayers}p scenario killed almost nothing — combat broken?`);
  if (r.avgMs > 2) throw new Error(`avg tick ${r.avgMs}ms exceeds the 2ms budget (SDD §3.6)`);
}
console.log("sim-harness: all invariants held ✓");
