// The Core Shop: earning, spending, and every rejection path — server-side.

import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../server/sim.js";
import { PHASE, EK, TICK_DT } from "../shared/constants.js";
import { shopItemById, shopFor } from "../shared/shop.js";

function combatSim(pilots = [0]) {
  const sim = new Sim();
  pilots.forEach((pl, i) => sim.addPlayer(i + 1, `T${i + 1}`, pl));
  sim.phase = PHASE.WAVE;
  sim.wave = 5; // boss wave → next intermission opens the shop
  sim.script = { entries: [{ t: 1e9, kind: EK.DRONE, count: 1 }], boss: null };
  sim.scriptT = 0;
  return sim;
}

test("kills pay cores by enemy weight; the wave stipend pays everyone", () => {
  const sim = combatSim([0]);
  const p = sim.players.get(1);
  sim.spawnEnemy(EK.BRUTE, 1800, 200, false);
  sim.damageEnemy([...sim.enemies.values()][0], 999, p);
  assert.equal(p.cores, 3, "a Brute is worth 3 cores");
  sim.beginIntermission(); // wave 5 → stipend 5+5, shop opens
  assert.equal(p.cores, 3 + 10);
  assert.equal(sim.shopOpen, true);
  const offer = sim.events.find(e => e.t === "shop_offer");
  assert.ok(offer, "post-boss intermission sends a shop offer");
  assert.ok(offer.items.includes("s_b_twin"), "BINK sees his class items");
  assert.ok(offer.items.includes("s_g_plate"), "generics included");
  assert.ok(!offer.items.includes("s_d_whirl"), "DAVE's items are not in BINK's shop");
  assert.equal(sim.phaseT, 40, "post-boss intermission runs long for shopping");
});

test("buy: deducts, applies, and rejects wrong-class/duplicate/poor/closed", () => {
  const sim = combatSim([0]);
  const p = sim.players.get(1);
  sim.beginIntermission();
  sim.events.length = 0;
  p.cores = 100;

  // closed-shop guard first: force-close and try
  sim.shopOpen = false;
  sim.action(p, { t: "buy", id: "s_g_plate" });
  assert.equal(p.cores, 100, "no shop, no sale");
  sim.shopOpen = true;

  const hpMax0 = sim.hpMax(p);
  sim.action(p, { t: "buy", id: "s_g_plate" }); // 50⬡, +1 maxHp, heal 1
  assert.equal(p.cores, 50);
  assert.ok(p.mods.includes("s_g_plate"));
  assert.equal(sim.hpMax(p), hpMax0 + 1, "purchase applies through computeStats");
  assert.ok(sim.events.some(e => e.t === "bought" && e.mod === "s_g_plate"));

  sim.events.length = 0;
  p.cores = 200;
  sim.action(p, { t: "buy", id: "s_b_twin" }); // signature `once` item (70⬡)
  sim.action(p, { t: "buy", id: "s_b_twin" }); // duplicate
  assert.equal(p.cores, 130, "signature items can't be re-bought");
  assert.ok(sim.events.some(e => e.t === "shop_err" && e.why === "owned"));

  sim.events.length = 0;
  sim.action(p, { t: "buy", id: "s_d_whirl" }); // DAVE-only, we are BINK
  assert.equal(p.cores, 130);
  assert.ok(sim.events.some(e => e.t === "shop_err" && e.why === "wrong_class"));

  sim.events.length = 0;
  p.cores = 10;
  sim.action(p, { t: "buy", id: "s_b_cdr" }); // 35⬡ > 10⬡
  assert.equal(p.cores, 10);
  assert.ok(sim.events.some(e => e.t === "shop_err" && e.why === "poor"));

  // repeatable consumable-style item buys twice
  p.cores = 100;
  sim.action(p, { t: "buy", id: "s_g_adren" });
  sim.action(p, { t: "buy", id: "s_g_adren" });
  assert.equal(p.cores, 50, "non-once items repeat");
});

test("stackables stack: weaker each, stronger together", () => {
  const sim = combatSim([0]);
  const p = sim.players.get(1);
  sim.beginIntermission();
  p.cores = 200;
  const dmg0 = p.stats.dmg;
  sim.action(p, { t: "buy", id: "s_b_rifle" }); // +8% dmg, stackable
  const dmg1 = p.stats.dmg;
  sim.action(p, { t: "buy", id: "s_b_rifle" });
  const dmg2 = p.stats.dmg;
  assert.ok(Math.abs(dmg1 - dmg0 * 1.08) < 1e-9, "one stack = +8%");
  assert.ok(Math.abs(dmg2 - dmg0 * 1.08 * 1.08) < 1e-9, "two stacks compound");
  assert.equal(p.cores, 200 - 60, "each stack costs full price");
  assert.equal(p.mods.filter(m => m === "s_b_rifle").length, 2);
  // ability-cooldown lines stack too, floored server-side at 2s
  p.cores = 500;
  for (let i = 0; i < 6; i++) sim.action(p, { t: "buy", id: "s_b_cdr" });
  assert.equal(p.mods.filter(m => m === "s_b_cdr").length, 6, "all six stacks bought");
  assert.ok(p.stats.abilityCdr >= 6, "cd reduction stacks (random class grant may add more)");
  sim.phase = 1; // WAVE — abilities usable
  sim.ability(p);
  assert.ok(p.abilCd >= 2, "cd stacking can't push the ability below the 2s floor");
});

test("intermission only shortens when everyone has picked AND shopped", () => {
  const sim = combatSim([0, 3]);
  const [a, b] = [sim.players.get(1), sim.players.get(2)];
  sim.beginIntermission();
  assert.equal(sim.phaseT, 40);
  // both pick their draft
  for (const p of [a, b]) sim.action(p, { t: "pick", id: sim.offers.get(p.id)[0] });
  assert.equal(sim.phaseT, 40, "picked but still shopping — timer holds");
  sim.action(a, { t: "shop_done" });
  assert.equal(sim.phaseT, 40, "one shopper still browsing");
  sim.action(b, { t: "shop_done" });
  assert.ok(sim.phaseT <= 3, "everyone done → timer collapses");
});

test("shop catalog: every class has ≥5 items, ≥3 stackables, an ability-cd line", () => {
  for (let pilot = 0; pilot < 8; pilot++) {
    const mine = shopFor(pilot).filter(i => i.pilot === pilot);
    assert.ok(mine.length >= 5, `pilot ${pilot} has only ${mine.length} shop items`);
    const stackables = mine.filter(i => !i.once);
    assert.ok(stackables.length >= 3, `pilot ${pilot} has only ${stackables.length} stackables`);
    // every class must be able to buy down its ability cooldown
    const hasCdr = mine.some(i => {
      const s = { abilityCdr: 0 };
      try { i.apply(s); } catch { /* stats-shape items */ }
      return s.abilityCdr > 0;
    });
    assert.ok(hasCdr, `pilot ${pilot} has no ability-cooldown shop line`);
  }
  for (const it of shopFor(0)) {
    assert.ok(it.price > 0 && it.price <= 200, `${it.id} price out of band`);
    assert.ok(shopItemById(it.id), `${it.id} not resolvable`);
    // stackables must be cheap-ish; signatures may run hot
    if (!it.once) assert.ok(it.price <= 50, `${it.id} is stackable but pricey (${it.price})`);
  }
});

test("run reset wipes cores and purchases", () => {
  const sim = combatSim([0]);
  const p = sim.players.get(1);
  p.cores = 500;
  p.mods.push("s_g_jets");
  sim.startRun();
  assert.equal(p.cores, 0);
  assert.equal(p.mods.length, 0);
  // and the sim ticks fine right after
  p.input = { seq: 1, mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 };
  for (let t = 0; t < 30; t++) sim.step(TICK_DT);
});
