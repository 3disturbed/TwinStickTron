import test from "node:test";
import assert from "node:assert/strict";
import { stepPlayerMovement, startDash } from "../shared/movement.js";
import { ARENA_W, ARENA_H, WALL_PAD, PLAYER } from "../shared/constants.js";
import { computeStats, draftOffer, modById } from "../shared/mods.js";

test("movement stays in bounds and reaches speed", () => {
  const p = { x: 100, y: 100, vx: 0, vy: 0, dashT: 0 };
  const stats = { speed: 1 };
  for (let i = 0; i < 30; i++) stepPlayerMovement(p, { mx: 1, my: 0 }, stats, 1 / 30);
  assert.ok(Math.abs(p.vx - PLAYER.SPEED) < 1, `vx=${p.vx} should reach max speed`);
  for (let i = 0; i < 600; i++) stepPlayerMovement(p, { mx: 1, my: 1 }, stats, 1 / 30);
  assert.ok(p.x <= ARENA_W - WALL_PAD && p.y <= ARENA_H - WALL_PAD, "clamped to arena");
});

test("dash launches at dash speed", () => {
  const p = { x: 500, y: 500, vx: 0, vy: 0, dashT: 0, aim: 0 };
  startDash(p, { mx: 0, my: -1 });
  assert.ok(Math.abs(p.vy + PLAYER.DASH_SPEED) < 1);
  assert.equal(p.dashT, PLAYER.DASH_TIME);
});

test("mods apply and stack", () => {
  const s0 = computeStats({ speed: 1, fire: 1 }, []);
  const s1 = computeStats({ speed: 1, fire: 1 }, ["pierce", "rapid", "rapid"]);
  assert.equal(s1.pierce, s0.pierce + 1);
  assert.ok(Math.abs(s1.fire - 1.25 * 1.25) < 1e-9);
});

test("draft offers 3 distinct real mods", () => {
  for (let i = 0; i < 50; i++) {
    const offer = draftOffer(Math.random, 5);
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer).size, 3);
    for (const id of offer) assert.ok(modById(id), `unknown mod ${id}`);
  }
});
