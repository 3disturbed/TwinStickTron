import test from "node:test";
import assert from "node:assert/strict";
import { MODS, CLASS_MODS, classModsFor, modById, computeStats, baseStats, draftOffer } from "../shared/mods.js";
import { ENEMIES } from "../shared/enemies.js";
import { EK, PILOTS, WAVE } from "../shared/constants.js";
import { makeWave } from "../server/waves.js";
import { mulberry32 } from "../shared/rng.js";
import { openDb } from "../server/db.js";

test("the full 40-mod pool exists and every mod applies cleanly", () => {
  assert.ok(MODS.length >= 40, `pool has ${MODS.length} mods, SDD §2.7 wants 40`);
  const ids = new Set(MODS.map(m => m.id));
  assert.equal(ids.size, MODS.length, "duplicate mod ids");
  for (const m of MODS) {
    const s = computeStats(PILOTS[0], [m.id]);
    for (const [k, v] of Object.entries(s)) {
      assert.ok(typeof v !== "number" || Number.isFinite(v), `${m.id} produced non-finite ${k}`);
    }
  }
  // every stat key a mod touches must exist in baseStats (no silent typos)
  const base = Object.keys(baseStats(PILOTS[0]));
  for (const m of MODS) {
    const s = baseStats(PILOTS[0]);
    m.apply(s);
    for (const k of Object.keys(s)) {
      assert.ok(base.includes(k) || ["dashPenalty", "dashBonus"].includes(k), `${m.id} invented stat "${k}"`);
    }
  }
});

test("class mods: every pilot has a pool, all apply cleanly, drafts never offer them", () => {
  for (let pilot = 0; pilot < 4; pilot++) {
    const pool = classModsFor(pilot);
    assert.ok(pool.length >= 4, `pilot ${pilot} has only ${pool.length} class mods`);
    for (const m of pool) {
      assert.equal(m.pilot, pilot);
      assert.ok(modById(m.id), `${m.id} not resolvable via modById`);
      const s = computeStats(PILOTS[pilot], [m.id, m.id]); // must stack safely
      for (const [k, v] of Object.entries(s)) {
        assert.ok(typeof v !== "number" || Number.isFinite(v), `${m.id} produced non-finite ${k}`);
      }
    }
  }
  const classIds = new Set(CLASS_MODS.map(m => m.id));
  assert.equal(classIds.size, CLASS_MODS.length, "duplicate class mod ids");
  for (let i = 0; i < 200; i++) {
    for (const id of draftOffer(Math.random, 20)) {
      assert.ok(!classIds.has(id), "draft offered a class mod — those are grant-only");
    }
  }
});

test("full enemy roster is defined for every wave's ramp", () => {
  const twelve = [EK.DRONE, EK.MITE, EK.WEAVER, EK.BRUTE, EK.SPINNER, EK.MORTAR,
    EK.SNIPER, EK.LEECH, EK.WARDEN, EK.FORGE, EK.GHOST, EK.MAGNET];
  for (const k of twelve) assert.ok(ENEMIES[k], `enemy kind ${k} missing`);
  for (const k of [EK.BRUTE_PRIME, EK.HEX_PRIME, EK.FOUNDRY, EK.SHEPHERD, EK.ULTRADARK]) {
    assert.ok(ENEMIES[k]?.boss, `boss kind ${k} missing`);
  }
  // every 5th wave has its boss, victory wave included
  for (const w of [5, 10, 15, 20, 25]) {
    assert.ok(makeWave(w, 2).boss, `wave ${w} has no boss`);
  }
  assert.equal(makeWave(25, 1).boss, EK.ULTRADARK);
  assert.equal(WAVE.MAX, 25);
});

test("seeded waves are deterministic (the Daily Dark contract)", () => {
  for (const w of [1, 7, 13, 19, 24]) {
    const a = makeWave(w, 3, mulberry32(0xBADC0DE ^ w));
    const b = makeWave(w, 3, mulberry32(0xBADC0DE ^ w));
    assert.deepEqual(a, b, `wave ${w} recipes diverged for identical seeds`);
  }
  const a = makeWave(9, 3, mulberry32(1));
  const b = makeWave(9, 3, mulberry32(2));
  assert.notDeepEqual(a.entries, b.entries);
});

test("leaderboard db: submit, rank, daily one-attempt rule", () => {
  const db = openDb(":memory:");
  const date = "2026-08-19";
  assert.equal(db.getDailySeed(date), db.getDailySeed(date), "daily seed must be stable");

  const r1 = db.submit({ mode: "run", date, squad: 2, score: 5000, wave: 12, names: ["ACE", "REX"] });
  assert.deepEqual(r1, { accepted: true, rank: 1 });
  const r2 = db.submit({ mode: "run", date, squad: 1, score: 9000, wave: 18, names: ["ZED"] });
  assert.deepEqual(r2, { accepted: true, rank: 1 });
  const r3 = db.submit({ mode: "run", date, squad: 1, score: 7000, wave: 15, names: ["MID"] });
  assert.equal(r3.rank, 2);

  const d1 = db.submit({ mode: "daily", date, squad: 1, score: 1000, wave: 5, names: ["ACE"] });
  assert.equal(d1.accepted, true);
  const d2 = db.submit({ mode: "daily", date, squad: 1, score: 99999, wave: 20, names: ["ACE"] });
  assert.equal(d2.accepted, false, "second daily attempt by the same callsign must not count");

  const top = db.top("run");
  assert.equal(top.length, 3);
  assert.equal(top[0].score, 9000);
  assert.deepEqual(top[0].names, ["ZED"]);
  assert.equal(db.top("daily", { date }).length, 1);
});
