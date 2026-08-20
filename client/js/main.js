// UltraDark client bootstrap: screens flow, the render loop, the 30 Hz
// input pump, and the event → juice wiring.

import { PHASE, PS, PLAYER, WAVE, PILOTS, ARENA_W, ARENA_H } from "/shared/constants.js";
import { ENEMIES } from "/shared/enemies.js";
import { CONSUMABLES, CK } from "/shared/consumables.js";
import { computeStats } from "/shared/mods.js";
import { SHOP_ITEMS, shopItemById } from "/shared/shop.js";
import { BTN, PROTO } from "/shared/protocol.js";
import { net, createRoom, connect, sendInput, sendAction, connectExtra } from "./net.js";
import { world, onSnapshot, handleEvent, resetForRun, inGame } from "./game.js";
import * as game from "./game.js";
import { initInput, pollInput, detectPadJoin, pollPad, pollPadNav, claimPad, releasePad } from "./input.js";
import * as R from "./render.js";
import { settings } from "./render.js";
import * as UI from "./ui.js";
import { ensureAudio, sfx, setVolume } from "./audio.js";

const canvas = document.getElementById("game");
R.initRender(canvas);
initInput(canvas);
UI.bindButtons();

// ---------- boot / URL ----------
const joinCode = (location.pathname.match(/^\/j\/([A-Za-z0-9]{4,8})/) || [])[1]?.toUpperCase() ?? null;
const saved = JSON.parse(localStorage.getItem("ultradark") ?? "{}");
world.myPilot = saved.pilot ?? 0;
UI.initMenu(joinCode, { name: saved.name, pilot: world.myPilot });

// ---------- challenge links (/c/<base64url{n,s,w,x}>) ----------
let challengeBeaten = false;
let lastEnd = null; // final gameover/victory event, for building challenge links

const challengeBlob = (location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/) || [])[1];
if (challengeBlob) {
  try {
    const ch = JSON.parse(atob(challengeBlob.replace(/-/g, "+").replace(/_/g, "/")));
    if (ch && Number.isFinite(ch.s) && Number.isFinite(ch.x)) {
      world.challenge = { n: String(ch.n ?? "A RIVAL").slice(0, 12), s: ch.s, w: ch.w | 0, seed: ch.x >>> 0 };
      UI.showChallengeBanner(world.challenge);
    }
  } catch { /* malformed blob → plain menu */ }
}

UI.bindChallenge(async () => {
  ensureAudio(); persist();
  pendingAutoStart = true;
  UI.menuMessage("Loading the challenger's waves…");
  try {
    const r = await createRoom("challenge", { seed: world.challenge.seed });
    world.code = r.code;
    world.joinUrl = `${location.origin}/j/${r.code}`;
    history.replaceState(null, "", `/j/${r.code}`);
    doConnect(r.code);
  } catch {
    UI.menuMessage("Could not start the challenge. Retry?");
  }
});

function challengeLink(end) {
  const payload = { n: UI.getName(), s: end.score, w: end.wave, x: end.seed >>> 0 };
  const blob = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${location.origin}/c/${blob}`;
}

async function shareChallenge() {
  if (!lastEnd || lastEnd.score <= 0) { UI.toast("Finish a scoring run first."); return; }
  const url = challengeLink(lastEnd);
  const text = `⚔ I scored ${lastEnd.score.toLocaleString("en-US")} in UltraDark. Same waves, one click — beat me:`;
  if (navigator.share) {
    try { await navigator.share({ title: "UltraDark Challenge", text, url }); return; } catch { /* fallthrough */ }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); UI.toast("⚔ Challenge link copied — send it!"); }
  catch { UI.toast(url, 6000); }
}
document.getElementById("btn-challenge").onclick = shareChallenge;

// ---------- settings (SDD §2.11), persisted ----------
Object.assign(settings, JSON.parse(localStorage.getItem("ultradark-settings") ?? "{}"));
setVolume(settings.volume);
UI.bindSettings(settings, () => {
  localStorage.setItem("ultradark-settings", JSON.stringify(settings));
  setVolume(settings.volume);
});

function leaveOverlay() { // where DONE/BACK returns to
  if (net.connected && world.phase === PHASE.LOBBY) UI.showScreen("screen-lobby");
  else if (net.connected && inGame()) UI.hideScreens();
  else UI.showScreen("screen-menu");
}
// Core Shop navigation (P1)
document.getElementById("btn-tab-shop").onclick = () => {
  if (world.shopOffer) UI.showShop(world.shopOffer, world.myCores, world.myMods);
};
document.getElementById("btn-tab-draft").onclick = () => UI.showScreen("screen-draft");
document.getElementById("btn-shop-ready").onclick = () => UI.ui.onAction?.({ t: "shop_done" });

document.getElementById("btn-settings").onclick = () => { ensureAudio(); UI.openSettings(settings); };
document.getElementById("btn-settings-done").onclick = leaveOverlay;
document.getElementById("btn-lb-done").onclick = leaveOverlay;
document.getElementById("btn-lb").onclick = () => {
  UI.openLeaderboard(async (mode, period) => {
    try {
      const q = mode === "daily" ? "mode=daily" : `mode=run&period=${period}`;
      const data = await fetch(`/api/leaderboard?${q}`).then(r => r.json());
      UI.renderLeaderboard(data.top ?? []);
    } catch { UI.renderLeaderboard([]); }
  });
};
document.getElementById("btn-daily").onclick = async () => {
  ensureAudio(); persist();
  pendingAutoStart = true;
  UI.menuMessage("Summoning today's dark…");
  try {
    const r = await createRoom("daily");
    world.code = r.code;
    world.joinUrl = `${location.origin}/j/${r.code}`;
    history.replaceState(null, "", `/j/${r.code}`);
    UI.toast("🌑 DAILY DARK — same waves for everyone. First attempt counts.", 4200);
    doConnect(r.code);
  } catch {
    UI.menuMessage("Could not start the daily. Retry?");
  }
};

let pendingAutoStart = false;
let prevPhase = PHASE.LOBBY;
let seq = 0;
let lastInput = { mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 };
let reconnects = 0;

UI.ui.onAction = async (a) => {
  ensureAudio();
  if (a.t === "ui_pilot") {
    world.myPilot = a.pilot;
    persist();
    if (net.connected) sendAction({ t: "pilot", pilot: a.pilot });
  } else if (a.t === "ui_solo" || a.t === "ui_create") {
    persist();
    pendingAutoStart = a.t === "ui_solo";
    UI.menuMessage("Creating room…");
    try {
      const r = await createRoom();
      world.code = r.code;
      world.joinUrl = r.joinUrl ?? `${location.origin}/j/${r.code}`;
      history.replaceState(null, "", `/j/${r.code}`);
      doConnect(r.code);
    } catch (e) {
      UI.menuMessage(e.message === "server_full" ? "Server is full — try again shortly." : "Could not create a room. Retry?");
    }
  } else if (a.t === "ui_join") {
    persist();
    world.code = a.code;
    world.joinUrl = `${location.origin}/j/${a.code}`;
    UI.menuMessage("Joining…");
    doConnect(a.code);
  } else if (a.t === "ui_invite") {
    UI.invite(world.joinUrl, world.code);
  } else if (a.t === "buy") {
    sendAction(a);
  } else if (a.t === "shop_done") {
    sendAction(a);
    UI.showScreen("screen-draft");
  } else if (a.t === "start" || a.t === "again" || a.t === "bank") {
    sendAction({ t: a.t });
    if (a.t === "again") {
      resetForRun();
      UI.clearDraftLocals();
      for (const seat of world.locals) {
        seat.mods = []; seat.stats = computeStats(PILOTS[seat.pilot], []);
        seat.offer = null; seat.grant = null; seat.pickedUi = false;
      }
      UI.hideScreens();
    }
  } else if (a.t === "pick") {
    sendAction(a);
    sfx.pick();
  }
};

function persist() {
  localStorage.setItem("ultradark", JSON.stringify({ name: UI.getName(), pilot: world.myPilot }));
}

function doConnect(code) {
  connect(code, { name: UI.getName(), pilot: world.myPilot, resumeKey: world.resumeKey || undefined });
}

// ---------- couch co-op: extra local seats, one socket per player ----------
const MAX_LOCAL = 4; // P1 + 3 pads on one screen

function addLocalPlayer(padIndex) {
  if (!net.connected) { UI.toast("🎮 Join a lobby first, then press START to add players."); return; }
  if (1 + world.locals.length >= MAX_LOCAL) { UI.toast("🎮 Couch is full (4 on this screen)."); return; }
  const n = world.locals.length + 2;
  const seat = {
    id: 0, padIndex, name: `${UI.getName().slice(0, 8)}·${n}`,
    pilot: (world.myPilot + n - 1) % PILOTS.length,
    pred: { x: ARENA_W / 2, y: ARENA_H / 2, vx: 0, vy: 0, dashT: 0, aim: 0 },
    mods: [], stats: null, lastInput: null, seq: 0, dashPrev: false,
    offer: null, grant: null, hud: null, conn: null,
  };
  seat.stats = computeStats(PILOTS[seat.pilot], []);
  claimPad(padIndex, seat);
  seat.conn = connectExtra(world.code, { name: seat.name, pilot: seat.pilot }, {
    onWelcome(w) {
      seat.id = w.id;
      world.locals.push(seat);
      const pilot = PILOTS[seat.pilot];
      UI.toast(`🎮 ${pilot.symbol} ${seat.name} joined on controller ${padIndex + 1}${w.spectating ? " — drops in next wave" : ""}`, 3200);
      sfx.pick();
    },
    onEvent(ev) {
      if (ev.t === "draft_offer") {
        seat.offer = ev.offer;
        UI.addDraftRow(seat, PILOTS[seat.pilot]);
        if (seat.shopOffer) UI.addShopRow(seat, PILOTS[seat.pilot], seat.shopOffer, seat.shopCores ?? 0);
      } else if (ev.t === "shop_offer") {
        seat.shopOffer = ev.items;
        seat.shopCores = ev.cores;
        if (seat.offer) UI.addShopRow(seat, PILOTS[seat.pilot], ev.items, ev.cores); // draft row already up
      } else if (ev.t === "shop_err") {
        UI.toast(`🎮 ${seat.name}: ${ev.why === "poor" ? "not enough cores" : ev.why === "owned" ? "already owned" : "can't buy"}`, 1600);
      } else if (ev.t === "class_grant") {
        seat.mods.push(ev.mod);
        seat.stats = computeStats(PILOTS[seat.pilot], seat.mods);
        seat.grant = ev;
      } else if (ev.t === "error") {
        UI.toast(ev.error === "room_full" ? "Room is full (8 max)." : "Could not join this room.");
      }
    },
    onClose() {
      const i = world.locals.indexOf(seat);
      if (i >= 0) world.locals.splice(i, 1);
      releasePad(padIndex);
      if (net.connected) UI.toast(`🎮 ${seat.name} left`);
    },
  });
}

// ---------- net wiring ----------
net.onWelcome = (w) => {
  if (w.proto && w.proto !== PROTO) { location.reload(); return; } // stale cached client
  world.myId = w.id;
  world.code = w.code;
  world.resumeKey = w.resumeKey;
  world.joinUrl = `${location.origin}/j/${w.code}`;
  reconnects = 0;
  R.setNames(w.roster);
  nameCache.clear();
  for (const r of w.roster) nameCache.set(r.id, r.name);
  if (w.phase === PHASE.LOBBY) {
    UI.showLobby(w.code, w.roster, world.myId);
    if (pendingAutoStart) { pendingAutoStart = false; sendAction({ t: "start" }); }
  } else {
    UI.hideScreens();
    if (w.spectating) UI.toast("Run in progress — you drop in at the next wave.", 4000);
  }
};

net.onSnapshot = (s) => {
  onSnapshot(s);
  if (s.phase !== prevPhase) onPhaseChange(prevPhase, s.phase);
  prevPhase = s.phase;
};

net.onClose = () => {
  if (world.resumeKey && inGame() && reconnects < 5) {
    reconnects++;
    UI.toast(`Connection lost — rejoining (${reconnects})…`);
    setTimeout(() => doConnect(world.code), 1200 * reconnects);
  } else if (reconnects >= 5) {
    UI.toast("Could not rejoin. Refresh to try again.", 6000);
  }
};

function onPhaseChange(from, to) {
  if (to === PHASE.WAVE) { UI.hideScreens(); }
  if (to === PHASE.LOBBY && from !== PHASE.LOBBY) {
    UI.showLobby(world.code, [], world.myId);
  }
}

net.onEvent = (ev) => {
  handleEvent(ev); // world-model side effects first (patterns, mods, …)
  switch (ev.t) {
    case "kill": {
      const def = ENEMIES[ev.kind];
      R.fxKill(ev.x, ev.y, def?.color ?? "#fff", !!def?.boss);
      R.fxPopup(ev.x, ev.y, `+${ev.points}`, ev.who === world.myId ? "#ffe45b" : "#9fb4dd");
      R.addTrauma(def?.boss ? 0.6 : 0.05);
      if (def?.boss) R.hitstop(220);
      sfx.kill();
      const mi = Math.floor(world.mult);
      if (mi > (net._lastMi ?? 1)) R.gridMilestone();
      net._lastMi = mi;
      break;
    }
    case "pattern": break; // handled in game.handleEvent
    case "cleave":
      if (ev.who !== world.myId) { // own swing is drawn locally at fire cadence
        R.fxCleave(ev.x, ev.y, ev.aim, ev.r, ev.full);
        sfx.swing();
      }
      break;
    case "aura_heal":
      if (ev.who === world.myId) R.fxPopup(world.me.x, world.me.y, "+♥", "#b8ff5e");
      break;
    case "shop_offer":
      world.shopOffer = ev.items;
      UI.showShopTab(ev.cores);
      break;
    case "bought": {
      const it = shopItemById(ev.mod);
      if (ev.who === world.myId && it) {
        UI.toast(`⬡ Bought ${it.name}`, 2000);
        sfx.buy();
      }
      // couch seats: keep prediction stats in sync with purchases
      const bSeat = world.locals.find(l => l.id === ev.who);
      if (bSeat && !bSeat.mods.includes(ev.mod)) {
        bSeat.mods.push(ev.mod);
        bSeat.stats = computeStats(PILOTS[bSeat.pilot], bSeat.mods);
      }
      break;
    }
    case "shop_err":
      UI.toast(ev.why === "poor" ? "Not enough cores." : ev.why === "owned" ? "Already owned." : "Can't buy that.", 1800);
      break;
    case "bomb": R.fxBomb(); sfx.bomb(); break;
    case "hurt":
      if (ev.who === world.myId) { R.addTrauma(0.5); R.hitstop(50); sfx.hurt(); }
      else R.addTrauma(0.15);
      break;
    case "dash": if (ev.who === world.myId) sfx.dash(); break;
    case "ability":
      if (ev.pilot === 2 && ev.phase === 1) {
        if (ev.who === world.myId) UI.toast("◇ Beacon placed — press Q again to warp back", 2600);
        sfx.pick();
      } else if (ev.pilot === 2 && ev.phase === 2) {
        sfx.warp();
      } else if (ev.pilot === 6) {
        sfx.freeze(); R.addTrauma(0.2);
      } else {
        sfx.ability();
      }
      break;
    case "nova": R.addTrauma(0.2); break;
    case "downed":
      UI.banner(ev.who === world.myId ? "YOU ARE DOWN" : `${nameOf(ev.who)} IS DOWN`, true, 2200);
      if (ev.who === world.myId && ev.cause) UI.toast(`☠ Killed by ${ev.cause}`, 3200); // death recap
      sfx.down();
      R.addTrauma(0.5);
      break;
    case "leech":
      if (ev.who === world.myId) {
        R.fxPopup(world.me.x, world.me.y, "MULTIPLIER DRAINED", "#5bffc9");
        R.addTrauma(0.15);
      }
      break;
    case "laser_warn": case "laser_fire": break; // game.handleEvent stores them
    case "doors": if (ev.open) UI.banner("FOUNDRY DOORS OPEN — HIT IT NOW", true, 1400); break;
    case "streak": if (ev.who === world.myId) { UI.toast("🔥 KILL STREAK — +1 BOMB"); } break;
    case "revived":
      if (!ev.solo) UI.toast(ev.cost > 0 ? `Revived — insurance cost ${ev.cost.toLocaleString("en-US")} banked` : "Revived!");
      sfx.revive();
      break;
    case "out": UI.banner(`${nameOf(ev.who)} IS OUT`, true); break;
    case "wave_start":
      UI.hideScreens();
      UI.clearDraftLocals();
      UI.hideShopTab();
      world.shopOffer = null;
      for (const seat of world.locals) {
        seat.offer = null; seat.grant = null; seat.pickedUi = false;
        seat.shopOffer = null; seat.shopEls = null; seat.shopDoneUi = false;
      }
      UI.banner(`WAVE ${ev.wave}`, false, 1600);
      sfx.wave();
      break;
    case "wave_end": UI.banner("WAVE CLEAR", false, 1400); break;
    case "boss": UI.banner(`⚠ ${ev.name}`, true, 2600); sfx.boss(); break;
    case "enrage": UI.banner("ENRAGED", true, 1500); R.addTrauma(0.4); break;
    case "boss_down": UI.banner("BOSS DOWN — +1 BOMB", false, 2000); break;
    case "class_grant":
      sfx.pick();
      break;
    case "pickup_got":
      if (ev.who === world.myId) {
        const c = CONSUMABLES[ev.kind];
        if (c) UI.toast(`${c.glyph} ${c.name} — press F to use`, 2200);
        sfx.pickup();
      }
      break;
    case "consumed": {
      const c = CONSUMABLES[ev.kind];
      if (ev.who === world.myId && c) {
        UI.banner(`${c.glyph} ${c.name.toUpperCase()}`, false, 1200);
        if (ev.kind === CK.SHIELD) R.addTrauma(0.1);
      }
      sfx.use();
      break;
    }
    case "draft_offer":
      UI.showDraft(ev.offer, world.unbanked, true, world.lastGrant);
      world.lastGrant = null;
      break;
    case "bank":
      sfx.bank();
      UI.toast(`🏦 BANKED ${ev.amount.toLocaleString("en-US")}`);
      UI.updateBank(0, false);
      break;
    case "picked": {
      // keep couch seats' prediction stats in sync with their drafts
      const seat = world.locals.find(l => l.id === ev.who);
      if (seat && !seat.mods.includes(ev.mod)) {
        seat.mods.push(ev.mod);
        seat.stats = computeStats(PILOTS[seat.pilot], seat.mods);
      }
      break;
    }
    case "intermission":
      world.intermissionS = ev.seconds || 20;
      break;
    case "gameover":
      lastEnd = ev; challengeBeaten = false;
      sfx.over(); UI.showScore(ev, false, world.challenge);
      break;
    case "victory":
      lastEnd = ev; challengeBeaten = false;
      sfx.win(); UI.showScore(ev, true, world.challenge);
      break;
    case "roster":
      R.setNames(ev.roster);
      nameCache.clear();
      for (const r of ev.roster) nameCache.set(r.id, r.name);
      UI.updateRoster(ev.roster, world.myId);
      break;
    case "error":
      UI.menuMessage(ev.error === "room_full" ? "That room is full (4 max)." : "Room not found — it may have expired.");
      UI.showScreen("screen-menu");
      break;
  }
};

const nameCache = new Map();
function nameOf(id) { return nameCache.get(id) ?? "ALLY"; }

// ---------- loops ----------
let last = performance.now();
let fireAcc = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  lastInput = pollInput();
  // couch co-op: unclaimed pad pressing START joins the room
  const joinPad = detectPadJoin();
  if (joinPad != null) addLocalPlayer(joinPad);
  // per-seat pad input + draft navigation
  for (const seat of world.locals) {
    seat.lastInput = pollPad(seat.padIndex);
    if (world.phase === PHASE.INTERMISSION && seat.offer && !seat.pickedUi) {
      const nav = pollPadNav(seat.padIndex);
      if (nav.left) UI.seatDraftMove(seat, -1);
      if (nav.right) UI.seatDraftMove(seat, 1);
      if (nav.confirm) {
        const id = UI.seatDraftConfirm(seat);
        if (id) { seat.conn.sendAction({ t: "pick", id }); sfx.pick(); }
      }
    } else if (world.phase === PHASE.INTERMISSION && seat.pickedUi && seat.shopEls && !seat.shopDoneUi) {
      // after drafting, the seat's d-pad drives its shop row
      const nav = pollPadNav(seat.padIndex);
      if (nav.left) UI.seatShopMove(seat, -1);
      if (nav.right) UI.seatShopMove(seat, 1);
      if (nav.confirm) {
        const id = UI.seatShopConfirm(seat);
        if (id === "__done") seat.conn.sendAction({ t: "shop_done" });
        else if (id) { seat.conn.sendAction({ t: "buy", id }); sfx.buy(); }
      }
    }
  }
  if (!R.isHitstopped()) game.frame(dt, lastInput);
  // local muzzle feel: flash at predicted cadence while firing
  if ((lastInput.buttons & BTN.FIRE) && world.myState === PS.ALIVE && world.phase === PHASE.WAVE) {
    fireAcc -= dt;
    if (fireAcc <= 0) {
      const wpn = PILOTS[world.myPilot].weapon;
      fireAcc = wpn.cd / (world.myStats.fire || 1);
      if (wpn.kind === "cleave") {
        R.fxCleave(world.me.x, world.me.y, world.me.aim, wpn.arcR, world.myStats.cleave360 > 0);
        sfx.swing();
      } else {
        R.fxMuzzle(world.me.x, world.me.y, world.me.aim, PILOTS[world.myPilot].color);
        ({ smg: sfx.smg, shotgun: sfx.boom, lance: sfx.lance, rail: sfx.rail, arc: sfx.arc }[wpn.kind] ?? sfx.shoot)();
      }
    }
  } else fireAcc = 0;
  // live challenge check: the moment the squad's total passes the target
  if (world.challenge && !challengeBeaten && inGame() &&
      world.banked + world.unbanked > world.challenge.s) {
    challengeBeaten = true;
    UI.banner(`⚔ ${world.challenge.n}'S SCORE FALLS`, false, 2600);
    sfx.bank();
    R.gridMilestone();
  }
  R.draw(dt);
  // intermission UI ticks
  if (world.phase === PHASE.INTERMISSION) {
    UI.updateDraftTimer(world.phaseT / (world.intermissionS * 30)); // post-boss runs 40s
    UI.updateBank(world.unbanked, true);
    UI.updateShop(world.myCores, world.myMods);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => {
  if (net.connected && world.myId) {
    seq = (seq + 1) % 65536;
    sendInput(seq, lastInput);
  }
  for (const seat of world.locals) {
    if (seat.id && seat.lastInput && seat.conn.ws.readyState === 1) {
      seat.seq = (seat.seq + 1) % 65536;
      seat.conn.sendInput(seat.seq, seat.lastInput);
    }
  }
}, 1000 / 30);

// PWA
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => { });
}
addEventListener("pointerdown", ensureAudio, { once: false });
