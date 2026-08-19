// Enemy definitions — data both sides need: the client renders from this
// (shape/radius/color), the server drives behaviour from it (speed/hp/ai).
// Silhouette-per-role and telegraph rules per SDD §2.5.

import { EK } from "./constants.js";

export const ENEMIES = {
  [EK.DRONE]: {
    name: "Drone", shape: "circle", radius: 13, color: "#ff5b6e",
    hp: 1, speed: 65, score: 10, cost: 3, ai: "seek",
  },
  [EK.MITE]: {
    name: "Mite", shape: "dot", radius: 8, color: "#ffb15b",
    hp: 1, speed: 150, score: 5, cost: 2, ai: "seek",
  },
  [EK.WEAVER]: {
    name: "Weaver", shape: "diamond", radius: 14, color: "#5bd0ff",
    hp: 2, speed: 85, score: 25, cost: 7, ai: "weave",
    fireEvery: 3.2, pattern: "FAN",
  },
  [EK.BRUTE]: {
    name: "Brute", shape: "hex", radius: 26, color: "#ff8c5b",
    hp: 6, speed: 42, score: 40, cost: 12, ai: "seek", dropChance: 0.20,
    onDeath: { split: EK.MITE, count: 4 },
  },
  [EK.SPINNER]: {
    name: "Spinner", shape: "gear", radius: 16, color: "#ffe45b",
    hp: 3, speed: 70, score: 30, cost: 9, ai: "wander", dropChance: 0.15,
    onDeath: { pattern: "RING" },   // position before you kill (SDD §2.5)
  },
  [EK.MORTAR]: {
    name: "Mortar", shape: "square", radius: 18, color: "#c26bfa",
    hp: 4, speed: 20, score: 35, cost: 10, ai: "mortar", dropChance: 0.20,
    fireEvery: 4.0, shellDelay: 1.2, shellRadius: 90, // telegraphed AoE
  },
  [EK.SNIPER]: {
    name: "Sniper", shape: "tri", radius: 15, color: "#ff3df0",
    hp: 3, speed: 18, score: 45, cost: 11, ai: "sniper", dropChance: 0.20,
    fireEvery: 5.0, aimTime: 1.1, // sightline telegraph, then instant beam
  },
  [EK.LEECH]: {
    name: "Leech", shape: "crescent", radius: 12, color: "#5bffc9",
    hp: 2, speed: 125, score: 20, cost: 6, ai: "leech",
    drain: 1.5, // contact drains multiplier instead of health (SDD §2.5)
  },
  [EK.WARDEN]: {
    name: "Warden", shape: "pent", radius: 20, color: "#8fb4ff",
    hp: 5, speed: 35, score: 50, cost: 13, ai: "warden", dropChance: 0.30,
    shieldR: 140, // projects shield bubbles onto nearby enemies
  },
  [EK.FORGE]: {
    name: "Forge", shape: "block", radius: 24, color: "#ffb15b",
    hp: 8, speed: 0, score: 60, cost: 16, ai: "forge", dropChance: 0.35,
    spawnEvery: 6, // the wave won't end while it lives
  },
  [EK.GHOST]: {
    name: "Ghost", shape: "ghost", radius: 15, color: "#c9d8ff",
    hp: 3, speed: 100, score: 40, cost: 10, ai: "ghost", dropChance: 0.15,
    phaseTime: 3.0, windowTime: 1.6, pattern: "FAN", // vulnerable only while firing
  },
  [EK.MAGNET]: {
    name: "Magnet", shape: "ring", radius: 18, color: "#ffe45b",
    hp: 4, speed: 28, score: 35, cost: 10, ai: "magnet", dropChance: 0.20,
    pullR: 420, pull: 70, // drags players toward it (into other threats)
  },
  [EK.BRUTE_PRIME]: {
    name: "BRUTE PRIME", shape: "hex", radius: 52, color: "#ff4d4d",
    hp: 60, speed: 30, score: 500, cost: 0, ai: "boss_brute", dropChance: 1,
    boss: true, fireEvery: 4.0,
    onDeath: { split: EK.MITE, count: 6 },
  },
  [EK.HEX_PRIME]: {
    name: "HEXAGON PRIME", shape: "hexring", radius: 56, color: "#39f0ff",
    hp: 90, speed: 14, score: 1000, cost: 0, ai: "boss_hex", dropChance: 1,
    boss: true, fireEvery: 0.55,   // rotating spokes cadence
  },
  [EK.FOUNDRY]: {
    name: "FOUNDRY", shape: "block", radius: 60, color: "#ff8c5b",
    hp: 120, speed: 6, score: 1600, cost: 0, ai: "boss_foundry", dropChance: 1,
    boss: true, doorClosed: 8, doorOpen: 3, spawnCount: 4, // vulnerable only while doors are open
  },
  [EK.SHEPHERD]: {
    name: "NULL SHEPHERD", shape: "ring", radius: 54, color: "#c26bfa",
    hp: 140, speed: 26, score: 2200, cost: 0, ai: "boss_shepherd", dropChance: 1,
    boss: true, fireEvery: 3.0, darkEvery: 5.0, // herds with expanding darkness
  },
  [EK.ULTRADARK]: {
    name: "THE ULTRADARK", shape: "hexring", radius: 68, color: "#7a5cff",
    hp: 180, speed: 34, score: 5000, cost: 0, ai: "boss_ultra", dropChance: 1,
    boss: true, fireEvery: 0.8, // lights out — your muzzle flash is the torch
  },
};

export function enemyDef(kind) { return ENEMIES[kind]; }
