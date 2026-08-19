// The draft pool — 40 mods across four families (SDD §2.7), including
// cursed picks. apply() mutates a stats object; stats are recomputed from
// the owned mod list after every draft, so stacking is multiplicative and
// order-independent for the ops used here.
//
// New hook fields consumed by server/sim.js:
//   maxHp        extra hit points (base 3)
//   bulletLife   bullet lifetime multiplier
//   iframeBonus  post-hit invulnerability multiplier
//   thorns       contact retaliation damage per stack
//   static       periodic arc-zap stacks (every ~2.2s, nearest enemy)
//   bloodrush    dash cooldown shaved per kill (0.15s per stack)
//   dashDmg      +30%/stack damage for 1s after dashing
//   bombPower    extra smart-bomb damage
//   reviveRange  revive radius multiplier
//   interest     +5%/stack bonus on every bank
//   streakBomb   +1 bomb every 25th personal kill (per stack: 25/20/15…)
//   hitFactor    multiplier kept on hit (default 0.5 = halved)
//   rage         +50%/stack fire rate for 3s after taking a hit

export function baseStats(pilot) {
  return {
    speed: pilot?.speed ?? 1,
    fire: pilot?.fire ?? 1,
    dmg: 1,
    bulletSpeed: 1,
    bulletLife: 1,
    pierce: 0,
    ricochet: 0,
    split: 0,
    dashCharges: 1,
    orbitals: 0,
    nova: 0,
    bounty: 1,
    blast: 0,
    reviveSpeed: 1,
    reviveRange: 1,
    maxHp: 0,
    iframeBonus: 1,
    thorns: 0,
    static: 0,
    bloodrush: 0,
    dashDmg: 0,
    bombPower: 0,
    interest: 0,
    streakBomb: 0,
    hitFactor: 0.5,
    rage: 0,
    // class-mod hooks (pilot signature upgrades, granted free each intermission)
    abilityCdr: 0,     // seconds shaved off the 12s ability cooldown
    blinkDist: 1,      // VANTA blink range multiplier
    blinkShots: 0,     // VANTA extra volley bullets
    blinkNova: 0,      // VANTA departure-point explosion stacks
    flameR: 1,         // EMBER zone radius multiplier
    flameDur: 1,       // EMBER zone duration multiplier
    flameDps: 1,       // EMBER burn damage multiplier
    napalm: 0,         // EMBER dash leaves a burning trail
    aegisR: 1,         // HALO field radius multiplier
    aegisDur: 1,       // HALO field duration multiplier
    aegisHeal: 0,      // HALO field heals allies on cast
    reviveDiscount: 1, // HALO revives cost this fraction of normal insurance
    wellR: 1,          // ONYX well radius multiplier
    wellDur: 1,        // ONYX well duration multiplier
    wellDmg: 0,        // ONYX extra detonation damage
  };
}

// Pilot-signature upgrades (SDD §2.7 extension): at every intermission each
// player is GRANTED one of these at random for their pilot — free, stacking,
// on top of the drafted pick. They deepen the pilot identity over a run.
export const CLASS_MODS = [
  // VANTA — Blink Volley
  { id: "c_v_dist",  pilot: 0, name: "Long Blink",     desc: "Blink travels 40% further.",                    apply: s => { s.blinkDist *= 1.4; } },
  { id: "c_v_shots", pilot: 0, name: "Volley Plus",    desc: "Blink volley fires 6 extra bullets.",           apply: s => { s.blinkShots += 6; } },
  { id: "c_v_nova",  pilot: 0, name: "Echo Blink",     desc: "Blinking detonates your departure point.",      apply: s => { s.blinkNova += 1; } },
  { id: "c_v_cdr",   pilot: 0, name: "Coil Feedback",  desc: "Blink cooldown −2s.",                           apply: s => { s.abilityCdr += 2; } },
  // EMBER — Flame Zone
  { id: "c_e_r",     pilot: 1, name: "Wider Burn",     desc: "Flame zone is 30% larger.",                     apply: s => { s.flameR *= 1.3; } },
  { id: "c_e_dur",   pilot: 1, name: "Longer Burn",    desc: "Flame zone lasts 50% longer.",                  apply: s => { s.flameDur *= 1.5; } },
  { id: "c_e_dps",   pilot: 1, name: "Hotter Burn",    desc: "Flame damage +75%.",                            apply: s => { s.flameDps *= 1.75; } },
  { id: "c_e_trail", pilot: 1, name: "Napalm Trail",   desc: "Dashing leaves a burning trail.",               apply: s => { s.napalm += 1; } },
  { id: "c_e_cdr",   pilot: 1, name: "Pilot Light",    desc: "Flame Zone cooldown −2s.",                      apply: s => { s.abilityCdr += 2; } },
  // HALO — Aegis Field
  { id: "c_h_r",     pilot: 2, name: "Wider Aegis",    desc: "Aegis Field is 30% larger.",                    apply: s => { s.aegisR *= 1.3; } },
  { id: "c_h_dur",   pilot: 2, name: "Lasting Aegis",  desc: "Aegis Field lasts 40% longer.",                 apply: s => { s.aegisDur *= 1.4; } },
  { id: "c_h_heal",  pilot: 2, name: "Mending Aegis",  desc: "Casting Aegis heals allies inside by 1.",       apply: s => { s.aegisHeal += 1; } },
  { id: "c_h_rev",   pilot: 2, name: "Guardian Angel", desc: "Your revives cost half the banked score.",      apply: s => { s.reviveDiscount *= 0.5; } },
  { id: "c_h_cdr",   pilot: 2, name: "Halo Charge",    desc: "Aegis cooldown −2s.",                           apply: s => { s.abilityCdr += 2; } },
  // ONYX — Gravity Well
  { id: "c_o_r",     pilot: 3, name: "Deeper Well",    desc: "Gravity Well is 30% larger.",                   apply: s => { s.wellR *= 1.3; } },
  { id: "c_o_dur",   pilot: 3, name: "Singularity",    desc: "Gravity Well lasts 40% longer.",                apply: s => { s.wellDur *= 1.4; } },
  { id: "c_o_dmg",   pilot: 3, name: "Crushing Well",  desc: "Well detonation deals +2 damage.",              apply: s => { s.wellDmg += 2; } },
  { id: "c_o_cdr",   pilot: 3, name: "Dense Core",     desc: "Gravity Well cooldown −2s.",                    apply: s => { s.abilityCdr += 2; } },
];

export function classModsFor(pilot) { return CLASS_MODS.filter(m => m.pilot === pilot); }

export const MODS = [
  // ---- Ballistics (what your bullets do) ----
  { id: "pierce",    family: "Ballistics", rarity: 1, name: "Piercer",       desc: "Bullets pass through +1 enemy.",                 apply: s => { s.pierce += 1; } },
  { id: "ricochet",  family: "Ballistics", rarity: 1, name: "Ricochet",      desc: "Bullets bounce off walls once.",                 apply: s => { s.ricochet += 1; } },
  { id: "split",     family: "Ballistics", rarity: 2, name: "Splitter",      desc: "Fire +1 bullet in a spread.",                    apply: s => { s.split += 1; } },
  { id: "heavy",     family: "Ballistics", rarity: 2, name: "Heavy Rounds",  desc: "+60% damage, −20% fire rate.",                   apply: s => { s.dmg *= 1.6; s.fire *= 0.8; } },
  { id: "rapid",     family: "Ballistics", rarity: 1, name: "Overclock",     desc: "+25% fire rate.",                                apply: s => { s.fire *= 1.25; } },
  { id: "velocity",  family: "Ballistics", rarity: 1, name: "Railshot",      desc: "+35% bullet speed.",                             apply: s => { s.bulletSpeed *= 1.35; } },
  { id: "longbar",   family: "Ballistics", rarity: 1, name: "Long Barrel",   desc: "+40% bullet range.",                             apply: s => { s.bulletLife *= 1.4; } },
  { id: "railgun",   family: "Ballistics", rarity: 2, name: "Railgun Coils", desc: "+60% bullet speed, pierce +1.",                  apply: s => { s.bulletSpeed *= 1.6; s.pierce += 1; } },
  { id: "gunsling",  family: "Ballistics", rarity: 1, name: "Gunslinger",    desc: "+15% fire rate, +10% damage.",                   apply: s => { s.fire *= 1.15; s.dmg *= 1.1; } },
  { id: "heavywt",   family: "Ballistics", rarity: 2, name: "Heavyweight",   desc: "+30% damage, −8% move speed.",                   apply: s => { s.dmg *= 1.3; s.speed *= 0.92; } },
  // ---- Field (what happens around you) ----
  { id: "orbital",   family: "Field",      rarity: 2, name: "Orbital",       desc: "A blade orbits you, shredding on contact.",      apply: s => { s.orbitals += 1; } },
  { id: "orbital2",  family: "Field",      rarity: 3, name: "Twin Orbital",  desc: "TWO more orbiting blades.",                      apply: s => { s.orbitals += 2; } },
  { id: "nova",      family: "Field",      rarity: 2, name: "Dash Nova",     desc: "Dashing releases a damaging shockwave.",         apply: s => { s.nova += 1; } },
  { id: "novaplus",  family: "Field",      rarity: 2, name: "Nova Core",     desc: "Stronger dash shockwave, dash −0.2s.",           apply: s => { s.nova += 1; s.dashBonus = (s.dashBonus ?? 0) + 0.2; } },
  { id: "static",    family: "Field",      rarity: 2, name: "Static Coil",   desc: "Periodically zaps the nearest enemy.",           apply: s => { s.static += 1; } },
  { id: "thorns",    family: "Field",      rarity: 1, name: "Thorn Plating", desc: "Enemies that touch you take damage.",            apply: s => { s.thorns += 1; } },
  { id: "bombpow",   family: "Field",      rarity: 1, name: "Yield Boost",   desc: "Smart bombs deal +1 damage.",                    apply: s => { s.bombPower += 1; } },
  // ---- Chassis (what you are) ----
  { id: "thrust",    family: "Chassis",    rarity: 1, name: "Thrusters",     desc: "+15% move speed.",                               apply: s => { s.speed *= 1.15; } },
  { id: "dash2",     family: "Chassis",    rarity: 2, name: "Twin Dash",     desc: "+1 dash charge.",                                apply: s => { s.dashCharges += 1; } },
  { id: "feather",   family: "Chassis",    rarity: 1, name: "Featherframe",  desc: "+10% speed, dash recovers 0.3s faster.",         apply: s => { s.speed *= 1.1; s.dashBonus = (s.dashBonus ?? 0) + 0.3; } },
  { id: "plating",   family: "Chassis",    rarity: 2, name: "Plating",       desc: "+1 max HP (and heal 1 now).",                    heal: 1, apply: s => { s.maxHp += 1; } },
  { id: "overshld",  family: "Chassis",    rarity: 1, name: "Overshield",    desc: "+50% longer invulnerability after hits.",        apply: s => { s.iframeBonus *= 1.5; } },
  { id: "triage",    family: "Chassis",    rarity: 1, name: "Triage Unit",   desc: "Revive teammates 50% faster.",                   apply: s => { s.reviveSpeed *= 1.5; } },
  { id: "revaura",   family: "Chassis",    rarity: 1, name: "Reach Field",   desc: "Revive from 60% further away.",                  apply: s => { s.reviveRange *= 1.6; } },
  { id: "sprinter",  family: "Chassis",    rarity: 1, name: "Sprinter",      desc: "+8% speed, +8% fire rate.",                      apply: s => { s.speed *= 1.08; s.fire *= 1.08; } },
  // ---- Echo (what happens on events) ----
  { id: "bounty",    family: "Echo",       rarity: 1, name: "Bounty Chip",   desc: "+25% score from your kills.",                    apply: s => { s.bounty *= 1.25; } },
  { id: "blast",     family: "Echo",       rarity: 2, name: "Volatile",      desc: "Your kills explode, damaging neighbours.",       apply: s => { s.blast += 1; } },
  { id: "shrapnel",  family: "Echo",       rarity: 2, name: "Shrapnel",      desc: "Bigger kill explosions.",                        apply: s => { s.blast += 1; s.bounty *= 1.05; } },
  { id: "bloodrush", family: "Echo",       rarity: 1, name: "Bloodrush",     desc: "Kills shave 0.15s off your dash cooldown.",      apply: s => { s.bloodrush += 1; } },
  { id: "momentum",  family: "Echo",       rarity: 1, name: "Momentum",      desc: "+30% damage for 1s after dashing.",              apply: s => { s.dashDmg += 1; } },
  { id: "interest",  family: "Echo",       rarity: 1, name: "Interest",      desc: "Banking pays a +5% bonus.",                      apply: s => { s.interest += 1; } },
  { id: "streak",    family: "Echo",       rarity: 2, name: "Kill Streak",   desc: "Every 25th kill grants +1 smart bomb.",          apply: s => { s.streakBomb += 1; } },
  { id: "multgrd",   family: "Echo",       rarity: 2, name: "Grudge Core",   desc: "Getting hit keeps 70% of your multiplier.",      apply: s => { s.hitFactor = Math.max(s.hitFactor, 0.7); } },
  { id: "rage",      family: "Echo",       rarity: 1, name: "Adrenal Loop",  desc: "+50% fire rate for 3s after taking a hit.",      apply: s => { s.rage += 1; } },
  { id: "scavenger", family: "Echo",       rarity: 1, name: "Scavenger",     desc: "+15% score, +5% bank bonus.",                    apply: s => { s.bounty *= 1.15; s.interest += 1; } },
  // ---- Cursed (big power, real drawback — SDD §2.7) ----
  { id: "glass",     family: "Ballistics", rarity: 3, cursed: true, name: "Glass Cannon",  desc: "+80% damage. Dash cooldown +1s.",              apply: s => { s.dmg *= 1.8; s.dashPenalty = (s.dashPenalty ?? 0) + 1; } },
  { id: "berserk",   family: "Echo",       rarity: 3, cursed: true, name: "Berserker",     desc: "+40% fire rate. −1 max HP.",                   apply: s => { s.fire *= 1.4; s.maxHp -= 1; } },
  { id: "splburst",  family: "Ballistics", rarity: 3, cursed: true, name: "Scattergun",    desc: "+2 split bullets. −25% damage.",               apply: s => { s.split += 2; s.dmg *= 0.75; } },
  { id: "turtle",    family: "Chassis",    rarity: 3, cursed: true, name: "Turtle Shell",  desc: "+2 max HP (heal 2 now). −15% move speed.",     heal: 2, apply: s => { s.maxHp += 2; s.speed *= 0.85; } },
  { id: "gambler",   family: "Echo",       rarity: 3, cursed: true, name: "Gambler's Coil",desc: "+50% score from kills. Hits DROP your multiplier to ×1.", apply: s => { s.bounty *= 1.5; s.hitFactor = 0; } },
];

export function modById(id) {
  return MODS.find(m => m.id === id) ?? CLASS_MODS.find(m => m.id === id);
}

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
