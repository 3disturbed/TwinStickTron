// Input: keyboard+mouse, gamepad, touch — merged into one state object
// {mx,my,ax,ay,buttons} in world axes (SDD §2.2 mappings).

import { BTN } from "/shared/protocol.js";
import { world } from "./game.js";
import { screenToWorld } from "./render.js";

const keys = new Set();
let mouseX = 0, mouseY = 0, mouseDown = false, rmbDown = false;
let bombTap = false, abilTap = false, useTap = false;
const touch = { l: null, r: null, lx: 0, ly: 0, rx: 0, ry: 0 };
export let touchActive = false;

export function initInput(canvas) {
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  canvas.addEventListener("mousemove", (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) { rmbDown = true; bombTap = true; }
  });
  addEventListener("mouseup", (e) => {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) rmbDown = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // touch: left half = move stick, right half = aim/fire stick
  const stickL = document.getElementById("stick-l");
  const stickR = document.getElementById("stick-r");
  const RADIUS = 55;
  canvas.addEventListener("touchstart", (e) => {
    touchActive = true;
    document.getElementById("touch-ui").classList.remove("hidden");
    for (const t of e.changedTouches) {
      const side = t.clientX < innerWidth / 2 ? "l" : "r";
      if (!touch[side]) {
        touch[side] = { id: t.identifier, ox: t.clientX, oy: t.clientY };
        const el = side === "l" ? stickL : stickR;
        el.style.left = (t.clientX - RADIUS) + "px";
        el.style.top = (t.clientY - RADIUS) + "px";
        el.style.right = "auto"; el.style.bottom = "auto";
      }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      for (const side of ["l", "r"]) {
        const s = touch[side];
        if (s && s.id === t.identifier) {
          const dx = (t.clientX - s.ox) / RADIUS, dy = (t.clientY - s.oy) / RADIUS;
          const len = Math.hypot(dx, dy) || 1;
          const cl = len > 1 ? 1 / len : 1;
          touch[side === "l" ? "lx" : "rx"] = dx * cl;
          touch[side === "l" ? "ly" : "ry"] = dy * cl;
          const el = (side === "l" ? stickL : stickR).firstElementChild;
          el.style.transform = `translate(${dx * cl * 30}px, ${dy * cl * 30}px)`;
        }
      }
    }
    e.preventDefault();
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      for (const side of ["l", "r"]) {
        const s = touch[side];
        if (s && s.id === t.identifier) {
          touch[side] = null;
          touch[side === "l" ? "lx" : "rx"] = 0;
          touch[side === "l" ? "ly" : "ry"] = 0;
          (side === "l" ? stickL : stickR).firstElementChild.style.transform = "";
        }
      }
    }
  };
  canvas.addEventListener("touchend", endTouch);
  canvas.addEventListener("touchcancel", endTouch);
  document.getElementById("tbtn-bomb").addEventListener("touchstart", (e) => { bombTap = true; e.preventDefault(); }, { passive: false });
  document.getElementById("tbtn-abil").addEventListener("touchstart", (e) => { abilTap = true; e.preventDefault(); }, { passive: false });
  document.getElementById("tbtn-use").addEventListener("touchstart", (e) => { useTap = true; e.preventDefault(); }, { passive: false });
}

// double-tap-ish dash on touch: quick full deflection after neutral
let lastLMag = 0, dashTapT = 0;

// ---------- couch co-op pad management ----------
// Pads are CLAIMED: the first active pad belongs to P1 (merged with
// keyboard/mouse, as ever). Any *unclaimed* pad pressing START becomes a
// new local player. main.js polls detectPadJoin() each frame.
const padClaims = new Map(); // padIndex -> "p1" | seat object marker
const padStartPrev = new Map();

export function claimPad(index, owner) { padClaims.set(index, owner); }
export function releasePad(index) { padClaims.delete(index); }

function livePads() {
  return [...(navigator.getGamepads?.() ?? [])].filter(gp => gp && gp.connected);
}

export function detectPadJoin() {
  for (const gp of livePads()) {
    const start = !!gp.buttons[9]?.pressed;
    const prev = padStartPrev.get(gp.index) ?? false;
    padStartPrev.set(gp.index, start);
    if (start && !prev && !padClaims.has(gp.index)) return gp.index;
  }
  return null;
}

// Read ONE pad as a full input state (a couch seat's whole controller)
export function pollPad(index) {
  let mx = 0, my = 0, ax = 1, ay = 0, buttons = 0;
  const gp = navigator.getGamepads?.()[index];
  if (gp && gp.connected) {
    const [lx, ly, rx, ry] = gp.axes;
    if (Math.hypot(lx, ly) > 0.18) { mx = lx; my = ly; }
    if (Math.hypot(rx ?? 0, ry ?? 0) > 0.35) { ax = rx; ay = ry; buttons |= BTN.FIRE; }
    if (gp.buttons[5]?.pressed || gp.buttons[10]?.pressed) buttons |= BTN.DASH; // RB / L3
    if (gp.buttons[4]?.pressed) buttons |= BTN.BOMB;                            // LB
    if (gp.buttons[7]?.pressed || gp.buttons[0]?.pressed) buttons |= BTN.ABILITY; // RT / A
    if (gp.buttons[2]?.pressed) buttons |= BTN.USE;                             // X — consumable
  }
  return { mx, my, ax, ay, buttons };
}

// D-pad/A edges for menu (draft) navigation by a couch seat's pad
const padNavPrev = new Map();
export function pollPadNav(index) {
  const gp = navigator.getGamepads?.()[index];
  const cur = {
    left: !!gp?.buttons[14]?.pressed, right: !!gp?.buttons[15]?.pressed,
    confirm: !!gp?.buttons[0]?.pressed,
  };
  const prev = padNavPrev.get(index) ?? { left: false, right: false, confirm: false };
  padNavPrev.set(index, cur);
  return {
    left: cur.left && !prev.left,
    right: cur.right && !prev.right,
    confirm: cur.confirm && !prev.confirm,
  };
}

export function pollInput() {
  let mx = 0, my = 0, ax = 0, ay = 0, buttons = 0;

  // keyboard
  if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
  if (keys.has("Space") || keys.has("ShiftLeft") || keys.has("ShiftRight")) buttons |= BTN.DASH;
  if (keys.has("KeyE")) buttons |= BTN.BOMB;
  if (keys.has("KeyQ")) buttons |= BTN.ABILITY;
  if (keys.has("KeyF")) buttons |= BTN.USE;
  if (mouseDown) buttons |= BTN.FIRE;

  // mouse aim: vector from my ship to cursor, in world space
  if (!touchActive) {
    const w = screenToWorld(mouseX, mouseY);
    const dx = w.x - world.me.x, dy = w.y - world.me.y;
    const len = Math.hypot(dx, dy) || 1;
    ax = dx / len; ay = dy / len;
  }

  // P1's own pad (first active unclaimed pad claims to P1; claimed-by-seat
  // pads are strictly hands-off)
  for (const gp of livePads()) {
    const owner = padClaims.get(gp.index);
    if (owner !== undefined && owner !== "p1") continue;
    if (owner === undefined) {
      const [lx, ly, rx, ry] = gp.axes;
      const active = Math.hypot(lx, ly) > 0.18 || Math.hypot(rx ?? 0, ry ?? 0) > 0.35 ||
        gp.buttons.some(b => b.pressed);
      if (!active || [...padClaims.values()].includes("p1")) continue;
      padClaims.set(gp.index, "p1");
    }
    const p = pollPad(gp.index);
    if (Math.hypot(p.mx, p.my) > 0.18) { mx = p.mx; my = p.my; }
    if (p.buttons & BTN.FIRE) { ax = p.ax; ay = p.ay; }
    buttons |= p.buttons;
    break;
  }

  // touch merges
  if (touchActive) {
    if (Math.hypot(touch.lx, touch.ly) > 0.12) { mx = touch.lx; my = touch.ly; }
    if (Math.hypot(touch.rx, touch.ry) > 0.25) { ax = touch.rx; ay = touch.ry; buttons |= BTN.FIRE; }
    // flick dash: stick snaps from neutral to full deflection
    const mag = Math.hypot(touch.lx, touch.ly);
    const now = performance.now();
    if (mag > 0.95 && lastLMag < 0.2 && now - dashTapT > 400) { dashTapT = now; }
    if (now - dashTapT < 120) buttons |= BTN.DASH;
    lastLMag = mag;
  }
  if (bombTap) { buttons |= BTN.BOMB; bombTap = false; }
  if (abilTap) { buttons |= BTN.ABILITY; abilTap = false; }
  if (useTap) { buttons |= BTN.USE; useTap = false; }

  const l = Math.hypot(mx, my);
  if (l > 1) { mx /= l; my /= l; }
  return { mx, my, ax, ay, buttons };
}
