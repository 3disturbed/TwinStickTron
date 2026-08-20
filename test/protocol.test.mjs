import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeSnapshot, decodeSnapshot, encodeInput, decodeInput,
  encodePong, decodePong, MSG,
} from "../shared/protocol.js";

test("input round-trips", () => {
  const buf = encodeInput(1234, -0.5, 1, 0.25, -1, 0b1011);
  const v = new DataView(buf);
  assert.equal(v.getUint8(0), MSG.INPUT);
  const d = decodeInput(v);
  assert.equal(d.seq, 1234);
  assert.equal(d.buttons, 0b1011);
  assert.ok(Math.abs(d.mx - -0.5) < 0.01);
  assert.ok(Math.abs(d.my - 1) < 0.01);
  assert.ok(Math.abs(d.ax - 0.25) < 0.01);
});

test("snapshot round-trips", () => {
  const snap = {
    tick: 90210, phase: 1, wave: 7, phaseT: 300, mult: 4.2,
    unbanked: 123456, banked: 999999, enemiesLeft: 42, stasis: 3.5,
    players: [
      { id: 1, pilot: 2, state: 0, x: 1024.5, y: 576.25, aim: 1.5, hp: 3, dashCd: 1.2, abilCd: 7, bombs: 2, flags: 3, orbitals: 3, cons: [1, 4, 0], cores: 4097 },
      { id: 2, pilot: 7, state: 1, x: 24, y: 1128, aim: 0, hp: 0, dashCd: 0, abilCd: 0, bombs: 0, flags: 4, orbitals: 0, cons: [], cores: 0 },
    ],
    enemies: [
      { id: 501, kind: 4, x: 2000.125, y: 100, hpPct: 55, flags: 1 },
      { id: 502, kind: 21, x: 1, y: 1, hpPct: 100, flags: 0 },
    ],
    bullets: [{ id: 9, x: 500, y: 500, owner: 1 }],
    zones: [{ kind: 2, x: 300, y: 300, r: 90, ttl: 1.2 }],
    pickups: [{ id: 77, kind: 3, x: 640.5, y: 480, ttl: 7.4 }],
  };
  const buf = encodeSnapshot(snap);
  const d = decodeSnapshot(new DataView(buf));
  assert.ok(Math.abs(d.stasis - 3.5) < 0.06);
  assert.equal(d.players[0].orbitals, 3);
  assert.deepEqual(d.players[0].cons, [1, 4, 0]);
  assert.deepEqual(d.players[1].cons, [0, 0, 0]);
  assert.equal(d.players[0].cores, 4097, "cores must survive as u16 (a u8 would truncate)");
  assert.equal(d.players[1].cores, 0);
  assert.equal(d.players[1].pilot, 7, "8-class pilot ids fit");
  assert.equal(d.pickups.length, 1);
  assert.equal(d.pickups[0].id, 77);
  assert.equal(d.pickups[0].kind, 3);
  assert.ok(Math.abs(d.pickups[0].x - 640.5) < 0.13);
  assert.ok(Math.abs(d.pickups[0].ttl - 7.4) < 0.11);
  assert.equal(d.tick, snap.tick);
  assert.equal(d.wave, 7);
  assert.equal(d.unbanked, 123456);
  assert.equal(d.banked, 999999);
  assert.ok(Math.abs(d.mult - 4.2) < 0.06);
  assert.equal(d.players.length, 2);
  assert.ok(Math.abs(d.players[0].x - 1024.5) < 0.13); // POS_SCALE quantisation
  assert.ok(Math.abs(d.players[0].y - 576.25) < 0.13);
  assert.equal(d.players[0].hp, 3);
  assert.equal(d.players[1].state, 1);
  assert.equal(d.enemies.length, 2);
  assert.equal(d.enemies[0].id, 501);
  assert.equal(d.enemies[0].hpPct, 55);
  assert.ok(Math.abs(d.enemies[0].x - 2000.125) < 0.13);
  assert.equal(d.bullets[0].owner, 1);
  assert.equal(d.zones[0].kind, 2);
  assert.ok(Math.abs(d.zones[0].r - 90) < 0.2);
  assert.ok(Math.abs(d.zones[0].ttl - 1.2) < 0.11);
});

test("pong round-trips", () => {
  const buf = encodePong(123.456, 1755600000000, 4242);
  const d = decodePong(new DataView(buf));
  assert.equal(d.clientT, 123.456);
  assert.equal(d.serverMs, 1755600000000);
  assert.equal(d.tick, 4242);
});
