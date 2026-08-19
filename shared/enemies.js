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
    hp: 6, speed: 42, score: 40, cost: 12, ai: "seek",
    onDeath: { split: EK.MITE, count: 4 },
  },
  [EK.SPINNER]: {
    name: "Spinner", shape: "gear", radius: 16, color: "#ffe45b",
    hp: 3, speed: 70, score: 30, cost: 9, ai: "wander",
    onDeath: { pattern: "RING" },   // position before you kill (SDD §2.5)
  },
  [EK.MORTAR]: {
    name: "Mortar", shape: "square", radius: 18, color: "#c26bfa",
    hp: 4, speed: 20, score: 35, cost: 10, ai: "mortar",
    fireEvery: 4.0, shellDelay: 1.2, shellRadius: 90, // telegraphed AoE
  },
  [EK.BRUTE_PRIME]: {
    name: "BRUTE PRIME", shape: "hex", radius: 52, color: "#ff4d4d",
    hp: 60, speed: 30, score: 500, cost: 0, ai: "boss_brute",
    boss: true, fireEvery: 4.0,
    onDeath: { split: EK.MITE, count: 6 },
  },
  [EK.HEX_PRIME]: {
    name: "HEXAGON PRIME", shape: "hexring", radius: 56, color: "#39f0ff",
    hp: 90, speed: 14, score: 1000, cost: 0, ai: "boss_hex",
    boss: true, fireEvery: 0.55,   // rotating spokes cadence
  },
};

export function enemyDef(kind) { return ENEMIES[kind]; }
