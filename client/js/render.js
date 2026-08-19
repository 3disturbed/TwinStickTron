// Canvas renderer — neon per SDD §2.10/§3.7: pre-baked glow sprites (no
// runtime shadowBlur), additive compositing, pooled particles, trauma
// shake, hitstop. Whole arena fits on screen (letterboxed).

import { ARENA_W, ARENA_H, PILOTS, ZK, PS, PHASE, PLAYER, WAVE, EK, ORBITAL, TICK_DT } from "/shared/constants.js";
import { ENEMIES } from "/shared/enemies.js";
import { CONSUMABLES } from "/shared/consumables.js";
import { PF, EF } from "/shared/protocol.js";
import { world, myHpMax, serverTickNow } from "./game.js";
import { net } from "./net.js";

// player-tunable accessibility settings (SDD §2.11) — main.js loads/saves
export const settings = { shake: 1, flash: true, floor: 0, volume: 0.25 };

let canvas, ctx, W = 0, H = 0, dpr = 1;
let scale = 1, offX = 0, offY = 0;
let trauma = 0, hitstopT = 0, gridPulse = 0, bombFlashT = 0;
let shakeX = 0, shakeY = 0;
let lightCanvas = null, lightCtx = null;

const glowCache = new Map();
const MAX_PARTICLES = 1500;
const particles = [];
const popups = [];

export function initRender(c) {
  canvas = c;
  ctx = canvas.getContext("2d");
  resize();
  addEventListener("resize", resize);
}

export function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const margin = 0.98;
  scale = Math.min(W / ARENA_W, H / ARENA_H) * margin;
  offX = (W - ARENA_W * scale) / 2;
  offY = (H - ARENA_H * scale) / 2;
}

export function screenToWorld(sx, sy) {
  return { x: (sx - offX - shakeX) / scale, y: (sy - offY - shakeY) / scale };
}

// ---------- effects API (called from main's event handling) ----------
export function addTrauma(t) { trauma = Math.min(1, trauma + t); }
export function hitstop(ms) { hitstopT = Math.max(hitstopT, ms / 1000); }
export function isHitstopped() { return hitstopT > 0; }
export function fxBomb() { bombFlashT = 0.25; addTrauma(0.5); }
export function gridMilestone() { gridPulse = 1; }

export function fxKill(x, y, color, big = false) {
  const n = big ? 46 : 14;
  for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (big ? 340 : 220) * (0.3 + Math.random() * 0.7);
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.35 + Math.random() * (big ? 0.5 : 0.25),
      t: 0, color, size: big ? 5 : 3.2,
    });
  }
}

export function fxMuzzle(x, y, angle, color) {
  for (let i = 0; i < 3 && particles.length < MAX_PARTICLES; i++) {
    const a = angle + (Math.random() - 0.5) * 0.6;
    particles.push({
      x: x + Math.cos(angle) * 20, y: y + Math.sin(angle) * 20,
      vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
      life: 0.1, t: 0, color, size: 2.5,
    });
  }
}

export function fxPopup(x, y, text, color) {
  popups.push({ x, y, text, color, life: 0.9, t: 0 });
  if (popups.length > 40) popups.shift();
}

// ---------- glow sprites ----------
function glow(color) {
  let s = glowCache.get(color);
  if (s) return s;
  s = document.createElement("canvas");
  s.width = s.height = 64;
  const g = s.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color + "aa");
  grad.addColorStop(1, "transparent");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, s);
  return s;
}

function blit(img, x, y, size) {
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
}

// ---------- main draw ----------
export function draw(dt) {
  if (hitstopT > 0) { hitstopT -= dt; dt = 0; } // freeze world visuals, still render
  trauma = Math.max(0, trauma - 1.4 * (dt || 0.016));
  gridPulse = Math.max(0, gridPulse - 2 * (dt || 0.016));
  bombFlashT = Math.max(0, bombFlashT - (dt || 0.016));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#05020c";
  ctx.fillRect(0, 0, W, H);

  const sh = trauma * trauma * 22 * settings.shake;
  shakeX = (Math.random() - 0.5) * sh; shakeY = (Math.random() - 0.5) * sh;
  ctx.translate(offX + shakeX, offY + shakeY);
  ctx.scale(scale, scale);

  drawGrid();
  drawZones(dt);
  drawPickups();
  drawBullets(dt);
  drawEnemies();
  drawLasers();
  drawPlayers();
  drawParticles(dt);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // screen space
  drawTheDark();
  drawPopups(dt);
  drawHUD();

  if (bombFlashT > 0 && settings.flash) {
    ctx.fillStyle = `rgba(255,255,255,${bombFlashT * 1.6})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (world.overdrive) {
    const p = settings.flash ? 0.25 + 0.15 * Math.sin(performance.now() / 90) : 0.3;
    ctx.strokeStyle = `rgba(255,228,91,${p})`;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);
  }
}

// ---------- the dark (SDD §2.4): light lives where your fire is ----------
function darknessLevel() {
  let d = 0;
  if (world.wave >= WAVE.DARK_START) d = Math.min(0.78, (world.wave - WAVE.DARK_START + 1) * 0.13);
  for (const e of world.enemies) {
    if (e.kind === EK.ULTRADARK) d = e.flags & EF.ENRAGED ? 0.96 : 0.92;
  }
  return d * (1 - settings.floor);
}

function drawTheDark() {
  const dark = darknessLevel();
  if (dark <= 0.02) return;
  const LS = 0.5; // lightmap at half resolution
  const lw = Math.ceil(W * LS), lh = Math.ceil(H * LS);
  if (!lightCanvas || lightCanvas.width !== lw || lightCanvas.height !== lh) {
    lightCanvas = document.createElement("canvas");
    lightCanvas.width = lw; lightCanvas.height = lh;
    lightCtx = lightCanvas.getContext("2d");
  }
  const g = lightCtx;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, lw, lh);
  g.fillStyle = `rgba(2,1,8,${dark})`;
  g.fillRect(0, 0, lw, lh);
  g.globalCompositeOperation = "destination-out";
  const spr = glow("#ffffff");
  const punch = (wx, wy, r) => {
    const sx = (wx * scale + offX + shakeX) * LS, sy = (wy * scale + offY + shakeY) * LS;
    const s = r * scale * LS * 2;
    g.drawImage(spr, sx - s / 2, sy - s / 2, s, s);
  };
  for (const p of world.players) {
    if (p.state === PS.ALIVE || p.state === PS.DOWNED) {
      punch(p.id === world.myId ? world.me.x : p.x, p.id === world.myId ? world.me.y : p.y, 170);
    }
  }
  let lights = 0;
  for (const b of world.bullets) { punch(b.x, b.y, 90); if (++lights > 220) break; }
  for (const b of world.eBullets) { punch(b.x, b.y, 55); if (++lights > 380) break; }
  for (const z of world.zones) {
    if (z.kind === ZK.BLAST || z.kind === ZK.FLAME || z.kind === ZK.WELL) punch(z.x, z.y, z.r * 1.7);
  }
  for (const e of world.enemies) punch(e.x, e.y, ENEMIES[e.kind]?.boss ? 60 : 24); // eyes stay visible
  ctx.drawImage(lightCanvas, 0, 0, W, H);
}

function drawPickups() {
  const now = performance.now();
  ctx.font = "bold 15px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (const k of world.pickups ?? []) {
    const def = CONSUMABLES[k.kind];
    if (!def) continue;
    // expiring pickups blink (steady-dim when flashes are disabled)
    let a = 1;
    if (k.ttl < 3) a = settings.flash ? (Math.floor(now / 160) % 2 ? 0.25 : 1) : 0.5;
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = "lighter";
    blit(glow(def.color), k.x, k.y, 46);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(k.x, k.y, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.fillText(def.glyph, k.x, k.y + 5);
  }
  ctx.globalAlpha = 1;
}

function drawLasers() {
  const now = performance.now();
  for (const l of world.lasers) {
    if (l.firing) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,61,240,0.9)";
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(l.sx, l.sy); ctx.lineTo(l.tx, l.ty); ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(l.sx, l.sy); ctx.lineTo(l.tx, l.ty); ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    } else {
      const blink = Math.floor(now / 110) % 2 === 0 || !settings.flash;
      ctx.strokeStyle = `rgba(255,61,240,${blink ? 0.55 : 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([14, 10]);
      // telegraph extends through the lock point, arena-length (matches server)
      const dx = l.tx - l.sx, dy = l.ty - l.sy;
      const len = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(l.sx, l.sy);
      ctx.lineTo(l.sx + (dx / len) * 2600, l.sy + (dy / len) * 2600);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawGrid() {
  const bright = 0.10 + gridPulse * 0.22;
  ctx.strokeStyle = `rgba(57,240,255,${bright})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let x = 0; x <= ARENA_W; x += 128) { ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); }
  for (let y = 0; y <= ARENA_H; y += 128) { ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); }
  ctx.stroke();
  ctx.strokeStyle = `rgba(57,240,255,${0.5 + gridPulse * 0.5})`;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, ARENA_W, ARENA_H);
}

function drawZones(dt) {
  for (const z of world.zones) {
    if (z.kind === ZK.WARP) {
      const p = 1 - Math.min(1, z.ttl / 0.5);
      ctx.strokeStyle = `rgba(255,91,110,${0.9 - p * 0.5})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (1.6 - p * 0.6), 0, Math.PI * 2); ctx.stroke();
    } else if (z.kind === ZK.MORTAR_TELE) {
      ctx.strokeStyle = "rgba(255,77,77,0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(255,77,77,0.12)";
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (1 - z.ttl / 1.2), 0, Math.PI * 2); ctx.fill();
    } else if (z.kind === ZK.BLAST) {
      ctx.globalCompositeOperation = "lighter";
      blit(glow("#ffffff"), z.x, z.y, z.r * 3.2 * (1 - z.ttl / 0.25 * 0.4));
      ctx.globalCompositeOperation = "source-over";
    } else if (z.kind === ZK.FLAME) {
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        blit(glow("#ff7a3d"), z.x + (Math.random() - 0.5) * z.r, z.y + (Math.random() - 0.5) * z.r, 60);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(255,122,61,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
    } else if (z.kind === ZK.AEGIS) {
      ctx.strokeStyle = "rgba(184,255,94,0.6)";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(184,255,94,0.05)";
      ctx.fill();
    } else if (z.kind === ZK.WELL) {
      ctx.strokeStyle = "rgba(194,107,250,0.7)";
      ctx.lineWidth = 2;
      const t = performance.now() / 300;
      for (let i = 0; i < 3; i++) {
        const rr = z.r * ((t + i / 3) % 1);
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r - rr, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (z.kind === ZK.DARK) {
      // the Shepherd's herding dark — get out before it bites
      const grad = ctx.createRadialGradient(z.x, z.y, z.r * 0.2, z.x, z.y, z.r);
      grad.addColorStop(0, "rgba(3,1,10,0.92)");
      grad.addColorStop(1, "rgba(3,1,10,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(194,107,250,0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 10]);
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawBullets() {
  ctx.globalCompositeOperation = "lighter";
  for (const b of world.bullets) {
    const color = PILOTS[world.players.find(p => p.id === b.owner)?.pilot ?? 0]?.color ?? "#39f0ff";
    blit(glow(color), b.x, b.y, 26);
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
  }
  for (const b of world.eBullets) {
    blit(glow("#ff5b8e"), b.x, b.y, b.r * 5.5);
    ctx.fillStyle = "#ffd7e5";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.75, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawEnemies() {
  let boss = null;
  // warden shield bubbles under everything (the order-of-kill puzzle, visible)
  for (const e of world.enemies) {
    const def = ENEMIES[e.kind];
    if (def?.shieldR) {
      ctx.strokeStyle = "rgba(143,180,255,0.35)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.arc(e.x, e.y, def.shieldR, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(143,180,255,0.05)";
      ctx.fill();
    }
  }
  for (const e of world.enemies) {
    const def = ENEMIES[e.kind];
    if (!def) continue;
    if (def.boss) boss = { e, def };
    const enraged = e.flags & EF.ENRAGED;
    const phased = e.flags & EF.PHASED;
    const open = e.flags & EF.OPEN;
    const color = open ? "#ffffff" : enraged ? "#ff4d4d" : def.color;
    if (phased) ctx.globalAlpha = 0.3;
    ctx.globalCompositeOperation = "lighter";
    blit(glow(color), e.x, e.y, def.radius * (open ? 5.5 : 4));
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color;
    ctx.fillStyle = "#0a0416";
    ctx.lineWidth = open ? 4 : 2.5;
    shapePath(def.shape, e.x, e.y, def.radius, performance.now() / 1000 + e.id);
    ctx.fill(); ctx.stroke();
    if (phased) ctx.globalAlpha = 1;
    // eyes stay visible (readable chaos)
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(2.5, def.radius * 0.18), 0, Math.PI * 2); ctx.fill();
    if (def.boss || e.hpPct < 100) {
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(e.x - def.radius, e.y - def.radius - 10, def.radius * 2, 4);
      ctx.fillStyle = color;
      ctx.fillRect(e.x - def.radius, e.y - def.radius - 10, def.radius * 2 * (e.hpPct / 100), 4);
    }
  }
  if (boss) {
    // boss bar top-center (world space top)
    const bw = ARENA_W * 0.4;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(ARENA_W / 2 - bw / 2, 18, bw, 12);
    ctx.fillStyle = boss.e.flags & EF.ENRAGED ? "#ff4d4d" : boss.def.color;
    ctx.fillRect(ARENA_W / 2 - bw / 2, 18, bw * (boss.e.hpPct / 100), 12);
    ctx.font = "bold 22px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.fillText(boss.def.name, ARENA_W / 2, 52);
  }
}

function shapePath(shape, x, y, r, t) {
  ctx.beginPath();
  if (shape === "circle" || shape === "dot") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  } else if (shape === "hex" || shape === "hexring") {
    for (let i = 0; i < 6; i++) {
      const a = t * 0.4 + (i / 6) * Math.PI * 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (shape === "gear") {
    for (let i = 0; i < 16; i++) {
      const a = t * 2 + (i / 16) * Math.PI * 2;
      const rr = i % 2 ? r : r * 0.62;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (shape === "square" || shape === "block") {
    const s = r * 0.9;
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else if (shape === "tri") {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x - r * 0.7, y + r * 0.8);
    ctx.lineTo(x - r * 0.7, y - r * 0.8);
    ctx.closePath();
  } else if (shape === "pent") {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (shape === "ring") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x + r * 0.55, y);
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2, true);
  } else if (shape === "crescent") {
    ctx.arc(x, y, r, Math.PI * 0.25, Math.PI * 1.75);
    ctx.quadraticCurveTo(x + r * 0.2, y, x + Math.cos(Math.PI * 0.25) * r, y + Math.sin(Math.PI * 0.25) * r);
  } else if (shape === "ghost") {
    ctx.arc(x, y, r, Math.PI, 0);
    ctx.lineTo(x + r, y + r * 0.8);
    ctx.lineTo(x + r * 0.5, y + r * 0.5);
    ctx.lineTo(x, y + r * 0.9);
    ctx.lineTo(x - r * 0.5, y + r * 0.5);
    ctx.lineTo(x - r, y + r * 0.8);
    ctx.closePath();
  }
}

function drawPlayers() {
  for (const p of world.players) {
    const pilot = PILOTS[p.pilot] ?? PILOTS[0];
    const mine = p.id === world.myId;
    const x = mine ? world.me.x : p.x;
    const y = mine ? world.me.y : p.y;
    const aim = mine ? world.me.aim : p.aim;

    if (p.state === PS.SPECTATING) continue;
    if (p.state === PS.OUT) continue;
    if (p.state === PS.DOWNED) {
      // downed core: pulsing ring + revive arc
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 160);
      ctx.globalCompositeOperation = "lighter";
      blit(glow(pilot.color), x, y, 60 * pulse);
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = pilot.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.stroke();
      if (p.flags & PF.REVIVING) {
        ctx.strokeStyle = "#b8ff5e";
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(x, y, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((performance.now() / 500) % 1)); ctx.stroke();
      }
      ctx.font = "12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.fillText("DOWNED", x, y - 34);
      continue;
    }

    const flicker = (p.flags & PF.IFRAMES) && Math.floor(performance.now() / 70) % 2 === 0;
    if (flicker && !mine) continue;
    ctx.globalAlpha = flicker ? 0.45 : 1;
    ctx.globalCompositeOperation = "lighter";
    blit(glow(pilot.color), x, y, 64);
    ctx.globalCompositeOperation = "source-over";
    // orbital blades — rendered from the same tick formula the server
    // damages with, so what you see is what shreds
    if (p.orbitals > 0) {
      const k = p.orbitals;
      const base = serverTickNow() * TICK_DT * ORBITAL.ROT;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < k; i++) {
        const a = base + (i / k) * Math.PI * 2;
        const ox = x + Math.cos(a) * ORBITAL.R, oy = y + Math.sin(a) * ORBITAL.R;
        blit(glow("#e8fbff"), ox, oy, 34);
        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate(a * 6);
        ctx.fillStyle = "#e8fbff";
        ctx.beginPath();
        ctx.moveTo(9, 0); ctx.lineTo(0, 4); ctx.lineTo(-9, 0); ctx.lineTo(0, -4);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(232,251,255,0.14)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, ORBITAL.R, 0, Math.PI * 2); ctx.stroke();
    }
    // ship triangle
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(aim);
    ctx.strokeStyle = pilot.color;
    ctx.fillStyle = "#0a0416";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(-11, 10); ctx.lineTo(-6, 0); ctx.lineTo(-11, -10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // class symbol at the arrow's centre — upright regardless of aim
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = pilot.color;
    ctx.fillText(pilot.symbol, x - 1, y + 4);
    ctx.globalAlpha = 1;
    if (!mine) {
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(nameOf(p.id), x, y - 24);
    }
  }
}

const names = new Map();
export function setNames(roster) {
  names.clear();
  for (const r of roster) names.set(r.id, r.name);
}
function nameOf(id) { return names.get(id) ?? "PILOT"; }

function drawParticles(dt) {
  ctx.globalCompositeOperation = "lighter";
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.94; p.vy *= 0.94;
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = a;
    blit(glow(p.color), p.x, p.y, p.size * 8 * a + 4);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawPopups(dt) {
  ctx.font = "bold 15px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    if (p.t >= p.life) { popups.splice(i, 1); continue; }
    const sx = p.x * scale + offX, sy = (p.y - 30 - p.t * 50) * scale + offY;
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, sx, sy);
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  if (world.phase === PHASE.LOBBY) return;
  const pad = 14;
  ctx.textAlign = "left";
  // score
  ctx.font = "bold 20px ui-monospace, monospace";
  ctx.fillStyle = "#ffe45b";
  ctx.fillText(fmt(world.banked), pad, 30);
  ctx.font = "bold 15px ui-monospace, monospace";
  ctx.fillStyle = world.unbanked > 0 ? "#ffffff" : "#66779c";
  ctx.fillText(`+${fmt(world.unbanked)} AT RISK`, pad, 52);
  // multiplier bar
  const mw = 180;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(pad, 62, mw, 8);
  const mf = (world.mult - 1) / 9;
  ctx.fillStyle = world.overdrive ? "#ffe45b" : "#39f0ff";
  ctx.fillRect(pad, 62, mw * mf, 8);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px ui-monospace, monospace";
  ctx.fillText(`×${world.mult.toFixed(1)}${world.overdrive ? " OVERDRIVE" : ""}`, pad + mw + 8, 71);
  // wave (top right)
  ctx.textAlign = "right";
  ctx.font = "bold 20px ui-monospace, monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText(`WAVE ${world.wave}`, W - pad, 30);
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillStyle = "#8fa3c8";
  if (world.phase === PHASE.WAVE) ctx.fillText(`${world.enemiesLeft} HOSTILES`, W - pad, 50);
  if (net.rttMs) ctx.fillText(`${net.rttMs}ms`, W - pad, H - 10);
  // hp pips (bottom left) — max grows with Plating/Turtle mods
  const pips = myHpMax();
  for (let i = 0; i < pips; i++) {
    ctx.fillStyle = i < world.myHp ? "#ff5b6e" : "rgba(255,255,255,0.15)";
    ctx.fillRect(pad + i * 26, H - 30, 20, 14);
  }
  // consumable slots (bottom centre) — F / gamepad X / touch ✚ to use
  const cons = world.myCons ?? [];
  const slotW = 36, total = 3 * (slotW + 6);
  for (let i = 0; i < 3; i++) {
    const sx = W / 2 - total / 2 + i * (slotW + 6);
    const kind = cons[i];
    const def = kind ? CONSUMABLES[kind] : null;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(sx, H - 46, slotW, 32);
    ctx.strokeStyle = def ? def.color : "rgba(255,255,255,0.15)";
    ctx.lineWidth = i === 0 && def ? 2.5 : 1;
    ctx.strokeRect(sx, H - 46, slotW, 32);
    if (def) {
      ctx.font = "bold 16px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.fillText(def.glyph, sx + slotW / 2, H - 24);
    }
  }
  if (cons.length) {
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#66779c";
    ctx.fillText("F · USE", W / 2, H - 52);
  }
  // stasis indicator
  if (world.stasis > 0) {
    ctx.strokeStyle = "rgba(143,180,255,0.5)";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.font = "bold 15px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb4ff";
    ctx.fillText(`❄ STASIS ${world.stasis.toFixed(1)}s`, W / 2, 30);
  }
  // bombs + dash + ability (bottom right)
  ctx.textAlign = "right";
  ctx.font = "16px ui-monospace, monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText(`💣 ${world.myBombs}`, W - pad, H - 44);
  ctx.fillStyle = world.myDashCd <= 0.05 ? "#39f0ff" : "rgba(255,255,255,0.25)";
  ctx.fillText("DASH", W - pad, H - 66);
  ctx.fillStyle = world.myAbilCd <= 0 ? "#c26bfa" : "rgba(255,255,255,0.25)";
  ctx.fillText(world.myAbilCd <= 0 ? "✦ READY" : `✦ ${world.myAbilCd}s`, W - pad, H - 88);
}

function fmt(n) { return n.toLocaleString("en-US"); }
