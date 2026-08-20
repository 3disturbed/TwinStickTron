// Every class must attack through its OWN weapon path, and every new
// ability/status must bite — headlessly, in the real Sim.

import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../server/sim.js";
import { PHASE, PS, EK, TICK_DT, PILOTS } from "../shared/constants.js";
import { computeStats } from "../shared/mods.js";
import { BTN } from "../shared/protocol.js";

function combatSim(pilots = [0]) {
  const sim = new Sim();
  pilots.forEach((pl, i) => sim.addPlayer(i + 1, `T${i + 1}`, pl));
  sim.phase = PHASE.WAVE;
  sim.wave = 3;
  sim.script = { entries: [{ t: 1e9, kind: EK.DRONE, count: 1 }], boss: null };
  sim.scriptT = 0;
  return sim;
}
const idle = { seq: 0, mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 };

test("class weapons are actually different", () => {
  // cadence identity: BINK sprays, HAWK deliberates
  assert.ok(PILOTS[0].weapon.cd < 0.1, "SMG must be fast");
  assert.ok(PILOTS[7].weapon.cd > 0.8, "railgun must be slow");
  // SMG: one bullet per trigger
  const s1 = combatSim([0]);
  s1.fire(s1.players.get(1));
  assert.equal(s1.pBullets.length, 1);
  assert.ok(Math.abs(s1.pBullets[0].dmg - 0.6) < 0.01, "SMG bullets are light");
  // Shotgun: 7 pellets, short-lived
  const s2 = combatSim([1]);
  s2.fire(s2.players.get(1));
  assert.equal(s2.pBullets.length, 7, "BLAZE fires 7 pellets");
  assert.ok(s2.pBullets[0].life < 0.6, "pellets are short range");
  // Rail: pierce baked in
  const s3 = combatSim([7]);
  s3.fire(s3.players.get(1));
  assert.equal(s3.pBullets.length, 1);
  assert.ok(s3.pBullets[0].pierce >= 3, "rail pierces 3");
  assert.ok(s3.pBullets[0].dmg >= 4, "rail hits hard");
});

test("DAVE's cleave: hits the arc, misses behind, spawns no bullets", () => {
  const sim = combatSim([3]);
  const dave = sim.players.get(1);
  dave.aim = 0; // facing +x
  sim.spawnEnemy(EK.DRONE, dave.x + 70, dave.y, false);        // in the arc
  sim.spawnEnemy(EK.DRONE, dave.x - 70, dave.y, false);        // behind him
  const [front, behind] = [...sim.enemies.values()];
  sim.fire(dave); // dispatches to cleave
  assert.equal(sim.pBullets.length, 0, "cleave must not spawn projectiles");
  assert.ok(!sim.enemies.has(front.id), "front drone dies to the cleave");
  assert.ok(sim.enemies.has(behind.id), "drone behind DAVE is untouched");
  assert.equal(behind.hp, behind.maxHp);
  const ev = sim.events.find(e => e.t === "cleave");
  assert.ok(ev && ev.who === 1, "cleave event emitted for the client swing");
  // and he's tanky: base max HP is 5
  assert.equal(sim.hpMax(dave), 5);
});

test("KELVIN: lance chills on hit; Frost Nova freezes movement and firing", () => {
  const sim = combatSim([6]);
  const kelvin = sim.players.get(1);
  sim.spawnEnemy(EK.WEAVER, kelvin.x + 60, kelvin.y, false);
  const weaver = [...sim.enemies.values()][0];
  kelvin.aim = 0;
  sim.fire(kelvin);
  for (let t = 0; t < 6 && weaver.slowT === 0; t++) sim.step(TICK_DT);
  assert.ok(weaver.slowT > 0, "lance hit must chill");
  // nova freezes
  sim.ability(kelvin);
  assert.ok(weaver.stunT > 1, "Frost Nova must freeze");
  const x0 = weaver.x, y0 = weaver.y;
  kelvin.input = idle;
  for (let t = 0; t < 15; t++) sim.step(TICK_DT);
  assert.ok(Math.hypot(weaver.x - x0, weaver.y - y0) < 1, "frozen enemies don't move");
});

test("SPARKS: chain lightning jumps to a neighbour; pylon zaps", () => {
  const sim = combatSim([4]);
  const sparks = sim.players.get(1);
  sparks.aim = 0;
  sim.spawnEnemy(EK.BRUTE, sparks.x + 80, sparks.y, false);       // primary target
  sim.spawnEnemy(EK.BRUTE, sparks.x + 80, sparks.y + 100, false); // chain neighbour
  const [a, b] = [...sim.enemies.values()];
  sparks.input = { ...idle, buttons: BTN.FIRE };
  for (let t = 0; t < 10 && a.hp === a.maxHp; t++) sim.step(TICK_DT);
  assert.ok(a.hp < a.maxHp, "primary took arc damage");
  assert.ok(b.hp < b.maxHp, "chain jumped to the neighbour");
  // pylon
  sparks.input = idle;
  sim.ability(sparks);
  const pylon = sim.zones.find(z => z.zapT !== undefined);
  assert.ok(pylon, "pylon zone deployed");
  const hpBefore = a.hp;
  for (let t = 0; t < 30; t++) sim.step(TICK_DT);
  assert.ok(a.hp < hpBefore || !sim.enemies.has(a.id), "pylon zapped something");
});

test("RIGG: turret fires owner-credited bullets and earns him cores", () => {
  const sim = combatSim([5]);
  const rigg = sim.players.get(1);
  sim.spawnEnemy(EK.DRONE, rigg.x + 200, rigg.y, false);
  sim.ability(rigg);
  assert.equal(sim.turrets.length, 1);
  rigg.input = idle;
  let killed = false;
  for (let t = 0; t < 90 && !killed; t++) {
    sim.step(TICK_DT);
    killed = sim.enemies.size === 0;
  }
  assert.ok(killed, "turret should kill a drone inside 3s");
  assert.equal(rigg.kills, 1, "turret kill credits the owner");
  assert.ok(rigg.cores >= 1, "turret kill pays the owner cores");
});

test("AMBER: beacon warps home in two presses; aura heals allies over time", () => {
  const sim = combatSim([2, 0]);
  const amber = sim.players.get(1);
  const ally = sim.players.get(2);
  amber.input = idle; ally.input = idle;
  const home = { x: amber.x, y: amber.y };
  sim.ability(amber); // drop
  assert.ok(amber.beacon, "beacon placed");
  assert.ok(amber.abilCd < 1, "phase 1 is a tiny re-arm, not the full cd");
  amber.x += 300; amber.y += 100;
  sim.ability(amber); // warp
  assert.ok(Math.hypot(amber.x - home.x, amber.y - home.y) < 1, "warped back to the beacon");
  assert.equal(amber.beacon, null);
  const phases = sim.events.filter(e => e.t === "ability" && e.pilot === 2).map(e => e.phase);
  assert.deepEqual(phases, [1, 2]);
  // aura: wounded ally standing next to her heals within ~6s
  ally.x = amber.x + 40; ally.y = amber.y;
  ally.hp = 1;
  for (let t = 0; t < Math.round(6 / TICK_DT); t++) { ally.x = amber.x + 40; ally.y = amber.y; sim.step(TICK_DT); }
  assert.ok(ally.hp >= 2, `aura should have healed the ally (hp ${ally.hp})`);
});

test("BINK is fast, DAVE is slow — class statlines are live", () => {
  const bink = computeStats(PILOTS[0], []);
  const dave = computeStats(PILOTS[3], []);
  assert.ok(bink.speed > 1.1);
  assert.ok(dave.speed < 0.85);
  assert.equal(dave.maxHp, 2, "DAVE's +2 max HP flows through baseStats");
});
