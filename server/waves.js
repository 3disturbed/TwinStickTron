// Wave recipes (SDD §2.4, §2.9). A recipe is a spawn timeline generated
// from a budget: budget = base(wave) × (0.65 + 0.35 × players) — more
// players means more enemies, never spongier ones.
// `rng` is injectable so Daily Dark runs are identical for everyone.

import { EK, WAVE } from "../shared/constants.js";
import { ENEMIES } from "../shared/enemies.js";

// Kind ramp: every few waves the roster deepens (SDD §2.5 roster of 12)
function allowedKinds(wave) {
  const kinds = [EK.DRONE, EK.MITE];
  if (wave >= 2) kinds.push(EK.WEAVER);
  if (wave >= 3) kinds.push(EK.SPINNER);
  if (wave >= 4) kinds.push(EK.BRUTE);
  if (wave >= 6) kinds.push(EK.MORTAR);
  if (wave >= 7) kinds.push(EK.SNIPER);
  if (wave >= 9) kinds.push(EK.GHOST);
  if (wave >= 11) kinds.push(EK.LEECH);
  if (wave >= 12) kinds.push(EK.MAGNET);
  if (wave >= 13) kinds.push(EK.WARDEN);
  if (wave >= 14) kinds.push(EK.FORGE);
  return kinds;
}

const BOSSES = { 5: EK.BRUTE_PRIME, 10: EK.HEX_PRIME, 15: EK.FOUNDRY, 20: EK.SHEPHERD, 25: EK.ULTRADARK };

// Returns { entries: [{t, kind, count}], boss: EK|null }
export function makeWave(wave, players, rng = Math.random) {
  const isBoss = wave % WAVE.BOSS_EVERY === 0;
  const budget = Math.round((50 + wave * 35) * (0.65 + 0.35 * players) * (isBoss ? 0.45 : 1));
  const kinds = allowedKinds(wave);
  const entries = [];
  const spread = isBoss ? 50 : 42; // seconds over which the wave trickles in
  let spent = 0;
  let t = isBoss ? 6 : 1.5;        // boss waves: boss lands first, adds later
  while (spent < budget) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const def = ENEMIES[kind];
    const group = kind === EK.MITE ? 6 : kind === EK.DRONE ? 3 :
                  (kind === EK.BRUTE || kind === EK.FORGE || kind === EK.WARDEN) ? 1 : 2;
    entries.push({ t, kind, count: group });
    spent += def.cost * group;
    t += 1.2 + rng() * (spread / Math.max(6, budget / 12));
  }
  entries.sort((a, b) => a.t - b.t);
  const boss = BOSSES[wave] ?? null;
  return { entries, boss };
}

// Boss HP scales with player count (SDD §2.6)
export function bossHp(kind, players) {
  const base = ENEMIES[kind].hp;
  return Math.round(base * (0.7 + 0.3 * players));
}
