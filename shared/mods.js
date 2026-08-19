// The draft pool (SDD §2.7). v1 slice: 14 mods across the four families.
// apply() mutates a player's server-side stats object; the client only ever
// renders card text. Stats start from baseStats() and are recomputed from
// the owned mod list after every draft (idempotent, order-independent-ish —
// multiplicative stacking, documented per mod).

export function baseStats(pilot) {
  return {
    speed: pilot?.speed ?? 1,     // move speed multiplier
    fire: pilot?.fire ?? 1,       // fire-rate multiplier
    dmg: 1,                       // bullet damage
    bulletSpeed: 1,
    pierce: 0,                    // enemies a bullet passes through
    ricochet: 0,                  // wall bounces per bullet
    split: 0,                     // extra side bullets
    dashCharges: 1,
    orbitals: 0,                  // orbiting blades
    nova: 0,                      // dash shockwave damage
    bounty: 1,                    // score multiplier on kills
    blast: 0,                     // on-kill explosion damage
    reviveSpeed: 1,
  };
}

export const MODS = [
  // Ballistics
  { id: "pierce",   family: "Ballistics", rarity: 1, name: "Piercer",      desc: "Bullets pass through +1 enemy.",            apply: s => { s.pierce += 1; } },
  { id: "ricochet", family: "Ballistics", rarity: 1, name: "Ricochet",     desc: "Bullets bounce off walls once.",            apply: s => { s.ricochet += 1; } },
  { id: "split",    family: "Ballistics", rarity: 2, name: "Splitter",     desc: "Fire +1 bullet in a spread.",               apply: s => { s.split += 1; } },
  { id: "heavy",    family: "Ballistics", rarity: 2, name: "Heavy Rounds", desc: "+60% damage, −20% fire rate.",              apply: s => { s.dmg *= 1.6; s.fire *= 0.8; } },
  { id: "rapid",    family: "Ballistics", rarity: 1, name: "Overclock",    desc: "+25% fire rate.",                           apply: s => { s.fire *= 1.25; } },
  { id: "velocity", family: "Ballistics", rarity: 1, name: "Railshot",     desc: "+35% bullet speed.",                        apply: s => { s.bulletSpeed *= 1.35; } },
  // Chassis
  { id: "thrust",   family: "Chassis",    rarity: 1, name: "Thrusters",    desc: "+15% move speed.",                          apply: s => { s.speed *= 1.15; } },
  { id: "dash2",    family: "Chassis",    rarity: 2, name: "Twin Dash",    desc: "+1 dash charge.",                           apply: s => { s.dashCharges += 1; } },
  { id: "triage",   family: "Chassis",    rarity: 1, name: "Triage Unit",  desc: "Revive teammates 50% faster.",              apply: s => { s.reviveSpeed *= 1.5; } },
  // Field
  { id: "orbital",  family: "Field",      rarity: 2, name: "Orbital",      desc: "A blade orbits you, shredding on contact.", apply: s => { s.orbitals += 1; } },
  { id: "nova",     family: "Field",      rarity: 2, name: "Dash Nova",    desc: "Dashing releases a damaging shockwave.",    apply: s => { s.nova += 1; } },
  // Echo
  { id: "bounty",   family: "Echo",       rarity: 1, name: "Bounty Chip",  desc: "+25% score from your kills.",               apply: s => { s.bounty *= 1.25; } },
  { id: "blast",    family: "Echo",       rarity: 2, name: "Volatile",     desc: "Your kills explode, damaging neighbours.",  apply: s => { s.blast += 1; } },
  // Cursed (SDD: big power, real drawback)
  { id: "glass",    family: "Ballistics", rarity: 3, cursed: true, name: "Glass Cannon", desc: "+80% damage. Dash cooldown +1s.", apply: s => { s.dmg *= 1.8; s.dashPenalty = (s.dashPenalty ?? 0) + 1; } },
];

export function modById(id) { return MODS.find(m => m.id === id); }

export function computeStats(pilot, modIds) {
  const s = baseStats(pilot);
  for (const id of modIds) modById(id)?.apply(s);
  return s;
}

// Deterministic 3-card offer for a player at a given wave (server picks seed).
export function draftOffer(rng, wave) {
  const weights = MODS.map(m => (m.rarity === 1 ? 10 : m.rarity === 2 ? (wave >= 3 ? 6 : 2) : (wave >= 4 ? 2 : 0)));
  const offer = [];
  const pool = MODS.slice();
  const w = weights.slice();
  for (let k = 0; k < 3 && pool.length; k++) {
    const total = w.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let i = 0;
    while (i < pool.length - 1 && (r -= w[i]) > 0) i++;
    offer.push(pool[i].id);
    pool.splice(i, 1); w.splice(i, 1);
  }
  return offer;
}
