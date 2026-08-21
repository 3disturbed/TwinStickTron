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
const BOSS_CYCLE = [EK.BRUTE_PRIME, EK.HEX_PRIME, EK.FOUNDRY, EK.SHEPHERD, EK.ULTRADARK];

// Endless: past 25 the roster cycles — wave 30 BRUTE PRIME, …, 50 THE
// ULTRADARK again, and on forever.
export function bossFor(wave) {
  if (wave % WAVE.BOSS_EVERY !== 0) return null;
  return BOSSES[wave] ?? BOSS_CYCLE[(wave / WAVE.BOSS_EVERY - 1) % BOSS_CYCLE.length];
}

// Beyond a 4-stack, each extra player adds enemies at a gentler slope —
// keeps 8-player lobbies chaotic but readable (and snapshots bounded).
function effectivePlayers(n) { return n <= 4 ? n : 4 + (n - 4) * 0.6; }

// Returns { entries: [{t, kind, count}], boss: EK|null }
export function makeWave(wave, players, rng = Math.random) {
  const isBoss = wave % WAVE.BOSS_EVERY === 0;
  const p = effectivePlayers(players);
  const budget = Math.round((50 + wave * 35) * (0.65 + 0.35 * p) * (isBoss ? 0.45 : 1));
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
  return { entries, boss: bossFor(wave) };
}

// Boss HP must track squad DPS, which is roughly linear in player count —
// the old 0.7+0.3p curve made bosses melt in co-op. Near-linear to a
// 4-stack (solo ×1.0 unchanged, 4p ×3.4), softened beyond (8p ×5.8).
// Past wave 25 the base keeps growing at the slope waves 1–25 set
// (~6 HP/wave: 60→180 across bosses 5→25), so cycled bosses never go soft.
export function bossHp(kind, players, wave = 0) {
  const base = ENEMIES[kind].hp + (wave > 25 ? (wave - 25) * 6 : 0);
  const f = players <= 4 ? 0.2 + 0.8 * players : 3.4 + 0.6 * (players - 4);
  return Math.round(base * f);
}
