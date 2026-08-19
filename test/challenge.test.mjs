// Challenge links promise "same waves": two rooms seeded with the same
// value must produce identical wave scripts through the REAL Sim path,
// and every run must expose its seed at run end so a link can be built.

import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../server/sim.js";

function seededSim(seed) {
  const sim = new Sim();
  sim.addPlayer(1, "T1", 0);
  sim.dailySeed = seed;
  sim.startRun();
  return sim;
}

test("same seed → identical wave scripts through Sim (challenge contract)", () => {
  const a = seededSim(0xC0FFEE);
  const b = seededSim(0xC0FFEE);
  const strip = (s) => s.entries.map(e => ({ t: e.t, kind: e.kind, count: e.count }));
  assert.deepEqual(strip(a.script), strip(b.script));
  a.startWave(7); b.startWave(7);
  assert.deepEqual(strip(a.script), strip(b.script));
  const c = seededSim(0xBEEF);
  c.startWave(7);
  assert.notDeepEqual(strip(a.script), strip(c.script));
});

test("run end exposes the seed a challenge link needs", () => {
  const sim = seededSim(12345);
  assert.equal(sim.runSeed, 12345, "seeded rooms pin runSeed");
  sim.unbanked = 500;
  sim.endRun(true);
  const ev = sim.events.find(e => e.t === "victory");
  assert.ok(ev, "victory event missing");
  assert.equal(ev.seed, 12345);
  assert.equal(ev.score, 500);

  // unseeded runs still get a shareable seed
  const s2 = new Sim();
  s2.addPlayer(1, "T1", 0);
  s2.startRun();
  s2.unbanked = 100;
  s2.endRun(false);
  const ev2 = s2.events.find(e => e.t === "gameover");
  assert.ok(Number.isInteger(ev2.seed) && ev2.seed >= 0, "unseeded run must still report a seed");
});
