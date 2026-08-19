// DOM overlays: menu, lobby, draft, score, toasts, banners.
// The canvas is the game; this file is everything around it.

import { PILOTS, PHASE } from "/shared/constants.js";
import { MODS, modById } from "/shared/mods.js";

const $ = (id) => document.getElementById(id);
const screens = ["screen-menu", "screen-lobby", "screen-draft", "screen-score"];

export const ui = { onAction: null }; // main.js wires this

export function showScreen(name) {
  for (const s of screens) $(s).classList.toggle("hidden", s !== name);
}
export function hideScreens() { for (const s of screens) $(s).classList.add("hidden"); }

// ---------- menu ----------
export function initMenu(joinCode, defaults) {
  $("name").value = defaults.name ?? "";
  const pilotsEl = $("pilots");
  pilotsEl.innerHTML = "";
  for (const p of PILOTS) {
    const el = document.createElement("div");
    el.className = "pilot" + (p.id === defaults.pilot ? " sel" : "");
    el.style.setProperty("--c", p.color);
    el.innerHTML = `<div class="nm" style="color:${p.color}">${p.name}</div><div class="ab">${p.lean}<br>✦ ${p.ability}</div>`;
    el.onclick = () => {
      pilotsEl.querySelectorAll(".pilot").forEach(x => x.classList.remove("sel"));
      el.classList.add("sel");
      ui.onAction?.({ t: "ui_pilot", pilot: p.id });
    };
    pilotsEl.appendChild(el);
  }
  if (joinCode) {
    $("btn-join").classList.remove("hidden");
    $("btn-solo").classList.add("hidden");
    $("btn-create").classList.add("hidden");
    $("menu-msg").textContent = `Joining room ${joinCode}…press JOIN`;
    $("btn-join").textContent = `JOIN RUN · ${joinCode}`;
  }
  $("btn-solo").onclick = () => ui.onAction?.({ t: "ui_solo" });
  $("btn-create").onclick = () => ui.onAction?.({ t: "ui_create" });
  $("btn-join").onclick = () => ui.onAction?.({ t: "ui_join", code: joinCode });
  showScreen("screen-menu");
}

export function menuMessage(msg) { $("menu-msg").textContent = msg; }
export function getName() { return $("name").value.trim().toUpperCase() || "PILOT"; }

// ---------- lobby ----------
export function showLobby(code, roster, myId) {
  $("lobby-code").textContent = code;
  updateRoster(roster, myId);
  showScreen("screen-lobby");
}
export function updateRoster(roster, myId) {
  const el = $("roster");
  el.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const r = roster[i];
    const slot = document.createElement("div");
    slot.className = "slot" + (r ? " filled" : "");
    if (r) {
      const pilot = PILOTS[r.pilot] ?? PILOTS[0];
      slot.innerHTML = `<span style="color:${pilot.color}">${r.name}${r.id === myId ? " (YOU)" : ""}</span><span class="dim">${pilot.name}</span>`;
    } else {
      slot.textContent = "— open slot — send the link —";
    }
    el.appendChild(slot);
  }
}

// ---------- invite ----------
export async function invite(joinUrl, code) {
  const text = `Fight with me in UltraDark — wave shooter, right in the browser. Room ${code}:`;
  if (navigator.share) {
    try { await navigator.share({ title: "UltraDark", text, url: joinUrl }); return; } catch { /* fallthrough */ }
  }
  try {
    await navigator.clipboard.writeText(joinUrl);
    toast("Link copied — send it to a friend!");
  } catch {
    toast(joinUrl);
  }
}

// ---------- draft ----------
export function showDraft(offer, bankAmount, canBank) {
  const cardsEl = $("draft-cards");
  cardsEl.innerHTML = "";
  for (const id of offer) {
    const m = modById(id);
    if (!m) continue;
    const el = document.createElement("div");
    el.className = "card" + (m.rarity >= 2 ? " r2" : "") + (m.cursed ? " cursed" : "");
    el.innerHTML = `<div class="fam">${m.cursed ? "⚠ CURSED · " : ""}${m.family.toUpperCase()}</div><div class="nm">${m.name}</div><div class="ds">${m.desc}</div>`;
    el.onclick = () => {
      cardsEl.querySelectorAll(".card").forEach(x => { x.onclick = null; x.style.opacity = 0.4; });
      el.style.opacity = 1;
      el.classList.add("picked");
      ui.onAction?.({ t: "pick", id });
    };
    cardsEl.appendChild(el);
  }
  updateBank(bankAmount, canBank);
  showScreen("screen-draft");
}
export function updateBank(amount, canBank) {
  $("bank-amount").textContent = amount.toLocaleString("en-US");
  $("btn-bank").disabled = !canBank || amount <= 0;
}
export function updateDraftTimer(frac) {
  $("draft-timer").firstElementChild.style.width = `${Math.max(0, frac * 100)}%`;
}
export function hideDraft() { $("screen-draft").classList.add("hidden"); }

// ---------- score ----------
export function showScore(ev, victory) {
  $("score-title").textContent = victory ? "🏆 ARENA CLEARED" : "RUN OVER";
  const rows = (ev.roster ?? []).map(r => `<div>${r.name}: ${r.kills} kills</div>`).join("");
  $("score-body").innerHTML =
    `<div class="big">${ev.score.toLocaleString("en-US")}</div>` +
    (ev.lost > 0 ? `<div class="lost">${ev.lost.toLocaleString("en-US")} unbanked — gone</div>` : "") +
    `<div>Wave ${ev.wave} · best ×${ev.bestMult}</div>` + rows;
  showScreen("screen-score");
}

// ---------- toast & banner ----------
let toastT = null;
export function toast(msg, ms = 2600) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  el.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.classList.add("hidden"), 400); }, ms);
}

let bannerT = null;
export function banner(text, warn = false, ms = 1800) {
  const el = $("banner");
  el.textContent = text;
  el.className = "banner" + (warn ? " warn" : "");
  clearTimeout(bannerT);
  bannerT = setTimeout(() => el.classList.add("hidden"), ms);
}

export function bindButtons() {
  $("btn-invite").onclick = () => ui.onAction?.({ t: "ui_invite" });
  $("btn-invite2").onclick = () => ui.onAction?.({ t: "ui_invite" });
  $("btn-start").onclick = () => ui.onAction?.({ t: "start" });
  $("btn-again").onclick = () => ui.onAction?.({ t: "again" });
  $("btn-bank").onclick = () => ui.onAction?.({ t: "bank" });
}
