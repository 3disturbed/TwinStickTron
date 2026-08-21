// Endless mode: clearing wave 25 must roll into wave 26 — never a victory
// screen — and the difficulty curve keeps the exact slope of waves 1–25.

import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../server/sim.js";
import { PHASE, TICK_DT } from "../shared/constants.js";
import { makeWave, bossHp } from "../server/waves.js";
import { mulberry32 } from "../shared/rng.js";
import { EK } from "../shared/constants.js";

test("clearing wave 25 continues to wave 26 (no victory)", () => {
  const sim = new Sim();
  sim.addPlayer(1, "T1", 0);
  sim.startRun();
  sim.startWave(25);
  // force the wave clear: script exhausted, arena empty
  sim.script = { entries: [{ t: 0, kind: EK.DRONE, count: 0, done: true }], boss: null };
  sim.scriptT = 1;
  sim.enemies.clear();
  sim.pending.length = 0;
  sim.players.get(1).input = { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 };
  sim.step(TICK_DT);
  assert.equal(sim.phase, PHASE.INTERMISSION, "wave 25 clear must lead to an intermission");
  // burn the intermission down (post-boss intermissions run 40s for the shop)
  for (let t = 0; t < Math.round(45 / TICK_DT) && sim.phase === PHASE.INTERMISSION; t++) sim.step(TICK_DT);
  assert.equal(sim.phase, PHASE.WAVE, "intermission after 25 must start another wave");
  assert.equal(sim.wave, 26);
  assert.notEqual(sim.phase, PHASE.VICTORY);
});

test("scaling continues at the established rate past 25", () => {
  // budget: (50 + 35·wave) — the same linear slope, no cap, no kink
  const b25 = makeWave(25, 2, mulberry32(7));
  const b45 = makeWave(45, 2, mulberry32(7));
  const cost = (w) => w.entries.reduce((a, e) => a + e.count, 0);
  assert.ok(cost(b45) > cost(b25) * 1.4, `wave 45 must be meaningfully denser than 25 (${cost(b45)} vs ${cost(b25)})`);
  // boss HP: ~6 HP per wave past 25, same slope as bosses 5→25
  const at25 = bossHp(EK.ULTRADARK, 1, 25);
  const at50 = bossHp(EK.ULTRADARK, 1, 50);
  // solo factor is (0.7 + 0.3·1) = 1.0 → slope is exactly 6 HP/wave
  assert.ok(Math.abs((at50 - at25) - 25 * 6) <= 2,
    `boss HP slope should continue (~6/wave): 25→${at25}, 50→${at50}`);
  // wave 50's cycled ULTRADARK is tougher than wave 25's original
  assert.ok(at50 > at25);
});

test("boss HP tracks squad size (near-linear to 4, softened past)", () => {
  const solo = bossHp(EK.BRUTE_PRIME, 1);
  assert.equal(solo, 60, "solo boss HP unchanged (×1.0)");
  assert.equal(bossHp(EK.BRUTE_PRIME, 2), Math.round(60 * 1.8));
  assert.equal(bossHp(EK.BRUTE_PRIME, 4), Math.round(60 * 3.4));
  assert.equal(bossHp(EK.BRUTE_PRIME, 8), Math.round(60 * 5.8));
  // a 4-stack boss must carry at least 3× a solo boss's HP, or it melts
  assert.ok(bossHp(EK.ULTRADARK, 4) >= bossHp(EK.ULTRADARK, 1) * 3);
  // monotonic in players
  for (let p = 2; p <= 8; p++) {
    assert.ok(bossHp(EK.HEX_PRIME, p) > bossHp(EK.HEX_PRIME, p - 1), `HP must grow at ${p} players`);
  }
});
