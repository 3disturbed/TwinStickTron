// DOM overlays: menu, lobby, draft, score, toasts, banners.
// The canvas is the game; this file is everything around it.

import { PILOTS, PHASE, MAX_PLAYERS } from "/shared/constants.js";
import { MODS, modById } from "/shared/mods.js";

const $ = (id) => document.getElementById(id);
const screens = ["screen-menu", "screen-lobby", "screen-draft", "screen-score", "screen-settings", "screen-lb"];

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
  for (let i = 0; i < MAX_PLAYERS; i++) {
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
export function showDraft(offer, bankAmount, canBank, grant) {
  const g = $("class-grant");
  if (grant) {
    g.innerHTML = `✦ CLASS UPGRADE — <b>${grant.name}</b>: ${grant.desc}`;
    g.classList.remove("hidden");
  } else {
    g.classList.add("hidden");
  }
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
  let rankLine = "";
  if (ev.counted && ev.rank) {
    const what = ev.mode === "daily" ? "DAILY DARK RANK" : "WORLD RANK";
    rankLine = `<div style="color:#39f0ff">★ ${what} #${ev.rank}</div>`;
  } else if (ev.mode === "daily" && ev.counted === false) {
    rankLine = `<div class="lost">Daily already attempted today — score not counted</div>`;
  }
  $("score-body").innerHTML =
    `<div class="big">${ev.score.toLocaleString("en-US")}</div>` + rankLine +
    (ev.lost > 0 ? `<div class="lost">${ev.lost.toLocaleString("en-US")} unbanked — gone</div>` : "") +
    `<div>Wave ${ev.wave} · best ×${ev.bestMult}</div>` + rows;
  showScreen("screen-score");
}

// ---------- settings ----------
export function openSettings(s) {
  $("set-shake").value = Math.round(s.shake * 100);
  $("set-floor").value = Math.round(s.floor * 100);
  $("set-vol").value = Math.round(s.volume * 400); // master 0..0.25 → 0..100
  syncSettingLabels(s);
  showScreen("screen-settings");
}
export function syncSettingLabels(s) {
  $("v-shake").textContent = `${Math.round(s.shake * 100)}%`;
  $("v-floor").textContent = `${Math.round(s.floor * 100)}%`;
  $("v-vol").textContent = `${Math.round(s.volume * 400)}%`;
  $("set-flash").textContent = s.flash ? "ON" : "OFF (photosensitive)";
}
export function bindSettings(s, onChange) {
  $("set-shake").oninput = (e) => { s.shake = e.target.value / 100; syncSettingLabels(s); onChange(); };
  $("set-floor").oninput = (e) => { s.floor = e.target.value / 100; syncSettingLabels(s); onChange(); };
  $("set-vol").oninput = (e) => { s.volume = e.target.value / 400; syncSettingLabels(s); onChange(); };
  $("set-flash").onclick = () => { s.flash = !s.flash; syncSettingLabels(s); onChange(); };
}

// ---------- leaderboards ----------
export function openLeaderboard(fetchTab) {
  const tabs = document.querySelectorAll(".lb-tab");
  tabs.forEach(b => {
    b.onclick = () => {
      tabs.forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      fetchTab(b.dataset.mode, b.dataset.period);
    };
  });
  tabs[0].classList.add("active");
  tabs.forEach((x, i) => { if (i) x.classList.remove("active"); });
  fetchTab("run", "all");
  showScreen("screen-lb");
}
export function renderLeaderboard(rows) {
  const el = $("lb-body");
  if (!rows.length) { el.innerHTML = `<p class="dim">No scores yet — set the first one.</p>`; return; }
  el.innerHTML = rows.map((r, i) =>
    `<div class="lb-row"><span class="rank">${i + 1}</span>` +
    `<span class="score">${r.score.toLocaleString("en-US")}</span>` +
    `<span class="who">${r.names.map(escapeHtml).join(" + ")}</span>` +
    `<span class="wave">w${r.wave}${r.squad > 1 ? ` · ${r.squad}p` : ""}</span></div>`
  ).join("");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
