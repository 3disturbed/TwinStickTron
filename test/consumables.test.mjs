// Proves the two systems the user asked about actually bite:
//  1. Orbital blades deal real damage to a real enemy in a real sim.
//  2. Consumables drop from eligible enemies, get collected, and USE applies
//     their effect — all server-side.

import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../server/sim.js";
import { PHASE, PS, EK, TICK_DT, PILOTS } from "../shared/constants.js";
import { computeStats } from "../shared/mods.js";
import { CK } from "../shared/consumables.js";
import { BTN } from "../shared/protocol.js";

// A sim frozen mid-wave: one entry that never fires keeps the wave from
// ending, so tests control exactly what is in the arena.
function combatSim(nPlayers = 1) {
  const sim = new Sim();
  for (let i = 1; i <= nPlayers; i++) sim.addPlayer(i, `T${i}`, 0);
  sim.phase = PHASE.WAVE;
  sim.wave = 3;
  sim.script = { entries: [{ t: 1e9, kind: EK.DRONE, count: 1 }], boss: null };
  sim.scriptT = 0;
  return sim;
}

const idle = { seq: 0, mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 };

test("orbital blades actually damage enemies (the spinning blade check)", () => {
  const sim = combatSim();
  const p = sim.players.get(1);
  p.mods = ["orbital", "orbital2"]; // 3 blades
  p.stats = computeStats(PILOTS[0], p.mods);
  assert.equal(p.stats.orbitals, 3, "orbital mods must stack to 3 blades");
  // a Forge is stationary and never touches the player — pure blade test
  sim.spawnEnemy(EK.FORGE, p.x + 60, p.y, false);
  const forge = [...sim.enemies.values()][0];
  const hp0 = forge.hp;
  p.input = idle;
  for (let t = 0; t < Math.round(3 / TICK_DT); t++) sim.step(TICK_DT);
  assert.ok(forge.hp < hp0, `blades dealt no damage after 3s (hp ${forge.hp}/${hp0})`);
  for (let t = 0; t < Math.round(12 / TICK_DT) && sim.enemies.size > 0; t++) sim.step(TICK_DT);
  assert.equal(sim.enemies.size, 0, "blades should kill a Forge inside 15s");
  // snapshot must carry the blade count so the client can render them
  const snap = sim.buildSnapshot();
  assert.equal(snap.players[0].orbitals, 3);
});

test("eligible enemies drop consumables; ineligible ones never do", () => {
  const sim = combatSim();
  const p = sim.players.get(1);
  sim.rngDrop = () => 0; // forces every eligible drop, and picks kind 0 → REPAIR
  sim.spawnEnemy(EK.BRUTE, 1800, 200, false); // dropChance 0.20
  const brute = [...sim.enemies.values()][0];
  sim.damageEnemy(brute, 999, p);
  assert.equal(sim.pickups.size, 1, "Brute with forced rng must drop");
  assert.equal([...sim.pickups.values()][0].kind, CK.REPAIR);

  sim.pickups.clear();
  sim.spawnEnemy(EK.DRONE, 1800, 200, false); // no dropChance
  const drone = [...sim.enemies.values()].find(e => e.kind === EK.DRONE);
  sim.damageEnemy(drone, 999, p);
  assert.equal(sim.pickups.size, 0, "Drones must never drop");
});

test("pickup → carry → USE applies the effect", () => {
  const sim = combatSim();
  const p = sim.players.get(1);
  p.hp = 1;
  sim.spawnPickup(CK.REPAIR, p.x, p.y); // right under the player
  p.input = idle;
  sim.step(TICK_DT);
  assert.deepEqual(p.cons, [CK.REPAIR], "walking over a pickup must collect it");
  assert.equal(sim.pickups.size, 0);

  p.input = { ...idle, buttons: BTN.USE };
  sim.step(TICK_DT);
  assert.equal(p.hp, 2, "Repair Kit must heal 1");
  assert.equal(p.cons.length, 0, "consumable must be spent");

  // edge-triggered: holding USE must not consume a second item
  sim.spawnPickup(CK.SHIELD, p.x, p.y);
  sim.step(TICK_DT); // collect while USE still held
  assert.deepEqual(p.cons, [CK.SHIELD]);
  sim.step(TICK_DT);
  assert.deepEqual(p.cons, [CK.SHIELD], "held USE must not re-trigger");
});

test("stasis slows enemies; shield grants i-frames; carry cap is 3", () => {
  const sim = combatSim();
  const p = sim.players.get(1);
  sim.spawnEnemy(EK.DRONE, 200, 200, false);
  const drone = [...sim.enemies.values()][0];
  p.input = idle;
  // measure normal chase speed over 1s
  const x0 = drone.x, y0 = drone.y;
  for (let t = 0; t < 30; t++) sim.step(TICK_DT);
  const normal = Math.hypot(drone.x - x0, drone.y - y0);
  // stasis on: same measurement window
  p.cons = [CK.STASIS];
  p.input = { ...idle, buttons: BTN.USE };
  sim.step(TICK_DT);
  assert.ok(sim.stasisT > 4.5, "stasis timer must arm");
  p.input = idle;
  const x1 = drone.x, y1 = drone.y;
  for (let t = 0; t < 30; t++) sim.step(TICK_DT);
  const slowed = Math.hypot(drone.x - x1, drone.y - y1);
  assert.ok(slowed < normal * 0.6, `stasis barely slowed: ${slowed} vs ${normal}`);

  p.cons = [CK.SHIELD];
  p.buttonsPrev = 0;
  p.input = { ...idle, buttons: BTN.USE };
  sim.step(TICK_DT);
  assert.ok(p.iframesT > 2.5, "Overshield must grant ~3s i-frames");

  p.cons = [CK.REPAIR, CK.REPAIR, CK.REPAIR];
  sim.spawnPickup(CK.BOMB, p.x, p.y);
  p.input = idle;
  sim.step(TICK_DT);
  assert.equal(p.cons.length, 3, "full inventory must not collect a 4th");
  assert.equal(sim.pickups.size, 1, "uncollected pickup stays for teammates");
});
