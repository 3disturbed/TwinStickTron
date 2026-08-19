import test from "node:test";
import assert from "node:assert/strict";
import { spawnPattern, PT } from "../shared/patterns.js";

test("same seed → identical bullets (the determinism contract)", () => {
  for (const pid of [PT.RING, PT.FAN, PT.SPOKES, PT.ORB]) {
    const a = spawnPattern(pid, 0xDEADBEEF, 1000, 500, 1.25);
    const b = spawnPattern(pid, 0xDEADBEEF, 1000, 500, 1.25);
    assert.deepEqual(a, b, `pattern ${pid} diverged for identical seeds`);
    assert.ok(a.length > 0);
    for (const blt of a) {
      assert.ok(Number.isFinite(blt.vx) && Number.isFinite(blt.vy));
    }
  }
});

test("different seeds differ", () => {
  const a = spawnPattern(PT.RING, 1, 0, 0, 0);
  const b = spawnPattern(PT.RING, 2, 0, 0, 0);
  assert.notDeepEqual(a, b);
});
