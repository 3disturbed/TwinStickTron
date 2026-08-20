// The post-boss Core Shop catalog. Items use s_* ids and resolve through
// modById() in mods.js, so a purchase is just an id pushed into p.mods —
// every stat-recompute site (server and client) applies it for free.
// `pilot: null` = any class. `once` items can be bought one time per run.
// `heal`/`bombs` are immediate effects applied at purchase by the server.
// IMPORTANT: shop.js must not import from mods.js (mods.js imports us).

export const SHOP_ITEMS = [
  // ---- BINK ✦ ----
  { id: "s_b_twin",   pilot: 0, price: 60, once: true, name: "Twin SMG",      desc: "+1 bullet stream, −15% damage.",                     apply: s => { s.split += 1; s.dmg *= 0.85; } },
  { id: "s_b_press",  pilot: 0, price: 40, once: true, name: "Overpressure",  desc: "SMG jitter halved, +10% damage.",                    apply: s => { s.jitterMul *= 0.5; s.dmg *= 1.1; } },
  { id: "s_b_phase",  pilot: 0, price: 70, once: true, name: "Phase Runner",  desc: "Blink cooldown −3s, blink i-frames +0.2s.",          apply: s => { s.abilityCdr += 3; s.blinkIframe += 0.2; } },
  // ---- BLAZE ▲ ----
  { id: "s_z_slug",   pilot: 1, price: 80, once: true, name: "Slug Shot",     desc: "Pellets fuse into ONE slug: dmg 5, range ×2.5.",     apply: s => { s.slugShot = 1; } },
  { id: "s_z_dragon", pilot: 1, price: 70, once: true, name: "Dragon's Breath", desc: "Pellets ignite enemies (burn over 2s).",           apply: s => { s.burn += 1; } },
  { id: "s_z_choke",  pilot: 1, price: 50, once: true, name: "Full Choke",    desc: "Cone 50% tighter, +30% damage.",                     apply: s => { s.chokeMul *= 0.5; s.dmg *= 1.3; } },
  // ---- AMBER ◯ ----
  { id: "s_a_sanct",  pilot: 2, price: 70, once: true, name: "Sanctuary",     desc: "Allies near your beacon heal +1 every 4s.",          apply: s => { s.sanctuary += 1; } },
  { id: "s_a_radia",  pilot: 2, price: 90, once: true, name: "Radiant Aura",  desc: "Your aura also burns enemies inside it.",            apply: s => { s.radiantAura += 1; } },
  { id: "s_a_blast",  pilot: 2, price: 60, once: true, name: "Beacon Blast",  desc: "Warping detonates your departure point.",            apply: s => { s.beaconBlast += 1; } },
  // ---- DAVE ◉ ----
  { id: "s_d_whirl",  pilot: 3, price: 90, once: true, name: "Whirlwind",     desc: "Cleave hits ALL around you (360°).",                 apply: s => { s.cleave360 = 1; } },
  { id: "s_d_shock",  pilot: 3, price: 60, once: true, name: "Aftershock",    desc: "Each cleave launches a shockwave slug.",             apply: s => { s.aftershock += 1; } },
  { id: "s_d_bulw",   pilot: 3, price: 70, once: true, heal: 2, name: "Bulwark", desc: "+2 max HP (heal 2 now).",                         apply: s => { s.maxHp += 2; } },
  // ---- SPARKS ⌁ ----
  { id: "s_s_cond",   pilot: 4, price: 60, once: true, name: "Conductor",     desc: "Chain lightning jumps +1 more time.",                apply: s => { s.chainHops += 1; } },
  { id: "s_s_volt",   pilot: 4, price: 70, once: true, name: "High Voltage",  desc: "Chain hops deal 80% damage (was 50%).",              apply: s => { s.chainDmgBonus += 0.3; } },
  { id: "s_s_twin",   pilot: 4, price: 80, once: true, name: "Twin Pylon",    desc: "Deploy 2 pylons per cast.",                          apply: s => { s.pylonCount += 1; } },
  // ---- RIGG ⚒ ----
  { id: "s_r_twin",   pilot: 5, price: 80, once: true, name: "Twin Turret",   desc: "Deploy 2 turrets per cast.",                         apply: s => { s.turretCount += 1; } },
  { id: "s_r_watch",  pilot: 5, price: 50, once: true, name: "Long Watch",    desc: "Turrets last twice as long.",                        apply: s => { s.turretTtlMul *= 2; } },
  { id: "s_r_cal",    pilot: 5, price: 70, once: true, name: "Heavy Caliber", desc: "Turret damage ×1.8.",                                apply: s => { s.turretDmgMul *= 1.8; } },
  // ---- KELVIN ❄ ----
  { id: "s_k_deep",   pilot: 6, price: 60, once: true, name: "Deep Freeze",   desc: "Chill lasts twice as long and slows harder.",        apply: s => { s.chillDurMul *= 2; s.chillSlow = Math.min(s.chillSlow, 0.4); } },
  { id: "s_k_shat",   pilot: 6, price: 90, once: true, name: "Shatter",       desc: "Chilled/frozen enemies take +75% damage from you.",  apply: s => { s.shatter += 1; } },
  { id: "s_k_cryo",   pilot: 6, price: 70, once: true, name: "Cryo Nova",     desc: "Frost Nova 50% larger, freeze +0.5s.",               apply: s => { s.frostRMul *= 1.5; s.frostDurBonus += 0.5; } },
  // ---- HAWK ⌖ ----
  { id: "s_h_pen",    pilot: 7, price: 90, once: true, name: "Overpenetrate", desc: "Rails pierce EVERYTHING.",                           apply: s => { s.pierce += 96; } },
  { id: "s_h_head",   pilot: 7, price: 70, once: true, name: "Headhunter",    desc: "+60% damage to elites and bosses.",                  apply: s => { s.headhunter += 1; } },
  { id: "s_h_storm",  pilot: 7, price: 60, once: true, name: "Railstorm",     desc: "Triple Rail fires 5 rails; cooldown −2s.",           apply: s => { s.railShots += 2; s.abilityCdr += 2; } },
  // ---- ANY CLASS ----
  { id: "s_g_plate",  pilot: null, price: 50, once: true,  heal: 1, name: "Plating Kit",     desc: "+1 max HP (heal 1 now).",             apply: s => { s.maxHp += 1; } },
  { id: "s_g_bombs",  pilot: null, price: 30, once: false, bombs: 2, name: "Bomb Rack",      desc: "+2 smart bombs, right now.",          apply: () => { } },
  { id: "s_g_adren",  pilot: null, price: 25, once: false, heal: 99, name: "Adrenal Injector", desc: "Full heal, right now.",             apply: () => { } },
  { id: "s_g_jets",   pilot: null, price: 45, once: true,  name: "Boot Jets",       desc: "+8% move speed.",                              apply: s => { s.speed *= 1.08; } },
];

export function shopItemById(id) { return SHOP_ITEMS.find(i => i.id === id); }

// The personal storefront: your class's items + the generics.
export function shopFor(pilot) {
  return SHOP_ITEMS.filter(i => i.pilot === null || i.pilot === pilot);
}
