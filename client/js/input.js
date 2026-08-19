// Input: keyboard+mouse, gamepad, touch — merged into one state object
// {mx,my,ax,ay,buttons} in world axes (SDD §2.2 mappings).

import { BTN } from "/shared/protocol.js";
import { world } from "./game.js";
import { screenToWorld } from "./render.js";

const keys = new Set();
let mouseX = 0, mouseY = 0, mouseDown = false, rmbDown = false;
let bombTap = false, abilTap = false;
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
}

// double-tap-ish dash on touch: quick full deflection after neutral
let lastLMag = 0, dashTapT = 0;

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
  if (mouseDown) buttons |= BTN.FIRE;

  // mouse aim: vector from my ship to cursor, in world space
  if (!touchActive) {
    const w = screenToWorld(mouseX, mouseY);
    const dx = w.x - world.me.x, dy = w.y - world.me.y;
    const len = Math.hypot(dx, dy) || 1;
    ax = dx / len; ay = dy / len;
  }

  // gamepad overrides/merges
  const pads = navigator.getGamepads?.() ?? [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const [lx, ly, rx, ry] = gp.axes;
    if (Math.hypot(lx, ly) > 0.18) { mx = lx; my = ly; }
    if (Math.hypot(rx ?? 0, ry ?? 0) > 0.35) { ax = rx; ay = ry; buttons |= BTN.FIRE; }
    if (gp.buttons[5]?.pressed || gp.buttons[10]?.pressed) buttons |= BTN.DASH; // RB / L3
    if (gp.buttons[4]?.pressed) buttons |= BTN.BOMB;                            // LB
    if (gp.buttons[7]?.pressed || gp.buttons[0]?.pressed) buttons |= BTN.ABILITY; // RT / A
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

  const l = Math.hypot(mx, my);
  if (l > 1) { mx /= l; my /= l; }
  return { mx, my, ax, ay, buttons };
}
